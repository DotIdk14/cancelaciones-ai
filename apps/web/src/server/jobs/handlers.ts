import {
  AssemblyAIProvider,
  createFakeAiProvider,
  FakeOpenRouterScenario,
  OpenRouterProvider,
  runAuditReviewer,
  runCaseAnalyst,
} from '@cancelaciones/ai';
import { prepareEvidenceContent } from '@cancelaciones/evidence';
import {
  createAuditRepository,
  createAuditResultRepository,
  createAuditRunRepository,
  createEvidenceRepository,
  createJobRepository,
  type ClaimedJob,
  type DatabaseClient,
} from '@cancelaciones/db';
import { MAX_TOOL_OUTPUT_CHARS, reviewSchema, sha256Hex, type Assessment, type Review } from '@cancelaciones/shared';
import { getAiEnv } from '@/server/config/env';

interface HandlerContext {
  database: DatabaseClient;
  storage?: { from(bucket: string): { download(key: string): Promise<{ data?: Blob | ArrayBuffer | null; error?: { message?: string } | null }>; upload?(key: string, body: Blob): Promise<{ error?: { message?: string } | null }> } };
  workerId: string;
}

type JobHandler = (context: HandlerContext, job: ClaimedJob) => Promise<void>;

const POLICY_CODE = 'GDM_GAM_PRD_MLG_003';
const POLICY_VERSION = '5';

function payloadRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
}

function sanitizeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : 'Error inesperado.';
}

function buildAiProvider() {
  if (process.env.LOCAL_DEMO === '1') return createFakeAiProvider(FakeOpenRouterScenario.CASE_NEEDS_INPUT);
  const env = getAiEnv();
  return new OpenRouterProvider({
    apiKey: env.OPENROUTER_API_KEY,
    appUrl: env.NEXT_PUBLIC_APP_URL,
    fastModel: env.OPENROUTER_FAST_MODEL,
    analystModel: env.OPENROUTER_ANALYST_MODEL,
    reviewerModel: env.OPENROUTER_REVIEWER_MODEL,
    visionModel: env.OPENROUTER_VISION_MODEL,
  });
}

function buildReviewerProvider(provider: ReturnType<typeof buildAiProvider>) {
  if ('review' in provider) return provider;
  return {
    review: async (input: unknown): Promise<Review> => {
      const assessment = (input && typeof input === 'object' ? (input as { assessment?: unknown }).assessment : null) ?? null;
      const response = await provider.generateStructured({
        model: provider.reviewerModel,
        purpose: 'audit-reviewer',
        user: `Revisa este assessment y devuelve JSON Review. Assessment: ${JSON.stringify(assessment)}`,
        schema: reviewSchema,
        timeoutMs: 60_000,
      });
      return reviewSchema.parse(response.value);
    },
  };
}

function buildAudioProvider() {
  if (process.env.LOCAL_DEMO === '1') return undefined;
  const env = getAiEnv();
  return env.ASSEMBLYAI_API_KEY ? new AssemblyAIProvider({ apiKey: env.ASSEMBLYAI_API_KEY }) : undefined;
}

function toEvidencePort(evidence: Awaited<ReturnType<ReturnType<typeof createEvidenceRepository>['findStoredById']>>) {
  if (!evidence) return null;
  return {
    id: evidence.id,
    auditId: evidence.auditId,
    originalFilename: evidence.originalFilename ?? evidence.filename,
    safeFilename: evidence.safeFilename ?? evidence.filename,
    detectedMimeType: evidence.detectedMimeType ?? evidence.mimeType ?? 'application/octet-stream',
    kind: evidence.kind,
    sizeBytes: evidence.sizeBytes,
    sha256: evidence.sha256 ?? '',
    storageBucket: evidence.storageBucket,
    storageKey: evidence.storageKey,
    status: evidence.status,
    contentStatus: evidence.contentStatus,
    contentError: evidence.contentError,
    createdAt: evidence.createdAt,
  };
}

