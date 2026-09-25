import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createAuditRepository, createEvidenceRepository, createFactRepository, createJobRepository } from '@cancelaciones/db';
import { uploadEvidenceFilesForAudit } from '@/server/evidence/upload';
import { enqueueEvidenceProcessingJobs } from './enqueue-evidence';
import { executeClaimedJob } from './handlers';

type Row = Record<string, unknown>;

class Query {
  private filters: Array<[string, unknown]> = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitCount: number | null = null;
  private selected = '*';
  private mutation: { type: 'insert'; values: Row[] } | { type: 'update'; values: Partial<Row> } | null = null;

  constructor(private readonly db: DurableDb, private readonly table: string) {}

  select(columns = '*') { this.selected = columns; return this; }
  eq(column: string, value: unknown) { this.filters.push([column, value]); return this; }
  order(column: string, options?: { ascending?: boolean }) { this.orderBy = { column, ascending: options?.ascending ?? true }; return this; }
  limit(count: number) { this.limitCount = count; return this.then((value) => value); }
  single() { return this.then((result) => ({ data: result.data?.[0] ?? null, error: result.error })); }
  insert(values: Row[]) { this.mutation = { type: 'insert', values }; return this; }
  update(values: Partial<Row>) { this.mutation = { type: 'update', values }; return this; }
  in(column: string, values: unknown[]) { this.filters.push([column, new Set(values)]); return this; }

  then<TResult1 = unknown, TResult2 = never>(resolve: (value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>, reject?: (reason: unknown) => TResult2 | PromiseLike<TResult2>) {
    return this.execute().then(resolve, reject);
  }

  private async execute() {
    if (this.mutation?.type === 'insert') {
      const rows = this.mutation.values.map((value) => this.db.insert(this.table, value));
      await this.db.flush();
      return { data: this.project(rows), error: null };
    }
    if (this.mutation?.type === 'update') {
      const rows = this.rows();
      for (const row of rows) Object.assign(row, this.mutation.values, { updated_at: now() });
      await this.db.flush();
      return { data: this.project(rows), error: null };
    }
    return { data: this.project(this.rows()), error: null };
  }

  private rows() {
    let rows = [...this.db.table(this.table)];
    for (const [column, value] of this.filters) {
      rows = rows.filter((row) => value instanceof Set ? value.has(row[column]) : row[column] === value);
    }
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      rows.sort((a, b) => ascending ? String(a[column]).localeCompare(String(b[column])) : String(b[column]).localeCompare(String(a[column])));
    }
    if (this.limitCount !== null) rows = rows.slice(0, this.limitCount);
    return rows;
  }

  private project(rows: Row[]) {
    if (this.selected === '*') return rows.map((row) => ({ ...row }));
    const columns = this.selected.split(',').map((column) => column.trim());
    return rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column]])));
  }
}

class DurableDb {
  data: Record<string, Row[]> = { audits: [], evidences: [], audit_log: [], jobs: [], job_attempts: [], job_artifacts: [], fact_extraction_runs: [], facts: [], fact_reviews: [], engine_runs: [], engine_rule_results: [], audit_runs: [], human_reviews: [], audit_manual_comments: [], audit_evidence_selection: [], report_snapshots: [], dictamen_documents: [] };

  constructor(private readonly file: string) {}
  from(table: string) { return new Query(this, table); }
  table(table: string) { return this.data[table] ?? (this.data[table] = []); }
  insert(table: string, value: Row) {
    const row = { id: value.id ?? randomUUID(), created_at: now(), updated_at: now(), ...value };
    this.table(table).push(row);
    return row;
  }
  async flush() { await writeFile(this.file, JSON.stringify(this.data, null, 2), 'utf8'); }
  async reload() { this.data = JSON.parse(await readFile(this.file, 'utf8')) as Record<string, Row[]>; }

