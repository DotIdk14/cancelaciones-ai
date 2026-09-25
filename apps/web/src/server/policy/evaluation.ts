import { createHash } from 'node:crypto';
import { createAuditRepository, createFactRepository, type DatabaseClient } from '@cancelaciones/db';
import { evaluatePolicy, type PolicyEvaluation } from '@cancelaciones/policy-engine';
import { recordBaselineRun } from '@/server/comparison/baseline';
import { mapStoredFactsToPolicyFacts, validateFrozenFactRun } from './frozen-fact-run';

function fingerprintHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function policyCodeHash(value: string): string {
  return fingerprintHash(value);
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
  const policyHash = policyCodeHash(evaluation.policyCode);
  const existing = await input.database.from('engine_runs').select('*').eq('audit_id', input.auditId).eq('policy_code_hash', policyHash).eq('policy_version', evaluation.policyVersion).order('created_at', { ascending: false }).limit(20);
  if (existing.error) throw new Error(existing.error.message ?? 'ENGINE_RUN_READ_FAILED');
  const matchingRun = existing.data?.find((row: { facts_fingerprint?: string; rules_fingerprint?: string }) => row.facts_fingerprint === factsFingerprint && row.rules_fingerprint === rulesFingerprint);
  if (matchingRun) {
    await recordBaselineRun({ database: input.database, auditId: input.auditId, engineRunId: matchingRun.id, factRunId: validation.run.id, policyCode: evaluation.policyCode, policyVersion: evaluation.policyVersion, evaluation, actorId: input.actorId });
    return { engineRun: matchingRun, evaluation, factsUsed: facts.length, created: false };
  }

  const inserted = await input.database.from('engine_runs').insert([{
    audit_id: input.auditId,
    fact_run_id: validation.run.id,
    policy_code: evaluation.policyCode,
    policy_code_hash: policyHash,
    policy_version: evaluation.policyVersion,
    rules_fingerprint: rulesFingerprint,
    facts_fingerprint: factsFingerprint,
    status: 'COMPLETED',
    suggested_outcome: evaluation.suggestedOutcome,
    outcome_status: evaluation.outcomeStatus,
    evaluation,
  }]).select('*').single();
  if (inserted.error || !inserted.data) throw new Error(inserted.error?.message ?? 'ENGINE_RUN_INSERT_FAILED');

  const ruleRows = evaluation.evaluatedRules.map((rule) => ({ engine_run_id: inserted.data.id, rule_id: rule.ruleId, status: rule.status, result: rule }));
  const ruleInsert = await input.database.from('engine_rule_results').insert(ruleRows);
  if (ruleInsert.error) throw new Error(ruleInsert.error.message ?? 'ENGINE_RULE_RESULTS_INSERT_FAILED');

  await recordBaselineRun({ database: input.database, auditId: input.auditId, engineRunId: inserted.data.id, factRunId: validation.run.id, policyCode: evaluation.policyCode, policyVersion: evaluation.policyVersion, evaluation, actorId: input.actorId });
  return { engineRun: inserted.data, evaluation, factsUsed: facts.length, created: true };
}
