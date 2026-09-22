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
  return facts.map((fact) => ({
    id: fact.id,
    type: fact.factType,
    value: fact.value,
    source: {
      evidenceId: String(fact.sourceRef.evidenceId ?? ''),
      artifactId: fact.sourceRef.artifactId ? String(fact.sourceRef.artifactId) : undefined,
      page: typeof fact.sourceRef.page === 'number' ? fact.sourceRef.page : undefined,
      timestampStart: typeof fact.sourceRef.timestampStart === 'number' ? fact.sourceRef.timestampStart : undefined,
      timestampEnd: typeof fact.sourceRef.timestampEnd === 'number' ? fact.sourceRef.timestampEnd : undefined,
      sha256: fact.sourceRef.sha256 ? String(fact.sourceRef.sha256) : undefined,
    },
    extractionConfidence: fact.confidence ?? undefined,
  }));
}
