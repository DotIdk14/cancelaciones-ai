import { createHash } from 'node:crypto';
import {
  createAuditLogRepository,
  createAuditRunRepository,
  createEvidenceRepository,
  createHumanDecisionExtractRepository,
  createJobRepository,
  type DatabaseClient,
} from '@cancelaciones/db';
import type { ClaimedJob } from '@cancelaciones/domain';
import { prepareEvidenceFile } from '@/server/evidence/upload';
import { extractPdfText } from '@/server/human-decision/pdf';
import {
  buildHumanDecisionPrompt,
  evidenceCorpusFromArtifacts,
  extractHumanDecisionDeterministic,
  HUMAN_DECISION_EXTRACTOR_VERSION,
  HUMAN_DECISION_PROMPT_VERSION,
  normalizeHumanStructured,
  verifyClaimsAgainstEvidence,
  type HumanDecisionStructured,
} from '@/server/human-decision/extract';
import { parseJsonFromCompletion, requestStructuredCompletion } from '@/server/ai/openrouter';
import { blobToText } from '@/server/jobs/blob-text';

export class HumanDecisionServiceError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'HumanDecisionServiceError';
  }
}

interface DownloadStorageClient {
  from(bucket: string): {
    download(key: string): Promise<{ data?: Blob | ArrayBuffer | null; error?: { message?: string } | null }>;
  };
}

interface UploadStorageClient extends DownloadStorageClient {
  from(bucket: string): {
    upload(key: string, body: Blob): Promise<{ error?: { message?: string } | null }>;
    download(key: string): Promise<{ data?: Blob | ArrayBuffer | null; error?: { message?: string } | null }>;
  };
}

/**
 * Sube el dictamen humano con rol HUMAN_DECISION_DOCUMENT. Crea el audit_run
 * HUMAN_DECISION en PENDING. NO encola extracción: el procesamiento queda
 * bloqueado hasta que exista una AI_BASELINE completada (aislamiento de baseline).
 */
export async function uploadHumanDecisionDocument(input: {
  auditId: string;
  actorId: string;
  file: File;
  database: DatabaseClient;
  storage: UploadStorageClient;
}): Promise<{ evidenceId: string; runId: string }> {
  const prepared = await prepareEvidenceFile(input.auditId, input.file);
  const evidences = createEvidenceRepository(input.database);
  await evidences.createPending({
    id: prepared.evidenceId,
    auditId: input.auditId,
    originalFilename: prepared.originalFilename,
    safeFilename: prepared.safeFilename,
    mimeType: prepared.declaredMimeType,
    detectedMimeType: prepared.detectedMimeType,
    sizeBytes: prepared.sizeBytes,
    sha256: prepared.sha256,
    storageBucket: prepared.storageBucket,
    storageKey: prepared.storageKey,
    uploadedBy: input.actorId,
    documentRole: 'HUMAN_DECISION_DOCUMENT',
  });

  const body = new ArrayBuffer(prepared.bytes.byteLength);
  new Uint8Array(body).set(prepared.bytes);
  const upload = await input.storage.from(prepared.storageBucket).upload(prepared.storageKey, new Blob([body], { type: prepared.detectedMimeType }));
  if (upload.error) throw new HumanDecisionServiceError(upload.error.message ?? 'Storage no pudo guardar el dictamen humano.', 'STORAGE_UPLOAD_FAILED');
  await evidences.markStored(prepared.evidenceId);

  const runs = createAuditRunRepository(input.database);
  const run = await runs.create({
    auditId: input.auditId,
    runType: 'HUMAN_DECISION',
    status: 'PENDING',
    result: { evidenceId: prepared.evidenceId, sha256: prepared.sha256, filename: prepared.originalFilename },
    createdBy: input.actorId,
  });

  await createAuditLogRepository(input.database).record({
    auditId: input.auditId,
    eventType: 'HUMAN_DECISION_DOCUMENT_UPLOADED',
    actorId: input.actorId,
    metadata: { evidenceId: prepared.evidenceId, runId: run.id, sha256: prepared.sha256 },
  });

  return { evidenceId: prepared.evidenceId, runId: run.id };
}

