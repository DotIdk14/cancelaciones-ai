import type { CanonicalFactCandidate, LegacyMappingClassification } from '@cancelaciones/rule-engine-v2';

export interface LegacyObservableFactRow {
  readonly factType: string;
  readonly value: unknown;
  readonly sourceRef: Record<string, unknown>;
  readonly confidence?: number;
}

export interface LegacyMappingDecision {
  readonly classification: LegacyMappingClassification;
  readonly canonicalFactId: string | null;
  readonly reason: string;
}

const MAPPINGS: Record<string, LegacyMappingDecision> = {
  'contact.effectiveContact': {
    classification: 'EXACT',
    canonicalFactId: 'F-contacto_efectivo',
    reason: 'Ambos contratos modelan literalmente contacto efectivo como booleano observable.',
  },
  'classroom.hasActivities': {
    classification: 'AMBIGUOUS',
    canonicalFactId: null,
    reason: 'La actividad depende de nivel y polaridad; no es un hecho canónico único.',
  },
  'student.level': {
    classification: 'DERIVABLE',
    canonicalFactId: null,
    reason: 'Alimenta EvidenceContext.nivelAcademico; no debe persistirse como verdad de regla por mapeo legacy.',
  },
};

export function classifyLegacyFactMapping(factType: string): LegacyMappingDecision {
  return MAPPINGS[factType] ?? {
    classification: 'NO_MAPPING',
    canonicalFactId: null,
    reason: 'No existe equivalencia canónica demostrable.',
  };
}

export function legacyFactToCanonicalCandidate(
  row: LegacyObservableFactRow,
): CanonicalFactCandidate | null {
  const decision = classifyLegacyFactMapping(row.factType);
  if (decision.classification !== 'EXACT' || decision.canonicalFactId === null) return null;
  if (row.factType === 'contact.effectiveContact' && typeof row.value !== 'boolean') return null;

  const evidenceId = stringField(row.sourceRef, 'evidenceId') ?? 'legacy-evidence-unknown';
  return {
    factId: decision.canonicalFactId,
    proposedState: 'KNOWN',
    value: row.value,
    evidenceId,
    ...(stringField(row.sourceRef, 'artifactId') === undefined ? {} : { artifactId: stringField(row.sourceRef, 'artifactId') }),
    ...(stringField(row.sourceRef, 'sha256') === undefined ? {} : { artifactHash: stringField(row.sourceRef, 'sha256') }),
    extractionMethod: 'IMPORTED',
    ...(row.confidence === undefined ? {} : { extractionConfidence: row.confidence }),
    extractorId: 'legacy-facts-exact-mapping',
    extractorVersion: '1.0.0',
    rawSupport: row,
  };
}

function stringField(source: Record<string, unknown>, field: string): string | undefined {
  const value = source[field];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
