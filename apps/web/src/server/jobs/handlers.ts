import { createHash } from 'node:crypto';
import { createAuditRepository, createEvidenceRepository, createFactRepository, createJobRepository, type DatabaseClient } from '@cancelaciones/db';
import { stableFingerprint, type ClaimedJob } from '@cancelaciones/domain';
import { extractFactsFromArtifacts } from '@/server/facts/extract';
import { freezeFactRunWithSnapshot } from '@/server/facts/fact-run-snapshot';
import { getServerEnv } from '@/server/config/env';
import { blobToText } from '@/server/jobs/blob-text';
import { runHumanDecisionExtraction } from '@/server/human-decision/service';
import { runReconciliationAnalysis } from '@/server/reconciliation/service';
import { runPolicyEngineForAudit } from '@/server/policy/evaluation';
import { buildSnapshot } from '@/server/dictamen/service';
import type { AuthorizedContext } from '@/server/reporting/authz';

interface HandlerContext {
  database: DatabaseClient;
  storage?: { from(bucket: string): { download(key: string): Promise<{ data?: Blob | ArrayBuffer | null; error?: { message?: string } | null }> } };
  workerId: string;
}

type JobHandler = (context: HandlerContext, job: ClaimedJob) => Promise<void>;

const POLICY_CODE = 'GDM_GAM_PRD_MLG_003';
const POLICY_VERSION = '5';
/**
 * `document_id` en `policy_source_registry` (migración 20260925120000, §11).
 * `freeze_fact_run_v1` y `create_derived_fact_run_v1` lo exigen con
 * `POLICY_SOURCE_NOT_REGISTERED`: ONLY_OWNER_PROVIDED_POLICY_SOURCES, no se
 * congela con una fuente que el propietario no haya registrado. Es el mismo
 * valor que usa el E2E de la fundación de política.
 */
const POLICY_SOURCE_ID = 'gdm-gam-prd-mlg-003-local-unverified';

async function updateAuditStatus(database: DatabaseClient, auditId: string, status: 'PROCESSING' | 'COMPLETED' | 'FAILED') {
  const { error } = await database.from('audits').update({ status }).eq('id', auditId);
  if (error) throw new Error(error.message ?? 'No fue posible actualizar estado de auditoria');
}

async function actorForAudit(database: DatabaseClient, auditId: string, payload: Record<string, unknown>): Promise<string> {
  if (typeof payload.actorId === 'string' && payload.actorId) return payload.actorId;
  const audit = await createAuditRepository(database).findById(auditId);
  if (!audit) throw new Error('AUDIT_NOT_FOUND');
  return audit.createdBy;
}

async function enqueueFactExtractionIfReady(context: HandlerContext, auditId: string, actorId: string) {
  const evidences = await createEvidenceRepository(context.database).listByAudit(auditId);
  const baseline = evidences.filter((evidence) => evidence.status === 'STORED' && evidence.documentRole === 'EVIDENCE');
  if (baseline.length === 0) return;
  const artifacts = await createJobRepository(context.database).listBaselineArtifactsByAudit(auditId);
  const processed = new Set(artifacts.map((artifact) => artifact.evidenceId).filter(Boolean));
  if (!baseline.every((evidence) => processed.has(evidence.id))) return;

  const factsRepo = createFactRepository(context.database);
  const existingRuns = await factsRepo.listRunsByAudit(auditId);
  const frozen = existingRuns.find((run) => run.state === 'FROZEN');
  if (frozen) {
    await enqueueAuditEvaluation(context, auditId, frozen.id, actorId);
    return;
  }
  const active = existingRuns.find((run) => run.state === 'PROCESSING' || run.state === 'DRAFT');
  const run = active ?? await factsRepo.createRun({ auditId, policyCode: POLICY_CODE, policyVersion: POLICY_VERSION, extractorVersion: 'deterministic-facts-v1', artifactSetFingerprint: await factsRepo.artifactSetFingerprint(auditId), createdBy: actorId });
  if (run.state === 'DRAFT') await context.database.from('fact_extraction_runs').update({ state: 'PROCESSING' }).eq('id', run.id);
  const payload = { auditId, factRunId: run.id, version: 'deterministic-facts-v1', actorId };
  await createJobRepository(context.database).enqueue({ auditId, jobType: 'FACT_EXTRACTION', operationScope: `audit:${auditId}:facts`, idempotencyKey: `facts:${run.id}:v1`, inputFingerprint: stableFingerprint(payload), payload, actorId });
}

