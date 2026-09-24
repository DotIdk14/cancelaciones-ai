import {
  createAuditLogRepository,
  createAuditRunRepository,
  createComparisonRepository,
  createHumanDecisionExtractRepository,
  createJobRepository,
  type DatabaseClient,
} from '@cancelaciones/db';
import type { ClaimedJob, DiscrepancyType } from '@cancelaciones/domain';
import { parseJsonFromCompletion, requestStructuredCompletion } from '@/server/ai/openrouter';
import { buildReconciliationAnalysis, type ReconciliationAnalysis } from '@/server/reconciliation/analysis';

export class ReconciliationServiceError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'ReconciliationServiceError';
  }
}

const RECONCILIATION_PROMPT_VERSION = 'reconciliation-analysis-v1';

interface ReconciliationContext {
  baseline: { runId: string; outcome: string | null; policyCode: string | null; policyVersion: string | null };
  humanExtract: { runId: string; resolution: string | null; facts: Array<{ statement: string; classification: string }> };
  comparison: { status: string; discrepancyType: DiscrepancyType | null; explanation: string | null; reasons: string[]; counterfactuals: string[]; unverifiedHumanClaims: Array<{ statement: string; classification: string }>; aiOutcome: string | null; humanOutcome: string | null };
}

async function loadContext(database: DatabaseClient, auditId: string): Promise<ReconciliationContext> {
  const runs = createAuditRunRepository(database);
  const baseline = await runs.findLatestByType(auditId, 'AI_BASELINE');
  if (!baseline || baseline.status !== 'COMPLETED') throw new ReconciliationServiceError('Se requiere línea base completada.', 'BASELINE_REQUIRED');
  const extract = await createHumanDecisionExtractRepository(database).findLatestByAudit(auditId);
  if (!extract) throw new ReconciliationServiceError('Se requiere extracción del dictamen humano.', 'HUMAN_EXTRACT_REQUIRED');
  const comparison = await createComparisonRepository(database).findLatestByAudit(auditId);
  if (!comparison) throw new ReconciliationServiceError('Se requiere una comparación previa.', 'COMPARISON_REQUIRED');
  return {
    baseline: { runId: baseline.id, outcome: baseline.result.suggestedOutcome as string | null, policyCode: baseline.policyCode, policyVersion: baseline.policyVersion },
    humanExtract: { runId: extract.runId, resolution: extract.resolution, facts: extract.facts },
    comparison: {
      status: comparison.status,
      discrepancyType: comparison.discrepancyType,
      explanation: comparison.explanation,
      reasons: comparison.counterfactuals,
      counterfactuals: comparison.counterfactuals,
      unverifiedHumanClaims: comparison.unverifiedHumanClaims,
      aiOutcome: comparison.aiOutcome,
      humanOutcome: comparison.humanOutcome,
    },
  };
}

/**
 * Crea un audit_run AI_RECONCILIATION nuevo (nunca reutiliza el anterior:
 * PRINCIPIO append-only) y encola el job durable que ejecuta el análisis.
 */
export async function runReconciliation(input: { database: DatabaseClient; auditId: string; actorId: string }): Promise<{ runId: string; jobId: string }> {
  const context = await loadContext(input.database, input.auditId);
  const runs = createAuditRunRepository(input.database);
  const run = await runs.create({
    auditId: input.auditId,
    runType: 'AI_RECONCILIATION',
    status: 'PENDING',
    parentRunId: context.baseline.runId,
    policyCode: context.baseline.policyCode,
    policyVersion: context.baseline.policyVersion,
    promptVersion: RECONCILIATION_PROMPT_VERSION,
    result: { inputSummary: context },
    createdBy: input.actorId,
  });

  const payload = { auditId: input.auditId, runId: run.id, promptVersion: RECONCILIATION_PROMPT_VERSION };
  const job = await createJobRepository(input.database).enqueue({
    auditId: input.auditId,
    jobType: 'AI_RECONCILIATION',
    operationScope: `audit:${input.auditId}:reconciliation:${run.id}`,
    idempotencyKey: `reconciliation:${run.id}:${RECONCILIATION_PROMPT_VERSION}`,
    inputFingerprint: `reconciliation-${context.baseline.runId}-${context.humanExtract.runId}-${context.comparison.status}`,
    payload,
    actorId: input.actorId,
  });
  await runs.mark(run.id, 'PROCESSING', { ...run.result, jobId: job.id });

  await createAuditLogRepository(input.database).record({
    auditId: input.auditId,
    eventType: 'AI_RECONCILIATION_ENQUEUED',
    actorId: input.actorId,
    metadata: { runId: run.id, jobId: job.id },
  });

  return { runId: run.id, jobId: job.id };
}

