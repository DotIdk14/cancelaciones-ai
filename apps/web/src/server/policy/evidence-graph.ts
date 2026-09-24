import type { StoredFact } from '@cancelaciones/db';
import type { Fact } from '@cancelaciones/policy-engine';
import { POLICY_FACT_INVENTORY } from '@cancelaciones/policy-engine';
import { mapStoredFactsToPolicyFacts } from './frozen-fact-run';

export interface GraphFactView {
  factType: string;
  value: unknown;
  evidenceId: string;
  confidence: number | null;
}

export interface GraphConflict {
  factType: string;
  entries: Array<{ factId: string; value: unknown; confidence: number | null; evidenceId: string }>;
  reason: string;
}

export interface GraphNote {
  factType: string;
  note: string;
  evidenceId?: string;
}

export interface EvidenceGraph {
  auditId: string;
  runId: string;
  factTypes: string[];
  groups: Array<{ factType: string; entries: StoredFact[] }>;
  conflicts: GraphConflict[];
  notes: GraphNote[];
  missingFacts: string[];
  resolvedFacts: StoredFact[];
  stats: {
    completeness: Record<string, number>;
    factConfidenceAvg: number;
  };
}

/** Considera que dos observaciones del mismo hecho entran en conflicto si su valor canónico difiere. */
function canonicalValue(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'object') {
    const sorted: unknown = Array.isArray(value)
      ? value.map(canonicalValue)
      : Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonicalValue(v)]));
    return JSON.stringify(sorted);
  }
  return String(value);
}

function evidenceIdOf(fact: StoredFact): string {
  return typeof fact.sourceRef.evidenceId === 'string' ? fact.sourceRef.evidenceId : '';
}

function isContactDetailsObject(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && ('email' in (value as Record<string, unknown>) || 'phoneNumbers' in (value as Record<string, unknown>)));
}

function mergeContactCollections(entries: StoredFact[]): { value: unknown; factsUsed: string[] } {
  const events: unknown[] = [];
  const seen = new Set<string>();
  let observedCount = 0;
  let sourceCompleteness: string | null = null;
  const warnings: string[] = [];
  for (const entry of entries) {
    const raw = entry.value;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const candidate = raw as { events?: unknown[]; observedCount?: unknown; sourceCompleteness?: unknown; warnings?: unknown[] };
      observedCount = Math.max(observedCount, typeof candidate.observedCount === 'number' ? candidate.observedCount : 0);
      const reportedCompleteness = candidate.sourceCompleteness;
      sourceCompleteness = reportedCompleteness === 'COMPLETE' || reportedCompleteness === 'PARTIAL' || reportedCompleteness === 'UNKNOWN'
        ? String(reportedCompleteness)
        : sourceCompleteness;
      if (Array.isArray(candidate.warnings)) warnings.push(...candidate.warnings.filter((w): w is string => typeof w === 'string'));
      for (const event of candidate.events ?? []) {
        if (!event || typeof event !== 'object') continue;
        const item = event as { kind?: string; channel?: string; occurredAt?: string; dateTime?: string; status?: string };
        const identity = `${item.kind ?? item.channel ?? ''}|${item.occurredAt ?? item.dateTime ?? ''}|${item.status ?? ''}`;
        if (!seen.has(identity)) { seen.add(identity); events.push(event); }
      }
    }
  }
  return {
    value: { events, observedCount: Math.max(observedCount, events.length), sourceCompleteness: sourceCompleteness ?? 'UNKNOWN', warnings },
    factsUsed: entries.map((e) => e.id),
  };
}

/**
 * Construye el Grafo de Evidencia a partir de los hechos almacenados de un Fact
 * Run congelado. Conserva TODAS las observaciones (no descarta duplicados),
 * detecta contradicciones entre artefactos, normaliza formas degeneradas y
 * produce los hechos resueltos que alimentan al Rule Engine.
 */
