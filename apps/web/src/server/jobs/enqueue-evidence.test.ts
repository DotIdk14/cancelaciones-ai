import { describe, expect, it } from 'vitest';
import { enqueueEvidenceProcessingJobs } from './enqueue-evidence';

type EvidenceRow = {
  id: string;
  audit_id: string;
  original_filename: string;
  safe_filename: string;
  nombre_archivo: string;
  mime_type: string;
  detected_mime_type: string;
  size_bytes: number;
  sha256: string;
  storage_bucket: string;
  storage_key: string;
  status: string;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
};

function buildDatabase(rows: EvidenceRow[]) {
  const enqueued: Record<string, unknown>[] = [];
  const selectBuilder = {
    eq: () => selectBuilder,
    order: () => selectBuilder,
    limit: async () => ({ data: rows, error: null }),
  };
  const database = {
    from: () => ({ select: () => selectBuilder }),
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      enqueued.push(args);
      const row = {
        id: `job_${enqueued.length}`,
        audit_id: args.p_audit_id,
        job_type: args.p_job_type,
        operation_scope: args.p_operation_scope,
        idempotency_key: args.p_idempotency_key,
        input_fingerprint: args.p_input_fingerprint,
        status: 'QUEUED',
        progress: 0,
        attempt_count: 0,
        max_attempts: args.p_max_attempts,
        last_error_code: null,
        last_error_message_sanitized: null,
        created_at: '2026-09-24T00:00:00.000Z',
      };
      return { data: [row], error: null };
    },
  } as never;
  return { database, enqueued };
}

function evidenceRow(overrides: Partial<EvidenceRow>): EvidenceRow {
  return {
    id: 'ev_1',
    audit_id: 'audit_1',
    original_filename: 'archivo.pdf',
    safe_filename: 'archivo.pdf',
    nombre_archivo: 'archivo.pdf',
    mime_type: 'application/pdf',
    detected_mime_type: 'application/pdf',
    size_bytes: 100,
    sha256: 'abc123',
    storage_bucket: 'dictamen-evidencias',
    storage_key: 'audits/audit_1/originals/ev_1/archivo.pdf',
    status: 'STORED',
    uploaded_by: 'user_1',
    created_at: '2026-09-24T00:00:00.000Z',
    updated_at: '2026-09-24T00:00:00.000Z',
    ...overrides,
  };
}

describe('enqueueEvidenceProcessingJobs', () => {
  it('encola un job EVIDENCE_PROCESSING por evidencia STORED con version determinista', async () => {
    const { database, enqueued } = buildDatabase([evidenceRow({}), evidenceRow({ id: 'ev_pending', status: 'PENDING' })]);

    const jobs = await enqueueEvidenceProcessingJobs({ database, auditId: 'audit_1', actorId: 'user_1' });

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual({ evidenceId: 'ev_1', jobId: 'job_1' });
    expect(enqueued[0]).toMatchObject({
      p_audit_id: 'audit_1',
      p_job_type: 'EVIDENCE_PROCESSING',
      p_operation_scope: 'evidence:ev_1:process',
      p_idempotency_key: 'evidence:ev_1:process:deterministic-text-v1',
      p_actor_id: 'user_1',
    });
  });

  it('usa vision-extraction-v3 para imagenes y versiones de rerun cuando rerun=true', async () => {
    const rows = [
      evidenceRow({ id: 'ev_img', detected_mime_type: 'image/png' }),
      evidenceRow({ id: 'ev_txt', detected_mime_type: 'text/plain' }),
    ];
    const first = buildDatabase(rows);
    const jobsFirst = await enqueueEvidenceProcessingJobs({ database: first.database, auditId: 'audit_1', actorId: 'user_1' });
    expect(jobsFirst).toHaveLength(2);
    expect(first.enqueued.map((job) => job.p_idempotency_key)).toEqual([
      'evidence:ev_img:process:vision-extraction-v3',
      'evidence:ev_txt:process:deterministic-text-v1',
    ]);

    const rerun = buildDatabase(rows);
    const jobsRerun = await enqueueEvidenceProcessingJobs({ database: rerun.database, auditId: 'audit_1', actorId: 'user_1', rerun: true });
    expect(jobsRerun).toHaveLength(2);
    expect(rerun.enqueued.map((job) => job.p_idempotency_key)).toEqual([
      'evidence:ev_img:process:vision-extraction-v4',
      'evidence:ev_txt:process:deterministic-text-v2',
    ]);
  });

  it('devuelve lista vacia cuando no hay evidencia STORED', async () => {
    const { database } = buildDatabase([evidenceRow({ status: 'PENDING' })]);
    const jobs = await enqueueEvidenceProcessingJobs({ database, auditId: 'audit_1', actorId: 'user_1' });
    expect(jobs).toEqual([]);
  });
});