/** Cuerpo del job AI_RECONCILIATION: análisis determinista + enriquecimiento LLM opcional. */
export async function runReconciliationAnalysis(context: { database: DatabaseClient }, job: ClaimedJob): Promise<void> {
  const auditId = String(job.payload.auditId ?? '');
  const runId = String(job.payload.runId ?? '');
  const ctx = await loadContext(context.database, auditId);

  const deterministic = buildReconciliationAnalysis({
    comparisonStatus: ctx.comparison.status as 'MATCH' | 'DISCREPANCY',
    discrepancyType: ctx.comparison.discrepancyType,
    explanation: ctx.comparison.explanation,
    reasons: ctx.comparison.reasons,
    counterfactuals: ctx.comparison.counterfactuals,
    unverifiedHumanClaims: ctx.comparison.unverifiedHumanClaims,
    aiOutcome: ctx.comparison.aiOutcome,
    humanOutcome: ctx.comparison.humanOutcome,
    humanResolution: ctx.humanExtract.resolution,
    policyCode: ctx.baseline.policyCode ?? '',
    policyVersion: ctx.baseline.policyVersion ?? '',
  });

  const enriched = await enrichWithLlm(deterministic, ctx);
  const runs = createAuditRunRepository(context.database);
  await runs.mark(runId, 'COMPLETED', { ...enriched, inputSummary: ctx }, true);

  await createAuditLogRepository(context.database).record({
    auditId,
    eventType: 'AI_RECONCILIATION_COMPLETED',
    actorId: job.payload.actorId ? String(job.payload.actorId) : 'system',
    metadata: { runId, recommendedAdjudicationType: enriched.recommendedAdjudicationType, confidence: enriched.confidence },
  });
}

interface EnrichedReconciliation extends ReconciliationAnalysis {
  provider: string | null;
  model: string | null;
  promptVersion: string;
  llmGenerated: boolean;
}

async function enrichWithLlm(deterministic: ReconciliationAnalysis, ctx: ReconciliationContext): Promise<EnrichedReconciliation> {
  const fallback: EnrichedReconciliation = { ...deterministic, provider: null, model: null, promptVersion: RECONCILIATION_PROMPT_VERSION, llmGenerated: false };
  try {
    const system = [
      'Eres un analizador normativo de soporte para auditoría QA.',
      'No eres la fuente de verdad: la política oficial GDM_GAM_PRD_MLG_003 manda.',
      'Responde SOLO con JSON: {"summary":"resumen en español","confidence":"HIGH|MEDIUM|LOW","recommendedAdjudicationType":"CONFIRM_AI|CONFIRM_HUMAN|BOTH_INCORRECT|INSUFFICIENT_INFORMATION|CUSTOM_FINAL_DECISION","pointsForHumanReview":["..."],"agreements":["..."],"observations":["..."]}.',
      'No emitas cadena de pensamiento.',
    ].join(' ');
    const user = [
      'Contexto estructurado de una auditoría:',
      `Estado del dictamen humano: ${ctx.humanExtract.resolution ?? 'sin resolución extraíble'}.`,
      `Afirmaciones humanas: ${JSON.stringify(ctx.humanExtract.facts.map((f) => ({ statement: f.statement, classification: f.classification })))}.`,
      `Comparación: estado=${ctx.comparison.status}, discrepancia=${ctx.comparison.discrepancyType ?? 'ninguna'}.`,
      `Outcome IA: ${ctx.comparison.aiOutcome ?? 'indeterminado'} — Resolución humana: ${ctx.comparison.humanOutcome ?? 'sin normalizar'}.`,
      `Observaciones de la comparación: ${JSON.stringify(ctx.comparison.reasons)}.`,
    ].join('\n');
    const completion = await requestStructuredCompletion({ system, user, json: true });
    const parsed = parseJsonFromCompletion<Partial<ReconciliationAnalysis>>(completion.content);
    return {
      summary: parsed.summary ?? deterministic.summary,
      agreements: parsed.agreements ?? deterministic.agreements,
      observations: parsed.observations ?? deterministic.observations,
      recommendedAdjudicationType: parsed.recommendedAdjudicationType ?? deterministic.recommendedAdjudicationType,
      confidence: parsed.confidence ?? deterministic.confidence,
      pointsForHumanReview: parsed.pointsForHumanReview ?? deterministic.pointsForHumanReview,
      deterministic: false,
      provider: completion.provider,
      model: completion.model,
      promptVersion: RECONCILIATION_PROMPT_VERSION,
      llmGenerated: true,
    };
  } catch {
    return fallback;
  }
}