  async rpc(fn: string, args: Record<string, unknown>) {
    if (fn === 'enqueue_job') {
      const existing = this.table('jobs').find((job) => job.idempotency_key === args.p_idempotency_key);
      if (existing) return { data: existing, error: null };
      const job = this.insert('jobs', {
        audit_id: args.p_audit_id,
        job_type: args.p_job_type,
        operation_scope: args.p_operation_scope,
        idempotency_key: args.p_idempotency_key,
        input_fingerprint: args.p_input_fingerprint,
        payload: args.p_payload,
        evidence_id: args.p_evidence_id,
        status: 'QUEUED',
        progress: 0,
        attempt_count: 0,
        max_attempts: args.p_max_attempts,
        last_error_code: null,
        last_error_message_sanitized: null,
        available_at: now(),
      });
      await this.flush();
      return { data: job, error: null };
    }
    if (fn === 'claim_next_job') {
      const job = this.table('jobs').find((row) => row.status === 'QUEUED');
      if (!job) return { data: null, error: null };
      if (!isRow(job) || !isFiniteNumber(job.attempt_count) || !isFiniteNumber(job.max_attempts)) {
        throw new Error('INVALID_DURABLE_JOB_ROW');
      }
      job.status = 'PROCESSING';
      job.attempt_count += 1;
      job.worker_id = args.p_worker_id;
      job.lease_expires_at = new Date(Date.now() + Number(args.p_lease_seconds) * 1000).toISOString();
      const attempt = this.insert('job_attempts', { job_id: job.id, worker_id: args.p_worker_id, attempt_number: job.attempt_count, status: 'PROCESSING', started_at: now() });
      await this.flush();
      return { data: { job_id: job.id, attempt_id: attempt.id, audit_id: job.audit_id, job_type: job.job_type, payload: job.payload, attempt_number: job.attempt_count }, error: null };
    }
    if (fn === 'record_job_artifact') {
      this.insert('job_artifacts', { job_id: args.p_job_id, evidence_id: args.p_evidence_id, artifact_type: args.p_artifact_type, result: args.p_result, content_sha256: args.p_content_sha256 });
      await this.flush();
      return { data: null, error: null };
    }
    if (fn === 'complete_job') {
      const job = this.table('jobs').find((row) => row.id === args.p_job_id && row.worker_id === args.p_worker_id);
      if (!job) return { data: null, error: { message: 'JOB_NOT_CLAIMED_BY_WORKER' } };
      Object.assign(job, { status: 'COMPLETED', progress: args.p_progress, completed_at: now() });
      await this.flush();
      return { data: null, error: null };
    }
    if (fn === 'schedule_job_retry') {
      const job = this.table('jobs').find((row) => row.id === args.p_job_id);
      if (!isRow(job) || !isFiniteNumber(job.attempt_count) || !isFiniteNumber(job.max_attempts)) {
        throw new Error('INVALID_DURABLE_JOB_ROW');
      }
      Object.assign(job, { status: job.attempt_count >= job.max_attempts ? 'FAILED' : 'QUEUED', last_error_code: args.p_error_code, last_error_message_sanitized: args.p_error_message_sanitized });
      await this.flush();
      return { data: null, error: null };
    }
    if (fn === 'fail_job_permanent') {
      // Ruta TERMINAL del handler. Antes todo acababa en schedule_job_retry, así
      // que el fake no la modelaba y reventaba con "Unsupported rpc".
      const job = this.table('jobs').find((row) => row.id === args.p_job_id);
      if (!isRow(job)) throw new Error('JOB_NOT_FOUND');
      Object.assign(job, { status: 'FAILED', last_error_code: args.p_error_code, last_error_message_sanitized: args.p_error_message_sanitized, failed_at: now() });
      await this.flush();
      return { data: null, error: null };
    }
    if (fn === 'begin_fact_run_processing_v1') {
      // Transición autoritativa DRAFT -> PROCESSING, con la misma semántica que
      // la función real: FROZEN responde en vez de fallar, PROCESSING es
      // idempotente.
      const run = this.table('fact_extraction_runs').find((row) => row.id === args.p_fact_run_id);
      if (!isRow(run)) return { data: null, error: { message: 'FACT_RUN_NOT_FOUND' } };
      const state = String(run.state);
      if (state === 'FROZEN') return { data: [{ out_fact_run_id: run.id, out_state: 'FROZEN', out_transition: 'ALREADY_FROZEN' }], error: null };
      if (state === 'PROCESSING') return { data: [{ out_fact_run_id: run.id, out_state: 'PROCESSING', out_transition: 'ALREADY_PROCESSING' }], error: null };
      Object.assign(run, { state: 'PROCESSING' });
      await this.flush();
      return { data: [{ out_fact_run_id: run.id, out_state: 'PROCESSING', out_transition: 'PROCESSING' }], error: null };
    }
    return { data: null, error: { message: `Unsupported rpc ${fn}` } };
  }
}

