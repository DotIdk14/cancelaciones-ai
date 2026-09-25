import type { Fact } from '@cancelaciones/policy-engine';
import type { FactExtractionRun, StoredFact } from '@cancelaciones/db';

/**
 * ============================================================================
 * ADAPTADORES DE HECHOS PARA EL MOTOR NORMATIVO
 * ============================================================================
 * Hay DOS formas de que un Fact Run FROZEN exponga sus hechos, y este módulo
 * tiene un adaptador para cada una. Los dos devuelven `Fact[]`, y para un
 * conjunto equivalente de hechos devuelven EXACTAMENTE el mismo array: por eso
 * `evaluatePolicy` produce el mismo `factsFingerprint` y el outcome no puede
 * depender de por dónde se leyó.
 *
 *  1. `mapStoredFactsToPolicyFacts` — filas de la tabla `facts`. Agrupa por
 *     `factType` (en orden de primera aparición) y fusiona las colecciones de
 *     contacto. Es la ruta que se sigue usando en la extracción, en el evidence
 *     graph y en el fixture sintético.
 *
 *  2. `mapSnapshotFactsToPolicyFacts` — el array `facts` de
 *     `fact_run_frozen_snapshots`, que es "hechos canónicos tal como los verá el
 *     motor" (migración 20260925120000, §5). Ya viene aplanado y CON las
 *     correcciones humanas aplicadas en el instante del sellado, así que este
 *     adaptador NO vuelve a reinterpretar nada: sólo valida la forma y la
 *     proyecta. Un snapshot mal formado se rechaza con un error explícito en
 *     vez de devolver hechos silenciosamente distintos, que es la forma más
 *     barata de mover un outcome sin que nadie lo note.
 *
 * `getFrozenEffectiveFacts` (apps/web/src/server/facts/fact-run-snapshot.ts) es
 * quien decide cuál de las dos usar, y degrada a propósito cuando el objeto
 * sellado todavía no existe: ése es el mecanismo de R-8 que protege los
 * outcomes.
 */

export function validateFrozenFactRun(input: {
  auditId: string;
  policyCode: string;
  policyVersion: string;
  run: FactExtractionRun | null;
}): { ok: true; run: FactExtractionRun } | { ok: false; status: number; code: string; message: string } {
  if (!input.run) return { ok: false, status: 404, code: 'FACT_RUN_NOT_FOUND', message: 'Fact Run no encontrado.' };
  if (input.run.auditId !== input.auditId) return { ok: false, status: 403, code: 'FACT_RUN_AUDIT_MISMATCH', message: 'El Fact Run no pertenece a esta auditoria.' };
  if (input.run.policyCode !== input.policyCode || input.run.policyVersion !== input.policyVersion) {
    return { ok: false, status: 409, code: 'POLICY_VERSION_MISMATCH', message: 'El Fact Run no corresponde al policyCode/policyVersion solicitado.' };
  }
  if (input.run.state !== 'FROZEN') return { ok: false, status: 409, code: 'FACT_RUN_NOT_FROZEN', message: 'Solo se puede evaluar un Fact Run congelado.' };
  return { ok: true, run: input.run };
}

