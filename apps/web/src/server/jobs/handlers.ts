import { createHash } from 'node:crypto';
import { createAuditRepository, createEvidenceRepository, createFactRepository, createJobRepository, type DatabaseClient } from '@cancelaciones/db';
import { canonicalFingerprintV1, stableFingerprint, type ClaimedJob } from '@cancelaciones/domain';
import { assertAuditEngineOperational } from '@/server/audit-engine/boundary';
import { extractFactsFromArtifacts } from '@/server/facts/extract';
import { getServerEnv } from '@/server/config/env';
import { blobToText } from '@/server/jobs/blob-text';

interface HandlerContext {
  database: DatabaseClient;
  storage?: { from(bucket: string): { download(key: string): Promise<{ data?: Blob | ArrayBuffer | null; error?: { message?: string } | null }> } };
  workerId: string;
}

type JobHandler = (context: HandlerContext, job: ClaimedJob) => Promise<void>;

const POLICY_CODE = 'GDM_GAM_PRD_MLG_003';
const POLICY_VERSION = '5';

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
  // La extraccion de hechos es infraestructura y puede congelar el fact run.
  // La evaluacion normativa ya NO se encadena: el motor de auditoria no existe.
  if (frozen) return;
  const active = existingRuns.find((run) => run.state === 'PROCESSING' || run.state === 'DRAFT');
  const run = active ?? await factsRepo.createRun({ auditId, policyCode: POLICY_CODE, policyVersion: POLICY_VERSION, extractorVersion: 'deterministic-facts-v1', artifactSetFingerprint: await factsRepo.artifactSetFingerprint(auditId), createdBy: actorId });
  if (run.state === 'DRAFT') await context.database.from('fact_extraction_runs').update({ state: 'PROCESSING' }).eq('id', run.id);
  const payload = { auditId, factRunId: run.id, version: 'deterministic-facts-v1', actorId };
  await createJobRepository(context.database).enqueue({ auditId, jobType: 'FACT_EXTRACTION', operationScope: `audit:${auditId}:facts`, idempotencyKey: `facts:${run.id}:v1`, inputFingerprint: stableFingerprint(payload), payload, actorId });
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
 * ONLY_OWNER_PROVIDED_POLICY_SOURCES: resuelve el documento normativo vigente
 * desde el registro del propietario. No hay constante con el `document_id` en
 * el código para que un cambio de documento sea una decisión del owner y no un
 * edit silencioso. Si no hay fuente registrada, el sellado falla.
 */
async function resolveRegisteredPolicySourceId(database: DatabaseClient, policyCode: string): Promise<string> {
  if (!database.rpc) throw new Error('Database client must support rpc to seal a fact run');
  const { data, error } = await database
    .from('policy_source_registry')
    .select('document_id,policy_version,status')
    .eq('policy_code', policyCode)
    .order('effective_from', { ascending: false })
    .limit(5);
  if (error) throw new Error(error.message ?? 'POLICY_SOURCE_LOOKUP_FAILED');
  const registered = (data ?? []).find((row: { status?: string | null }) => row.status === 'VERIFIED' || row.status === 'PENDING_VERIFICATION');
  const documentId = registered?.document_id;
  if (typeof documentId !== 'string' || documentId.trim() === '') {
    throw new Error(`POLICY_SOURCE_NOT_REGISTERED: ${policyCode}`);
  }
  return documentId;
}

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
  // Se sella lo que realmente quedó persistido, no lo que la extracción quiso
  // producir: el snapshot es la evidencia de referencia y su conteo lo contrasta
  // la función oficial contra la tabla `facts`.
  const persistedFacts = await factsRepo.listFactsByRun(run.id);
  if (persistedFacts.length === 0) throw new Error('FACT_RUN_EMPTY');
  const reviews = await context.database
    .from('fact_reviews')
    .select('fact_id,decision,corrected_value,created_at')
    .eq('audit_id', run.auditId)
    .order('created_at', { ascending: true });
  if (reviews.error) throw new Error(reviews.error.message ?? 'FACT_REVIEWS_READ_FAILED');
  const factReviewsSnapshot = (reviews.data ?? []).map((review: { fact_id: string; decision: string; corrected_value: unknown; created_at: string }) => ({
    factId: review.fact_id,
    decision: review.decision,
    correctedValue: review.corrected_value ?? null,
    createdAt: review.created_at,
  }));
  // ONLY_OWNER_PROVIDED_POLICY_SOURCES: el documento no lo decide el código.
  // Se resuelve contra el registro normative; si el propietario no lo registró,
  // el sellado falla en vez de congelar contra una fuente inventada.
  const policySourceId = await resolveRegisteredPolicySourceId(context.database, POLICY_CODE);
  // En este punto el run se sella recién extraído, sin revisiones humanas
  // incorporadas: por eso fingerprint canónico y efectivo coinciden. Toda
  // revisión posterior produce un run derivado con `create_derived_fact_run_v1`,
  // que es el mecanismo previsto para eso.
  const factsFingerprint = canonicalFingerprintV1(persistedFacts);
  if (!context.database.rpc) throw new Error('Database client must support rpc to seal a fact run');
  const freeze = await context.database.rpc('freeze_fact_run_v1', {
    p_fact_run_id: run.id,
    p_facts: persistedFacts,
    p_provenance: {
      factRunId: run.id,
      extractorVersion: run.extractorVersion,
      policyCode: POLICY_CODE,
      sealedFrom: 'fact_extraction_job',
    },
    p_policy_source_id: policySourceId,
    p_canonical_facts_fingerprint: factsFingerprint,
    p_effective_facts_fingerprint: factsFingerprint,
    p_fact_reviews_snapshot: factReviewsSnapshot,
    p_fact_count: persistedFacts.length,
  });
  if (freeze.error) throw new Error(freeze.error.message ?? 'FACT_RUN_FREEZE_FAILED');
  await createJobRepository(context.database).complete(job.jobId, context.workerId, 100);
  // La extraccion de hechos es infraestructura y termina aqui. No se encadena
  // evaluacion normativa: el motor de auditoria no esta implementado.
};

const auditEvaluation: JobHandler = async () => {
  // Falla explicito y ruidoso. No hay fallback al motor retirado.
  assertAuditEngineOperational('normative-evaluation');
};

const reportGeneration: JobHandler = async () => {
  // Un snapshot de reporte exige un resultado normativo aprobado.
  assertAuditEngineOperational('report-snapshot');
};

const handlers: Record<string, JobHandler> = {
  METADATA_PROBE: metadataProbe,
  EVIDENCE_PROCESSING: evidenceProcessing,
  FACT_EXTRACTION: factExtraction,
  AUDIT_EVALUATION: auditEvaluation,
  REPORT_GENERATION: reportGeneration,
  HUMAN_DECISION_EXTRACTION: async () => {
    assertAuditEngineOperational('human-comparison');
  },
  AI_RECONCILIATION: async () => {
    assertAuditEngineOperational('human-comparison');
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
