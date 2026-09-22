import type { Fact } from '@cancelaciones/policy-engine';
import type { FactExtractionRun, StoredFact } from '@cancelaciones/db';

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