async function enqueueAuditEvaluation(context: HandlerContext, auditId: string, factRunId: string, actorId: string) {
  const payload = { auditId, factRunId, policyCode: POLICY_CODE, policyVersion: POLICY_VERSION, actorId };
  await createJobRepository(context.database).enqueue({ auditId, jobType: 'AUDIT_EVALUATION', operationScope: `audit:${auditId}:evaluation:${factRunId}`, idempotencyKey: `evaluation:${auditId}:${factRunId}:${POLICY_CODE}:${POLICY_VERSION}`, inputFingerprint: stableFingerprint(payload), payload, actorId });
}

async function enqueueReportGeneration(context: HandlerContext, auditId: string, engineRunId: string, actorId: string) {
  const payload = { auditId, engineRunId, actorId };
  await createJobRepository(context.database).enqueue({ auditId, jobType: 'REPORT_GENERATION', operationScope: `audit:${auditId}:report:${engineRunId}`, idempotencyKey: `report:${auditId}:${engineRunId}`, inputFingerprint: stableFingerprint(payload), payload, actorId });
}

const metadataProbe: JobHandler = async (context, job) => {
  const repo = createJobRepository(context.database);
  await repo.recordArtifact(job.jobId, 'metadata-probe-result', {
    auditId: job.auditId,
    checkedAt: new Date().toISOString(),
    synthetic: true,
  });
  await repo.complete(job.jobId, context.workerId, 100);
};

async function transcribeAudio(data: Blob | ArrayBuffer): Promise<EvidenceAnalysis> {
  const env = getServerEnv();
  if (!env.ASSEMBLYAI_API_KEY) throw new Error('ASSEMBLYAI_API_KEY_NOT_CONFIGURED');
  const buffer = data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(await data.arrayBuffer());
  const upload = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: { authorization: env.ASSEMBLYAI_API_KEY, 'content-type': 'application/octet-stream' },
    body: buffer,
  });
  if (!upload.ok) throw new Error(`ASSEMBLYAI_UPLOAD_ERROR_${upload.status}`);
  const uploaded = await upload.json() as { upload_url?: string };
  if (!uploaded.upload_url) throw new Error('ASSEMBLYAI_UPLOAD_URL_MISSING');
  const start = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: { authorization: env.ASSEMBLYAI_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ audio_url: uploaded.upload_url, speaker_labels: true, language_code: 'es' }),
  });
  if (!start.ok) throw new Error(`ASSEMBLYAI_TRANSCRIPT_ERROR_${start.status}`);
  const started = await start.json() as { id?: string };
  if (!started.id) throw new Error('ASSEMBLYAI_TRANSCRIPT_ID_MISSING');
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const poll = await fetch(`https://api.assemblyai.com/v2/transcript/${started.id}`, { headers: { authorization: env.ASSEMBLYAI_API_KEY } });
    if (!poll.ok) throw new Error(`ASSEMBLYAI_POLL_ERROR_${poll.status}`);
    const result = await poll.json() as { status?: string; text?: string; utterances?: unknown[]; words?: unknown[]; error?: string };
    if (result.status === 'completed') return { text: result.text ?? '', transcript: result.text ?? '', utterances: result.utterances ?? [], words: result.words ?? [], facts: [], provider: 'ASSEMBLYAI' };
    if (result.status === 'error') throw new Error(result.error ?? 'ASSEMBLYAI_TRANSCRIPTION_FAILED');
  }
  throw new Error('ASSEMBLYAI_TRANSCRIPTION_TIMEOUT');
}

type ExtractedFact = { factType: string; value: unknown; confidence?: number };
type EvidenceAnalysis = { text: string; facts: ExtractedFact[]; provider: string | null; transcript?: string; utterances?: unknown[]; words?: unknown[] };

