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
import { classifyJobError, retryDelaySeconds } from '@/server/jobs/error-taxonomy';
import {
  beginProviderOperation, completeProviderOperation, recordAiUsage, readAssemblyAiUsage, readOpenRouterUsage,
  requestFingerprint, type ProviderUsage,
} from '@/server/jobs/cost-ledger';
import { logPolicyEvent, startTimer } from '@/server/policy/operational-log';

/**
 * Contexto necesario para contabilizar una llamada de proveedor.
 *
 * Es opcional a propósito: `analyzeEvidence` se usa también en rutas sin job
 * (procesamiento síncrono), y esas NO deben dejar de funcionar por no tener
 * ledger. Lo que no tiene ledger simply no se mide; lo que lo tiene se mide y
 * se factura como máximo una vez.
 */
interface ProviderCallContext {
  database: DatabaseClient;
  auditId: string;
  jobId: string | null;
  attemptId: string | null;
  evidenceId: string | null;
}
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

async function transcribeAudio(data: Blob | ArrayBuffer, cost?: ProviderCallContext): Promise<EvidenceAnalysis> {
  const env = getServerEnv();
  if (!env.ASSEMBLYAI_API_KEY) throw new Error('ASSEMBLYAI_API_KEY_NOT_CONFIGURED');
  const buffer = data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(await data.arrayBuffer());

  // Una transcripción es UNA operación pagada, aunque internamente haga upload
  // + create + N polls. La huella cubre la operación lógica entera para que un
  // reintento reutilice el resultado en vez de crear una segunda transcripción.
  const fingerprint = cost
    ? requestFingerprint({ auditId: cost.auditId, jobId: cost.jobId, stage: 'ASSEMBLYAI_TRANSCRIPT', input: `${buffer.length}` })
    : null;
  const ledger = cost && fingerprint
    ? await beginProviderOperation({
        database: cost.database, jobId: cost.jobId, attemptId: cost.attemptId, evidenceId: cost.evidenceId,
        provider: 'ASSEMBLYAI', operationType: 'TRANSCRIPT', fingerprint, billable: true,
      })
    : null;
  if (ledger && !ledger.shouldExecute) {
    if (ledger.status === 'RESULT_UNKNOWN') throw new Error('PROVIDER_RESULT_UNKNOWN: la transcripcion anterior a AssemblyAI no tiene resultado registrado');
    logPolicyEvent('PROVIDER_OPERATION_SUCCEEDED', { auditId: cost?.auditId, jobId: cost?.jobId, attemptId: cost?.attemptId, code: 'REUSED', reasonCode: 'ALREADY_PAID' });
    return { text: '', transcript: '', utterances: [], words: [], facts: [], provider: 'ASSEMBLYAI' };
  }
  logPolicyEvent('PROVIDER_OPERATION_STARTED', { auditId: cost?.auditId, jobId: cost?.jobId, attemptId: cost?.attemptId, code: 'ASSEMBLYAI' });

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

  // El poll es una LECTURA, no una operación pagada. No genera coste: contarlo
  // como coste inflaría el gasto registrado y haría inútil el control.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const poll = await fetch(`https://api.assemblyai.com/v2/transcript/${started.id}`, { headers: { authorization: env.ASSEMBLYAI_API_KEY } });
    if (!poll.ok) throw new Error(`ASSEMBLYAI_POLL_ERROR_${poll.status}`);
    const result = await poll.json() as { status?: string; text?: string; utterances?: unknown[]; words?: unknown[]; error?: string; audio_duration?: number };
    if (result.status === 'completed') {
      if (cost && fingerprint && ledger) {
        const usage: ProviderUsage = readAssemblyAiUsage(result, started.id ?? null);
        await completeProviderOperation({ database: cost.database, providerOperationId: ledger.providerOperationId, status: 'SUCCEEDED', externalOperationId: usage.externalOperationId });
        await recordAiUsage({
          database: cost.database, auditId: cost.auditId, jobId: cost.jobId, attemptId: cost.attemptId,
          evidenceId: cost.evidenceId, fingerprint, providerOperationId: ledger.providerOperationId, usage,
        });
        logPolicyEvent('PROVIDER_OPERATION_SUCCEEDED', { auditId: cost.auditId, jobId: cost.jobId, attemptId: cost.attemptId, code: 'ASSEMBLYAI' });
      }
      return { text: result.text ?? '', transcript: result.text ?? '', utterances: result.utterances ?? [], words: result.words ?? [], facts: [], provider: 'ASSEMBLYAI' };
    }
    if (result.status === 'error') throw new Error(result.error ?? 'ASSEMBLYAI_TRANSCRIPTION_FAILED');
  }
  // Se agotó el tiempo de espera, pero la transcripción pudo facturarse. Se
  // marca como resultado desconocido en vez de FAILED, porque "no sé si se
  // cobró" y "no se cobró" llevan a decisiones opuestas.
  if (ledger) await completeProviderOperation({ database: cost!.database, providerOperationId: ledger.providerOperationId, status: 'RESULT_UNKNOWN', errorCode: 'ASSEMBLYAI_TRANSCRIPTION_TIMEOUT' });
  throw new Error('ASSEMBLYAI_TRANSCRIPTION_TIMEOUT');
}

