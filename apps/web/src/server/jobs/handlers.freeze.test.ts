import { describe, expect, it, vi } from 'vitest';
import type { ClaimedJob } from '@cancelaciones/domain';
import { FoundationFakeDb } from '../facts/foundation-fake-db';
import { executeClaimedJob } from './handlers';

/**
 * Step 7 / C1: el handler de FACT_EXTRACTION congela el Fact Run.
 *
 * RED por dos razones distintas, y las dos importan:
 *  1. Con la migración aplicada, `freeze_fact_run_v1` es la única vía legal:
 *     sella el snapshot y pasa el run a FROZEN en una transacción.
 *  2. Sin la migración (el estado real de hoy, y el del fake `DurableDb` del
 *     E2E de pipeline), el handler tiene que seguir funcionando por la máquina
 *     de estados legal. El paso único PROCESSING -> FROZEN que hacía antes es
 *     correcto hoy y también legal después; DRAFT -> FROZEN en un solo UPDATE
 *     es lo que `guard_fact_run_transition` prohíbe, y por eso el camino de
 *     `freezeRun` en packages/db quedó corregido aparte.
 */

const AUDIT_ID = 'audit-1';
const RUN_ID = 'run-1';
const ACTOR_ID = 'actor-1';
const CREATED_AT = '2026-09-25T00:00:00.000Z';

class JobFakeDb extends FoundationFakeDb {
  override async rpc(fn: string, args: Record<string, unknown> = {}): Promise<{ data: unknown; error: { message: string } | null }> {
    if (fn === 'enqueue_job') {
      const existing = this.table('jobs').find((row) => row.idempotency_key === args.p_idempotency_key);
      if (existing) return { data: existing, error: null };
      return { data: this.insert('jobs', {
        audit_id: args.p_audit_id, job_type: args.p_job_type, operation_scope: args.p_operation_scope,
        idempotency_key: args.p_idempotency_key, input_fingerprint: args.p_input_fingerprint, payload: args.p_payload,
        status: 'QUEUED', progress: 0, attempt_count: 0, max_attempts: args.p_max_attempts,
      }), error: null };
    }
    if (fn === 'complete_job') {
      this.insert('job_artifacts', { job_id: args.p_job_id, artifact_type: 'complete', result: { progress: args.p_progress } });
      return { data: null, error: null };
    }
    if (fn === 'schedule_job_retry') {
      this.insert('job_retries', { job_id: args.p_job_id, error_code: args.p_error_code, message: args.p_error_message_sanitized });
      return { data: null, error: null };
    }
    return super.rpc(fn, args);
  }
}

function seed(db: JobFakeDb, state: 'DRAFT' | 'PROCESSING') {
  db.table('audits').push({ id: AUDIT_ID, display_name: 'Caso', status: 'PROCESSING', external_case_id: 'E2E-1', created_by: ACTOR_ID, created_at: CREATED_AT, updated_at: CREATED_AT });
  db.table('fact_extraction_runs').push({
    id: RUN_ID, audit_id: AUDIT_ID, policy_code: 'GDM_GAM_PRD_MLG_003', policy_version: '5',
    extractor_version: 'deterministic-facts-v1', artifact_set_fingerprint: 'artifact-fp', state,
    frozen_at: null, created_at: CREATED_AT,
  });
  db.table('job_artifacts').push({ id: 'artifact-1', job_id: 'job-1', artifact_type: 'document-text', evidence_id: 'ev-1', result: { text: 'NIVEL: LICENCIATURA\nNO CONTACTO EFECTIVO\nSIN LOGIN\nSIN MODALIDAD' }, content_sha256: 'sha-1', created_at: CREATED_AT });
  db.table('evidences').push({ id: 'ev-1', audit_id: AUDIT_ID, document_role: 'EVIDENCE', status: 'STORED', original_filename: 'a.txt', safe_filename: 'a.txt', nombre_archivo: 'a.txt', detected_mime_type: 'text/plain', storage_bucket: 'b', storage_key: 'k', uploaded_by: ACTOR_ID, created_at: CREATED_AT, updated_at: CREATED_AT });
}

const job: ClaimedJob = {
  jobId: 'job-1', attemptId: 'attempt-1', auditId: AUDIT_ID, jobType: 'FACT_EXTRACTION',
  payload: { auditId: AUDIT_ID, factRunId: RUN_ID, version: 'deterministic-facts-v1', actorId: ACTOR_ID }, attemptNumber: 1,
};

describe('handler FACT_EXTRACTION — congelado con snapshot (Step 7 / C1)', () => {
  it('con la migración aplicada sella por freeze_fact_run_v1 y NO hace UPDATE de estado', async () => {
    const db = new JobFakeDb().withFoundationApplied();
    seed(db, 'PROCESSING');
    db.onRpc('freeze_fact_run_v1', () => ({
      data: [{ out_snapshot_id: 'snapshot-1', out_fact_run_id: RUN_ID, out_audit_id: AUDIT_ID, out_canonical_facts_fingerprint: 'c'.repeat(64), out_effective_facts_fingerprint: 'e'.repeat(64), out_fact_count: 4, out_frozen_at: CREATED_AT }],
      error: null,
    }));

    await executeClaimedJob({ database: db, workerId: 'w-1' }, job);

    expect(db.rpcCalls.map((call) => call.fn)).toContain('freeze_fact_run_v1');
    expect(db.writesOn('fact_extraction_runs')).toEqual([]);
    // Encoló la evaluación y NO dejó el job en retry.
    expect(db.table('jobs').map((row) => row.job_type)).toContain('AUDIT_EVALUATION');
    expect(db.table('job_retries')).toEqual([]);
  });

  it('sin la migración el job COMPLETA y el run queda FROZEN (compatibilidad con el fake local)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = new JobFakeDb();
    seed(db, 'PROCESSING');

    await executeClaimedJob({ database: db, workerId: 'w-1' }, job);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('FREEZE_FACT_RUN_RPC_ABSENT'));
    expect(db.table('job_retries')).toEqual([]);
    expect(db.table('fact_extraction_runs')[0].state).toBe('FROZEN');
    expect(db.table('jobs').map((row) => row.job_type)).toContain('AUDIT_EVALUATION');
    warn.mockRestore();
  });

  it('sin la migración y con el run en DRAFT camina DRAFT -> PROCESSING -> FROZEN', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = new JobFakeDb();
    seed(db, 'DRAFT');

    await executeClaimedJob({ database: db, workerId: 'w-1' }, job);

    expect(db.writesOn('fact_extraction_runs').map((write) => (write.values[0] as { state?: string }).state).filter(Boolean)).toEqual(['PROCESSING', 'FROZEN']);
    vi.restoreAllMocks();
  });

  it('un error REAL del RPC deja el job en retry y NO congela el run', async () => {
    const db = new JobFakeDb().withFoundationApplied();
    seed(db, 'PROCESSING');
    db.onRpc('freeze_fact_run_v1', () => ({ data: null, error: { message: 'POLICY_SOURCE_NOT_REGISTERED: gdm-x' } }));

    await executeClaimedJob({ database: db, workerId: 'w-1' }, job);

    expect(db.table('job_retries').map((row) => row.message)).toEqual(['POLICY_SOURCE_NOT_REGISTERED: gdm-x']);
    expect(db.table('fact_extraction_runs')[0].state).toBe('PROCESSING');
  });
});
