import { createAuditLogRepository, createAuditRunRepository, createComparisonRepository, createHumanDecisionExtractRepository, type DatabaseClient } from '@cancelaciones/db';
import { compareHumanDecisionWithBaseline, primitivesFromEvaluation, type PolicyEvaluation } from '@cancelaciones/policy-engine';

export class ComparisonServiceError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'ComparisonServiceError';
  }
}

interface LoadedBaseline {
  runId: string;
  engineRunId: string | null;
  evaluation: PolicyEvaluation;
  policyCode: string;
  policyVersion: string;
}

async function loadBaseline(database: DatabaseClient, auditId: string): Promise<LoadedBaseline> {
  const runs = createAuditRunRepository(database);
  const baseline = await runs.findLatestByType(auditId, 'AI_BASELINE');
  if (!baseline || baseline.status !== 'COMPLETED') throw new ComparisonServiceError('Aún no existe una línea base de la IA completada. Ejecuta primero el dictamen IA.', 'BASELINE_REQUIRED');
  if (!baseline.engineRunId) throw new ComparisonServiceError('La línea base de la IA no referencia un engine_run.', 'BASELINE_ENGINE_RUN_MISSING');
  const { data, error } = await database.from('engine_runs').select('evaluation,policy_code,policy_version').eq('id', baseline.engineRunId).limit(1);
  if (error || !data?.[0]) throw new ComparisonServiceError('No fue posible leer el engine_run de la línea base.', 'ENGINE_RUN_NOT_FOUND');
  return {
    runId: baseline.id,
    engineRunId: baseline.engineRunId,
    evaluation: data[0].evaluation as PolicyEvaluation,
    policyCode: String(data[0].policy_code ?? ''),
    policyVersion: String(data[0].policy_version ?? ''),
  };
}

/** Ejecuta la comparación IA vs humano para una auditoría. Persiste la ejecución AI_COMPARISON. */
export async function runComparison(input: { database: DatabaseClient; auditId: string; actorId: string }) {
  const baseline = await loadBaseline(input.database, input.auditId);
  const humanRepo = createHumanDecisionExtractRepository(input.database);
  const extract = await humanRepo.findLatestByAudit(input.auditId);
  if (!extract) throw new ComparisonServiceError('Aún no se extrajo el dictamen humano.', 'HUMAN_EXTRACT_REQUIRED');
  const humanRun = await createAuditRunRepository(input.database).findById(extract.runId);
  if (!humanRun || humanRun.status !== 'COMPLETED') throw new ComparisonServiceError('La extracción del dictamen humano no está completada.', 'HUMAN_RUN_INCOMPLETE');

  const primitives = primitivesFromEvaluation({
    evaluation: baseline.evaluation,
    humanResolutionRaw: extract.resolution,
    humanClaims: extract.facts,
    humanExternalInformation: extract.externalInformation,
  });
  const detail = compareHumanDecisionWithBaseline(primitives);

  const runs = createAuditRunRepository(input.database);
  const comparisonRun = await runs.create({
    auditId: input.auditId,
    runType: 'AI_COMPARISON',
    status: 'COMPLETED',
    parentRunId: baseline.runId,
    inputFingerprint: primitives.factsFingerprint ?? baseline.evaluation.factsFingerprint,
    result: {
      status: detail.status,
      discrepancyType: detail.discrepancyType,
      explanation: detail.explanation,
      reasons: detail.reasons,
      counterfactuals: detail.counterfactuals,
      rulesInvolved: detail.rulesInvolved,
      unverifiedHumanClaims: detail.unverifiedHumanClaims,
      missingEvidence: detail.missingEvidence,
      aiOutcome: detail.aiOutcome,
      humanOutcome: detail.humanOutcome,
      humanResolutionRaw: detail.humanResolutionRaw,
      aiRunId: baseline.runId,
      humanRunId: extract.runId,
      policyCode: baseline.policyCode,
      policyVersion: baseline.policyVersion,
    },
    createdBy: input.actorId,
  });

  const comparisons = createComparisonRepository(input.database);
  const comparison = await comparisons.create({
    auditId: input.auditId,
    runId: comparisonRun.id,
    aiRunId: baseline.runId,
    humanRunId: extract.runId,
    status: detail.status,
    discrepancyType: detail.discrepancyType,
    explanation: detail.explanation,
    counterfactuals: detail.counterfactuals,
    rulesInvolved: detail.rulesInvolved,
    unverifiedHumanClaims: detail.unverifiedHumanClaims,
    missingEvidence: detail.missingEvidence,
    aiOutcome: detail.aiOutcome,
    humanOutcome: detail.humanOutcome,
    aiOutcomeStatus: baseline.evaluation.outcomeStatus,
    humanResolution: extract.resolution,
    evidenceRefs: detail.rulesInvolved,
  });

  await createAuditLogRepository(input.database).record({
    auditId: input.auditId,
    eventType: 'AI_HUMAN_COMPARISON_COMPLETED',
    actorId: input.actorId,
    metadata: {
      runId: comparisonRun.id,
      comparisonId: comparison.id,
      status: detail.status,
      discrepancyType: detail.discrepancyType,
    },
  });

  return { run: comparisonRun, comparison, detail };
}