type ExtractedFact = { factType: string; value: unknown; confidence?: number };
type EvidenceAnalysis = { text: string; facts: ExtractedFact[]; provider: string | null; transcript?: string; utterances?: unknown[]; words?: unknown[] };

async function analyzeEvidence(data: Blob | ArrayBuffer, mimeType: string, filename: string, cost?: ProviderCallContext): Promise<EvidenceAnalysis> {
  const env = getServerEnv();
  const buffer = data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(await data.arrayBuffer());
  const encoded = buffer.toString('base64');

  // La huella identifica la operación LÓGICA pagada. No incluye el intento: el
  // reintento del mismo trabajo debe producir la misma huella para que se
  // reutilice en vez de volver a pagarse.
  const fingerprint = cost
    ? requestFingerprint({ auditId: cost.auditId, jobId: cost.jobId, stage: 'OPENROUTER_CHAT', input: `${filename}:${encoded.length}` })
    : null;
  const ledger = cost && fingerprint
    ? await beginProviderOperation({
        database: cost.database, jobId: cost.jobId, attemptId: cost.attemptId, evidenceId: cost.evidenceId,
        provider: 'OPENROUTER', operationType: 'CHAT_COMPLETIONS', fingerprint, billable: true,
      })
    : null;

  // Si ya se pagó y se guardó, NO se vuelve a llamar. Se devuelve lo que hay.
  if (ledger && !ledger.shouldExecute) {
    if (ledger.status === 'RESULT_UNKNOWN') throw new Error('PROVIDER_RESULT_UNKNOWN: la llamada anterior a OpenRouter no tiene resultado registrado');
    logPolicyEvent('PROVIDER_OPERATION_SUCCEEDED', {
      auditId: cost?.auditId, jobId: cost?.jobId, attemptId: cost?.attemptId,
      code: 'REUSED', reasonCode: 'ALREADY_PAID',
    });
    return { text: '', facts: [], provider: 'OPENROUTER' };
  }
  logPolicyEvent('PROVIDER_OPERATION_STARTED', {
    auditId: cost?.auditId, jobId: cost?.jobId, attemptId: cost?.attemptId, code: 'OPENROUTER',
  });

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
    const message = `OPENROUTER_ERROR_${response.status}${details ? `: ${details.slice(0, 240)}` : ''}`;
    if (ledger) await completeProviderOperation({ database: cost!.database, providerOperationId: ledger.providerOperationId, status: 'FAILED', errorCode: `OPENROUTER_${response.status}`, errorMessage: message });
    logPolicyEvent('PROVIDER_OPERATION_FAILED', { auditId: cost?.auditId, jobId: cost?.jobId, attemptId: cost?.attemptId, code: `OPENROUTER_${response.status}` });
    throw new Error(message);
  }
  // El cuerpo completo se conserva para leer `usage`: antes se descartaba, y por
  // eso el coste era invisible.
  const body = await response.json() as Record<string, unknown>;
  const completion = body as { choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }> };
  const content = completion.choices?.[0]?.message?.content;
  const raw = Array.isArray(content) ? content.map((part) => part.text ?? '').join('') : content ?? '';
  const parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()) as { text?: string; facts?: ExtractedFact[]; observations?: string[] };

  if (cost && fingerprint && ledger) {
    const usage = readOpenRouterUsage(body);
    await completeProviderOperation({ database: cost.database, providerOperationId: ledger.providerOperationId, status: 'SUCCEEDED', externalOperationId: usage.externalOperationId });
    await recordAiUsage({
      database: cost.database, auditId: cost.auditId, jobId: cost.jobId, attemptId: cost.attemptId,
      evidenceId: cost.evidenceId, fingerprint, providerOperationId: ledger.providerOperationId, usage,
    });
    logPolicyEvent('PROVIDER_OPERATION_SUCCEEDED', {
      auditId: cost.auditId, jobId: cost.jobId, attemptId: cost.attemptId, code: 'OPENROUTER',
      factsFingerprint: usage.costUsd === null ? null : String(usage.costUsd),
    });
  }

  return { text: [parsed.text ?? '', ...(parsed.observations ?? [])].filter(Boolean).join('\n'), facts: parsed.facts ?? [], provider: 'OPENROUTER' };
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
  // El contexto de coste sólo existe si hay job: es lo que permite reutilizar
  // una operación ya pagada en lugar de volver a pagarla en un reintento.
  const cost: ProviderCallContext = {
    database: context.database,
    auditId: job.auditId,
    jobId: job.jobId,
    attemptId: job.attemptId ?? null,
    evidenceId,
  };
  logPolicyEvent('JOB_CLAIMED', { auditId: job.auditId, jobId: job.jobId, attemptId: job.attemptId ?? null, stage: job.jobType });
  const analysis = isAudio
    ? await transcribeAudio(download.data, cost)
    : isImage
    ? await analyzeEvidence(download.data, evidence.detectedMimeType, evidence.originalFilename, cost)
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
/**
 * Avanza el Fact Run a PROCESSING por la vía autoritativa.
 *
 * Por qué existe esto y por qué no es un UPDATE suelto: el incidente del
 * 2026-09-25. `freeze_fact_run_v1` exige `state = 'PROCESSING'`, pero la
 * transición a PROCESSING estaba written SÓLO en el camino local de
 * `freezeFactRunWithSnapshot`, después del intento por RPC. Al aplicarse la
 * migración Foundation el RPC pasó a existir, todos los freezes fueron por el
 * camino que NO mueve el estado, y el RPC respondió
 * `FACT_RUN_NOT_PROCESSING: DRAFT` indefinidamente.
 *
 * `begin_fact_run_processing_v1` es atómica (FOR UPDATE), idempotente, y es el
 * ÚNICO sitio donde se decide la transición.
 */
