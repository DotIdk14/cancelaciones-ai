import { createHash } from 'node:crypto';
import { createEvidenceRepository, createFactRepository, createJobRepository, type DatabaseClient } from '@cancelaciones/db';
import type { ClaimedJob } from '@cancelaciones/domain';
import { extractFactsFromArtifacts } from '@/server/facts/extract';
import { getServerEnv } from '@/server/config/env';
import { blobToText } from '@/server/jobs/blob-text';
import { runHumanDecisionExtraction } from '@/server/human-decision/service';
import { runReconciliationAnalysis } from '@/server/reconciliation/service';

interface HandlerContext {
  database: DatabaseClient;
  storage?: { from(bucket: string): { download(key: string): Promise<{ data?: Blob | ArrayBuffer | null; error?: { message?: string } | null }> } };
  workerId: string;
}

type JobHandler = (context: HandlerContext, job: ClaimedJob) => Promise<void>;

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
};

const factExtraction: JobHandler = async (context, job) => {
  const runId = String(job.payload.factRunId ?? '');
  const factsRepo = createFactRepository(context.database);
  const run = await factsRepo.findRunById(runId);
  if (!run) throw new Error('FACT_RUN_NOT_FOUND');
  // Aislamiento de baseline: solo artifacts de evidencias con rol EVIDENCE.
  const artifacts = await createJobRepository(context.database).listBaselineArtifactsByAudit(run.auditId);
  const facts = extractFactsFromArtifacts({ auditId: run.auditId, runId: run.id, artifacts });
  await factsRepo.insertFacts(facts);
  await context.database.from('fact_extraction_runs').update({ state: 'DRAFT' }).eq('id', run.id).eq('state', 'PROCESSING');
  await createJobRepository(context.database).complete(job.jobId, context.workerId, 100);
};

const handlers: Record<string, JobHandler> = {
  METADATA_PROBE: metadataProbe,
  EVIDENCE_PROCESSING: evidenceProcessing,
  FACT_EXTRACTION: factExtraction,
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