const evidenceProcessing: JobHandler = async (context, job) => {
  const payload = payloadRecord(job.payload);
  const evidenceId = String(payload.evidenceId ?? job.evidenceId ?? '');
  const repo = createJobRepository(context.database);
  const evidenceRepo = createEvidenceRepository(context.database);
  const evidence = toEvidencePort(await evidenceRepo.findStoredById(evidenceId));
  if (!evidence) throw new Error('EVIDENCE_NOT_FOUND');
  if (!context.storage) throw new Error('STORAGE_UNAVAILABLE');

  const aiProvider = buildAiProvider();
  const prepared = await prepareEvidenceContent({
    evidence,
    storage: {
      download: async (bucket: string, key: string) => {
        const response = await context.storage!.from(bucket).download(key);
        return { data: response.data ?? null, error: response.error ?? null };
      },
      upload: async (bucket, key, body) => context.storage!.from(bucket).upload ? context.storage!.from(bucket).upload!(key, body) : { error: { message: 'STORAGE_UPLOAD_UNAVAILABLE' } },
    },
    providers: { audio: buildAudioProvider() },
    config: {
      visionModel: 'visionModel' in aiProvider ? aiProvider.visionModel : 'local-demo-vision',
      visionTimeoutMs: 60_000,
      audioPollMaxAttempts: 1,
      audioPollIntervalMs: 1_000,
      audioPollTimeoutMs: 60_000,
      maxToolOutputChars: MAX_TOOL_OUTPUT_CHARS,
    },
  });

  await evidenceRepo.markContentStatus(evidence.id, prepared.status, prepared.error?.message ?? null);
  await repo.recordArtifact(job.jobId, prepared.kind === 'AUDIO' ? 'audio-transcription-request' : 'evidence-content', prepared, {
    evidenceId: evidence.id,
    contentSha256: prepared.text ? sha256Hex(prepared.text) : null,
    extractorVersion: 'ai-native-evidence-v1',
    provider: prepared.aiCall?.model ?? (process.env.LOCAL_DEMO === '1' ? 'local-demo' : 'deterministic'),
  });
  await repo.complete(job.jobId, context.workerId, 100);
};

async function createRunForAudit(context: HandlerContext, auditId: string, actorId: string | null) {
  const evidences = await createEvidenceRepository(context.database).listByAudit(auditId);
  const fingerprint = sha256Hex(JSON.stringify(evidences.map((evidence) => ({ id: evidence.id, sha256: evidence.sha256, status: evidence.contentStatus })).sort((a, b) => a.id.localeCompare(b.id))));
  const aiProvider = buildAiProvider();
  return createAuditRunRepository(context.database).create({
    auditId,
    createdBy: actorId,
    evidenceFingerprint: fingerprint,
    policyCode: POLICY_CODE,
    policyVersion: POLICY_VERSION,
    analystModel: 'analystModel' in aiProvider ? aiProvider.analystModel : 'local-demo-analyst',
    analystPromptVersion: 'ai-native-v1',
    reviewerModel: 'reviewerModel' in aiProvider ? aiProvider.reviewerModel : 'local-demo-reviewer',
    reviewerPromptVersion: 'ai-native-v1',
  });
}

function resultStatus(assessment: Assessment) {
  return assessment.status === 'NEEDS_INPUT' ? 'NEEDS_INPUT' as const : 'COMPLETED' as const;
}

