import { createJobRepository, type DatabaseClient } from '@cancelaciones/db';
import type { ClaimedJob } from '@cancelaciones/domain';

interface HandlerContext {
  database: DatabaseClient;
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

const handlers: Record<string, JobHandler> = {
  METADATA_PROBE: metadataProbe,
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