export function buildEvidenceGraph(input: { auditId: string; runId: string; storedFacts: StoredFact[] }): EvidenceGraph {
  const { auditId, runId, storedFacts } = input;
  const grouped = new Map<string, StoredFact[]>();
  for (const fact of storedFacts) grouped.set(fact.factType, [...(grouped.get(fact.factType) ?? []), fact]);

  const factTypes = [...grouped.keys()].sort();
  const conflicts: GraphConflict[] = [];
  const notes: GraphNote[] = [];
  const resolvedFacts: StoredFact[] = [];
  const completeness: Record<string, number> = {};

  for (const [factType, entries] of grouped) {
    if (factType === 'contact.effectiveContact' && entries.every((e) => isContactDetailsObject(e.value))) {
      // Forma degenerada: el dato de contacto efectivo llegó como objeto de
      // contactos (email/telefonos). No se puede afirmar ni negar efectividad.
      notes.push({ factType, note: 'contact.effectiveContact recibido como datos de contacto (email/telefonos); efectividad NO confirmada.', evidenceId: evidenceIdOf(entries[0]) });
      continue;
    }

    if (factType === 'contact.callAttempts' || factType === 'contact.writtenInteractions') {
      const merged = mergeContactCollections(entries);
      resolvedFacts.push({ ...entries[0], value: merged.value });
      const scalar = entries[0].value && typeof entries[0].value === 'object' && !Array.isArray(entries[0].value)
        ? (entries[0].value as { sourceCompleteness?: unknown }).sourceCompleteness
        : 'UNKNOWN';
      const completenessKey = scalar === 'COMPLETE' || scalar === 'PARTIAL' ? String(scalar) : 'UNKNOWN';
      completeness[factType] = completenessKey === 'COMPLETE' ? 1 : completenessKey === 'PARTIAL' ? 0.5 : 0;
      continue;
    }

    const uniqueValues = new Set(entries.map((e) => canonicalValue(e.value)));
    if (uniqueValues.size > 1) {
      conflicts.push({
        factType,
        entries: entries.map((e) => ({ factId: e.id, value: e.value, confidence: e.confidence, evidenceId: evidenceIdOf(e) })),
        reason: `Valores contradictorios observados en distintos artefactos: ${[...uniqueValues].join(' vs ')}`,
      });
      // Resolución determinista: mayor confianza; empate => el más reciente.
      const sorted = [...entries].sort((a, b) => {
        const diff = (b.confidence ?? 0) - (a.confidence ?? 0);
        if (Math.abs(diff) > 0.001) return diff;
        return b.createdAt.localeCompare(a.createdAt);
      });
      notes.push({ factType, note: `Contradiccion resuelta por confianza/fecha: se conserva el valor de ${sorted[0].id}.`, evidenceId: evidenceIdOf(sorted[0]) });
      resolvedFacts.push(sorted[0]);
      completeness[factType] = 1;
      continue;
    }

    resolvedFacts.push(entries[0]);
    if (factType.includes('callAttempts') || factType.includes('writtenInteractions')) completeness[factType] = 1;
  }

  const observedTypes = new Set(resolvedFacts.map((f) => f.factType));
  const missingFacts = POLICY_FACT_INVENTORY.filter((type) => !observedTypes.has(type) && !grouped.has(type));

  const confident = resolvedFacts.filter((f) => f.confidence !== null).map((f) => f.confidence as number);
  const factConfidenceAvg = confident.length ? confident.reduce((a, b) => a + b, 0) / confident.length : 0;

  return {
    auditId,
    runId,
    factTypes,
    groups: [...grouped.entries()].map(([factType, entries]) => ({ factType, entries })),
    conflicts,
    notes,
    missingFacts,
    resolvedFacts,
    stats: { completeness, factConfidenceAvg },
  };
}

export interface GraphStatsForAdjudicator {
  factTypes: string[];
  conflicts: number;
  missingFacts: string[];
  completeness: Record<string, number>;
  factConfidenceAvg: number;
}

export function graphStats(graph: EvidenceGraph): GraphStatsForAdjudicator {
  return {
    factTypes: graph.factTypes,
    conflicts: graph.conflicts.length,
    missingFacts: graph.missingFacts,
    completeness: graph.stats.completeness,
    factConfidenceAvg: graph.stats.factConfidenceAvg,
  };
}

/** Hechos resueltos listos para el Rule Engine (una observación canónica por tipo). */
export function graphToPolicyFacts(graph: EvidenceGraph): Fact[] {
  return mapStoredFactsToPolicyFacts(graph.resolvedFacts);
}