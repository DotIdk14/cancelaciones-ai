import { createHash } from 'node:crypto';
import { createEvidenceRepository, createFactRepository, createJobRepository, type DatabaseClient } from '@cancelaciones/db';
import type { ClaimedJob } from '@cancelaciones/domain';
import { extractFactsFromArtifacts, textArtifactResult } from '@/server/facts/extract';

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

async function blobToText(data: Blob | ArrayBuffer): Promise<string> {
  const buffer = data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(await data.arrayBuffer());
  return buffer.toString('utf8').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ');
}

const evidenceProcessing: JobHandler = async (context, job) => {
  const evidenceId = String(job.payload.evidenceId ?? '');
  const evidence = await createEvidenceRepository(context.database).findStoredById(evidenceId);
  if (!evidence?.storageKey) throw new Error('EVIDENCE_NOT_FOUND');
  if (!context.storage) throw new Error('STORAGE_UNAVAILABLE');
  const download = await context.storage.from(evidence.storageBucket).download(evidence.storageKey);
  if (download.error || !download.data) throw new Error(download.error?.message ?? 'STORAGE_DOWNLOAD_FAILED');
  const text = await blobToText(download.data);
  const contentSha256 = createHash('sha256').update(text).digest('hex');
  const repo = createJobRepository(context.database);
  await repo.recordArtifact(job.jobId, evidence.detectedMimeType.startsWith('audio/') ? 'audio-transcript' : 'document-text', textArtifactResult(text, {
    evidenceId,
    mimeType: evidence.detectedMimeType,
    extraction: 'deterministic-text-v1',
  }), { evidenceId, contentSha256, extractorVersion: 'deterministic-text-v1', provider: 'LOCAL' });
  await repo.complete(job.jobId, context.workerId, 100);
};

const factExtraction: JobHandler = async (context, job) => {
  const runId = String(job.payload.factRunId ?? '');
  const factsRepo = createFactRepository(context.database);
  const run = await factsRepo.findRunById(runId);
  if (!run) throw new Error('FACT_RUN_NOT_FOUND');
  const artifacts = await createJobRepository(context.database).listArtifactsByAudit(run.auditId);
  const facts = extractFactsFromArtifacts({ auditId: run.auditId, runId: run.id, artifacts });
  await factsRepo.insertFacts(facts);
  await context.database.from('fact_extraction_runs').update({ state: 'DRAFT' }).eq('id', run.id).eq('state', 'PROCESSING');
  await createJobRepository(context.database).complete(job.jobId, context.workerId, 100);
};

const handlers: Record<string, JobHandler> = {
  METADATA_PROBE: metadataProbe,
  EVIDENCE_PROCESSING: evidenceProcessing,
  FACT_EXTRACTION: factExtraction,
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