/** Verifica que exista una baseline AI_BASELINE completada (requisito para extracción). */
async function requireBaseline(database: DatabaseClient, auditId: string): Promise<string> {
  const runs = createAuditRunRepository(database);
  const baseline = await runs.findLatestByType(auditId, 'AI_BASELINE');
  if (!baseline || baseline.status !== 'COMPLETED') {
    throw new HumanDecisionServiceError('La extracción del dictamen humano requiere una línea base de la IA completada primero.', 'BASELINE_REQUIRED');
  }
  return baseline.id;
}

/**
 * Encola el job HUMAN_DECISION_EXTRACTION. Negado mientras no exista baseline.
 * Crea un audit_run HUMAN_DECISION nuevo si el de subida no está disponible.
 */
export async function enqueueHumanDecisionExtraction(input: {
  auditId: string;
  actorId: string;
  database: DatabaseClient;
  evidenceId?: string;
  runId?: string;
}): Promise<{ runId: string; jobId: string }> {
  await requireBaseline(input.database, input.auditId);

  const runs = createAuditRunRepository(input.database);
  const evidences = createEvidenceRepository(input.database);
  const evidence = input.evidenceId ? await evidences.findStoredById(input.evidenceId) : null;
  if (!evidence || evidence.documentRole !== 'HUMAN_DECISION_DOCUMENT') {
    throw new HumanDecisionServiceError('Evidencia de dictamen humano no encontrada.', 'HUMAN_DECISION_EVIDENCE_NOT_FOUND');
  }

  let run = input.runId ? await runs.findById(input.runId) : null;
  if (!run || run.auditId !== input.auditId || run.runType !== 'HUMAN_DECISION') {
    run = await runs.create({
      auditId: input.auditId,
      runType: 'HUMAN_DECISION',
      status: 'PROCESSING',
      result: { evidenceId: evidence.id, sha256: evidence.sha256, filename: evidence.originalFilename },
      createdBy: input.actorId,
    });
  } else {
    await runs.mark(run.id, 'PROCESSING');
  }

  const payload = {
    auditId: input.auditId,
    runId: run.id,
    evidenceId: evidence.id,
    sha256: evidence.sha256,
    version: HUMAN_DECISION_EXTRACTOR_VERSION,
  };
  const job = await createJobRepository(input.database).enqueue({
    auditId: input.auditId,
    jobType: 'HUMAN_DECISION_EXTRACTION',
    operationScope: `audit:${input.auditId}:human-decision:${run.id}`,
    idempotencyKey: `human-decision:${evidence.id}:${HUMAN_DECISION_EXTRACTOR_VERSION}`,
    inputFingerprint: `human-decision-${HUMAN_DECISION_EXTRACTOR_VERSION}-${evidence.sha256}`,
    payload,
    evidenceId: evidence.id,
    actorId: input.actorId,
  });
  await runs.mark(run.id, 'PROCESSING', { ...run.result, jobId: job.id });

  await createAuditLogRepository(input.database).record({
    auditId: input.auditId,
    eventType: 'HUMAN_DECISION_EXTRACTION_ENQUEUED',
    actorId: input.actorId,
    metadata: { runId: run.id, evidenceId: evidence.id, jobId: job.id },
  });

  return { runId: run.id, jobId: job.id };
}

async function analyzeDocument(input: { bytes: Uint8Array; mimeType: string; filename: string }): Promise<{ structured: HumanDecisionStructured; provider: string | null; model: string | null; rawText: string }> {
  const isImage = input.mimeType.startsWith('image/');
  const isPdf = input.mimeType === 'application/pdf';

  let rawText = '';
  if (isPdf) {
    try {
      const extracted = await extractPdfText(input.bytes);
      rawText = extracted.text;
    } catch {
      rawText = '';
    }
  } else if (!isImage) {
    rawText = await blobToText(input.bytes);
  }

  if (rawText.trim().length === 0 && !isImage) {
    const fallback = extractHumanDecisionDeterministic(rawText);
    return { structured: fallback, provider: null, model: null, rawText };
  }

  try {
    const prompt = buildHumanDecisionPrompt({ filename: input.filename, mode: isImage ? 'VISION' : 'TEXT' });
    const parts = isImage
      ? [{ type: 'text' as const, text: prompt.user }, { type: 'image_url' as const, image_url: { url: `data:${input.mimeType};base64,${Buffer.from(input.bytes).toString('base64')}` } }]
      : undefined;
    const completion = await requestStructuredCompletion({ system: prompt.system, user: prompt.user, parts, json: true });
    const structured = normalizeHumanStructured(parseJsonFromCompletion(completion.content));
    return { structured, provider: completion.provider, model: completion.model, rawText };
  } catch {
    // Sin cadena de pensamiento: si el LLM falla se usa el fallback determinista.
    const fallback = extractHumanDecisionDeterministic(rawText);
    return { structured: fallback, provider: null, model: null, rawText };
  }
}

