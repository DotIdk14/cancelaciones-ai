import {
  AssemblyAIProvider,
  createFakeAiProvider,
  FakeOpenRouterScenario,
  OpenRouterProvider,
  readPolicySection,
  runAuditReviewer,
  runCaseAnalyst,
} from '@cancelaciones/ai';
import { prepareEvidenceContent } from '@cancelaciones/evidence';
import {
  createAuditRepository,
  createAuditResultRepository,
  createAuditRunRepository,
  createAiCallLogRepository,
  createEvidenceRepository,
  createJobRepository,
  createToolExecutionRepository,
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

/**
 * Revisor real sobre OpenRouter.
 *
 * Recibe el assessment, el expediente y las tools de lectura para que pueda
 * verificar las citas de política contra el procedimiento real en vez de
 * aceptarlas de palabra. `generateStructured` con `reviewSchema` mantiene la
 * salida validada por Zod: un veredicto mal formado es un fallo, no un CONFIRMED.
 */
function buildReviewerProvider(provider: ReturnType<typeof buildAiProvider>) {
  if ('review' in provider) return provider;
  return {
    async review(input: { model: string; system: string; messages: unknown[]; tools: unknown[] }): Promise<{ value: Review }> {
      const response = await provider.generateStructured({
        model: input.model,
        purpose: 'audit-reviewer',
        system: input.system,
        user: input.messages
          .map((message) => (message as { content?: string }).content ?? '')
          .filter(Boolean)
          .join('\n\n'),
        schema: reviewSchema,
        timeoutMs: 60_000,
      });
      return { value: reviewSchema.parse(response.value) };
    },
  };
}

/**
 * Proveedor de audio.
 *
 * El webhook se configura en el envío: así AssemblyAI entrega la transcripción
 * sola y el job no tiene que ir a preguntar. El polling acotado queda como red de
 * seguridad, no como camino normal.
 */
function buildAudioProvider() {
  if (process.env.LOCAL_DEMO === '1') return undefined;
  const env = getAiEnv();
  if (!env.ASSEMBLYAI_API_KEY) return undefined;
  const webhookUrl = env.ASSEMBLYAI_WEBHOOK_URL ?? `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/api/webhooks/assemblyai`;
  return new AssemblyAIProvider({
    apiKey: env.ASSEMBLYAI_API_KEY,
    webhookUrl,
    webhookSecret: env.ASSEMBLYAI_WEBHOOK_SECRET,
  });
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
    providers: { audio: buildAudioProvider(), vision: aiProvider },
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
  if (prepared.aiCall) {
    await createAiCallLogRepository(context.database).record({ auditId: evidence.auditId, provider: 'openrouter', model: prepared.aiCall.model, purpose: 'vision', inputTokens: prepared.aiCall.inputTokens, outputTokens: prepared.aiCall.outputTokens });
  }
  if (prepared.kind === 'AUDIO' && prepared.status === 'WAITING_EXTERNAL' && prepared.audio?.assemblyId) {
    await repo.enqueue({
      auditId: evidence.auditId,
      jobType: 'AUDIO_TRANSCRIPTION',
      operationScope: `evidence:${evidence.id}`,
      idempotencyKey: `audio-transcription:${prepared.audio.assemblyId}`,
      inputFingerprint: sha256Hex(JSON.stringify({ evidenceId: evidence.id, assemblyId: prepared.audio.assemblyId })),
      payload: { evidenceId: evidence.id, assemblyId: prepared.audio.assemblyId },
      evidenceId: evidence.id,
      maxAttempts: 20,
    });
  }
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

function usageRecords(value: unknown): Array<{ provider?: string; model?: string; purpose?: string; inputTokens?: number | null; outputTokens?: number | null; estimatedCostUsd?: number | null; latencyMs?: number | null; errorCode?: string | null }> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object').map((item) => ({
    provider: typeof item.provider === 'string' ? item.provider : undefined,
    model: typeof item.model === 'string' ? item.model : undefined,
    purpose: typeof item.purpose === 'string' ? item.purpose : undefined,
    inputTokens: typeof item.inputTokens === 'number' ? item.inputTokens : null,
    outputTokens: typeof item.outputTokens === 'number' ? item.outputTokens : null,
    estimatedCostUsd: typeof item.estimatedCostUsd === 'number' ? item.estimatedCostUsd : null,
    latencyMs: typeof item.latencyMs === 'number' ? item.latencyMs : null,
    errorCode: typeof item.errorCode === 'string' ? item.errorCode : null,
  })) : [];
}