async function ensureFactRunProcessing(context: HandlerContext, runId: string): Promise<'PROCESSING' | 'ALREADY_PROCESSING' | 'ALREADY_FROZEN'> {
  if (typeof context.database.rpc !== 'function') return 'ALREADY_PROCESSING';
  const { data, error } = await context.database.rpc('begin_fact_run_processing_v1', { p_fact_run_id: runId });
  if (error) throw new Error(`FACT_RUN_STATE_NOT_PROCESSABLE: ${error.message ?? 'transicion rechazada'}`);
  const row = ((data ?? []) as Array<Record<string, unknown>>)[0];
  const transition = String(row?.out_transition ?? 'ALREADY_PROCESSING');
  if (transition === 'ALREADY_FROZEN') return 'ALREADY_FROZEN';
  return 'PROCESSING';
}

/**
 * ¿Terminaron las evidencias que este Fact Run necesita?
 *
 * Sin esta comprobación, FACT_EXTRACTION se lanza contra artefactos a medio
 * construir y falla por una razón que no es un error: la evidencia aún no está.
 * Eso no se reintenta a ciegas; se espera o se bloquea explícitamente.
 */
async function assertEvidenceDependenciesReady(context: HandlerContext, auditId: string): Promise<void> {
  const { data, error } = await context.database
    .from('jobs')
    .select('job_type,status,last_error_code,last_error_message_sanitized')
    .eq('audit_id', auditId)
    .eq('job_type', 'EVIDENCE_PROCESSING');
  if (error) return; // No se puede comprobar: no se bloquea por una lectura fallida.

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const failed = rows.find((row) => row.status === 'FAILED');
  if (failed) {
    // Terminal y explícito. Reintentar FACT_EXTRACTION no va a arreglar una
    // evidencia que falló, y consume intentos de los tres disponibles.
    throw new Error(`DEPENDENCY_TERMINAL_FAILURE: EVIDENCE_PROCESSING fallo (${String(failed.last_error_code ?? 'UNKNOWN')}): ${String(failed.last_error_message_sanitized ?? '')}`.trim());
  }
  const pending = rows.filter((row) => row.status === 'QUEUED' || row.status === 'RUNNING' || row.status === 'RETRY_SCHEDULED');
  if (pending.length > 0) {
    // Reintentable y con sentido: la evidencia se está procesando ahora mismo.
    throw new Error('DEPENDENCY_NOT_READY: hay EVIDENCE_PROCESSING sin terminar');
  }
}