export function mapStoredFactsToPolicyFacts(facts: StoredFact[]): Fact[] {
  const grouped = new Map<string, StoredFact[]>();
  for (const fact of facts) grouped.set(fact.factType, [...(grouped.get(fact.factType) ?? []), fact]);
  return Array.from(grouped.entries()).map(([type, entries]) => {
    const first = entries[0];
    let value: unknown = first.value;
    if (type === 'contact.callAttempts' || type === 'contact.writtenInteractions') {
      const events = entries.flatMap((entry) => {
        if (entry.value && typeof entry.value === 'object' && !Array.isArray(entry.value)) {
          const candidate = entry.value as { events?: unknown[]; observedCount?: number; sourceCompleteness?: string };
          return candidate.events ?? [];
        }
        return [];
      });
      const counts = entries.map((entry) => {
        if (typeof entry.value === 'number') return entry.value;
        if (typeof entry.value === 'string' && /^\d+$/.test(entry.value)) return Number(entry.value);
        if (entry.value && typeof entry.value === 'object' && !Array.isArray(entry.value)) {
          const count = (entry.value as { observedCount?: unknown }).observedCount;
          return typeof count === 'number' ? count : null;
        }
        return null;
      }).filter((count): count is number => count !== null);
      const uniqueEvents = Array.from(new Map(events.map((event) => {
        const item = event as { kind?: string; channel?: string; occurredAt?: string; dateTime?: string; status?: string };
        return [`${item.kind ?? item.channel ?? ''}|${item.occurredAt ?? item.dateTime ?? ''}|${item.status ?? ''}`, event];
      })).values());
      const completeness = entries.some((entry) => entry.value && typeof entry.value === 'object' && !Array.isArray(entry.value) && (entry.value as { sourceCompleteness?: string }).sourceCompleteness === 'PARTIAL')
        ? 'PARTIAL'
        : entries.every((entry) => entry.value && typeof entry.value === 'object' && !Array.isArray(entry.value) && (entry.value as { sourceCompleteness?: string }).sourceCompleteness === 'COMPLETE') ? 'COMPLETE' : 'UNKNOWN';
      value = { events: uniqueEvents, observedCount: Math.max(uniqueEvents.length, ...(counts.length ? counts : [0])), sourceCompleteness: completeness };
    }
    return {
      id: first.id,
      type,
      value,
      source: {
        evidenceId: String(first.sourceRef.evidenceId ?? ''),
        artifactId: first.sourceRef.artifactId ? String(first.sourceRef.artifactId) : undefined,
        page: typeof first.sourceRef.page === 'number' ? first.sourceRef.page : undefined,
        timestampStart: typeof first.sourceRef.timestampStart === 'number' ? first.sourceRef.timestampStart : undefined,
        timestampEnd: typeof first.sourceRef.timestampEnd === 'number' ? first.sourceRef.timestampEnd : undefined,
        sha256: first.sourceRef.sha256 ? String(first.sourceRef.sha256) : undefined,
      },
      extractionConfidence: first.confidence ?? undefined,
    };
  });
}

/**
 * Proyecta el array `facts` de `fact_run_frozen_snapshots` a `Fact[]`.
 *
 * NO agrupa, NO fusiona colecciones de contacto y NO aplica revisiones: el
 * snapshot ya es el resultado final. Lo único que hace es validar que cada
 * entrada tenga `id`, `type` y `value`, porque un hecho sin `value` no es un
 * hecho: `UNKNOWN_IS_NOT_FALSE` exige que la ausencia de un valor se distinga de
 * un valor falso, y un `value` ausente se perdería en la proyección.
 */
export function mapSnapshotFactsToPolicyFacts(facts: unknown): Fact[] {
  if (!Array.isArray(facts)) throw new Error('FROZEN_SNAPSHOT_PAYLOAD_INVALID: facts no es un array');
  return facts.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) throw new Error(`FROZEN_SNAPSHOT_PAYLOAD_INVALID: facts[${index}] no es un objeto`);
    const fact = entry as { id?: unknown; type?: unknown; value?: unknown; source?: unknown; extractionConfidence?: unknown };
    if (typeof fact.id !== 'string' || !fact.id) throw new Error(`FROZEN_SNAPSHOT_PAYLOAD_INVALID: facts[${index}].id ausente`);
    if (typeof fact.type !== 'string' || !fact.type) throw new Error(`FROZEN_SNAPSHOT_PAYLOAD_INVALID: facts[${index}].type ausente`);
    if (!('value' in fact)) throw new Error(`FROZEN_SNAPSHOT_PAYLOAD_INVALID: facts[${index}].value ausente`);
    return {
      id: fact.id,
      type: fact.type,
      value: fact.value,
      ...(fact.source && typeof fact.source === 'object' ? { source: fact.source as Fact['source'] } : {}),
      ...(typeof fact.extractionConfidence === 'number' ? { extractionConfidence: fact.extractionConfidence } : {}),
    };
  });
}