/**
 * Cuerpo del job HUMAN_DECISION_EXTRACTION: descarga, analiza, verifica las
 * afirmaciones contra el corpus EVIDENCE y persiste la extracción.
 */
export async function runHumanDecisionExtraction(context: { database: DatabaseClient; storage?: DownloadStorageClient }, job: ClaimedJob): Promise<void> {
  const auditId = String(job.payload.auditId ?? '');
  const runId = String(job.payload.runId ?? '');
  const evidenceId = String(job.payload.evidenceId ?? '');
  const version = String(job.payload.version ?? HUMAN_DECISION_EXTRACTOR_VERSION);

  const evidences = createEvidenceRepository(context.database);
  const evidence = await evidences.findStoredById(evidenceId);
  if (!evidence || evidence.documentRole !== 'HUMAN_DECISION_DOCUMENT') {
    throw new HumanDecisionServiceError('Evidencia de dictamen humano no encontrada.', 'HUMAN_DECISION_EVIDENCE_NOT_FOUND');
  }
  if (!context.storage) throw new HumanDecisionServiceError('Storage no disponible.', 'STORAGE_UNAVAILABLE');
  const download = await context.storage.from(evidence.storageBucket).download(evidence.storageKey ?? '');
  if (download.error || !download.data) throw new HumanDecisionServiceError(download.error?.message ?? 'No fue posible descargar el dictamen.', 'STORAGE_DOWNLOAD_FAILED');
  const bytes = download.data instanceof ArrayBuffer ? new Uint8Array(download.data) : new Uint8Array(await download.data.arrayBuffer());

  const { structured, provider, model, rawText } = await analyzeDocument({ bytes, mimeType: evidence.detectedMimeType, filename: evidence.originalFilename });

  // Verificación: contra evidencias con rol EVIDENCE únicamente (aislamiento de baseline).
  const artifacts = await createJobRepository(context.database).listBaselineArtifactsByAudit(auditId);
  const corpus = evidenceCorpusFromArtifacts(artifacts);
  const verifiedClaims = verifyClaimsAgainstEvidence(structured.facts, corpus);

  const rawTextHash = createHash('sha256').update(rawText).digest('hex');
  const extractRepo = createHumanDecisionExtractRepository(context.database);
  const extractRow = await extractRepo.create({
    auditId,
    runId,
    evidenceId,
    extractorVersion: version,
    resolution: structured.resolution,
    decisionDate: structured.decisionDate,
    motives: structured.motives,
    conditionsConsidered: structured.conditionsConsidered,
    datesConsidered: structured.datesConsidered,
    facts: verifiedClaims,
    evidenceMentioned: structured.evidenceMentioned,
    rulesMentioned: structured.rulesMentioned,
    observations: structured.observations,
    areasInvolved: structured.areasInvolved,
    externalInformation: structured.externalInformation,
    provider,
    model,
    promptVersion: HUMAN_DECISION_PROMPT_VERSION,
    rawTextHash,
    createdBy: evidence.uploadedBy,
  });

  const runs = createAuditRunRepository(context.database);
  await runs.mark(runId, 'COMPLETED', {
    extractionId: extractRow.id,
    evidenceId,
    resolution: structured.resolution,
    provider,
    model,
    rawTextHash,
  }, true);

  await createAuditLogRepository(context.database).record({
    auditId,
    eventType: 'HUMAN_DECISION_EXTRACTED',
    actorId: evidence.uploadedBy,
    metadata: { runId, extractionId: extractRow.id, resolution: structured.resolution, provider },
  });
}