class DurableStorage {
  constructor(private readonly root: string) {}
  from(bucket: string) {
    return {
      upload: async (key: string, body: Blob) => {
        const path = join(this.root, bucket, ...key.split('/'));
        await mkdir(join(path, '..'), { recursive: true });
        await writeFile(path, Buffer.from(await body.arrayBuffer()));
        return { error: null };
      },
      download: async (key: string) => {
        const bytes = await readFile(join(this.root, bucket, ...key.split('/')));
        return { data: new Blob([bytes]), error: null };
      },
    };
  }
}

function now() { return new Date().toISOString(); }

function isRow(value: Row | undefined): value is Row {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

describe('AUDIT QUEUE E2E', () => {
  let root = '';
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  async function drainQueue(db: DurableDb, storage: DurableStorage, workerId = `vitest-${randomUUID()}`) {
    const repo = createJobRepository(db);
    for (let index = 0; index < 20; index += 1) {
      const claimed = await repo.claimNext(workerId, 60);
      if (!claimed) return;
      await executeClaimedJob({ database: db, storage, workerId }, claimed);
    }
    throw new Error('QUEUE_DID_NOT_DRAIN');
  }

  it('completa pipeline: evidencias, facts congelados, engine, rule results, report snapshot y audit COMPLETED', async () => {
    root = join(tmpdir(), `cancelaciones-audit-queue-${randomUUID()}`);
    await mkdir(root, { recursive: true });
    const db = new DurableDb(join(root, 'db.json'));
    const storage = new DurableStorage(join(root, 'storage'));
    const actorId = randomUUID();
    const audit = await createAuditRepository(db).create({ createdBy: actorId, displayName: 'E2E sintético', externalCaseId: 'E2E-QUEUE' });
    const file = new File(['ESTUDIANTE: ALUMNO SINTETICO\nMATRICULA: TEST-001\nNIVEL: LICENCIATURA\nNO CONTACTO EFECTIVO\nSIN LOGIN\nSIN MODALIDAD\nCALL: 2026-09-01\nEMAIL: 2026-09-02'], 'fixture.txt', { type: 'text/plain' });

    const uploaded = await uploadEvidenceFilesForAudit({ auditId: audit.id, actorId, files: [file], database: db, storage });
    const jobs = await enqueueEvidenceProcessingJobs({ database: db, auditId: audit.id, actorId });
    const duplicateJobs = await enqueueEvidenceProcessingJobs({ database: db, auditId: audit.id, actorId });

    expect(uploaded[0].status).toBe('STORED');
    expect(jobs).toHaveLength(1);
    expect(duplicateJobs).toEqual(jobs);
    expect(db.table('jobs')).toHaveLength(1);
    await expect(createJobRepository(db).listByAudit(audit.id)).resolves.toMatchObject([{ status: 'QUEUED', attemptCount: 0 }]);

    const reloadedBeforeWorker = new DurableDb(join(root, 'db.json'));
    reloadedBeforeWorker.data = JSON.parse(await readFile(join(root, 'db.json'), 'utf8'));
    expect(await createEvidenceRepository(reloadedBeforeWorker).findStoredById(uploaded[0].evidenceId!)).toMatchObject({ auditId: audit.id, storageKey: expect.any(String) });

    await drainQueue(reloadedBeforeWorker, storage);

    const reload = new DurableDb(join(root, 'db.json'));
    await reload.reload();
    const artifacts = await createJobRepository(reload).listArtifactsByAudit(audit.id);
    const finalJobs = await createJobRepository(reload).listByAudit(audit.id);
    const evidenceJob = finalJobs.find((job) => job.id === jobs[0].jobId);
    expect(evidenceJob).toMatchObject({ status: 'COMPLETED', progress: 100, attemptCount: 1 });
    expect(artifacts[0]).toMatchObject({ evidenceId: uploaded[0].evidenceId, artifactType: 'document-text' });
    expect(artifacts[0].result.text).toContain('ALUMNO SINTETICO');
    expect(reload.table('fact_extraction_runs')).toMatchObject([{ audit_id: audit.id, state: 'FROZEN' }]);
    expect(reload.table('facts').map((row) => row.fact_type)).toEqual(expect.arrayContaining(['student.level', 'contact.effectiveContact', 'classroom.hasLogin', 'classroom.hasEvaluationMode']));
    expect(reload.table('engine_runs')).toHaveLength(1);
    expect(reload.table('engine_rule_results').length).toBeGreaterThan(0);
    expect(reload.table('report_snapshots')).toHaveLength(1);
    expect(reload.table('audits')[0]).toMatchObject({ id: audit.id, status: 'COMPLETED' });
    const evaluation = reload.table('engine_runs')[0].evaluation as { suggestedOutcome?: string | null; evaluatedRules?: unknown[] };
    expect(evaluation.suggestedOutcome).toBe('CANCELACION_VENTA');
  });

  it('multi-file fan-in: no extrae facts hasta que todas las evidencias tienen artifact y crea un solo FACT_EXTRACTION', async () => {
    root = join(tmpdir(), `cancelaciones-audit-queue-${randomUUID()}`);
    await mkdir(root, { recursive: true });
    const db = new DurableDb(join(root, 'db.json'));
    const storage = new DurableStorage(join(root, 'storage'));
    const actorId = randomUUID();
    const audit = await createAuditRepository(db).create({ createdBy: actorId, displayName: 'E2E fan-in', externalCaseId: 'E2E-FANIN' });
    const files = [
      new File(['NIVEL: LICENCIATURA\nNO CONTACTO EFECTIVO'], 'a.txt', { type: 'text/plain' }),
      new File(['SIN LOGIN\nSIN MODALIDAD'], 'b.txt', { type: 'text/plain' }),
    ];
    await uploadEvidenceFilesForAudit({ auditId: audit.id, actorId, files, database: db, storage });
    await enqueueEvidenceProcessingJobs({ database: db, auditId: audit.id, actorId });
    const repo = createJobRepository(db);
    const workerId = `vitest-${randomUUID()}`;
    const first = await repo.claimNext(workerId, 60);
    await executeClaimedJob({ database: db, storage, workerId }, first!);
    expect(db.table('jobs').filter((job) => job.job_type === 'FACT_EXTRACTION')).toHaveLength(0);
    const second = await repo.claimNext(workerId, 60);
    await executeClaimedJob({ database: db, storage, workerId }, second!);
    expect(db.table('jobs').filter((job) => job.job_type === 'FACT_EXTRACTION')).toHaveLength(1);
    await drainQueue(db, storage, workerId);
    expect(db.table('jobs').filter((job) => job.job_type === 'FACT_EXTRACTION')).toHaveLength(1);
    expect(db.table('report_snapshots')).toHaveLength(1);
  });

  it('persiste error y retry para evidencia inexistente sin crear artifact falso', async () => {
    root = join(tmpdir(), `cancelaciones-audit-queue-${randomUUID()}`);
    await mkdir(root, { recursive: true });
    const db = new DurableDb(join(root, 'db.json'));
    const actorId = randomUUID();
    const audit = await createAuditRepository(db).create({ createdBy: actorId, displayName: 'E2E fallo', externalCaseId: 'E2E-FAILURE' });
    const repo = createJobRepository(db);
    const payload = { auditId: audit.id, evidenceId: randomUUID(), sha256: 'missing', version: 'deterministic-text-v1' };
    const job = await repo.enqueue({ auditId: audit.id, jobType: 'EVIDENCE_PROCESSING', operationScope: 'evidence:missing:process', idempotencyKey: 'evidence:missing:process:v1', inputFingerprint: 'missing', payload, actorId });
    const workerId = `vitest-${randomUUID()}`;
    const claimed = await repo.claimNext(workerId, 60);

    await executeClaimedJob({ database: db, storage: new DurableStorage(join(root, 'storage')), workerId }, claimed!);

    // El código pasó de `SYNTHETIC_TRANSIENT_ERROR` (nombre de un fixture de
    // test, en producción) a `DEPENDENCY_NOT_READY`, que dice lo que ocurrió:
    // la evidencia aún no estaba. El comportamiento —retry— no cambia; cambia
    // la honestidad del etiqueta.
    expect(await repo.listByAudit(audit.id)).toMatchObject([{ id: job.id, status: 'QUEUED', attemptCount: 1, lastErrorCode: 'DEPENDENCY_NOT_READY', lastErrorMessage: 'EVIDENCE_NOT_FOUND' }]);
    expect(await repo.listArtifactsByAudit(audit.id)).toEqual([]);
    expect(db.table('engine_runs')).toEqual([]);
    expect(db.table('report_snapshots')).toEqual([]);
  });

  it('demuestra que la cola actual no ejecuta facts, motor ni dictamen automáticamente', async () => {
    root = join(tmpdir(), `cancelaciones-audit-queue-${randomUUID()}`);
    await mkdir(root, { recursive: true });
    const db = new DurableDb(join(root, 'db.json'));
    expect(await createFactRepository(db).listRunsByAudit(randomUUID())).toEqual([]);
    expect(db.table('engine_runs')).toEqual([]);
    expect(db.table('report_snapshots')).toEqual([]);
  });

  it('retry transitorio y duplicate delivery no duplican facts, engine ni report', async () => {
    root = join(tmpdir(), `cancelaciones-audit-queue-${randomUUID()}`);
    await mkdir(root, { recursive: true });
    const db = new DurableDb(join(root, 'db.json'));
    const storage = new DurableStorage(join(root, 'storage'));
    const actorId = randomUUID();
    const audit = await createAuditRepository(db).create({ createdBy: actorId, displayName: 'E2E retry', externalCaseId: 'E2E-RETRY' });
    const file = new File(['NIVEL: LICENCIATURA\nNO CONTACTO EFECTIVO\nSIN LOGIN\nSIN MODALIDAD'], 'retry.txt', { type: 'text/plain' });
    const uploaded = await uploadEvidenceFilesForAudit({ auditId: audit.id, actorId, files: [file], database: db, storage });
    await enqueueEvidenceProcessingJobs({ database: db, auditId: audit.id, actorId });
    const evidence = await createEvidenceRepository(db).findStoredById(uploaded[0].evidenceId!);
    await rm(join(root, 'storage', evidence!.storageBucket, ...evidence!.storageKey!.split('/')), { force: true });
    const repo = createJobRepository(db);
    const workerId = `vitest-${randomUUID()}`;
    const failedClaim = await repo.claimNext(workerId, 60);
    await executeClaimedJob({ database: db, storage, workerId }, failedClaim!);
    expect((await repo.listByAudit(audit.id)).find((job) => job.id === failedClaim!.jobId)).toMatchObject({ status: 'QUEUED', attemptCount: 1 });
    await storage.from(evidence!.storageBucket).upload(evidence!.storageKey!, file);
    const retryClaim = await repo.claimNext(workerId, 60);
    await executeClaimedJob({ database: db, storage, workerId }, retryClaim!);
    await drainQueue(db, storage, workerId);
    const factJob = db.table('jobs').find((job) => job.job_type === 'FACT_EXTRACTION');
    await executeClaimedJob({ database: db, storage, workerId }, { jobId: String(factJob!.id), attemptId: 'duplicate', auditId: audit.id, jobType: 'FACT_EXTRACTION', payload: factJob!.payload as Record<string, unknown>, attemptNumber: 99 });
    expect(db.table('fact_extraction_runs')).toHaveLength(1);
    expect(db.table('engine_runs')).toHaveLength(1);
    expect(db.table('report_snapshots')).toHaveLength(1);
  });
});