function referencedPolicySections(assessment: Assessment): string[] {
  return assessment.policyReferences.map((reference) => reference.section).filter((section): section is string => typeof section === 'string' && section.length > 0);
}

/**
 * Persiste el coste de las llamadas al modelo. Best-effort por diseño: perder una
 * línea de coste no puede tumbar un dictamen que ya se logró emitir.
 */
async function persistUsage(
  callLog: ReturnType<typeof createAiCallLogRepository>,
  auditId: string,
  runId: string,
  records: unknown,
): Promise<void> {
  for (const usage of usageRecords(records)) {
    if (!usage.provider || !usage.model || !usage.purpose) continue;
    await callLog.record({
      auditId,
      runId,
      provider: usage.provider,
      model: usage.model,
      purpose: usage.purpose,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCostUsd: usage.estimatedCostUsd,
      latencyMs: usage.latencyMs,
      errorCode: usage.errorCode,
    });
  }
}

async function validateReferences(context: HandlerContext, auditId: string, assessment: Assessment): Promise<void> {
  const evidences = await createEvidenceRepository(context.database).listByAudit(auditId);
  const ids = new Set(evidences.map((evidence) => evidence.id));
  const invalidEvidence = assessment.evidenceReferences.find((reference) => !ids.has(reference.evidenceId));
  if (invalidEvidence) throw new Error(`MODEL_INVALID_EVIDENCE_REFERENCE:${invalidEvidence.evidenceId}`);
  for (const section of referencedPolicySections(assessment)) {
    if (!readPolicySection(section)) throw new Error(`MODEL_INVALID_POLICY_REFERENCE:${section}`);
  }
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
  const evidenceRepo = createEvidenceRepository(context.database);
  const waitingEvidence = await evidenceRepo.countByAuditAndContentStatuses(auditId, ['PENDING', 'WAITING_EXTERNAL']);
  if (waitingEvidence > 0) {
    await jobRepo.scheduleRetry(job.jobId, context.workerId, 'WAITING_FOR_EVIDENCE', 'Hay evidencias pendientes o esperando proveedor externo.', 30);
    return;
  }
  await runRepo.advance(run.id, 'ANALYZING');

  const artifacts = await jobRepo.listArtifactsByAudit(auditId);
  const evidence = artifacts
    .filter((artifact) => artifact.artifactType === 'evidence-content')
    .map((artifact) => ({ id: artifact.evidenceId ?? artifact.id, text: typeof (artifact.result as { text?: unknown }).text === 'string' ? (artifact.result as { text: string }).text : JSON.stringify(artifact.result) }));
  const aiProvider = buildAiProvider();
  const analystModel = 'analystModel' in aiProvider ? aiProvider.analystModel : 'local-demo-analyst';
  const reviewerModel = 'reviewerModel' in aiProvider ? aiProvider.reviewerModel : 'local-demo-reviewer';
  const toolRepo = createToolExecutionRepository(context.database);
  const callLog = createAiCallLogRepository(context.database);

  const analysis = await runCaseAnalyst({
    provider: aiProvider,
    model: analystModel,
    context: {
      audit: { ...audit },
      evidence,
      policyRootDir: process.env.POLICY_ROOT_DIR,
      onToolExecution: async (event) => {
        const tool = await toolRepo.start({
          auditId,
          runId: run.id,
          name: event.name,
          kind: event.kind,
          input: event.arguments,
          idempotencyKey: `${run.id}:${event.name}:${sha256Hex(JSON.stringify(event.arguments))}`,
        });
        if (event.error) await toolRepo.fail(tool.id, 'TOOL_FAILED', sanitizeError(event.error));
        else await toolRepo.succeed(tool.id, event.output ?? '');
      },
    },
  });

  await persistUsage(callLog, auditId, run.id, analysis.usage);
  await runRepo.incrementCounters(run.id, { agentStepCount: analysis.agentStepCount, toolCallCount: analysis.toolCallCount });

  // Un fallo del analista es un fallo del run, no un dictamen: se propaga para que
  // `executeClaimedJob` cierre run, audit y job en el mismo sitio.
  if (analysis.status === 'FAILED') throw new Error(`${analysis.errorCode}: ${analysis.errorMessage}`);
  const assessment = analysis.assessment;

  await validateReferences(context, auditId, assessment);
  await runRepo.recordPolicySections(run.id, analysis.policySectionsConsulted);
  await runRepo.recordPolicySections(run.id, referencedPolicySections(assessment));

  await runRepo.advance(run.id, 'REVIEWING');
  const reviewed = await runAuditReviewer({
    provider: buildReviewerProvider(aiProvider),
    model: reviewerModel,
    assessment,
    context: { audit: { ...audit }, evidence, policyRootDir: process.env.POLICY_ROOT_DIR },
    reviseAssessment: async (review, previous) => {
      // UNA corrección del analista con el feedback del revisor, sin empezar de cero.
      const revised = await runCaseAnalyst({
        provider: aiProvider,
        model: analystModel,
        context: {
          audit: { ...audit },
          evidence,
          policyRootDir: process.env.POLICY_ROOT_DIR,
        },
      });
      if (revised.status === 'FAILED') throw new Error(`${revised.errorCode}: ${revised.errorMessage}`);
      return revised.status === 'NEEDS_INPUT' ? revised.assessment : previous;
    },
  });

  await persistUsage(callLog, auditId, run.id, reviewed.usage);
  if (reviewed.status === 'FAILED') throw new Error(`${reviewed.errorCode}: ${reviewed.errorMessage}`);

  await validateReferences(context, auditId, reviewed.finalAssessment);
  await runRepo.recordPolicySections(run.id, referencedPolicySections(reviewed.finalAssessment));
  await resultRepo.create({
    auditId,
    runId: run.id,
    stage: 'FINAL',
    status: resultStatus(reviewed.finalAssessment),
    classification: reviewed.finalAssessment.classification ?? null,
    summary: reviewed.finalAssessment.summary,
    assessment: reviewed.finalAssessment,
    review: reviewed.review,
  });
  const terminalStatus = reviewed.finalAssessment.status === 'NEEDS_INPUT' ? 'NEEDS_INPUT' : 'COMPLETED';
  await runRepo.advance(run.id, terminalStatus);
  await createAuditRepository(context.database).updateStatus(auditId, terminalStatus);
  await jobRepo.complete(job.jobId, context.workerId, 100);
};

