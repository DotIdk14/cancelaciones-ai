import { createJobRepository, type DatabaseClient } from '@cancelaciones/db';
import { executeClaimedJob } from './handlers';

interface WorkerStorage {
  from(bucket: string): { download(key: string): Promise<{ data?: Blob | ArrayBuffer | null; error?: { message?: string } | null }> };
}

export interface JobWorkerOptions {
  database: DatabaseClient;
  storage: WorkerStorage;
  workerId: string;
  leaseSeconds?: number;
  idleDelayMs?: number;
  signal?: AbortSignal;
}

export async function runJobWorker(options: JobWorkerOptions): Promise<void> {
  const leaseSeconds = options.leaseSeconds ?? 60;
  const idleDelayMs = options.idleDelayMs ?? 1000;
  const repo = createJobRepository(options.database);

  while (!options.signal?.aborted) {
    const claimed = await repo.claimNext(options.workerId, leaseSeconds);
    if (!claimed) {
      await delay(idleDelayMs, options.signal);
      continue;
    }
    await executeClaimedJob({ database: options.database, storage: options.storage, workerId: options.workerId }, claimed);
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}
