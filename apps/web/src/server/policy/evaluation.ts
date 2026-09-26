import { createHash } from 'node:crypto';
import { createAuditRepository, createFactRepository, type DatabaseClient } from '@cancelaciones/db';
import { evaluatePolicy, toAuditEvaluationEnvelopeV1, type PolicyEvaluation } from '@cancelaciones/policy-engine';
import { recordBaselineCompletedEvent } from '@/server/comparison/baseline';
import { mapStoredFactsToPolicyFacts, validateFrozenFactRun } from './frozen-fact-run';

function fingerprintHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function runPolicyEngineForAudit(input: {
  database: DatabaseClient;
  auditId: string;
  actorId: string;
  policyCode: string;
  policyVersion: string;
  factRunId: string;
}): Promise<{ engineRun: Record<string, unknown>; evaluation: PolicyEvaluation; factsUsed: number; created: boolean }> {
  const audit = await createAuditRepository(input.database).findById(input.auditId);
  if (!audit) throw new Error('AUDIT_NOT_FOUND');

  const factsRepo = createFactRepository(input.database);
  const run = await factsRepo.findRunById(input.factRunId);
  const validation = validateFrozenFactRun({ auditId: input.auditId, policyCode: input.policyCode, policyVersion: input.policyVersion, run });
  if (!validation.ok) throw new Error(validation.code);

  const storedFacts = await factsRepo.listFactsByRun(validation.run.id);
  const reviewResult = await input.database.from('fact_reviews').select('fact_id,decision,corrected_value,created_at').eq('audit_id', input.auditId).order('created_at', { ascending: false });
  if (reviewResult.error) throw new Error(reviewResult.error.message ?? 'FACT_REVIEWS_READ_FAILED');
  const latestReviews = new Map<string, { decision: string; corrected_value: unknown }>();
  for (const review of reviewResult.data ?? []) if (!latestReviews.has(review.fact_id)) latestReviews.set(review.fact_id, review);

  const facts = mapStoredFactsToPolicyFacts(storedFacts)
    .filter((fact) => latestReviews.get(fact.id)?.decision !== 'INVALID')
    .map((fact) => {
      const review = latestReviews.get(fact.id);
      if (!review || review.corrected_value === null || review.corrected_value === undefined) return fact;
      return { ...fact, value: review.corrected_value };
    });
  if (facts.length === 0) throw new Error('FACT_RUN_EMPTY');

  const evaluation = evaluatePolicy({ policyCode: input.policyCode, policyVersion: input.policyVersion, facts });
  const factsFingerprint = fingerprintHash(evaluation.factsFingerprint);
  const rulesFingerprint = fingerprintHash(evaluation.rulesFingerprint);

  // La decisión de máquina se persiste SIEMPRE por la función oficial
  // `persist_policy_evaluation_v1`. El INSERT directo en `engine_runs` /
  // `engine_rule_results` está revocado para el rol cliente: con la misma
  // credencial que recibe el navegador era posible forjar la decisión que el
  // Dictamen lee como oficial (ver migraciones/20260926120000). La función es
  // idempotente y además valida actor, fact run FROZEN con snapshot, y
  // coherencia audit/run, por lo que la idempotencia no se reimplementa aquí.
  const envelope = toAuditEvaluationEnvelopeV1(evaluation);
  const envelopeHash = fingerprintHash(JSON.stringify(envelope));
  if (!input.database.rpc) throw new Error('Database client must support rpc to persist the machine decision');
  const persisted = await input.database.rpc('persist_policy_evaluation_v1', {
    p_audit_id: input.auditId,
    p_fact_run_id: validation.run.id,
    p_policy_code: evaluation.policyCode,
    p_policy_version: evaluation.policyVersion,
    p_rules_fingerprint: rulesFingerprint,
    p_facts_fingerprint: factsFingerprint,
    p_suggested_outcome: evaluation.suggestedOutcome,
    p_outcome_status: evaluation.outcomeStatus,
    p_evaluation: evaluation,
    p_evaluated_rules: evaluation.evaluatedRules.map((rule) => ({
      rule_id: rule.ruleId,
      status: rule.status,
      result: rule,
    })),
    p_envelope: envelope,
    p_envelope_hash: envelopeHash,
    p_owner_precedence_version: null,
    p_created_by: input.actorId,
  });
  if (persisted.error) throw new Error(persisted.error.message ?? 'ENGINE_RUN_PERSIST_FAILED');
  const row = (Array.isArray(persisted.data) ? persisted.data[0] : persisted.data) as
    | { out_engine_run_id?: string; out_created?: boolean; out_baseline_run_id?: string | null }
    | null;
  const engineRunId = row?.out_engine_run_id;
  if (typeof engineRunId !== 'string' || engineRunId === '') throw new Error('ENGINE_RUN_PERSIST_NO_ID');

  const engineRun = await input.database.from('engine_runs').select('*').eq('id', engineRunId).single();
  if (engineRun.error || !engineRun.data) throw new Error(engineRun.error?.message ?? 'ENGINE_RUN_READ_FAILED');

  // `persist_policy_evaluation_v1` registra el baseline AI_BASELINE pero no
  // escribe el evento de auditoría; se conserva aquí para no perder la traza.
  if (row?.out_created) {
    await recordBaselineCompletedEvent({
      database: input.database,
      auditId: input.auditId,
      runId: row.out_baseline_run_id ?? null,
      engineRunId,
      evaluation,
      actorId: input.actorId,
    });
  }
  return { engineRun: engineRun.data, evaluation, factsUsed: facts.length, created: Boolean(row?.out_created) };
}
