import { createAuditLogRepository, createAuditRunRepository, type DatabaseClient } from '@cancelaciones/db';
import type { PolicyEvaluation } from '@cancelaciones/policy-engine';

/**
 * Registra la ejecución AI_BASELINE cuando la ruta POST /api/audits/:id/policy
 * produce (201) o enlaza (200) un engine_run. Idempotente por engine_run_id
 * (index parcial único en audit_runs). Nunca sobrescribe corridas previas:
 * cada nueva evaluación genera una ejecución nueva.
 */
export async function recordBaselineRun(input: {
  database: DatabaseClient;
  auditId: string;
  engineRunId: string;
  factRunId: string | null;
  policyCode: string;
  policyVersion: string;
  evaluation: PolicyEvaluation;
  actorId: string;
}): Promise<{ created: boolean; runId: string }> {
  const runs = createAuditRunRepository(input.database);
  const existing = await runs.findBaselineByEngineRun(input.engineRunId);
  if (existing) return { created: false, runId: existing.id };

  const run = await runs.create({
    auditId: input.auditId,
    runType: 'AI_BASELINE',
    status: 'COMPLETED',
    engineRunId: input.engineRunId,
    factRunId: input.factRunId,
    policyCode: input.policyCode,
    policyVersion: input.policyVersion,
    inputFingerprint: input.evaluation.factsFingerprint,
    result: {
      suggestedOutcome: input.evaluation.suggestedOutcome,
      outcomeStatus: input.evaluation.outcomeStatus,
      decisionStatus: input.evaluation.decisionStatus,
      reviewRequired: input.evaluation.reviewRequired,
      suggestedReason: input.evaluation.suggestedReason,
      missingEvidence: input.evaluation.missingEvidence,
      missingFacts: input.evaluation.missingFacts,
      softwareCoverageGaps: input.evaluation.softwareCoverageGaps,
      decisiveRules: input.evaluation.decisiveRules,
      explanation: input.evaluation.explanation,
      factsFingerprint: input.evaluation.factsFingerprint,
      rulesFingerprint: input.evaluation.rulesFingerprint,
    },
    createdBy: input.actorId,
  });

  await createAuditLogRepository(input.database).record({
    auditId: input.auditId,
    eventType: 'AI_BASELINE_COMPLETED',
    actorId: input.actorId,
    metadata: { runId: run.id, engineRunId: input.engineRunId, outcome: input.evaluation.suggestedOutcome },
  });

  return { created: true, runId: run.id };
}