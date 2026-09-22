import { stableFingerprint, type Audit, type ClaimedJob, type Evidence, type EvidenceStatus, type Job, type JobStatus, type JobType } from '@cancelaciones/domain';

export interface DatabaseClient {
  from(table: string): any;
  rpc?(fn: string, args?: Record<string, unknown>): any;
}

interface AuditRow {
  id: string;
  display_name: string | null;
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
  last_error_code: string | null;
  last_error_message_sanitized: string | null;
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

export interface JobArtifact {
  id: string;
  jobId: string;
  evidenceId: string | null;
  artifactType: string;
  result: Record<string, unknown>;
  contentSha256: string | null;
  createdAt: string;
}

interface JobArtifactRow {
  id: string;
  job_id: string;
  evidence_id: string | null;
  artifact_type: string;
  result: Record<string, unknown>;
  content_sha256: string | null;
  created_at: string;
}

export interface FactExtractionRun {
  id: string;
  auditId: string;
  policyCode: string;
  policyVersion: string;
  extractorVersion: string;
  artifactSetFingerprint: string;
  state: 'DRAFT' | 'PROCESSING' | 'FAILED' | 'FROZEN';
  frozenAt: string | null;
  createdAt: string;
}

interface FactExtractionRunRow {
  id: string;
  audit_id: string;
  policy_code: string;
  policy_version: string;
  extractor_version: string;
  artifact_set_fingerprint: string;
  state: FactExtractionRun['state'];
  frozen_at: string | null;
  created_at: string;
}

export interface StoredFact {
  id: string;
  auditId: string;
  runId: string;
  factType: string;
  classification: string;
  value: unknown;
  sourceRef: Record<string, unknown>;
  confidence: number | null;
  createdAt: string;
}

interface FactRow {
  id: string;
  audit_id: string;
  run_id: string;
  fact_type: string;
  classification: string;
  value: unknown;
  source_ref: Record<string, unknown>;
  confidence: number | null;
  created_at: string;
}

function mapAudit(row: AuditRow): Audit {
  return {
    id: row.id,
    displayName: row.display_name,
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
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message_sanitized,
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

function mapJobArtifact(row: JobArtifactRow): JobArtifact {
  return { id: row.id, jobId: row.job_id, evidenceId: row.evidence_id, artifactType: row.artifact_type, result: row.result, contentSha256: row.content_sha256, createdAt: row.created_at };
}

function mapFactRun(row: FactExtractionRunRow): FactExtractionRun {
  return { id: row.id, auditId: row.audit_id, policyCode: row.policy_code, policyVersion: row.policy_version, extractorVersion: row.extractor_version, artifactSetFingerprint: row.artifact_set_fingerprint, state: row.state, frozenAt: row.frozen_at, createdAt: row.created_at };
}

function mapFact(row: FactRow): StoredFact {
  return { id: row.id, auditId: row.audit_id, runId: row.run_id, factType: row.fact_type, classification: row.classification, value: row.value, sourceRef: row.source_ref, confidence: row.confidence === null ? null : Number(row.confidence), createdAt: row.created_at };
}

export function createAuditRepository(database: DatabaseClient) {
  return {
    async listRecent(): Promise<Audit[]> {
      const { data, error } = await database
        .from('audits')
        .select('id,display_name,status,external_case_id,created_by,created_at,updated_at')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw new Error(error.message ?? 'No fue posible leer auditorias');
      return (data ?? []).map(mapAudit);
    },

    async create(input: { createdBy: string; displayName: string; externalCaseId?: string | null }): Promise<Audit> {
      const { data, error } = await database
        .from('audits')
        .insert([{ created_by: input.createdBy, display_name: input.displayName, external_case_id: input.externalCaseId ?? null }])
        .select('id,display_name,status,external_case_id,created_by,created_at,updated_at')
        .single();

      if (error || !data) throw new Error(error?.message ?? 'No fue posible crear auditoria');
      return mapAudit(data);
    },

    async findById(auditId: string): Promise<Audit | null> {
      const { data, error } = await database
        .from('audits')
        .select('id,display_name,status,external_case_id,created_by,created_at,updated_at')
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
          ticket_id: null,
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
  const columns = 'id,audit_id,job_type,operation_scope,idempotency_key,input_fingerprint,status,progress,attempt_count,max_attempts,last_error_code,last_error_message_sanitized,created_at';

  return {
    async enqueue(input: {
      auditId: string;
      jobType: JobType;
      operationScope: string;
      idempotencyKey: string;
      inputFingerprint: string;
      payload?: Record<string, unknown>;
      evidenceId?: string | null;
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
        p_evidence_id: input.evidenceId ?? null,
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

    async recordArtifact(jobId: string, artifactType: string, result: Record<string, unknown>, metadata?: { evidenceId?: string | null; contentSha256?: string | null; extractorVersion?: string | null; provider?: string | null }): Promise<void> {
      const { error } = await rpc('record_job_artifact', {
        p_job_id: jobId,
        p_artifact_type: artifactType,
        p_result: result,
        p_evidence_id: metadata?.evidenceId ?? null,
        p_attempt_id: null,
        p_extractor_version: metadata?.extractorVersion ?? null,
        p_provider: metadata?.provider ?? null,
        p_provider_operation_id: null,
        p_storage_bucket: null,
        p_storage_key: null,
        p_content_sha256: metadata?.contentSha256 ?? null,
        p_warnings: [],
      });
      if (error) throw new Error(error.message ?? 'No fue posible registrar artifact');
    },

    async listArtifactsByAudit(auditId: string): Promise<JobArtifact[]> {
      const jobs = await this.listByAudit(auditId);
      if (!jobs.length) return [];
      const { data, error } = await database
        .from('job_artifacts')
        .select('id,job_id,evidence_id,artifact_type,result,content_sha256,created_at')
        .in('job_id', jobs.map((job) => job.id))
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message ?? 'No fue posible leer artifacts');
      return (data ?? []).map(mapJobArtifact);
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

export function createFactRepository(database: DatabaseClient) {
  const runColumns = 'id,audit_id,policy_code,policy_version,extractor_version,artifact_set_fingerprint,state,frozen_at,created_at';
  const factColumns = 'id,audit_id,run_id,fact_type,classification,value,source_ref,confidence,created_at';

  return {
    async listRunsByAudit(auditId: string): Promise<FactExtractionRun[]> {
      const { data, error } = await database.from('fact_extraction_runs').select(runColumns).eq('audit_id', auditId).order('created_at', { ascending: false }).limit(20);
      if (error) throw new Error(error.message ?? 'No fue posible leer fact runs');
      return (data ?? []).map(mapFactRun);
    },

    async findRunById(runId: string): Promise<FactExtractionRun | null> {
      const { data, error } = await database.from('fact_extraction_runs').select(runColumns).eq('id', runId).limit(1);
      if (error) throw new Error(error.message ?? 'No fue posible leer fact run');
      return data?.[0] ? mapFactRun(data[0]) : null;
    },

    async createRun(input: { auditId: string; policyCode: string; policyVersion: string; extractorVersion: string; artifactSetFingerprint: string; createdBy: string }): Promise<FactExtractionRun> {
      const { data, error } = await database.from('fact_extraction_runs').insert([{
        audit_id: input.auditId,
        policy_code: input.policyCode,
        policy_version: input.policyVersion,
        extractor_version: input.extractorVersion,
        artifact_set_fingerprint: input.artifactSetFingerprint,
        state: 'DRAFT',
        created_by: input.createdBy,
      }]).select(runColumns).single();
      if (error || !data) throw new Error(error?.message ?? 'No fue posible crear fact run');
      return mapFactRun(data);
    },

    async freezeRun(runId: string): Promise<FactExtractionRun> {
      const { data, error } = await database.from('fact_extraction_runs').update({ state: 'FROZEN', frozen_at: new Date().toISOString() }).eq('id', runId).eq('state', 'DRAFT').select(runColumns).single();
      if (error || !data) throw new Error(error?.message ?? 'No fue posible congelar fact run');
      return mapFactRun(data);
    },

    async listFactsByRun(runId: string): Promise<StoredFact[]> {
      const { data, error } = await database.from('facts').select(factColumns).eq('run_id', runId).order('created_at', { ascending: true }).limit(500);
      if (error) throw new Error(error.message ?? 'No fue posible leer facts');
      return (data ?? []).map(mapFact);
    },

    async findFactById(factId: string): Promise<StoredFact | null> {
      const { data, error } = await database.from('facts').select(factColumns).eq('id', factId).limit(1);
      if (error) throw new Error(error.message ?? 'No fue posible leer el dato');
      return data?.[0] ? mapFact(data[0]) : null;
    },

    async insertFacts(facts: Array<{ auditId: string; runId: string; factType: string; value: unknown; sourceRef: Record<string, unknown>; confidence?: number }>): Promise<StoredFact[]> {
      if (!facts.length) return [];
      const { data, error } = await database.from('facts').insert(facts.map((fact) => ({
        audit_id: fact.auditId,
        run_id: fact.runId,
        fact_type: fact.factType,
        classification: 'OBSERVABLE',
        value: fact.value,
        source_ref: fact.sourceRef,
        confidence: fact.confidence ?? null,
      }))).select(factColumns);
      if (error || !data) throw new Error(error?.message ?? 'No fue posible guardar facts');
      return data.map(mapFact);
    },

    async artifactSetFingerprint(auditId: string): Promise<string> {
      const artifacts = await createJobRepository(database).listArtifactsByAudit(auditId);
      return stableFingerprint(artifacts.map((artifact) => ({ id: artifact.id, type: artifact.artifactType, sha256: artifact.contentSha256, evidenceId: artifact.evidenceId })));
    },
  };
}
