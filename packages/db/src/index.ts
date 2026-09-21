import type { Audit, ClaimedJob, Evidence, EvidenceStatus, Job, JobStatus, JobType } from '@cancelaciones/domain';

export interface DatabaseClient {
  from(table: string): any;
  rpc?(fn: string, args?: Record<string, unknown>): any;
}

interface AuditRow {
  id: string;
  status: Audit['status'];
  external_case_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface EvidenceRow {
  id: string;
  audit_id: string;
  original_filename: string | null;
  safe_filename: string | null;
  nombre_archivo: string;
  mime_type: string | null;
  detected_mime_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  storage_bucket: string;
  storage_key: string | null;
  status: EvidenceStatus;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

interface JobRow {
  id: string;
  audit_id: string;
  job_type: JobType;
  operation_scope: string;
  idempotency_key: string;
  input_fingerprint: string;
  status: JobStatus;
  progress: number;
  attempt_count: number;
  max_attempts: number;
  created_at: string;
}

interface ClaimedJobRow {
  job_id: string;
  attempt_id: string;
  audit_id: string;
  job_type: JobType;
  payload: Record<string, unknown>;
  attempt_number: number;
}

function mapAudit(row: AuditRow): Audit {
  return {
    id: row.id,
    status: row.status,
    externalCaseId: row.external_case_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEvidence(row: EvidenceRow): Evidence {
  return {
    id: row.id,
    auditId: row.audit_id,
    originalFilename: row.original_filename ?? row.nombre_archivo,
    safeFilename: row.safe_filename ?? row.nombre_archivo,
    mimeType: row.mime_type ?? 'application/octet-stream',
    detectedMimeType: row.detected_mime_type ?? row.mime_type ?? 'application/octet-stream',
    sizeBytes: Number(row.size_bytes ?? 0),
    sha256: row.sha256 ?? '',
    storageBucket: row.storage_bucket,
    storageKey: row.storage_key,
    status: row.status,
    uploadedBy: row.uploaded_by ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapJob(row: JobRow): Job {
  return {
    id: row.id,
    auditId: row.audit_id,
    jobType: row.job_type,
    status: row.status,
    operationScope: row.operation_scope,
    idempotencyKey: row.idempotency_key,
    inputFingerprint: row.input_fingerprint,
    progress: row.progress,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    createdAt: row.created_at,
  };
}

function mapClaimedJob(row: ClaimedJobRow): ClaimedJob {
  return {
    jobId: row.job_id,
    attemptId: row.attempt_id,
    auditId: row.audit_id,
    jobType: row.job_type,
    payload: row.payload,
    attemptNumber: row.attempt_number,
  };
}

export function createAuditRepository(database: DatabaseClient) {
  return {
    async listRecent(): Promise<Audit[]> {
      const { data, error } = await database
        .from('audits')
        .select('id,status,external_case_id,created_by,created_at,updated_at')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw new Error(error.message ?? 'No fue posible leer auditorias');
      return (data ?? []).map(mapAudit);
    },

    async create(input: { createdBy: string; externalCaseId?: string | null }): Promise<Audit> {
      const { data, error } = await database
        .from('audits')
        .insert([{ created_by: input.createdBy, external_case_id: input.externalCaseId ?? null }])
        .select('id,status,external_case_id,created_by,created_at,updated_at')
        .single();

      if (error || !data) throw new Error(error?.message ?? 'No fue posible crear auditoria');
      return mapAudit(data);
    },

    async findById(auditId: string): Promise<Audit | null> {
      const { data, error } = await database
        .from('audits')
        .select('id,status,external_case_id,created_by,created_at,updated_at')
        .eq('id', auditId)
        .limit(1);
      if (error) throw new Error(error.message ?? 'No fue posible leer auditoria');
      return data?.[0] ? mapAudit(data[0]) : null;
    },
  };
}

export function createEvidenceRepository(database: DatabaseClient) {
  const columns = 'id,audit_id,original_filename,safe_filename,nombre_archivo,mime_type,detected_mime_type,size_bytes,sha256,storage_bucket,storage_key,status,uploaded_by,created_at,updated_at';

  return {
    async listByAudit(auditId: string): Promise<Evidence[]> {
      const { data, error } = await database
        .from('evidences')
        .select(columns)
        .eq('audit_id', auditId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message ?? 'No fue posible leer evidencias');
      return (data ?? []).map(mapEvidence);
    },

    async createPending(input: {
      id: string;
      auditId: string;
      originalFilename: string;
      safeFilename: string;
      mimeType: string;
      detectedMimeType: string;
      sizeBytes: number;
      sha256: string;
      storageBucket: string;
      storageKey: string;
      uploadedBy: string;
    }): Promise<Evidence> {
      const { data, error } = await database
        .from('evidences')
        .insert([{
          id: input.id,
          ticket_id: input.auditId,
          audit_id: input.auditId,
          nombre_archivo: input.originalFilename,
          original_filename: input.originalFilename,
          safe_filename: input.safeFilename,
          tipo: input.detectedMimeType,
          fuente: 'UPLOAD',
          mime_type: input.mimeType,
          detected_mime_type: input.detectedMimeType,
          size_bytes: input.sizeBytes,
          sha256: input.sha256,
          storage_bucket: input.storageBucket,
          storage_key: input.storageKey,
          status: 'PENDING',
          estado_lectura: 'PENDING',
          uploaded_by: input.uploadedBy,
          created_by: input.uploadedBy,
        }])
        .select(columns)
        .single();
      if (error || !data) throw new Error(error?.message ?? 'No fue posible crear evidencia');
      return mapEvidence(data);
    },

    async markStored(evidenceId: string): Promise<void> {
      const { error } = await database
        .from('evidences')
        .update({ status: 'STORED', estado_lectura: 'STORED', failure_reason: null })
        .eq('id', evidenceId);
      if (error) throw new Error(error.message ?? 'No fue posible marcar evidencia como almacenada');
    },

    async markFailed(evidenceId: string, reason: string): Promise<void> {
      const { error } = await database
        .from('evidences')
        .update({ status: 'FAILED', estado_lectura: 'FAILED', failure_reason: reason.slice(0, 500) })
        .eq('id', evidenceId);
      if (error) throw new Error(error.message ?? 'No fue posible marcar evidencia como fallida');
    },

    async findStoredById(evidenceId: string): Promise<Evidence | null> {
      const { data, error } = await database
        .from('evidences')
        .select(columns)
        .eq('id', evidenceId)
        .eq('status', 'STORED')
        .limit(1);
      if (error) throw new Error(error.message ?? 'No fue posible leer evidencia');
      return data?.[0] ? mapEvidence(data[0]) : null;
    },
  };
}

export function createAuditLogRepository(database: DatabaseClient) {
  return {
    async record(input: { auditId: string; eventType: string; actorId: string; metadata?: Record<string, unknown> }): Promise<void> {
      const { error } = await database
        .from('audit_log')
        .insert([{ audit_id: input.auditId, event_type: input.eventType, actor_id: input.actorId, metadata: input.metadata ?? {} }]);
      if (error) throw new Error(error.message ?? 'No fue posible registrar audit log');
    },
  };
}

export function createJobRepository(database: DatabaseClient) {
  if (!database.rpc) throw new Error('Database client must support rpc for durable jobs');
  const rpc = database.rpc.bind(database);
  const columns = 'id,audit_id,job_type,operation_scope,idempotency_key,input_fingerprint,status,progress,attempt_count,max_attempts,created_at';

  return {
    async enqueue(input: {
      auditId: string;
      jobType: JobType;
      operationScope: string;
      idempotencyKey: string;
      inputFingerprint: string;
      payload?: Record<string, unknown>;
      priority?: number;
      maxAttempts?: number;
      actorId?: string | null;
    }): Promise<Job> {
      const { data, error } = await rpc('enqueue_job', {
        p_audit_id: input.auditId,
        p_job_type: input.jobType,
        p_operation_scope: input.operationScope,
        p_idempotency_key: input.idempotencyKey,
        p_input_fingerprint: input.inputFingerprint,
        p_payload: input.payload ?? {},
        p_priority: input.priority ?? 100,
        p_max_attempts: input.maxAttempts ?? 3,
        p_actor_id: input.actorId ?? null,
      });
      if (error || !data) throw new Error(error?.message ?? 'No fue posible encolar job');
      return mapJob(Array.isArray(data) ? data[0] : data);
    },

    async claimNext(workerId: string, leaseSeconds = 60): Promise<ClaimedJob | null> {
      const { data, error } = await rpc('claim_next_job', { p_worker_id: workerId, p_lease_seconds: leaseSeconds });
      if (error) throw new Error(error.message ?? 'No fue posible reclamar job');
      const row = Array.isArray(data) ? data[0] : data;
      return row ? mapClaimedJob(row) : null;
    },

    async listByAudit(auditId: string): Promise<Job[]> {
      const { data, error } = await database
        .from('jobs')
        .select(columns)
        .eq('audit_id', auditId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message ?? 'No fue posible leer jobs');
      return (data ?? []).map(mapJob);
    },

    async recordArtifact(jobId: string, artifactType: string, result: Record<string, unknown>): Promise<void> {
      const { error } = await rpc('record_job_artifact', { p_job_id: jobId, p_artifact_type: artifactType, p_result: result });
      if (error) throw new Error(error.message ?? 'No fue posible registrar artifact');
    },

    async complete(jobId: string, workerId: string, progress = 100): Promise<void> {
      const { error } = await rpc('complete_job', { p_job_id: jobId, p_worker_id: workerId, p_progress: progress });
      if (error) throw new Error(error.message ?? 'No fue posible completar job');
    },

    async scheduleRetry(jobId: string, workerId: string, errorCode: string, message: string, delaySeconds: number): Promise<void> {
      const { error } = await rpc('schedule_job_retry', {
        p_job_id: jobId,
        p_worker_id: workerId,
        p_error_code: errorCode,
        p_error_message_sanitized: message,
        p_delay_seconds: delaySeconds,
      });
      if (error) throw new Error(error.message ?? 'No fue posible programar retry');
    },

    async failPermanent(jobId: string, workerId: string, errorCode: string, message: string): Promise<void> {
      const { error } = await rpc('fail_job_permanent', {
        p_job_id: jobId,
        p_worker_id: workerId,
        p_error_code: errorCode,
        p_error_message_sanitized: message,
      });
      if (error) throw new Error(error.message ?? 'No fue posible fallar job');
    },
  };
}