const auditRun: JobHandler = async (context, job) => {
  const payload = payloadRecord(job.payload);
  const auditId = String(job.auditId ?? payload.auditId ?? '');
  if (!auditId) throw new Error('AUDIT_ID_MISSING');
  const audit = await createAuditRepository(context.database).findById(auditId);
  if (!audit) throw new Error('AUDIT_NOT_FOUND');

  const runRepo = createAuditRunRepository(context.database);
  const resultRepo = createAuditResultRepository(context.database);
  const jobRepo = createJobRepository(context.database);
  const run = payload.runId ? await runRepo.findById(String(payload.runId)) : await createRunForAudit(context, auditId, audit.createdBy);
  if (!run) throw new Error('AUDIT_RUN_NOT_FOUND');
  if (audit.status === 'DRAFT') await createAuditRepository(context.database).updateStatus(auditId, 'PROCESSING');
  await runRepo.advance(run.id, 'PROCESSING_EVIDENCE');
  await runRepo.advance(run.id, 'ANALYZING');

  const artifacts = await jobRepo.listArtifactsByAudit(auditId);
  const evidence = artifacts
    .filter((artifact) => artifact.artifactType === 'evidence-content')
    .map((artifact) => ({ id: artifact.evidenceId ?? artifact.id, text: typeof (artifact.result as { text?: unknown }).text === 'string' ? (artifact.result as { text: string }).text : JSON.stringify(artifact.result) }));
  const aiProvider = buildAiProvider();
  const analystModel = 'analystModel' in aiProvider ? aiProvider.analystModel : 'local-demo-analyst';
  const reviewerModel = 'reviewerModel' in aiProvider ? aiProvider.reviewerModel : 'local-demo-reviewer';
  const assessment = await runCaseAnalyst({ provider: aiProvider, model: analystModel, audit: { ...audit }, evidence });
  await runRepo.advance(run.id, 'REVIEWING');
  const reviewed = await runAuditReviewer({ provider: buildReviewerProvider(aiProvider), model: reviewerModel, assessment });
  await resultRepo.create({
    auditId,
    runId: run.id,
    stage: 'FINAL',
    status: resultStatus(reviewed.finalAssessment),
    classification: reviewed.finalAssessment.classification ?? reviewed.finalAssessment.status,
    summary: reviewed.finalAssessment.summary,
    assessment: reviewed.finalAssessment,
    review: reviewed.review,
  });
  await runRepo.incrementCounters(run.id, { agentStepCount: 'stepCount' in aiProvider ? aiProvider.stepCount : 0, toolCallCount: 'toolCallCount' in aiProvider ? aiProvider.toolCallCount : 0 });
  const terminalStatus = reviewed.finalAssessment.status === 'NEEDS_INPUT' ? 'NEEDS_INPUT' : 'COMPLETED';
  await runRepo.advance(run.id, terminalStatus);
  await createAuditRepository(context.database).updateStatus(auditId, terminalStatus);
  await jobRepo.complete(job.jobId, context.workerId, 100);
};

const audioTranscription: JobHandler = async (context, job) => {
  await createJobRepository(context.database).recordArtifact(job.jobId, 'audio-transcription-placeholder', { status: 'WAITING_EXTERNAL', jobId: job.jobId });
  await createJobRepository(context.database).complete(job.jobId, context.workerId, 100);
};

const handlers: Record<string, JobHandler> = {
  EVIDENCE_PROCESSING: evidenceProcessing,
  AUDIT_RUN: auditRun,
  AUDIO_TRANSCRIPTION: audioTranscription,
};

export async function executeClaimedJob(context: HandlerContext, job: ClaimedJob): Promise<void> {
  const handler = handlers[job.jobType];
  const repo = createJobRepository(context.database);
  if (!handler) {
    await repo.failPermanent(job.jobId, context.workerId, 'UNSUPPORTED_JOB_TYPE', 'Tipo de job no soportado.');
    return;
  }
  try {
    await handler(context, job);
  } catch (error) {
    const message = sanitizeError(error);
    if (job.attemptCount + 1 >= job.maxAttempts) await repo.failPermanent(job.jobId, context.workerId, 'JOB_FAILED', message);
    else await repo.scheduleRetry(job.jobId, context.workerId, 'JOB_RETRY', message, 30);
  }
}
