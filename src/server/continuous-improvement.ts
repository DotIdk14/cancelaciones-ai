import { createHash } from 'node:crypto';
import type { InsForgeClient } from './insforge.js';
import type { AuthContext } from './auth.js';
import { ApiError } from './http.js';
import { capabilitiesForRole } from './capabilities.js';
import { assertCaseOwner, getCaseOr404, getScopedCaseOr404, listEvidenceRows, type AuditRow } from './cases.js';
import { getCaseReviewForAudit } from './reviews.js';
import { PROCEDURE_MANIFEST } from '../skills/audit/procedure-v5.js';
import { buildAuditInputs } from './audit-service.js';
import { listAreaComments } from './area-comments.js';
import { auditSkill, buildAuditMessages } from '../skills/audit/execute.js';
import { getModelCapabilities } from './ai/model-capabilities.js';
import type { AuditResult } from '../skills/audit/schema.js';
import { AUDIT_PIPELINE_VERSION, computeEvidenceFingerprint } from './audit-fingerprint.js';
import { getEnv } from './env.js';

export const FEEDBACK_ERROR_TYPES = ['MISSED_EVIDENCE','MISINTERPRETED_EVIDENCE','MISAPPLIED_PROCEDURE','WRONG_RESOLUTION','DATE_CHRONOLOGY','MISSED_CONTACT_REQUIREMENT','INSUFFICIENT_INFORMATION','FACT_RESOLUTION_CONTRADICTION','EXTRACTION_TRANSCRIPTION','HUMAN_CRITERION_PENDING','OTHER'] as const;
export const FEEDBACK_CONCLUSIONS = ['AI_ERROR','HUMAN_ERROR','INSUFFICIENT_EVIDENCE','PENDING_CRITERION'] as const;
export const FEEDBACK_STATUSES = ['PENDING_REVIEW','VALIDATED','REJECTED','NEEDS_CLARIFICATION','IN_EVALUATION_SET'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

type FeedbackRow = Record<string, unknown> & { id: string; case_id: string; audit_id: string; status: FeedbackStatus; created_at: string };
type VersionRow = Record<string, unknown> & { id: string; status: string; created_at: string };

function failDb(error: unknown): never {
  console.error('[continuous-improvement] persistence failure', error instanceof Error ? error.name : 'unknown');
  throw new ApiError(503, 'DATABASE_ERROR', 'No se pudo consultar el módulo de mejora continua.');
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function getContinuousImprovement(client: InsForgeClient, auth: AuthContext) {
  const capabilities = capabilitiesForRole(auth.role);
  const canReview = capabilities.canValidateAuditFeedback;
  const canManage = capabilities.canManageAiLab;
  const canSubmit = capabilities.canReviewOwnCases;
  if (!canSubmit && !canReview && !canManage) throw new ApiError(403, 'AUTH_ERROR', 'No tienes permiso para consultar este módulo.');
  const feedbackQuery = client.database.from('audit_feedback').select('*').order('created_at', { ascending: false }).limit(200);
  if (canSubmit && !canReview && !canManage) feedbackQuery.eq('author_id', auth.sub);
  const [feedbackResult, examplesResult, versionsResult, datasetsResult, runsResult] = await Promise.all([
    feedbackQuery,
    canReview || canManage ? client.database.from('approved_examples').select('id,feedback_id,case_id,resolution,procedure_section,procedure_version,error_type,eligibility,validated_at').order('validated_at', { ascending: false }).limit(200) : Promise.resolve({ data: [], error: null }),
    canManage ? client.database.from('audit_versions').select('*').order('created_at', { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null }),
    canManage ? client.database.from('audit_evaluation_datasets').select('*').order('created_at', { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null }),
    canManage ? client.database.from('audit_evaluation_runs').select('*').order('created_at', { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null }),
  ]);
  if (feedbackResult.error || examplesResult.error || versionsResult.error || datasetsResult.error || runsResult.error) failDb(feedbackResult.error ?? examplesResult.error ?? versionsResult.error ?? datasetsResult.error ?? runsResult.error);
  const runIds = ((runsResult.data ?? []) as Array<{ id: string }>).map(({ id }) => id);
  const resultsQuery = runIds.length ? client.database.from('audit_evaluation_results').select('id,run_id,version_id,example_id,model,tokens_prompt,tokens_completion,cost,latency_ms,resolution_match,procedure_match,evidence_omissions,technical_error').in('run_id', runIds).limit(1000) : Promise.resolve({ data: [], error: null });
  const resultsResult = await resultsQuery;
  if (resultsResult.error) failDb(resultsResult.error);
  const feedbackTargets: Array<Record<string, unknown>> = [];
  if (canSubmit && !canReview && !canManage) {
    const { data: reviews, error: reviewError } = await client.database.from('case_reviews').select('case_id,audit_id,result,coordinator_decision,coordinator_resolution').eq('created_by', auth.sub).not('coordinator_decision', 'is', null).order('created_at', { ascending: false }).limit(100);
    if (reviewError) failDb(reviewError);
    for (const review of (reviews ?? []) as Array<Record<string, unknown>>) {
      const audit = await client.database.from('audits').select('id,result_json,model,provider_metadata,created_at').eq('id', String(review.audit_id)).eq('case_id', String(review.case_id)).eq('status', 'COMPLETED').is('retired_at', null).limit(1);
      if (audit.error) failDb(audit.error);
      const auditRow = (audit.data as Array<Record<string, unknown>> | null)?.[0];
      if (auditRow) {
        const evidence = await listEvidenceRows(client, String(review.case_id));
        feedbackTargets.push({ caseId: review.case_id, auditId: review.audit_id, advisorResolution: review.result, coordinatorResolution: review.coordinator_decision === 'CHANGE' ? review.coordinator_resolution : review.result, createdAt: auditRow.created_at, evidenceIds: evidence.map((row) => row.id) });
      }
    }
  }
  return {
    feedback: (feedbackResult.data ?? []) as FeedbackRow[],
    examples: examplesResult.data ?? [],
    versions: (versionsResult.data ?? []) as VersionRow[],
    datasets: datasetsResult.data ?? [],
    runs: runsResult.data ?? [],
    results: resultsResult.data ?? [],
    procedure: { code: PROCEDURE_MANIFEST.code, version: PROCEDURE_MANIFEST.version, sha256: PROCEDURE_MANIFEST.sourceSha256, sections: PROCEDURE_MANIFEST.sections.map(({ id, title, pages }) => ({ id, title, pages })) },
    feedbackTargets,
    permissions: { canSubmitFeedback: canSubmit, canReviewFeedback: canReview, canManageLab: canManage },
  };
}

export interface CreateFeedbackInput {
  caseId: string;
  auditId: string;
  errorType: (typeof FEEDBACK_ERROR_TYPES)[number];
  conclusion: (typeof FEEDBACK_CONCLUSIONS)[number];
  correctedProcedureSection: string | null;
  justification: string;
  evidenceIds: string[];
}

export async function createAuditFeedback(client: InsForgeClient, auth: AuthContext, input: CreateFeedbackInput): Promise<FeedbackRow> {
  const capabilities = capabilitiesForRole(auth.role);
  if (!capabilities.canReviewOwnCases) throw new ApiError(403, 'AUTH_ERROR', 'No tienes permiso para registrar retroalimentación.');
  const caseRow = await getScopedCaseOr404(client, input.caseId, auth);
  assertCaseOwner(caseRow, auth);
  const [auditResult, review, evidenceRows] = await Promise.all([
    client.database.from('audits').select('*').eq('id', input.auditId).eq('case_id', input.caseId).eq('status', 'COMPLETED').is('retired_at', null).limit(1),
    getCaseReviewForAudit(client, input.auditId),
    listEvidenceRows(client, input.caseId),
  ]);
  if (auditResult.error) failDb(auditResult.error);
  const audit = (auditResult.data as Array<Record<string, unknown>> | null)?.[0];
  if (!audit || !review || review.case_id !== input.caseId || !review.coordinator_decision) {
    throw new ApiError(409, 'VALIDATION_ERROR', 'La retroalimentación requiere una resolución final del Coordinador para esa auditoría.');
  }
  const sectionExists = PROCEDURE_MANIFEST.sections.some(({ id }) => id === input.correctedProcedureSection);
  if (input.conclusion === 'AI_ERROR' && !sectionExists) throw new ApiError(400, 'VALIDATION_ERROR', 'Una corrección confirmada requiere una sección del procedimiento V5.');
  if (input.conclusion !== 'AI_ERROR' && input.correctedProcedureSection && !sectionExists) throw new ApiError(400, 'VALIDATION_ERROR', 'La sección del procedimiento no existe en la versión vigente.');
  const availableIds = new Set(evidenceRows.map(({ id }) => id));
  if (input.evidenceIds.some((id) => !availableIds.has(id))) throw new ApiError(400, 'VALIDATION_ERROR', 'La retroalimentación contiene evidencias que no pertenecen al expediente.');
  const resultJson = audit.result_json as { audit?: { result?: string; procedureSection?: string; model?: { model?: string } }; model?: { model?: string } } | null;
  const aiResolution = resultJson?.audit?.result ?? 'NEEDS_INPUT';
  const coordinatorResolution = review.coordinator_decision === 'CHANGE' ? review.coordinator_resolution : review.result;
  const { data, error } = await client.database.from('audit_feedback').insert([{
    case_id: input.caseId, audit_id: input.auditId, case_review_id: review.id,
    ai_resolution: aiResolution, advisor_resolution: review.result, coordinator_resolution: coordinatorResolution,
    ai_procedure_section: resultJson?.audit?.procedureSection ?? 'NEEDS_INPUT', corrected_procedure_section: input.correctedProcedureSection,
    conclusion: input.conclusion, error_type: input.errorType, justification: input.justification,
    evidence_ids: input.evidenceIds, author_id: auth.sub, status: 'PENDING_REVIEW',
    auditor_version: (audit.provider_metadata as Record<string, unknown> | null)?.auditVersion ?? null,
    model: audit.model ?? resultJson?.model?.model ?? resultJson?.audit?.model?.model ?? null,
    procedure_version: PROCEDURE_MANIFEST.version,
  }]).select('*').single();
  if (error || !data) failDb(error);
  return data as FeedbackRow;
}

export interface ReviewFeedbackInput { feedbackId: string; status: Extract<FeedbackStatus, 'VALIDATED'|'REJECTED'|'NEEDS_CLARIFICATION'>; note: string; checks: { finalResolution: boolean; procedureSection: boolean; evidenceReferences: boolean; factsSupported: boolean; priorityRuleChecked: boolean }; facts?: Array<{ fact: string; evidenceIds: string[] }>; eligibility?: 'CONTEXTUAL'|'EVALUATION_ONLY' }

export async function reviewAuditFeedback(client: InsForgeClient, auth: AuthContext, input: ReviewFeedbackInput) {
  if (!capabilitiesForRole(auth.role).canValidateAuditFeedback) throw new ApiError(403, 'AUTH_ERROR', 'Solo un Coordinador puede validar retroalimentación.');
  const { data, error } = await client.database.from('audit_feedback').select('*').eq('id', input.feedbackId).limit(1);
  if (error) failDb(error);
  const feedback = (data as FeedbackRow[] | null)?.[0];
  if (!feedback) throw new ApiError(404, 'NOT_FOUND', 'Retroalimentación no encontrada.');
  if (feedback.status !== 'PENDING_REVIEW' && feedback.status !== 'NEEDS_CLARIFICATION') throw new ApiError(409, 'VALIDATION_ERROR', 'Esta retroalimentación ya fue resuelta.');
  const checks = input.checks;
  const validated = input.status === 'VALIDATED';
  if (validated && (!checks.finalResolution || !checks.procedureSection || !checks.evidenceReferences || !checks.factsSupported || !checks.priorityRuleChecked)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Para validar deben confirmarse los cinco controles de revisión.');
  }
  const caseId = String(feedback.case_id);
  const [review, evidenceRows] = await Promise.all([getCaseReviewForAudit(client, String(feedback.audit_id)), listEvidenceRows(client, caseId)]);
  if (!review || !review.coordinator_decision) throw new ApiError(409, 'VALIDATION_ERROR', 'La revisión final del caso ya no está disponible.');
  const allowedEvidence = new Set(evidenceRows.map((row) => row.id));
  const feedbackEvidence = Array.isArray(feedback.evidence_ids) ? feedback.evidence_ids as string[] : [];
  if (feedbackEvidence.some((id) => !allowedEvidence.has(id))) throw new ApiError(409, 'VALIDATION_ERROR', 'Las referencias de evidencia ya no coinciden con el expediente.');
  if (validated && !PROCEDURE_MANIFEST.sections.some(({ id }) => id === feedback.corrected_procedure_section)) throw new ApiError(409, 'VALIDATION_ERROR', 'La sección corregida no corresponde al procedimiento vigente.');
  const facts = input.facts ?? [];
  if (validated && feedback.conclusion === 'AI_ERROR' && facts.length === 0) throw new ApiError(400, 'VALIDATION_ERROR', 'Un ejemplo validado requiere al menos un hecho comprobado y sus referencias.');
  if (validated && facts.some((entry) => entry.fact.trim().length < 3 || entry.evidenceIds.length === 0 || entry.evidenceIds.some((id) => !allowedEvidence.has(id)))) throw new ApiError(400, 'VALIDATION_ERROR', 'Cada hecho validado requiere referencias de evidencia existentes.');
  const update = await client.database.from('audit_feedback').update({ status: input.status, validator_id: auth.sub, validation_note: input.note, validation_checks: checks, validated_at: validated ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('id', input.feedbackId).select('*').single();
  if (update.error || !update.data) failDb(update.error);
  if (validated && feedback.conclusion === 'AI_ERROR') {
    const example = await client.database.from('approved_examples').insert([{
      feedback_id: input.feedbackId, case_id: caseId, facts, resolution: feedback.coordinator_resolution,
      procedure_section: feedback.corrected_procedure_section, procedure_version: feedback.procedure_version,
      error_type: feedback.error_type, rationale: feedback.justification, evidence_ids: feedbackEvidence,
      eligibility: input.eligibility ?? 'EVALUATION_ONLY', validated_by: auth.sub,
    }]).select('*').single();
    if (example.error) failDb(example.error);
    const promotion = await client.database.from('audit_feedback').update({ status: 'IN_EVALUATION_SET', updated_at: new Date().toISOString() }).eq('id', input.feedbackId);
    if (promotion.error) {
      await client.database.from('approved_examples').delete().eq('feedback_id', input.feedbackId);
      failDb(promotion.error);
    }
    return { feedback: { ...(update.data as FeedbackRow), status: 'IN_EVALUATION_SET' }, example: example.data };
  }
  return { feedback: update.data as FeedbackRow, example: null };
}

export interface CreateVersionInput { versionKey: string; name: string; description: string; instructions: string; model: string; parentVersionId?: string | null; config: Record<string, unknown> }
export async function registerCurrentProductionVersion(client: InsForgeClient, auth: AuthContext) {
  if (!capabilitiesForRole(auth.role).canManageAiLab) throw new ApiError(403, 'AUTH_ERROR', 'Solo un Gerente puede registrar la versión de producción.');
  const active = await client.database.from('audit_versions').select('id').eq('status', 'ACTIVE').limit(1);
  if (active.error) failDb(active.error);
  if (active.data?.length) throw new ApiError(409, 'VALIDATION_ERROR', 'Ya hay una versión activa registrada.');
  const instructions = buildAuditMessages({ caseId: 'production-version-snapshot', studentIdentifier: null, evidences: [], administrativeContext: '' }).system;
  const model = getEnv().OPENROUTER_MODEL;
  const config = { baseline: true, fallbackModel: getEnv().OPENROUTER_FALLBACK_MODEL, maxOutputTokens: getEnv().AI_MAX_OUTPUT_TOKENS };
  const snapshot = {
    version_key: 'audit-v5.1', name: 'Auditor de producción V5', description: 'Snapshot del auditor y configuración que operan antes de activar variantes experimentales.',
    procedure_version: PROCEDURE_MANIFEST.version, procedure_sha256: PROCEDURE_MANIFEST.sourceSha256,
    instructions, instructions_sha256: createHash('sha256').update(instructions).digest('hex'), model, config,
    pipeline_version: AUDIT_PIPELINE_VERSION, output_schema_version: 'assessment-v5', parent_version_id: null, author_id: auth.sub,
  };
  const { data, error } = await client.database.from('audit_versions').insert([{
    ...snapshot, snapshot_sha256: hash(snapshot), status: 'ACTIVE', approved_by: auth.sub, approved_at: new Date().toISOString(),
  }]).select('*').single();
  if (error || !data) failDb(error);
  return data;
}

export async function createAuditVersion(client: InsForgeClient, auth: AuthContext, input: CreateVersionInput) {
  if (!capabilitiesForRole(auth.role).canManageAiLab) throw new ApiError(403, 'AUTH_ERROR', 'Solo un Gerente puede crear versiones del auditor.');
  if (input.config.baseline === true) throw new ApiError(400, 'VALIDATION_ERROR', 'La marca de versión base se reserva para el snapshot de producción.');
  const snapshot = {
    version_key: input.versionKey, name: input.name, description: input.description,
    procedure_version: PROCEDURE_MANIFEST.version, procedure_sha256: PROCEDURE_MANIFEST.sourceSha256,
    instructions: input.instructions, instructions_sha256: createHash('sha256').update(input.instructions).digest('hex'),
    model: input.model, config: input.config, pipeline_version: AUDIT_PIPELINE_VERSION, output_schema_version: 'assessment-v5',
    parent_version_id: input.parentVersionId ?? null, author_id: auth.sub,
  };
  const { data, error } = await client.database.from('audit_versions').insert([{ ...snapshot, snapshot_sha256: hash(snapshot), status: 'DRAFT' }]).select('*').single();
  if (error || !data) failDb(error);
  return data;
}

export async function changeAuditVersionStatus(client: InsForgeClient, auth: AuthContext, versionId: string, status: 'EVALUATING'|'APPROVED'|'ACTIVE'|'ARCHIVED') {
  if (!capabilitiesForRole(auth.role).canManageAiLab) throw new ApiError(403, 'AUTH_ERROR', 'Solo un Gerente puede promover versiones del auditor.');
  const { data, error } = await client.database.from('audit_versions').select('*').eq('id', versionId).limit(1);
  if (error) failDb(error);
  const version = (data as VersionRow[] | null)?.[0];
  if (!version) throw new ApiError(404, 'NOT_FOUND', 'Versión no encontrada.');
  if (status === 'EVALUATING' && version.status !== 'DRAFT') throw new ApiError(409, 'VALIDATION_ERROR', 'Solo una versión en borrador puede pasar a evaluación.');
  if (status === 'ACTIVE' && version.status !== 'APPROVED') throw new ApiError(409, 'VALIDATION_ERROR', 'La versión debe estar aprobada antes de activarse.');
  if (status === 'APPROVED' && version.status !== 'EVALUATING') throw new ApiError(409, 'VALIDATION_ERROR', 'La versión debe evaluarse antes de aprobarse.');
  if (status === 'ARCHIVED' && version.status === 'ACTIVE') throw new ApiError(409, 'VALIDATION_ERROR', 'La versión activa solo se archiva al activar otra versión aprobada.');
  if (version.status === 'ARCHIVED') throw new ApiError(409, 'VALIDATION_ERROR', 'Una versión archivada no puede reactivarse desde esta operación.');
  if (status === 'APPROVED') {
    const runRows = await client.database.from('audit_evaluation_runs').select('id,dataset_id,status').eq('status', 'COMPLETED');
    if (runRows.error) failDb(runRows.error);
    const completedRuns = (runRows.data ?? []) as Array<{ id: string; dataset_id: string }>;
    const heldOutRunIds: string[] = [];
    for (const row of completedRuns) {
      const dataset = await client.database.from('audit_evaluation_datasets').select('split').eq('id', row.dataset_id).limit(1);
      if (dataset.error) failDb(dataset.error);
      if ((dataset.data as Array<{ split: string }> | null)?.[0]?.split === 'HELD_OUT') heldOutRunIds.push(row.id);
    }
    if (heldOutRunIds.length === 0) throw new ApiError(409, 'VALIDATION_ERROR', 'La versión requiere una evaluación completada sobre un conjunto reservado.');
    const results = await client.database.from('audit_evaluation_results').select('id,technical_error').eq('version_id', versionId).in('run_id', heldOutRunIds);
    if (results.error) failDb(results.error);
    const checked = (results.data ?? []) as Array<{ id: string; technical_error: string | null }>;
    if (checked.length === 0 || checked.some((row) => row.technical_error)) throw new ApiError(409, 'VALIDATION_ERROR', 'La evaluación reservada no tiene resultados completos para esta versión.');
  }
  const patch = { status, ...(status === 'APPROVED' || status === 'ACTIVE' || status === 'ARCHIVED' ? { approved_by: auth.sub, approved_at: new Date().toISOString() } : {}) };
  let previousActiveId: string | null = null;
  if (status === 'ACTIVE') {
    const active = await client.database.from('audit_versions').select('id').eq('status', 'ACTIVE').limit(1);
    if (active.error) failDb(active.error);
    previousActiveId = ((active.data as Array<{ id: string }> | null)?.[0]?.id ?? null);
    if (previousActiveId && previousActiveId !== versionId) {
      const archived = await client.database.from('audit_versions').update({ status: 'ARCHIVED' }).eq('id', previousActiveId);
      if (archived.error) failDb(archived.error);
    }
  }
  const updated = await client.database.from('audit_versions').update(patch).eq('id', versionId).select('*').single();
  if (updated.error || !updated.data) {
    if (previousActiveId && previousActiveId !== versionId) {
      try { await client.database.from('audit_versions').update({ status: 'ACTIVE' }).eq('id', previousActiveId); } catch { /* se informa el error primario */ }
    }
    failDb(updated.error);
  }
  return updated.data;
}

export async function createEvaluationDataset(client: InsForgeClient, auth: AuthContext, input: { name: string; description: string; split: 'IMPROVEMENT'|'HELD_OUT'; exampleIds: string[] }) {
  if (!capabilitiesForRole(auth.role).canManageAiLab) throw new ApiError(403, 'AUTH_ERROR', 'Solo un Gerente puede administrar conjuntos de evaluación.');
  if (input.exampleIds.length < 1 || input.exampleIds.length > 100 || new Set(input.exampleIds).size !== input.exampleIds.length) throw new ApiError(400, 'VALIDATION_ERROR', 'Selecciona entre 1 y 100 ejemplos distintos.');
  const { data, error } = await client.database.from('approved_examples').select('id,feedback_id,procedure_version,eligibility').in('id', input.exampleIds);
  if (error) failDb(error);
  const examples = (data ?? []) as Array<{ id: string; feedback_id: string; procedure_version: string; eligibility: string }>;
  if (examples.length !== input.exampleIds.length || examples.some((e) => e.procedure_version !== PROCEDURE_MANIFEST.version || e.eligibility === 'EXCLUDED')) throw new ApiError(400, 'VALIDATION_ERROR', 'El conjunto incluye ejemplos ausentes, excluidos o de otra versión normativa.');
  const sourceFeedback = await client.database.from('audit_feedback').select('id,status').in('id', examples.map(({ feedback_id }) => feedback_id));
  if (sourceFeedback.error) failDb(sourceFeedback.error);
  if ((sourceFeedback.data ?? []).length !== examples.length || (sourceFeedback.data ?? []).some((row: { status: string }) => row.status !== 'IN_EVALUATION_SET')) throw new ApiError(409, 'VALIDATION_ERROR', 'El conjunto solo admite ejemplos incorporados mediante validación humana completa.');
  const existingDatasets = await client.database.from('audit_evaluation_datasets').select('split,example_ids');
  if (existingDatasets.error) failDb(existingDatasets.error);
  const overlappingOppositeSplit = (existingDatasets.data ?? []).some((row: { split: string; example_ids: string[] }) =>
    row.split !== input.split && row.example_ids.some((exampleId) => input.exampleIds.includes(exampleId)),
  );
  if (overlappingOppositeSplit) throw new ApiError(409, 'VALIDATION_ERROR', 'Un ejemplo no puede pertenecer a conjuntos de mejora y evaluación reservada a la vez.');
  const { data: prior, error: priorError } = await client.database.from('audit_evaluation_datasets').select('version').eq('name', input.name).order('version', { ascending: false }).limit(1);
  if (priorError) failDb(priorError);
  const version = (((prior ?? []) as Array<{ version: number }>)[0]?.version ?? 0) + 1;
  const snapshot = { name: input.name, version, split: input.split, exampleIds: [...input.exampleIds].sort() };
  const { data: dataset, error: insertError } = await client.database.from('audit_evaluation_datasets').insert([{
    name: input.name, description: input.description, version, split: input.split, example_ids: input.exampleIds,
    snapshot_sha256: hash(snapshot), created_by: auth.sub,
  }]).select('*').single();
  if (insertError || !dataset) failDb(insertError);
  return dataset;
}

export async function createEvaluationRun(client: InsForgeClient, auth: AuthContext, input: { datasetId: string; versionIds: string[]; budgetLimit: number; idempotencyKey: string }) {
  if (!capabilitiesForRole(auth.role).canManageAiLab) throw new ApiError(403, 'AUTH_ERROR', 'Solo un Gerente puede ejecutar experimentos.');
  if (input.versionIds.length < 2 || input.versionIds.length > 4 || new Set(input.versionIds).size !== input.versionIds.length) throw new ApiError(400, 'VALIDATION_ERROR', 'Un experimento compara entre 2 y 4 versiones distintas.');
  if (!Number.isFinite(input.budgetLimit) || input.budgetLimit <= 0 || input.budgetLimit > 50) throw new ApiError(400, 'VALIDATION_ERROR', 'El presupuesto debe ser mayor que cero y no exceder 50 USD.');
  const existingRun = await client.database.from('audit_evaluation_runs').select('*').eq('idempotency_key', input.idempotencyKey).limit(1);
  if (existingRun.error) failDb(existingRun.error);
  if (existingRun.data?.length) {
    const existing = existingRun.data[0] as { dataset_id: string; version_ids: string[]; budget_limit: number };
    if (existing.dataset_id !== input.datasetId || Number(existing.budget_limit) !== input.budgetLimit || JSON.stringify([...existing.version_ids].sort()) !== JSON.stringify([...input.versionIds].sort())) {
      throw new ApiError(409, 'VALIDATION_ERROR', 'La clave de idempotencia ya pertenece a otro experimento.');
    }
    return existingRun.data[0];
  }
  const [datasetResult, versionsResult] = await Promise.all([
    client.database.from('audit_evaluation_datasets').select('*').eq('id', input.datasetId).limit(1),
    client.database.from('audit_versions').select('id,status').in('id', input.versionIds),
  ]);
  if (datasetResult.error || versionsResult.error) failDb(datasetResult.error ?? versionsResult.error);
  if (!datasetResult.data?.length || (versionsResult.data ?? []).length !== input.versionIds.length || (versionsResult.data as Array<{ status: string }>).some((v) => !['ACTIVE','EVALUATING','APPROVED'].includes(v.status))) throw new ApiError(400, 'VALIDATION_ERROR', 'Conjunto o versiones no disponibles para evaluación.');
  const { data, error } = await client.database.from('audit_evaluation_runs').insert([{
    dataset_id: input.datasetId, version_ids: input.versionIds, status: 'QUEUED', idempotency_key: input.idempotencyKey, budget_limit: input.budgetLimit, requested_by: auth.sub,
  }]).select('*').single();
  if (error || !data) {
    const racedRun = await client.database.from('audit_evaluation_runs').select('*').eq('idempotency_key', input.idempotencyKey).limit(1);
    if (racedRun.data?.length) return racedRun.data[0];
    failDb(error);
  }
  return data;
}

function conservativeCallBudget(model: { contextLength: number; safeOutputLimit: number; pricing: { prompt: string | null; completion: string | null } }): number {
  const prompt = Number(model.pricing.prompt);
  const completion = Number(model.pricing.completion);
  if (!Number.isFinite(prompt) || !Number.isFinite(completion) || prompt < 0 || completion < 0) return Number.POSITIVE_INFINITY;
  return model.contextLength * prompt + model.safeOutputLimit * completion;
}

/** Ejecuta un solo expediente por lote; las filas y el avance sobreviven a la Function. */
export async function runEvaluationBatch(client: InsForgeClient, auth: AuthContext, runId: string) {
  if (!capabilitiesForRole(auth.role).canManageAiLab) throw new ApiError(403, 'AUTH_ERROR', 'Solo un Gerente puede ejecutar experimentos.');
  const runRead = await client.database.from('audit_evaluation_runs').select('*').eq('id', runId).limit(1);
  if (runRead.error) failDb(runRead.error);
  const run = (runRead.data as Array<Record<string, unknown>> | null)?.[0];
  if (!run) throw new ApiError(404, 'NOT_FOUND', 'Experimento no encontrado.');
  if (run.status === 'COMPLETED' || run.status === 'ERROR' || run.status === 'CANCELLED') return { run, processedExamples: 0 };
  const now = new Date();
  const lease = new Date(now.getTime() + 5 * 60_000).toISOString();
  const claim = run.status === 'QUEUED'
    ? await client.database.from('audit_evaluation_runs').update({ status: 'RUNNING', started_at: run.started_at ?? now.toISOString(), lease_expires_at: lease }).eq('id', runId).eq('status', 'QUEUED').select('id')
    : await client.database.from('audit_evaluation_runs').update({ lease_expires_at: lease }).eq('id', runId).eq('status', 'RUNNING').lt('lease_expires_at', now.toISOString()).select('id');
  if (claim.error) failDb(claim.error);
  if (!claim.data?.length) throw new ApiError(409, 'VALIDATION_ERROR', 'El experimento ya se está ejecutando; vuelve a consultar su estado.');

  try {
    const [datasetResult, versionsResult, examplesResult, existingResult] = await Promise.all([
      client.database.from('audit_evaluation_datasets').select('*').eq('id', String(run.dataset_id)).limit(1),
      client.database.from('audit_versions').select('*').in('id', run.version_ids as string[]),
      client.database.from('approved_examples').select('*').in('id', (await client.database.from('audit_evaluation_datasets').select('example_ids').eq('id', String(run.dataset_id)).single()).data?.example_ids ?? []),
      client.database.from('audit_evaluation_results').select('version_id,example_id,cost').eq('run_id', runId),
    ]);
    if (datasetResult.error || versionsResult.error || examplesResult.error || existingResult.error) failDb(datasetResult.error ?? versionsResult.error ?? examplesResult.error ?? existingResult.error);
    const dataset = (datasetResult.data as Array<Record<string, unknown>> | null)?.[0];
    const versions = (versionsResult.data ?? []) as Array<Record<string, unknown>>;
    const examples = (examplesResult.data ?? []) as Array<Record<string, unknown>>;
    if (!dataset || versions.length !== (run.version_ids as string[]).length || examples.length === 0) throw new ApiError(409, 'VALIDATION_ERROR', 'El conjunto o las versiones cambiaron; el experimento no puede continuar.');
    const priorResults = (existingResult.data ?? []) as Array<{ version_id: string; example_id: string; cost: number | null }>;
    const actualPriorCost = priorResults.reduce((sum, row) => sum + (typeof row.cost === 'number' ? row.cost : 0), 0);
    const budgetLimit = Number(run.budget_limit);
    const remainingBudget = budgetLimit - actualPriorCost;
    if (remainingBudget <= 0) throw new ApiError(409, 'VALIDATION_ERROR', 'Se alcanzó el presupuesto del experimento.');
    const completedKeys = new Set(priorResults.map((row) => `${row.version_id}:${row.example_id}`));
    const nextExample = examples.find((example) => versions.some((version) => !completedKeys.has(`${version.id}:${example.id}`)));
    if (!nextExample) {
      const done = await client.database.from('audit_evaluation_runs').update({ status: 'COMPLETED', cost_total: actualPriorCost, finished_at: now.toISOString(), lease_expires_at: null }).eq('id', runId).select('*').single();
      if (done.error) failDb(done.error);
      return { run: done.data, processedExamples: 0 };
    }
    const feedbackRead = await client.database.from('audit_feedback').select('audit_id,case_id,procedure_version').eq('id', String(nextExample.feedback_id)).limit(1);
    if (feedbackRead.error) failDb(feedbackRead.error);
    const feedback = (feedbackRead.data as Array<Record<string, unknown>> | null)?.[0];
    if (!feedback || feedback.procedure_version !== PROCEDURE_MANIFEST.version) throw new ApiError(409, 'VALIDATION_ERROR', 'El ejemplo no corresponde al procedimiento vigente.');
    const auditRead = await client.database.from('audits').select('*').eq('id', String(feedback.audit_id)).eq('case_id', String(nextExample.case_id)).eq('status', 'COMPLETED').is('retired_at', null).limit(1);
    if (auditRead.error) failDb(auditRead.error);
    const audit = (auditRead.data as AuditRow[] | null)?.[0];
    if (!audit) throw new ApiError(409, 'VALIDATION_ERROR', 'La auditoría fuente del ejemplo ya no está vigente.');
    const [caseRow, evidenceRows, areaComments] = await Promise.all([getCaseOr404(client, String(nextExample.case_id)), listEvidenceRows(client, String(nextExample.case_id)), listAreaComments(client, String(nextExample.case_id))]);
    const auditMetadata = audit.provider_metadata as Record<string, unknown> | null;
    const recordedFingerprintVersion = typeof auditMetadata?.auditFingerprintVersion === 'string' ? auditMetadata.auditFingerprintVersion : undefined;
    const currentFingerprint = computeEvidenceFingerprint(evidenceRows, caseRow.cycle_start_date ?? null, areaComments, caseRow.flokzu_data, recordedFingerprintVersion);
    if (currentFingerprint !== audit.evidence_fingerprint) throw new ApiError(409, 'VALIDATION_ERROR', 'La evidencia del ejemplo cambió desde la auditoría validada; actualiza el conjunto antes de medir.');
    const inputs = await buildAuditInputs(client, caseRow, evidenceRows, areaComments);
    let spentCost = actualPriorCost;
    let completedThisBatch = 0;
    const version = versions.find((candidate) => !completedKeys.has(`${candidate.id}:${nextExample.id}`));
    if (version) {
      const key = `${version.id}:${nextExample.id}`;
      const modelId = String(version.model);
      const profile = await getModelCapabilities(modelId);
      const reserved = conservativeCallBudget(profile);
      if (!Number.isFinite(reserved) || reserved > budgetLimit - spentCost) throw new ApiError(409, 'VALIDATION_ERROR', 'El catálogo no permite reservar un costo máximo verificable para este modelo dentro del presupuesto restante.');
      const started = Date.now();
      const execution = await auditSkill.executeWithMetadata(inputs, {
        deadlineMs: Date.now() + 240_000,
        model: modelId,
        ...(version.config && (version.config as Record<string, unknown>).baseline !== true ? { supplementalInstructions: String(version.instructions) } : {}),
      });
      const result = execution.result as AuditResult;
      const cost = result.usage.estimatedCostUSD;
      const sourceIds = Array.isArray(nextExample.evidence_ids) ? nextExample.evidence_ids as string[] : [];
      const usedIds = new Set(result.audit.supportingEvidenceIds);
      const omissions = sourceIds.filter((id) => !usedIds.has(id));
      const inputSnapshot = { evidenceFingerprint: currentFingerprint, evidence: evidenceRows.map((row) => ({ id: row.id, sha256: row.hash })), procedureSha256: version.procedure_sha256, promptSha256: version.instructions_sha256 };
      const inserted = await client.database.from('audit_evaluation_results').insert([{
        run_id: runId, version_id: version.id, example_id: nextExample.id, case_id: nextExample.case_id,
        input_fingerprint: currentFingerprint, input_snapshot: inputSnapshot, assessment: result, model: execution.model,
        prompt_sha256: version.instructions_sha256, procedure_sha256: version.procedure_sha256,
        tokens_prompt: result.usage.promptTokens, tokens_completion: result.usage.completionTokens,
        cost, latency_ms: Date.now() - started, resolution_match: result.audit.result === nextExample.resolution,
        procedure_match: result.audit.procedureChecks.some((check) => check.procedureSection === nextExample.procedure_section), evidence_omissions: omissions,
      }]).select('id').single();
      if (inserted.error) failDb(inserted.error);
      completedKeys.add(key);
      completedThisBatch++;
      if (cost !== null && spentCost + cost > budgetLimit) throw new ApiError(409, 'VALIDATION_ERROR', 'El costo reportado excedió el presupuesto configurado; se detuvo el experimento.');
      if (cost === null) throw new ApiError(409, 'VALIDATION_ERROR', 'El proveedor no informó el costo real; se detuvo el experimento para no exceder el presupuesto sin medición.');
      spentCost += cost;
    }
    const freshResults = await client.database.from('audit_evaluation_results').select('version_id,example_id,cost').eq('run_id', runId);
    if (freshResults.error) failDb(freshResults.error);
    const allResults = (freshResults.data ?? []) as Array<{ version_id: string; example_id: string; cost: number | null }>;
    const totalCost = allResults.reduce((sum, row) => sum + (typeof row.cost === 'number' ? row.cost : 0), 0);
    const complete = examples.every((example) => versions.every((version) => allResults.some((row) => row.example_id === example.id && row.version_id === version.id)));
    const updated = await client.database.from('audit_evaluation_runs').update({ status: complete ? 'COMPLETED' : 'QUEUED', cost_total: totalCost, finished_at: complete ? new Date().toISOString() : null, lease_expires_at: null }).eq('id', runId).select('*').single();
    if (updated.error) failDb(updated.error);
    return { run: updated.data, processedExamples: completedThisBatch };
  } catch (cause) {
    const current = await client.database.from('audit_evaluation_results').select('cost').eq('run_id', runId);
    const cost = (current.data ?? []).reduce((sum: number, item: { cost: number | null }) => sum + (typeof item.cost === 'number' ? item.cost : 0), 0);
    await client.database.from('audit_evaluation_runs').update({ status: 'ERROR', error_category: cause instanceof ApiError ? cause.category : 'AI_PROVIDER_ERROR', cost_total: cost, finished_at: new Date().toISOString(), lease_expires_at: null }).eq('id', runId);
    throw cause;
  }
}