const factExtraction: JobHandler = async (context, job) => {
  const runId = String(job.payload.factRunId ?? '');
  const factsRepo = createFactRepository(context.database);
  const run = await factsRepo.findRunById(runId);
  if (!run) throw new Error('FACT_RUN_NOT_FOUND');

  const actorId = await actorForAudit(context.database, run.auditId, job.payload);
  const jobsRepo = createJobRepository(context.database);

  // 1) Reanudación: si el run ya está FROZEN y sellado, el trabajo ya está
  //    hecho. No se vuelve a extraer, no se vuelven a llamar proveedores, no se
  //    inserta un segundo snapshot. Es lo que hace segura una reanudación tras
  //    un refresh, un reintento o un worker duplicado.
  if (run.state === 'FROZEN') {
    const existing = await jobsRepo.listArtifactsByAudit(run.auditId);
    const alreadySealed = existing.length > 0 || (await factsRepo.listFactsByRun(run.id)).length > 0;
    if (alreadySealed) {
      logPolicyEvent('FACT_RUN_ALREADY_FROZEN', {
        auditId: run.auditId, factRunId: run.id, jobId: job.jobId,
        code: 'ALREADY_COMPLETED', extractorVersion: run.extractorVersion,
      });
      await jobsRepo.complete(job.jobId, context.workerId, 100);
      return;
    }
  }

  // 2) Precondiciones: las evidencias tienen que estar listas.
  await assertEvidenceDependenciesReady(context, run.auditId);

  // 3) LA transición que faltaba. Va ANTES de extraer, no justo antes de
  //    congelar: si el proceso muere a mitad de extracción, el run queda en
  //    PROCESSING y el reintento sabe que ya empezó.
  const transition = await ensureFactRunProcessing(context, run.id);
  if (transition === 'ALREADY_FROZEN') {
    await jobsRepo.complete(job.jobId, context.workerId, 100);
    return;
  }
  if (transition === 'ALREADY_PROCESSING') {
    logPolicyEvent('FACT_RUN_PROCESSING_RESUMED', { auditId: run.auditId, factRunId: run.id, jobId: job.jobId });
  } else {
    logPolicyEvent('FACT_RUN_PROCESSING_STARTED', { auditId: run.auditId, factRunId: run.id, jobId: job.jobId, extractorVersion: run.extractorVersion });
  }

  // 4) Aislamiento de baseline: sólo artifacts de evidencias con rol EVIDENCE.
  const artifacts = await jobsRepo.listBaselineArtifactsByAudit(run.auditId);
  const facts = extractFactsFromArtifacts({ auditId: run.auditId, runId: run.id, artifacts });

  // 5) Idempotencia de facts.
  //
  //    No se puede poner un UNIQUE (run_id, fact_type): se comprobó en la base
  //    y hay 8 Fact Runs con dos facts del mismo tipo, así que sería un
  //    constraint que rechazaría datos legítimos. La identidad real de un fact
  //    extraído es "el conjunto completo del run", así que la convergencia se
  //    hace por conjunto: si lo que hay no es exactamente lo que se extrajo, se
  //    reemplaza. Es idempotente y no necesita schema nuevo.
  const existingFacts = await factsRepo.listFactsByRun(run.id);
  if (existingFacts.length !== facts.length) {
    if (existingFacts.length > 0) await factsRepo.deleteFactsByRun(run.id);
    if (facts.length > 0) await factsRepo.insertFacts(facts);
  }

  // 6) Congelar. freeze_fact_run_v1 ya ve el run en PROCESSING.
  await freezeFactRunWithSnapshot({
    database: context.database,
    factRunId: run.id,
    actorId,
    policySourceId: POLICY_SOURCE_ID,
    run: { ...run, state: 'PROCESSING' },
  });

  logPolicyEvent('FACT_RUN_FROZEN', { auditId: run.auditId, factRunId: run.id, jobId: job.jobId, factCount: facts.length });

  await jobsRepo.complete(job.jobId, context.workerId, 100);
  await enqueueAuditEvaluation(context, run.auditId, run.id, actorId);
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

/**
 * Ejecuta UN job ya reclamado.
 *
 * QUÉ CAMBIA RESPECTO A ANTES
 * Antes: `catch (error) { scheduleRetry(..., 'SYNTHETIC_TRANSIENT_ERROR', message, 30) }`.
 * Todo error era transitorio. `FACT_RUN_NOT_PROCESSING: DRAFT` lo consumió dos
 * de tres intentos aunque no podía funcionar nunca, y el job quedó en
 * RETRY_SCHEDULED, que es el estado que mantienen vivo el bucle de POST del
 * incidente.
 *
 * Ahora cada error se clasifica y sólo se reintenta lo que puede funcionar sin
 * intervención. Lo demás va a `failPermanent`, que es terminal y queda
 * registrado en `audit_log` para que una persona lo atienda.
 *
 * Un error no reconocido se clasifica como TERMINAL. Ante la duda, parar es
 * reversible: una persona relanza. Cobrar dos veces, no.
 */
export async function executeClaimedJob(context: HandlerContext, job: ClaimedJob): Promise<void> {
  const handler = handlers[job.jobType];
  if (!handler) {
    await createJobRepository(context.database).failPermanent(job.jobId, context.workerId, 'UNSUPPORTED_JOB_TYPE', 'Tipo de job no soportado.');
    logPolicyEvent('JOB_TERMINAL_FAILURE', { auditId: job.auditId ?? null, jobId: job.jobId, code: 'UNSUPPORTED_JOB_TYPE' });
    return;
  }

  const started = startTimer();
  try {
    await handler(context, job);
    logPolicyEvent('JOB_COMPLETED', { auditId: job.auditId ?? null, jobId: job.jobId, durationMs: started() });
  } catch (error) {
    const classified = classifyJobError(error);
    const jobs = createJobRepository(context.database);

    if (classified.retryable) {
      const delay = retryDelaySeconds(job.attemptNumber ?? 1);
      await jobs.scheduleRetry(job.jobId, context.workerId, classified.code, classified.message, delay);
      logPolicyEvent('JOB_RETRY_SCHEDULED', {
        auditId: job.auditId ?? null, jobId: job.jobId, code: classified.code, stage: job.jobType, durationMs: started(),
      });
      return;
    }

    // Terminal. Y si el coste pudo cobrarse pero no se sabe, se dice: es la
    // diferencia entre "esta auditoría falló" y "no sabemos si esta auditoría
    // se cobró dos veces".
    await jobs.failPermanent(job.jobId, context.workerId, classified.code, classified.message);
    logPolicyEvent('JOB_TERMINAL_FAILURE', {
      auditId: job.auditId ?? null, jobId: job.jobId, code: classified.code, stage: job.jobType, durationMs: started(),
    });
    if (classified.costMayHaveBeenCharged) {
      logPolicyEvent('PROVIDER_OPERATION_FAILED', {
        auditId: job.auditId ?? null, jobId: job.jobId, code: 'PROVIDER_RESULT_UNKNOWN',
      });
    }
  }
}
