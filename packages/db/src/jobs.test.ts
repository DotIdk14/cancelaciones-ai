import { beforeEach, describe, expect, it } from 'vitest';
import { createJobRepository } from './jobs';
import { createFakeDatabase, type FakeDatabase, type FakeRow } from './testing/fake-db';

let db: FakeDatabase;
let jobs: ReturnType<typeof createJobRepository>;

const jobRow: FakeRow = {
  id: 'job_1', audit_id: 'audit_1', job_type: 'EVIDENCE_PROCESSING', operation_scope: 'evidence:ev_1', idempotency_key: 'key_1',
  input_fingerprint: 'fp_1', payload: { a: 1 }, evidence_id: 'ev_1', status: 'QUEUED', progress: 0, attempt_count: 0, max_attempts: 2,
  last_error_code: null, last_error_message_sanitized: null, available_at: '2026-01-01T00:00:00.000Z', created_at: '2026-01-01T00:00:00.000Z',
  started_at: null, finished_at: null, timeout_at: null,
};

beforeEach(() => {
  db = createFakeDatabase();
  jobs = createJobRepository(db);
});

describe('createJobRepository', () => {
  it('enqueue usa maxAttempts por defecto 2 y mapea el job', async () => {
    db.registerRpc('enqueue_job', (args) => ({ ...jobRow, max_attempts: args.p_max_attempts }));

    const enqueued = await jobs.enqueue({ auditId: 'audit_1', jobType: 'EVIDENCE_PROCESSING', operationScope: 'evidence:ev_1', idempotencyKey: 'key_1', inputFingerprint: 'fp_1' });

    expect(enqueued.maxAttempts).toBe(2);
  });

  it('claimNext acepta respuesta objeto o array', async () => {
    db.registerRpc('claim_next_job', () => [{ job_id: 'job_1', attempt_number: 1, audit_id: 'audit_1', job_type: 'EVIDENCE_PROCESSING', payload: {}, evidence_id: 'ev_1', attempt_count: 1, max_attempts: 2, timeout_at: 't' }]);

    await expect(jobs.claimNext('worker_1')).resolves.toMatchObject({ jobId: 'job_1', attemptNumber: 1 });
  });

  it('complete, scheduleRetry, failPermanent y recordArtifact llaman RPCs', async () => {
    const called: string[] = [];
    for (const name of ['complete_job', 'schedule_job_retry', 'fail_job_permanent', 'record_job_artifact']) {
      db.registerRpc(name, () => { called.push(name); return name === 'record_job_artifact' ? 'artifact_1' : null; });
    }

    await jobs.complete('job_1', 'worker_1');
    await jobs.scheduleRetry('job_1', 'worker_1', 'ERR', 'fallo', 5);
    await jobs.failPermanent('job_1', 'worker_1', 'ERR', 'fallo');
    await expect(jobs.recordArtifact('job_1', 'TEXT', { ok: true }, { evidenceId: 'ev_1' })).resolves.toBe('artifact_1');

    expect(called).toEqual(['complete_job', 'schedule_job_retry', 'fail_job_permanent', 'record_job_artifact']);
  });

  it('listByAudit lee tabla jobs', async () => {
    db.seed('jobs', [jobRow]);

    await expect(jobs.listByAudit('audit_1')).resolves.toHaveLength(1);
  });
});