const audioTranscription: JobHandler = async (context, job) => {
  const payload = payloadRecord(job.payload);
  const evidenceId = String(payload.evidenceId ?? job.evidenceId ?? '');
  const assemblyId = String(payload.assemblyId ?? '');
  if (!evidenceId || !assemblyId) throw new Error('AUDIO_TRANSCRIPTION_PAYLOAD_INVALID');
  const provider = buildAudioProvider();
  if (!provider) throw new Error('AUDIO_PROVIDER_MISSING');
  const status = await provider.status(assemblyId);
  const jobRepo = createJobRepository(context.database);
  const evidenceRepo = createEvidenceRepository(context.database);
  if (status.status === 'queued' || status.status === 'processing') {
    await jobRepo.scheduleRetry(job.jobId, context.workerId, 'ASSEMBLY_TRANSCRIPTION_PENDING', `AssemblyAI ${status.status}`, 30);
    return;
  }
  if (status.status === 'error') {
    await evidenceRepo.markFailed(evidenceId, status.error ?? 'AssemblyAI error');
    await jobRepo.failPermanent(job.jobId, context.workerId, 'ASSEMBLY_TRANSCRIPTION_FAILED', status.error ?? 'AssemblyAI error');
    return;
  }
  const transcript = await provider.fetchAudioTranscript(assemblyId);
  await jobRepo.recordArtifact(job.jobId, 'audio-transcript', { status: 'READY', assemblyId, ...transcript }, { evidenceId, contentSha256: sha256Hex(transcript.text), extractorVersion: 'assemblyai-v1', provider: 'assemblyai' });
  await evidenceRepo.markContentStatus(evidenceId, 'READY', null);
  await jobRepo.complete(job.jobId, context.workerId, 100);
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
    if (job.attemptCount + 1 >= job.maxAttempts) {
      if (job.jobType === 'AUDIT_RUN') {
        const payload = payloadRecord(job.payload);
        const auditId = String(job.auditId ?? payload.auditId ?? '');
        const runId = typeof payload.runId === 'string' ? payload.runId : null;
        if (runId) await createAuditRunRepository(context.database).fail(runId, 'JOB_FAILED', message).catch(() => undefined);
        if (auditId) await createAuditRepository(context.database).updateStatus(auditId, 'FAILED').catch(() => undefined);
      }
      await repo.failPermanent(job.jobId, context.workerId, 'JOB_FAILED', message);
    }
    else await repo.scheduleRetry(job.jobId, context.workerId, 'JOB_RETRY', message, 30);
  }
}