async function analyzeEvidence(data: Blob | ArrayBuffer, mimeType: string, filename: string): Promise<EvidenceAnalysis> {
  const env = getServerEnv();
  const buffer = data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(await data.arrayBuffer());
  const encoded = buffer.toString('base64');
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'content-type': 'application/json',
      'http-referer': env.NEXT_PUBLIC_APP_URL,
      'x-title': 'Cancelaciones AI',
    },
    body: JSON.stringify({
      model: env.OPENROUTER_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `Eres un extractor de evidencia para auditoría QA de llamadas en español. Analiza "${filename}". Lee todo el texto visible y describe solo hechos observables. Devuelve JSON válido con esta forma: {"text":"transcripción o texto visible completo","facts":[{"factType":"contact.callAttempts|contact.writtenInteractions|contact.effectiveContact|student.name|student.enrollment|student.level|academic.lastCourseAccess|academic.platformAccessEvents|classroom.hasLogin|classroom.hasEvaluationMode|classroom.hasActivities|student.requestedNotContinue|retention.accepted","value":"valor estructurado","confidence":0.0}],"observations":["observación breve"]}. Para contact.callAttempts y contact.writtenInteractions usa {"events":[{"channel":"CALL|EMAIL|WHATSAPP|OTHER_WRITTEN","dateTime":"ISO-8601 si es visible","status":"estado visible","campaign":"campaña si es visible","confidence":0.0}],"sourceCompleteness":"COMPLETE|PARTIAL|UNKNOWN","warnings":["POTENTIALLY_PARTIAL_LIST"]}. Detecta controles de paginación, páginas, scroll, filtros o indicadores de continuación y marca PARTIAL; las filas visibles no representan todo el universo. No inventes datos: si una colección no puede reconstruirse, conserva events=[] y sourceCompleteness=UNKNOWN en lugar de false o cero. Si ves nombre o matrícula, extraelos explícitamente. Para actividad académica conserva lastCourseAccess=NEVER y registros visibles sin convertir ausencia de modalidad en false.` },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${encoded}` } },
        ],
      }],
    }),
  });
  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`OPENROUTER_ERROR_${response.status}${details ? `: ${details.slice(0, 240)}` : ''}`);
  }
  const completion = await response.json() as { choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }> };
  const content = completion.choices?.[0]?.message?.content;
  const raw = Array.isArray(content) ? content.map((part) => part.text ?? '').join('') : content ?? '';
  const parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()) as { text?: string; facts?: ExtractedFact[]; observations?: string[] };
  return { text: [parsed.text ?? '', ...(parsed.observations ?? [])].filter(Boolean).join('\n'), facts: parsed.facts ?? [], provider: null };
}

const evidenceProcessing: JobHandler = async (context, job) => {
  const evidenceId = String(job.payload.evidenceId ?? '');
  const evidence = await createEvidenceRepository(context.database).findStoredById(evidenceId);
  if (!evidence?.storageKey) throw new Error('EVIDENCE_NOT_FOUND');
  if (!context.storage) throw new Error('STORAGE_UNAVAILABLE');
  const download = await context.storage.from(evidence.storageBucket).download(evidence.storageKey);
  if (download.error || !download.data) throw new Error(download.error?.message ?? 'STORAGE_DOWNLOAD_FAILED');
  const isImage = evidence.detectedMimeType.startsWith('image/');
  const isAudio = evidence.detectedMimeType.startsWith('audio/');
  const analysis = isAudio
    ? await transcribeAudio(download.data)
    : isImage
    ? await analyzeEvidence(download.data, evidence.detectedMimeType, evidence.originalFilename)
    : { text: await blobToText(download.data), facts: [] as ExtractedFact[], provider: 'LOCAL' };
  const contentSha256 = createHash('sha256').update(analysis.text).digest('hex');
  const extractionVersion = String(job.payload.version ?? (isImage ? 'vision-extraction-v3' : 'deterministic-text-v1'));
  const repo = createJobRepository(context.database);
  await repo.recordArtifact(job.jobId, isAudio ? 'audio-transcript' : isImage ? 'visual-transcription' : 'document-text', {
    evidenceId,
    mimeType: evidence.detectedMimeType,
    extraction: extractionVersion,
    ...(isAudio ? { transcript: analysis.transcript ?? analysis.text, utterances: analysis.utterances ?? [], words: analysis.words ?? [] } : { extractedFacts: analysis.facts }),
    text: analysis.text,
  }, { evidenceId, contentSha256, extractorVersion: extractionVersion, provider: analysis.provider });
  await repo.complete(job.jobId, context.workerId, 100);
  await enqueueFactExtractionIfReady(context, job.auditId, await actorForAudit(context.database, job.auditId, job.payload));
};

/**
 * C1 / Step 7: el congelado pasa por `freeze_fact_run_v1`, que sella el snapshot
 * de hechos efectivos y pasa el run a FROZEN en la MISMA transacción, con el
 * `integrity_hash` calculado en el servidor. Antes este handler hacía un
 * `UPDATE fact_extraction_runs SET state='FROZEN'` a pelo: sin snapshot, y con
 * la migración aplicada sería un FROZEN que no se puede volver a sellar.
 *
 * `freezeFactRunWithSnapshot` degradea solo cuando el RPC NO EXISTE (la
 * migración aún no está aplicada), y avisa con un código estable. Un error de
 * negocio del RPC sube al handler y el job queda en retry: no se escribe un
 * FROZEN sin motivo registrado.
 */
const factExtraction: JobHandler = async (context, job) => {
  const runId = String(job.payload.factRunId ?? '');
  const factsRepo = createFactRepository(context.database);
  const run = await factsRepo.findRunById(runId);
  if (!run) throw new Error('FACT_RUN_NOT_FOUND');
  // Aislamiento de baseline: solo artifacts de evidencias con rol EVIDENCE.
  const artifacts = await createJobRepository(context.database).listBaselineArtifactsByAudit(run.auditId);
  const facts = extractFactsFromArtifacts({ auditId: run.auditId, runId: run.id, artifacts });
  const existingFacts = await factsRepo.listFactsByRun(run.id);
  if (existingFacts.length === 0) await factsRepo.insertFacts(facts);
  await freezeFactRunWithSnapshot({
    database: context.database,
    factRunId: run.id,
    actorId: await actorForAudit(context.database, run.auditId, job.payload),
    policySourceId: POLICY_SOURCE_ID,
    run,
  });
  await createJobRepository(context.database).complete(job.jobId, context.workerId, 100);
  await enqueueAuditEvaluation(context, run.auditId, run.id, await actorForAudit(context.database, run.auditId, job.payload));
};

const auditEvaluation: JobHandler = async (context, job) => {
  const auditId = String(job.payload.auditId ?? job.auditId);
  const factRunId = String(job.payload.factRunId ?? '');
  const actorId = await actorForAudit(context.database, auditId, job.payload);
  const result = await runPolicyEngineForAudit({ database: context.database, auditId, actorId, policyCode: POLICY_CODE, policyVersion: POLICY_VERSION, factRunId });
  await createJobRepository(context.database).complete(job.jobId, context.workerId, 100);
  await enqueueReportGeneration(context, auditId, String(result.engineRun.id), actorId);
};

const reportGeneration: JobHandler = async (context, job) => {
  const auditId = String(job.payload.auditId ?? job.auditId);
  const actorId = await actorForAudit(context.database, auditId, job.payload);
  await buildSnapshot({ user: { id: actorId }, client: { database: context.database, storage: context.storage }, auditId } as AuthorizedContext);
  await updateAuditStatus(context.database, auditId, 'COMPLETED');
  await createJobRepository(context.database).complete(job.jobId, context.workerId, 100);
};

const handlers: Record<string, JobHandler> = {
  METADATA_PROBE: metadataProbe,
  EVIDENCE_PROCESSING: evidenceProcessing,
  FACT_EXTRACTION: factExtraction,
  AUDIT_EVALUATION: auditEvaluation,
  REPORT_GENERATION: reportGeneration,
  HUMAN_DECISION_EXTRACTION: async (context, job) => {
    await runHumanDecisionExtraction({ database: context.database, storage: context.storage }, job);
    await createJobRepository(context.database).complete(job.jobId, context.workerId, 100);
  },
  AI_RECONCILIATION: async (context, job) => {
    await runReconciliationAnalysis({ database: context.database }, job);
    await createJobRepository(context.database).complete(job.jobId, context.workerId, 100);
  },
};

export async function executeClaimedJob(context: HandlerContext, job: ClaimedJob): Promise<void> {
  const handler = handlers[job.jobType];
  if (!handler) {
    await createJobRepository(context.database).failPermanent(job.jobId, context.workerId, 'UNSUPPORTED_JOB_TYPE', 'Tipo de job no soportado.');
    return;
  }

  try {
    await handler(context, job);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error transitorio.';
    await createJobRepository(context.database).scheduleRetry(job.jobId, context.workerId, 'SYNTHETIC_TRANSIENT_ERROR', message, 30);
  }
}
