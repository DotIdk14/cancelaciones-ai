import { stableFingerprint, type Audit, type AuditRun, type AuditRunStatus, type AuditRunType, type ClaimedJob, type ComparisonStatus, type DiscrepancyType, type DocumentRole, type Evidence, type EvidenceStatus, type FinalAdjudicationType, type HumanClaimClassification, type Job, type JobStatus, type JobType } from '@cancelaciones/domain';

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

export interface AuditManualComments {
  id: string;
  auditId: string;
  backOfficeComment: string | null;
  helpdeskComment: string | null;
  schoolServicesComment: string | null;
  financeComment: string | null;
  additionalComment: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
}

interface AuditManualCommentsRow {
  id: string;
  audit_id: string;
  back_office_comment: string | null;
  helpdesk_comment: string | null;
  school_services_comment: string | null;
  finance_comment: string | null;
  additional_comment: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
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
  document_role: DocumentRole;
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

export type RuleLifecycleStatus = 'DRAFT' | 'REVIEW' | 'APPROVED' | 'ACTIVE' | 'RETIRED';
export type EvidenceRequirementType = 'DOCUMENT' | 'IMAGE' | 'AUDIO' | 'TEXT' | 'SPREADSHEET' | 'PDF' | 'OTHER';

export interface RuleRecord {
  id: string;
  ruleKey: string;
  version: string;
  name: string;
  status: RuleLifecycleStatus;
  createdAt: string;
}

interface RuleRow {
  id: string;
  rule_key: string;
  version: string;
  name: string;
  status: RuleLifecycleStatus;
  created_at: string;
}

export interface EvidenceRequirementRecord {
  id: string;
  ruleId: string;
  requirementKey: string;
  name: string | null;
  description: string | null;
  evidenceType: EvidenceRequirementType;
  evidenceCode: string | null;
  documentRole: DocumentRole | null;
  required: boolean;
  minCount: number;
  maxCount: number | null;
  orderIndex: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface EvidenceRequirementRow {
  id: string;
  rule_id: string;
  requirement_key: string;
  name: string | null;
  description: string | null;
  evidence_type: EvidenceRequirementType;
  evidence_code: string | null;
  document_role: DocumentRole | null;
  required: boolean;
  min_count: number;
  max_count: number | null;
  order_index: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
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

function mapAuditManualComments(row: AuditManualCommentsRow): AuditManualComments {
  return {
    id: row.id,
    auditId: row.audit_id,
    backOfficeComment: row.back_office_comment,
    helpdeskComment: row.helpdesk_comment,
    schoolServicesComment: row.school_services_comment,
    financeComment: row.finance_comment,
    additionalComment: row.additional_comment,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
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
    documentRole: row.document_role ?? 'EVIDENCE',
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

function mapRule(row: RuleRow): RuleRecord {
  return { id: row.id, ruleKey: row.rule_key, version: row.version, name: row.name, status: row.status, createdAt: row.created_at };
}

function mapEvidenceRequirement(row: EvidenceRequirementRow): EvidenceRequirementRecord {
  return { id: row.id, ruleId: row.rule_id, requirementKey: row.requirement_key, name: row.name, description: row.description, evidenceType: row.evidence_type, evidenceCode: row.evidence_code, documentRole: row.document_role, required: row.required, minCount: Number(row.min_count), maxCount: row.max_count === null ? null : Number(row.max_count), orderIndex: Number(row.order_index), metadata: row.metadata ?? {}, createdAt: row.created_at, updatedAt: row.updated_at };
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

    /**
     * Elimina una auditoría a través de la función RPC public.delete_audit().
     * Esa función valida autorización (creador u OWNER) y deja SIEMPRE una
     * entrada en audit_log con quién la eliminó. El DELETE directo sobre
     * `audits` está revocado en la base; todo borrado pasa por aquí.
     */
    async deleteAudit(auditId: string, reason?: string | null): Promise<Record<string, unknown> | null> {
      if (!database.rpc) throw new Error('Database client must support rpc for audit deletion');
      const { data, error } = await database.rpc('delete_audit', {
        p_audit_id: auditId,
        p_reason: reason ?? null,
      });
      if (error) throw new Error(error.message ?? 'No fue posible eliminar la auditoria');
      const row = Array.isArray(data) ? data[0] : data;
      return row ?? null;
    },
  };
}

export function createEvidenceRepository(database: DatabaseClient) {
  const columns = 'id,audit_id,original_filename,safe_filename,nombre_archivo,mime_type,detected_mime_type,size_bytes,sha256,storage_bucket,storage_key,status,document_role,uploaded_by,created_at,updated_at';

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
      documentRole?: DocumentRole;
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
          document_role: input.documentRole ?? 'EVIDENCE',
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

    async listByAudit(auditId: string, limit = 100): Promise<Array<{ id: string; eventType: string; actorId: string | null; metadata: Record<string, unknown>; occurredAt: string }>> {
      const { data, error } = await database
        .from('audit_log')
        .select('id,event_type,actor_id,metadata,occurred_at')
        .eq('audit_id', auditId)
        .order('occurred_at', { ascending: true })
        .limit(limit);
      if (error) throw new Error(error.message ?? 'No fue posible leer audit log');
      return (data ?? []).map((row: { id: string; event_type: string; actor_id: string | null; metadata?: Record<string, unknown> | null; occurred_at: string }) => ({
        id: row.id,
        eventType: row.event_type,
        actorId: row.actor_id,
        metadata: row.metadata ?? {},
        occurredAt: row.occurred_at,
      }));
    },
  };
}

export function createAuditManualCommentsRepository(database: DatabaseClient) {
  const columns = 'id,audit_id,back_office_comment,helpdesk_comment,school_services_comment,finance_comment,additional_comment,created_at,updated_at,updated_by';

  return {
    async findByAudit(auditId: string): Promise<AuditManualComments | null> {
      const { data, error } = await database
        .from('audit_manual_comments')
        .select(columns)
        .eq('audit_id', auditId)
        .limit(1);
      if (error) throw new Error(error.message ?? 'No fue posible leer comentarios manuales');
      return data?.[0] ? mapAuditManualComments(data[0]) : null;
    },

    async upsert(input: {
      auditId: string;
      actorId: string;
      comments: {
        backOfficeComment?: string | null;
        helpdeskComment?: string | null;
        schoolServicesComment?: string | null;
        financeComment?: string | null;
        additionalComment?: string | null;
      };
    }): Promise<AuditManualComments> {
      const normalized = {
        back_office_comment: input.comments.backOfficeComment?.trim() || null,
        helpdesk_comment: input.comments.helpdeskComment?.trim() || null,
        school_services_comment: input.comments.schoolServicesComment?.trim() || null,
        finance_comment: input.comments.financeComment?.trim() || null,
        additional_comment: input.comments.additionalComment?.trim() || null,
      };

      const existing = await this.findByAudit(input.auditId);
      if (existing) {
        const { data, error } = await database
          .from('audit_manual_comments')
          .update({ ...normalized, updated_by: input.actorId })
          .eq('audit_id', input.auditId)
          .select(columns)
          .single();
        if (error || !data) throw new Error(error?.message ?? 'No fue posible guardar comentarios manuales');
        return mapAuditManualComments(data);
      }

      const { data, error } = await database
        .from('audit_manual_comments')
        .insert([{ audit_id: input.auditId, ...normalized, updated_by: input.actorId }])
        .select(columns)
        .single();
      if (error || !data) throw new Error(error?.message ?? 'No fue posible crear comentarios manuales');
      return mapAuditManualComments(data);
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

    /**
     * Solo los artifacts producidos por evidencias con rol EVIDENCE alimentan el
     * hechario de la línea base. El dictamen humano y las evidencias de
     * adjudicación jamás entran a este universo (aislamiento de baseline).
     */
    async listBaselineArtifactsByAudit(auditId: string): Promise<JobArtifact[]> {
      const evidences = await createEvidenceRepository(database).listByAudit(auditId);
      const allowed = new Set(evidences.filter((evidence) => evidence.documentRole === 'EVIDENCE').map((evidence) => evidence.id));
      const artifacts = await this.listArtifactsByAudit(auditId);
      return artifacts.filter((artifact) => artifact.evidenceId !== null && allowed.has(artifact.evidenceId));
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

    /**
     * Congela un Fact Run recorriendo la máquina de estados LEGAL.
     *
     * Antes este método hacía `DRAFT -> FROZEN` en un solo `UPDATE`, que es
     * exactamente lo que `guard_fact_run_transition` (migración
     * 20260925120000, §10) prohíbe: `FACT_RUN_STATE_TRANSITION_FORBIDDEN`. Con
     * esa migración aplicada, `POST /api/audits/[auditId]/fact-runs` y el
     * fixture de `/api/dev/synthetic-case` recibirían 500. Por eso el
     * recorrido es `DRAFT -> PROCESSING -> FROZEN`, un paso legal por UPDATE.
     *
     * NO sella snapshot. El camino que sella es
     * `freezeFactRunWithSnapshot` (apps/web), que usa `freeze_fact_run_v1` y
     * calcula el `integrity_hash` en el servidor. Este método queda como la vía
     * legal mínima para quien no necesita el snapshot, y como la degradación
     * explícita cuando el RPC todavía no existe.
     */
    async freezeRun(runId: string): Promise<FactExtractionRun> {
      const current = await database
        .from('fact_extraction_runs')
        .select('id,state')
        .eq('id', runId)
        .limit(1);
      if (current.error) throw new Error(current.error.message ?? 'No fue posible leer fact run');
      const state = (current.data?.[0] as { state?: string } | undefined)?.state;
      if (state !== 'DRAFT' && state !== 'PROCESSING') throw new Error(`FACT_RUN_NOT_FREEZABLE: ${state ?? 'NOT_FOUND'}`);

      if (state === 'DRAFT') {
        const toProcessing = await database
          .from('fact_extraction_runs')
          .update({ state: 'PROCESSING' })
          .eq('id', runId)
          .eq('state', 'DRAFT')
          .select(runColumns)
          .single();
        if (toProcessing.error || !toProcessing.data) throw new Error(toProcessing.error?.message ?? 'No fue posible congelar fact run');
      }

      const frozen = await database
        .from('fact_extraction_runs')
        .update({ state: 'FROZEN', frozen_at: new Date().toISOString() })
        .eq('id', runId)
        .eq('state', 'PROCESSING')
        .select(runColumns)
        .single();
      if (frozen.error || !frozen.data) throw new Error(frozen.error?.message ?? 'No fue posible congelar fact run');
      return mapFactRun(frozen.data);
    },

    async listFactsByRun(runId: string): Promise<StoredFact[]> {
      const { data, error } = await database.from('facts').select(factColumns).eq('run_id', runId).order('created_at', { ascending: true }).limit(500);
      if (error) throw new Error(error.message ?? 'No fue posible leer facts');
      return (data ?? []).map(mapFact);
    },

    /**
     * Borra los facts de un Fact Run que NO esté FROZEN.
     *
     * Existe para la convergencia de la extracción: si un intento anterior
     * dejó el conjunto a medias, la identidad real de un fact extraído es "el
     * conjunto completo del run", así que se reemplaza en vez de acumular.
     *
     * El trigger `facts_guard_frozen_run_mutation` impide hacer esto sobre un
     * run FROZEN, y no se intenta eludir: un run congelado tiene snapshot
     * sellado, que es la fuente de verdad, y sus facts ya no se tocan. Por eso
     * el método filtra por estado en lugar de confiar en que el llamadorqedó bien.
     */
    async deleteFactsByRun(runId: string): Promise<number> {
      const { data, error } = await database.from('fact_extraction_runs').select('id,state').eq('id', runId).limit(1);
      if (error) throw new Error(error.message ?? 'No fue posible leer el Fact Run');
      const state = (data ?? [])[0] as { state?: string } | undefined;
      if (!state) throw new Error('FACT_RUN_NOT_FOUND');
      if (state.state === 'FROZEN') throw new Error('FACT_RUN_ALREADY_FROZEN: no se modifican los facts de un run sellado');
      const { error: deleteError } = await database.from('facts').delete().eq('run_id', runId);
      if (deleteError) throw new Error(deleteError.message ?? 'No fue posible limpiar los facts del run');
      return 0;
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
      const artifacts = await createJobRepository(database).listBaselineArtifactsByAudit(auditId);
      return stableFingerprint(artifacts.map((artifact) => ({ id: artifact.id, type: artifact.artifactType, sha256: artifact.contentSha256, evidenceId: artifact.evidenceId })));
    },
  };
}

const evidenceRequirementTypes = new Set<EvidenceRequirementType>(['DOCUMENT', 'IMAGE', 'AUDIO', 'TEXT', 'SPREADSHEET', 'PDF', 'OTHER']);
const documentRoles = new Set<DocumentRole>(['EVIDENCE', 'HUMAN_DECISION_DOCUMENT', 'ADJUDICATION_EVIDENCE']);

function validateRequirementInput(input: {
  requirementKey?: string;
  evidenceType?: string;
  documentRole?: string | null;
  required?: boolean;
  minCount?: number;
  maxCount?: number | null;
  metadata?: Record<string, unknown>;
}) {
  if (input.requirementKey !== undefined && input.requirementKey.trim().length === 0) throw new Error('INVALID_REQUIREMENT_KEY');
  if (input.evidenceType !== undefined && !evidenceRequirementTypes.has(input.evidenceType as EvidenceRequirementType)) throw new Error('INVALID_EVIDENCE_TYPE');
  if (input.documentRole !== undefined && input.documentRole !== null && !documentRoles.has(input.documentRole as DocumentRole)) throw new Error('INVALID_DOCUMENT_ROLE');
  if (input.minCount !== undefined && (!Number.isInteger(input.minCount) || input.minCount < 0)) throw new Error('INVALID_MIN_COUNT');
  if (input.maxCount !== undefined && input.maxCount !== null && (!Number.isInteger(input.maxCount) || input.maxCount < 0)) throw new Error('INVALID_MAX_COUNT');
  if (input.maxCount !== undefined && input.maxCount !== null && input.minCount !== undefined && input.maxCount < input.minCount) throw new Error('INVALID_COUNT_RANGE');
  if (input.required === true && input.minCount !== undefined && input.minCount < 1) throw new Error('REQUIRED_MIN_COUNT_MUST_BE_POSITIVE');
  if (input.metadata !== undefined && (input.metadata === null || Array.isArray(input.metadata) || typeof input.metadata !== 'object')) throw new Error('INVALID_METADATA');
}

export function createRuleGovernanceRepository(database: DatabaseClient) {
  const ruleColumns = 'id,rule_key,version,name,status,created_at';
  const requirementColumns = 'id,rule_id,requirement_key,name,description,evidence_type,evidence_code,document_role,required,min_count,max_count,order_index,metadata,created_at,updated_at';

  return {
    async createRule(input: { ruleKey: string; version: string; name: string; status?: RuleLifecycleStatus; createdBy?: string | null }): Promise<RuleRecord> {
      const { data, error } = await database.from('rules').insert([{ rule_key: input.ruleKey, version: input.version, name: input.name, status: input.status ?? 'DRAFT', created_by: input.createdBy ?? null }]).select(ruleColumns).single();
      if (error || !data) throw new Error(error?.message ?? 'No fue posible crear rule');
      return mapRule(data);
    },

    async updateRuleStatus(ruleId: string, status: RuleLifecycleStatus): Promise<RuleRecord> {
      const { data, error } = await database.from('rules').update({ status }).eq('id', ruleId).select(ruleColumns).single();
      if (error || !data) throw new Error(error?.message ?? 'No fue posible actualizar rule');
      return mapRule(data);
    },

    async listRules(options?: { ruleKey?: string; status?: RuleLifecycleStatus; limit?: number; offset?: number }): Promise<RuleRecord[]> {
      let query = database.from('rules').select(ruleColumns);
      if (options?.ruleKey) query = query.eq('rule_key', options.ruleKey);
      if (options?.status) query = query.eq('status', options.status);
      if (options?.limit !== undefined) query = query.limit(options.limit);
      if (options?.offset !== undefined) query = query.range(options.offset, options.offset + ((options.limit ?? 50) - 1));
      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw new Error(error.message ?? 'No fue posible leer rules');
      return (data ?? []).map(mapRule);
    },

    async findRuleById(ruleId: string): Promise<RuleRecord | null> {
      const { data, error } = await database.from('rules').select(ruleColumns).eq('id', ruleId).limit(1);
      if (error) throw new Error(error.message ?? 'No fue posible leer rule');
      return data?.[0] ? mapRule(data[0]) : null;
    },

    async listEvidenceRequirements(ruleId: string, options?: { limit?: number; offset?: number }): Promise<EvidenceRequirementRecord[]> {
      let query = database.from('evidence_requirements').select(requirementColumns).eq('rule_id', ruleId);
      if (options?.limit !== undefined) query = query.limit(options.limit);
      if (options?.offset !== undefined) query = query.range(options.offset, options.offset + ((options.limit ?? 50) - 1));
      const { data, error } = await query.order('order_index', { ascending: true }).order('created_at', { ascending: true });
      if (error) throw new Error(error.message ?? 'No fue posible leer evidence requirements');
      return (data ?? []).map(mapEvidenceRequirement);
    },

    async createEvidenceRequirement(input: {
      ruleId: string;
      requirementKey: string;
      name?: string | null;
      description?: string | null;
      evidenceType: EvidenceRequirementType;
      evidenceCode?: string | null;
      documentRole?: DocumentRole | null;
      required?: boolean;
      minCount?: number;
      maxCount?: number | null;
      orderIndex?: number;
      metadata?: Record<string, unknown>;
    }): Promise<EvidenceRequirementRecord> {
      const minCount = input.minCount ?? (input.required === false ? 0 : 1);
      validateRequirementInput({ ...input, minCount });
      const { data, error } = await database.from('evidence_requirements').insert([{
        rule_id: input.ruleId,
        requirement_key: input.requirementKey,
        name: input.name ?? null,
        description: input.description ?? null,
        evidence_type: input.evidenceType,
        evidence_code: input.evidenceCode ?? null,
        document_role: input.documentRole ?? null,
        required: input.required ?? true,
        min_count: minCount,
        max_count: input.maxCount ?? null,
        order_index: input.orderIndex ?? 0,
        metadata: input.metadata ?? {},
      }]).select(requirementColumns).single();
      if (error || !data) throw new Error(error?.message ?? 'No fue posible crear evidence requirement');
      return mapEvidenceRequirement(data);
    },

    async updateEvidenceRequirement(requirementId: string, patch: Partial<Omit<EvidenceRequirementRecord, 'id' | 'ruleId' | 'createdAt' | 'updatedAt'>>): Promise<EvidenceRequirementRecord> {
      validateRequirementInput({ requirementKey: patch.requirementKey, evidenceType: patch.evidenceType, documentRole: patch.documentRole, required: patch.required, minCount: patch.minCount, maxCount: patch.maxCount, metadata: patch.metadata });
      const payload: Record<string, unknown> = {};
      if (patch.requirementKey !== undefined) payload.requirement_key = patch.requirementKey;
      if (patch.name !== undefined) payload.name = patch.name;
      if (patch.description !== undefined) payload.description = patch.description;
      if (patch.evidenceType !== undefined) payload.evidence_type = patch.evidenceType;
      if (patch.evidenceCode !== undefined) payload.evidence_code = patch.evidenceCode;
      if (patch.documentRole !== undefined) payload.document_role = patch.documentRole;
      if (patch.required !== undefined) payload.required = patch.required;
      if (patch.minCount !== undefined) payload.min_count = patch.minCount;
      if (patch.maxCount !== undefined) payload.max_count = patch.maxCount;
      if (patch.orderIndex !== undefined) payload.order_index = patch.orderIndex;
      if (patch.metadata !== undefined) payload.metadata = patch.metadata;
      const { data, error } = await database.from('evidence_requirements').update(payload).eq('id', requirementId).select(requirementColumns).single();
      if (error || !data) throw new Error(error?.message ?? 'No fue posible actualizar evidence requirement');
      return mapEvidenceRequirement(data);
    },

    async deleteEvidenceRequirement(requirementId: string): Promise<void> {
      const { error } = await database.from('evidence_requirements').delete().eq('id', requirementId);
      if (error) throw new Error(error.message ?? 'No fue posible eliminar evidence requirement');
    },
  };
}

// ---------------------------------------------------------------------------
// Phase 7 — Dictamen oficial, revisión humana y workflow PDF
// ---------------------------------------------------------------------------

export interface HumanReviewRecord {
  id: string;
  auditId: string;
  machineDecision: Record<string, unknown>;
  decisionType: 'APPROVE' | 'CORRECT';
  humanOutcome: string | null;
  humanCause: string | null;
  humanReason: string | null;
  reviewedBy: string;
  reviewedAt: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
}

interface HumanReviewRow {
  id: string;
  audit_id: string;
  machine_decision: Record<string, unknown>;
  decision_type: 'APPROVE' | 'CORRECT';
  human_outcome: string | null;
  human_cause: string | null;
  human_reason: string | null;
  reviewed_by: string;
  reviewed_at: string;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export interface EvidenceSelectionRecord {
  id: string;
  auditId: string;
  evidenceId: string;
  artifactId: string | null;
  sha256: string | null;
  page: number | null;
  region: Record<string, unknown> | null;
  timestampStart: number | null;
  timestampEnd: number | null;
  cell: string | null;
  originalFilename: string | null;
  selectedBy: string;
  selectedAt: string;
}

interface EvidenceSelectionRow {
  id: string;
  audit_id: string;
  evidence_id: string;
  artifact_id: string | null;
  sha256: string | null;
  page: number | null;
  region: Record<string, unknown> | null;
  timestamp_start: number | null;
  timestamp_end: number | null;
  cell: string | null;
  original_filename: string | null;
  selected_by: string;
  selected_at: string;
}

export interface ReportSnapshotRecord {
  id: string;
  auditId: string;
  factRunId: string | null;
  engineRunId: string;
  policyCode: string;
  policyVersion: string;
  snapshotFingerprint: string;
  machine: Record<string, unknown>;
  human: Record<string, unknown> | null;
  manualComments: Record<string, unknown>;
  selectedEvidence: Record<string, unknown>[];
  templateHash: string;
  ruleTrace: Record<string, unknown>;
  status: 'DRAFT' | 'FINAL';
  approvedBy: string | null;
  approvedAt: string | null;
  createdBy: string;
  createdAt: string;
}

interface ReportSnapshotRow {
  id: string;
  audit_id: string;
  fact_run_id: string | null;
  engine_run_id: string;
  policy_code: string;
  policy_version: string;
  snapshot_fingerprint: string;
  machine: Record<string, unknown>;
  human: Record<string, unknown> | null;
  manual_comments: Record<string, unknown>;
  selected_evidence: Record<string, unknown>[];
  template_hash: string;
  rule_trace: Record<string, unknown>;
  status: 'DRAFT' | 'FINAL';
  approved_by: string | null;
  approved_at: string | null;
  created_by: string;
  created_at: string;
}

export interface DictamenDocumentRecord {
  id: string;
  snapshotId: string;
  auditId: string;
  kind: 'DRAFT' | 'FINAL';
  docFingerprint: string;
  pdfSha256: string;
  storageBucket: string;
  storageKey: string;
  templateHash: string;
  generatedBy: string;
  generatedAt: string;
  createdAt: string;
}

interface DictamenDocumentRow {
  id: string;
  snapshot_id: string;
  audit_id: string;
  kind: 'DRAFT' | 'FINAL';
  doc_fingerprint: string;
  pdf_sha256: string;
  storage_bucket: string;
  storage_key: string;
  template_hash: string;
  generated_by: string;
  generated_at: string;
  created_at: string;
}

const mapHumanReview = (row: HumanReviewRow): HumanReviewRecord => ({
  id: row.id,
  auditId: row.audit_id,
  machineDecision: row.machine_decision,
  decisionType: row.decision_type,
  humanOutcome: row.human_outcome,
  humanCause: row.human_cause,
  humanReason: row.human_reason,
  reviewedBy: row.reviewed_by,
  reviewedAt: row.reviewed_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  updatedBy: row.updated_by,
});

const mapEvidenceSelection = (row: EvidenceSelectionRow): EvidenceSelectionRecord => ({
  id: row.id,
  auditId: row.audit_id,
  evidenceId: row.evidence_id,
  artifactId: row.artifact_id,
  sha256: row.sha256,
  page: row.page,
  region: row.region,
  timestampStart: row.timestamp_start,
  timestampEnd: row.timestamp_end,
  cell: row.cell,
  originalFilename: row.original_filename,
  selectedBy: row.selected_by,
  selectedAt: row.selected_at,
});

const mapReportSnapshot = (row: ReportSnapshotRow): ReportSnapshotRecord => ({
  id: row.id,
  auditId: row.audit_id,
  factRunId: row.fact_run_id,
  engineRunId: row.engine_run_id,
  policyCode: row.policy_code,
  policyVersion: row.policy_version,
  snapshotFingerprint: row.snapshot_fingerprint,
  machine: row.machine,
  human: row.human,
  manualComments: row.manual_comments,
  selectedEvidence: row.selected_evidence,
  templateHash: row.template_hash,
  ruleTrace: row.rule_trace,
  status: row.status,
  approvedBy: row.approved_by,
  approvedAt: row.approved_at,
  createdBy: row.created_by,
  createdAt: row.created_at,
});

const mapDictamenDocument = (row: DictamenDocumentRow): DictamenDocumentRecord => ({
  id: row.id,
  snapshotId: row.snapshot_id,
  auditId: row.audit_id,
  kind: row.kind,
  docFingerprint: row.doc_fingerprint,
  pdfSha256: row.pdf_sha256,
  storageBucket: row.storage_bucket,
  storageKey: row.storage_key,
  templateHash: row.template_hash,
  generatedBy: row.generated_by,
  generatedAt: row.generated_at,
  createdAt: row.created_at,
});

export function createHumanReviewRepository(database: DatabaseClient) {
  const columns = 'id,audit_id,machine_decision,decision_type,human_outcome,human_cause,human_reason,reviewed_by,reviewed_at,created_at,updated_at,updated_by';

  return {
    async findByAudit(auditId: string): Promise<HumanReviewRecord | null> {
      const { data, error } = await database
        .from('human_reviews')
        .select(columns)
        .eq('audit_id', auditId)
        .limit(1);
      if (error) throw new Error(error.message ?? 'No fue posible leer la revision humana');
      return data?.[0] ? mapHumanReview(data[0]) : null;
    },

    async upsert(input: {
      auditId: string;
      machineDecision: Record<string, unknown>;
      decisionType: 'APPROVE' | 'CORRECT';
      humanOutcome?: string | null;
      humanCause?: string | null;
      humanReason?: string | null;
      reviewedBy: string;
      reviewedAt: string;
    }): Promise<HumanReviewRecord> {
      const payload = {
        audit_id: input.auditId,
        machine_decision: input.machineDecision,
        decision_type: input.decisionType,
        human_outcome: input.humanOutcome ?? null,
        human_cause: input.humanCause ?? null,
        human_reason: input.humanReason ?? null,
        reviewed_by: input.reviewedBy,
        reviewed_at: input.reviewedAt,
        updated_by: input.reviewedBy,
      };
      const existing = await this.findByAudit(input.auditId);
      if (existing) {
        const { data, error } = await database
          .from('human_reviews')
          .update(payload)
          .eq('audit_id', input.auditId)
          .select(columns)
          .single();
        if (error || !data) throw new Error(error?.message ?? 'No fue posible actualizar la revision humana');
        return mapHumanReview(data);
      }
      const { data, error } = await database
        .from('human_reviews')
        .insert([payload])
        .select(columns)
        .single();
      if (error || !data) throw new Error(error?.message ?? 'No fue posible crear la revision humana');
      return mapHumanReview(data);
    },
  };
}

export function createEvidenceSelectionRepository(database: DatabaseClient) {
  const columns = 'id,audit_id,evidence_id,artifact_id,sha256,page,region,timestamp_start,timestamp_end,cell,original_filename,selected_by,selected_at';

  return {
    async listByAudit(auditId: string): Promise<EvidenceSelectionRecord[]> {
      const { data, error } = await database
        .from('audit_evidence_selection')
        .select(columns)
        .eq('audit_id', auditId)
        .order('selected_at', { ascending: true })
        .limit(200);
      if (error) throw new Error(error.message ?? 'No fue posible leer la seleccion de evidencias');
      return (data ?? []).map(mapEvidenceSelection);
    },

    /** Reemplaza toda la selección de la auditoría (commit único por petición). */
    async replaceForAudit(auditId: string, items: Array<{
      evidenceId: string;
      artifactId?: string | null;
      sha256?: string | null;
      page?: number | null;
      region?: Record<string, unknown> | null;
      timestampStart?: number | null;
      timestampEnd?: number | null;
      cell?: string | null;
      originalFilename?: string | null;
    }>, selectedBy: string): Promise<EvidenceSelectionRecord[]> {
      const { error: delError } = await database
        .from('audit_evidence_selection')
        .delete()
        .eq('audit_id', auditId);
      if (delError) throw new Error(delError.message ?? 'No fue posible limpiar la seleccion previa');
      if (items.length === 0) return [];

      const { data, error } = await database
        .from('audit_evidence_selection')
        .insert(items.map((item) => ({
          audit_id: auditId,
          evidence_id: item.evidenceId,
          artifact_id: item.artifactId ?? null,
          sha256: item.sha256 ?? null,
          page: item.page ?? null,
          region: item.region ?? null,
          timestamp_start: item.timestampStart ?? null,
          timestamp_end: item.timestampEnd ?? null,
          cell: item.cell ?? null,
          original_filename: item.originalFilename ?? null,
          selected_by: selectedBy,
        })))
        .select(columns);
      if (error || !data) throw new Error(error?.message ?? 'No fue posible guardar la seleccion de evidencias');
      return data.map(mapEvidenceSelection);
    },
  };
}

export function createReportSnapshotRepository(database: DatabaseClient) {
  const columns = 'id,audit_id,fact_run_id,engine_run_id,policy_code,policy_version,snapshot_fingerprint,machine,human,manual_comments,selected_evidence,template_hash,rule_trace,status,approved_by,approved_at,created_by,created_at';

  return {
    async findLatestByAudit(auditId: string): Promise<ReportSnapshotRecord | null> {
      const { data, error } = await database
        .from('report_snapshots')
        .select(columns)
        .eq('audit_id', auditId)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw new Error(error.message ?? 'No fue posible leer el snapshot');
      return data?.[0] ? mapReportSnapshot(data[0]) : null;
    },

    async findById(snapshotId: string): Promise<ReportSnapshotRecord | null> {
      const { data, error } = await database
        .from('report_snapshots')
        .select(columns)
        .eq('id', snapshotId)
        .limit(1);
      if (error) throw new Error(error.message ?? 'No fue posible leer el snapshot');
      return data?.[0] ? mapReportSnapshot(data[0]) : null;
    },

    async create(input: {
      auditId: string;
      factRunId: string | null;
      engineRunId: string;
      policyCode: string;
      policyVersion: string;
      snapshotFingerprint: string;
      machine: Record<string, unknown>;
      human: Record<string, unknown> | null;
      manualComments: Record<string, unknown>;
      selectedEvidence: Record<string, unknown>[];
      templateHash: string;
      ruleTrace: Record<string, unknown>;
      createdBy: string;
    }): Promise<ReportSnapshotRecord> {
      const { data, error } = await database
        .from('report_snapshots')
        .insert([{
          audit_id: input.auditId,
          fact_run_id: input.factRunId,
          engine_run_id: input.engineRunId,
          policy_code: input.policyCode,
          policy_version: input.policyVersion,
          snapshot_fingerprint: input.snapshotFingerprint,
          machine: input.machine,
          human: input.human,
          manual_comments: input.manualComments,
          selected_evidence: input.selectedEvidence,
          template_hash: input.templateHash,
          rule_trace: input.ruleTrace,
          status: 'DRAFT',
          created_by: input.createdBy,
        }])
        .select(columns)
        .single();
      if (error || !data) throw new Error(error?.message ?? 'No fue posible crear el snapshot');
      return mapReportSnapshot(data);
    },

    /** Marca el snapshot como FINAL (uno por auditoría; el índice parcial lo garantiza). */
    async markFinal(snapshotId: string, approvedBy: string): Promise<ReportSnapshotRecord> {
      const { data, error } = await database
        .from('report_snapshots')
        .update({ status: 'FINAL', approved_by: approvedBy, approved_at: new Date().toISOString() })
        .eq('id', snapshotId)
        .select(columns)
        .single();
      if (error || !data) throw new Error(error?.message ?? 'No fue posible aprobar el snapshot');
      return mapReportSnapshot(data);
    },
  };
}

export function createDictamenDocumentRepository(database: DatabaseClient) {
  const columns = 'id,snapshot_id,audit_id,kind,doc_fingerprint,pdf_sha256,storage_bucket,storage_key,template_hash,generated_by,generated_at,created_at';

  return {
    async findForSnapshot(snapshotId: string, kind: 'DRAFT' | 'FINAL'): Promise<DictamenDocumentRecord | null> {
      const { data, error } = await database
        .from('dictamen_documents')
        .select(columns)
        .eq('snapshot_id', snapshotId)
        .eq('kind', kind)
        .limit(1);
      if (error) throw new Error(error.message ?? 'No fue posible leer el documento');
      return data?.[0] ? mapDictamenDocument(data[0]) : null;
    },

    async listByAudit(auditId: string): Promise<DictamenDocumentRecord[]> {
      const { data, error } = await database
        .from('dictamen_documents')
        .select(columns)
        .eq('audit_id', auditId)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message ?? 'No fue posible leer los documentos');
      return (data ?? []).map(mapDictamenDocument);
    },

    /** Inserta el documento (idempotente: si ya existe el mismo doc_fingerprint, no duplica). */
    async createIfAbsent(input: {
      snapshotId: string;
      auditId: string;
      kind: 'DRAFT' | 'FINAL';
      docFingerprint: string;
      pdfSha256: string;
      storageBucket: string;
      storageKey: string;
      templateHash: string;
      generatedBy: string;
      generatedAt: string;
    }): Promise<DictamenDocumentRecord | null> {
      const existing = await this.findForSnapshot(input.snapshotId, input.kind);
      if (existing) return existing.pdfSha256 === input.pdfSha256 ? existing : null;
      const { data, error } = await database
        .from('dictamen_documents')
        .insert([{
          snapshot_id: input.snapshotId,
          audit_id: input.auditId,
          kind: input.kind,
          doc_fingerprint: input.docFingerprint,
          pdf_sha256: input.pdfSha256,
          storage_bucket: input.storageBucket,
          storage_key: input.storageKey,
          template_hash: input.templateHash,
          generated_by: input.generatedBy,
          generated_at: input.generatedAt,
        }])
        .select(columns)
        .single();
      if (error || !data) throw new Error(error?.message ?? 'No fue posible guardar el documento');
      return mapDictamenDocument(data);
    },
  };
}

// ---------------------------------------------------------------------------
// Policy Foundation — AI_DECISION_V1 durable e inmutable (append-only)
// ---------------------------------------------------------------------------

/** Código de error cuando la identidad (audit, version, input fingerprint) ya existe. */
export const AI_DECISION_V1_ALREADY_EXISTS = 'AI_DECISION_V1_ALREADY_EXISTS' as const;

export const AI_DECISION_SNAPSHOTS_TABLE = 'ai_decision_snapshots' as const;

/**
 * Snapshot durable de una decisión de máquina. `hash` cubre TODOS los campos
 * anteriores; la fila es append-only y jamás se actualiza ni se borra.
 */
export interface AiDecisionV1Snapshot {
  auditId: string;
  factRunId: string;
  decisionVersion: 'AI_DECISION_V1';
  policyCode: string;
  policyVersion: string;
  policySourceId: string;
  engineVersion: string;
  promptVersion: string | null;
  extractorVersion: string;
  provider: string | null;
  model: string | null;
  inputFingerprint: string;
  decisionSnapshot: Record<string, unknown>;
  ruleTraceSnapshot: Record<string, unknown>;
  evidenceSnapshot: Record<string, unknown>;
  createdAt: string;
  hash: string;
}

interface AiDecisionV1SnapshotRow {
  audit_id: string;
  fact_run_id: string;
  decision_version: AiDecisionV1Snapshot['decisionVersion'];
  policy_code: string;
  policy_version: string;
  policy_source_id: string;
  engine_version: string;
  prompt_version: string | null;
  extractor_version: string;
  provider: string | null;
  model: string | null;
  input_fingerprint: string;
  decision_snapshot: Record<string, unknown>;
  rule_trace_snapshot: Record<string, unknown>;
  evidence_snapshot: Record<string, unknown>;
  created_at: string;
  hash: string;
}

const aiDecisionV1SnapshotColumns = 'audit_id,fact_run_id,decision_version,policy_code,policy_version,policy_source_id,engine_version,prompt_version,extractor_version,provider,model,input_fingerprint,decision_snapshot,rule_trace_snapshot,evidence_snapshot,created_at,hash';

function mapAiDecisionV1Snapshot(row: AiDecisionV1SnapshotRow): AiDecisionV1Snapshot {
  return {
    auditId: row.audit_id,
    factRunId: row.fact_run_id,
    decisionVersion: row.decision_version,
    policyCode: row.policy_code,
    policyVersion: row.policy_version,
    policySourceId: row.policy_source_id,
    engineVersion: row.engine_version,
    promptVersion: row.prompt_version,
    extractorVersion: row.extractor_version,
    provider: row.provider,
    model: row.model,
    inputFingerprint: row.input_fingerprint,
    decisionSnapshot: row.decision_snapshot,
    ruleTraceSnapshot: row.rule_trace_snapshot,
    evidenceSnapshot: row.evidence_snapshot,
    createdAt: row.created_at,
    hash: row.hash,
  };
}

/** 23505 = unique_violation de Postgres: la restricción de identidad ya se cumplió. */
function isUniqueViolation(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === '23505') return true;
  return (error.message ?? '').includes('duplicate key value violates unique constraint');
}

/**
 * Persistencia de los fundamentos de política.
 *
 * `appendAiDecisionV1` es de uso explícito: no hay caller productivo. La
 * identidad (audit_id, decision_version, input_fingerprint) se comprueba antes
 * de insertar y además se traduce la violación de unicidad del servidor, de
 * modo que la fila existente nunca se sobrescribe.
 */
export function createPolicyFoundationRepository(database: DatabaseClient) {
  return {
    async appendAiDecisionV1(snapshot: AiDecisionV1Snapshot): Promise<AiDecisionV1Snapshot> {
      const { data: existing, error: readError } = await database
        .from(AI_DECISION_SNAPSHOTS_TABLE)
        .select(aiDecisionV1SnapshotColumns)
        .eq('audit_id', snapshot.auditId)
        .eq('decision_version', snapshot.decisionVersion)
        .eq('input_fingerprint', snapshot.inputFingerprint)
        .limit(1);

      if (readError) throw new Error(readError.message ?? 'No fue posible leer el snapshot de decisión AI');
      if (Array.isArray(existing) && existing.length > 0) throw new Error(AI_DECISION_V1_ALREADY_EXISTS);

      const { data, error } = await database
        .from(AI_DECISION_SNAPSHOTS_TABLE)
        .insert([{
          audit_id: snapshot.auditId,
          fact_run_id: snapshot.factRunId,
          decision_version: snapshot.decisionVersion,
          policy_code: snapshot.policyCode,
          policy_version: snapshot.policyVersion,
          policy_source_id: snapshot.policySourceId,
          engine_version: snapshot.engineVersion,
          prompt_version: snapshot.promptVersion,
          extractor_version: snapshot.extractorVersion,
          provider: snapshot.provider,
          model: snapshot.model,
          input_fingerprint: snapshot.inputFingerprint,
          decision_snapshot: snapshot.decisionSnapshot,
          rule_trace_snapshot: snapshot.ruleTraceSnapshot,
          evidence_snapshot: snapshot.evidenceSnapshot,
          created_at: snapshot.createdAt,
          hash: snapshot.hash,
        }])
        .select(aiDecisionV1SnapshotColumns)
        .single();

      if (error) {
        if (isUniqueViolation({ code: error.code ?? null, message: error.message ?? null })) throw new Error(AI_DECISION_V1_ALREADY_EXISTS);
        throw new Error(error.message ?? 'No fue posible guardar el snapshot de decisión AI');
      }
      if (!data) throw new Error('No fue posible guardar el snapshot de decisión AI');
      return mapAiDecisionV1Snapshot(data);
    },
  };
}

// ---------------------------------------------------------------------------
// Phase 9 — Comparación IA vs Dictamen humano
// ---------------------------------------------------------------------------

interface AuditRunRow {
  id: string;
  audit_id: string;
  run_type: AuditRunType;
  status: AuditRunStatus;
  parent_run_id: string | null;
  fact_run_id: string | null;
  engine_run_id: string | null;
  job_id: string | null;
  policy_code: string | null;
  policy_version: string | null;
  prompt_version: string | null;
  model: string | null;
  provider: string | null;
  input_fingerprint: string | null;
  result: Record<string, unknown>;
  created_by: string;
  created_at: string;
  completed_at: string | null;
}

function mapAuditRun(row: AuditRunRow): AuditRun {
  return {
    id: row.id,
    auditId: row.audit_id,
    runType: row.run_type,
    status: row.status,
    parentRunId: row.parent_run_id,
    factRunId: row.fact_run_id,
    engineRunId: row.engine_run_id,
    jobId: row.job_id,
    policyCode: row.policy_code,
    policyVersion: row.policy_version,
    promptVersion: row.prompt_version,
    model: row.model,
    provider: row.provider,
    inputFingerprint: row.input_fingerprint,
    result: row.result ?? {},
    createdBy: row.created_by,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

const auditRunColumns = 'id,audit_id,run_type,status,parent_run_id,fact_run_id,engine_run_id,job_id,policy_code,policy_version,prompt_version,model,provider,input_fingerprint,result,created_by,created_at,completed_at';

export function createAuditRunRepository(database: DatabaseClient) {
  return {
    async listByAudit(auditId: string): Promise<AuditRun[]> {
      const { data, error } = await database
        .from('audit_runs')
        .select(auditRunColumns)
        .eq('audit_id', auditId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message ?? 'No fue posible leer audit runs');
      return (data ?? []).map(mapAuditRun);
    },

    async findLatestByType(auditId: string, runType: AuditRunType): Promise<AuditRun | null> {
      const { data, error } = await database
        .from('audit_runs')
        .select(auditRunColumns)
        .eq('audit_id', auditId)
        .eq('run_type', runType)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw new Error(error.message ?? 'No fue posible leer audit run');
      return data?.[0] ? mapAuditRun(data[0]) : null;
    },

    async findById(runId: string): Promise<AuditRun | null> {
      const { data, error } = await database
        .from('audit_runs')
        .select(auditRunColumns)
        .eq('id', runId)
        .limit(1);
      if (error) throw new Error(error.message ?? 'No fue posible leer audit run');
      return data?.[0] ? mapAuditRun(data[0]) : null;
    },

    async create(input: {
      auditId: string;
      runType: AuditRunType;
      status?: AuditRunStatus;
      parentRunId?: string | null;
      factRunId?: string | null;
      engineRunId?: string | null;
      jobId?: string | null;
      policyCode?: string | null;
      policyVersion?: string | null;
      promptVersion?: string | null;
      model?: string | null;
      provider?: string | null;
      inputFingerprint?: string | null;
      result?: Record<string, unknown>;
      createdBy: string;
    }): Promise<AuditRun> {
      const { data, error } = await database
        .from('audit_runs')
        .insert([{
          audit_id: input.auditId,
          run_type: input.runType,
          status: input.status ?? 'PENDING',
          parent_run_id: input.parentRunId ?? null,
          fact_run_id: input.factRunId ?? null,
          engine_run_id: input.engineRunId ?? null,
          job_id: input.jobId ?? null,
          policy_code: input.policyCode ?? null,
          policy_version: input.policyVersion ?? null,
          prompt_version: input.promptVersion ?? null,
          model: input.model ?? null,
          provider: input.provider ?? null,
          input_fingerprint: input.inputFingerprint ?? null,
          result: input.result ?? {},
          created_by: input.createdBy,
        }])
        .select(auditRunColumns)
        .single();
      if (error || !data) throw new Error(error?.message ?? 'No fue posible crear audit run');
      return mapAuditRun(data);
    },

    async mark(id: string, status: AuditRunStatus, result?: Record<string, unknown>, completed?: boolean): Promise<AuditRun> {
      const { data, error } = await database
        .from('audit_runs')
        .update({
          status,
          ...(result !== undefined ? { result } : {}),
          ...(completed ? { completed_at: new Date().toISOString() } : {}),
        })
        .eq('id', id)
        .select(auditRunColumns)
        .single();
      if (error || !data) throw new Error(error?.message ?? 'No fue posible actualizar audit run');
      return mapAuditRun(data);
    },

    async findBaselineByEngineRun(engineRunId: string): Promise<AuditRun | null> {
      const { data, error } = await database
        .from('audit_runs')
        .select(auditRunColumns)
        .eq('engine_run_id', engineRunId)
        .eq('run_type', 'AI_BASELINE')
        .limit(1);
      if (error) throw new Error(error.message ?? 'No fue posible leer audit run baseline');
      return data?.[0] ? mapAuditRun(data[0]) : null;
    },
  };
}

export interface HumanClaimRecord {
  id: string;
  statement: string;
  classification: HumanClaimClassification;
  source?: string;
}

interface HumanDecisionExtractRow {
  id: string;
  audit_id: string;
  run_id: string;
  evidence_id: string | null;
  extractor_version: string;
  resolution: string | null;
  decision_date: string | null;
  motives: unknown;
  conditions_considered: unknown;
  dates_considered: unknown;
  facts: unknown;
  evidence_mentioned: unknown;
  rules_mentioned: unknown;
  observations: unknown;
  areas_involved: unknown;
  external_information: unknown;
  provider: string | null;
  model: string | null;
  prompt_version: string | null;
  raw_text_hash: string | null;
  created_by: string;
  created_at: string;
}

export interface HumanDecisionExtract {
  id: string;
  auditId: string;
  runId: string;
  evidenceId: string | null;
  extractorVersion: string;
  resolution: string | null;
  decisionDate: string | null;
  motives: string[];
  conditionsConsidered: string[];
  datesConsidered: string[];
  facts: HumanClaimRecord[];
  evidenceMentioned: string[];
  rulesMentioned: string[];
  observations: string[];
  areasInvolved: string[];
  externalInformation: string[];
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  rawTextHash: string | null;
  createdBy: string;
  createdAt: string;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function mapHumanDecisionExtract(row: HumanDecisionExtractRow): HumanDecisionExtract {
  return {
    id: row.id,
    auditId: row.audit_id,
    runId: row.run_id,
    evidenceId: row.evidence_id,
    extractorVersion: row.extractor_version,
    resolution: row.resolution,
    decisionDate: row.decision_date,
    motives: asStringArray(row.motives),
    conditionsConsidered: asStringArray(row.conditions_considered),
    datesConsidered: asStringArray(row.dates_considered),
    facts: Array.isArray(row.facts) ? (row.facts as HumanClaimRecord[]) : [],
    evidenceMentioned: asStringArray(row.evidence_mentioned),
    rulesMentioned: asStringArray(row.rules_mentioned),
    observations: asStringArray(row.observations),
    areasInvolved: asStringArray(row.areas_involved),
    externalInformation: asStringArray(row.external_information),
    provider: row.provider,
    model: row.model,
    promptVersion: row.prompt_version,
    rawTextHash: row.raw_text_hash,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

const humanDecisionExtractColumns = 'id,audit_id,run_id,evidence_id,extractor_version,resolution,decision_date,motives,conditions_considered,dates_considered,facts,evidence_mentioned,rules_mentioned,observations,areas_involved,external_information,provider,model,prompt_version,raw_text_hash,created_by,created_at';

export function createHumanDecisionExtractRepository(database: DatabaseClient) {
  return {
    async create(input: {
      auditId: string;
      runId: string;
      evidenceId?: string | null;
      extractorVersion: string;
      resolution?: string | null;
      decisionDate?: string | null;
      motives?: string[];
      conditionsConsidered?: string[];
      datesConsidered?: string[];
      facts?: HumanClaimRecord[];
      evidenceMentioned?: string[];
      rulesMentioned?: string[];
      observations?: string[];
      areasInvolved?: string[];
      externalInformation?: string[];
      provider?: string | null;
      model?: string | null;
      promptVersion?: string | null;
      rawTextHash?: string | null;
      createdBy: string;
    }): Promise<HumanDecisionExtract> {
      const { data, error } = await database
        .from('human_decision_extracts')
        .insert([{
          audit_id: input.auditId,
          run_id: input.runId,
          evidence_id: input.evidenceId ?? null,
          extractor_version: input.extractorVersion,
          resolution: input.resolution ?? null,
          decision_date: input.decisionDate ?? null,
          motives: input.motives ?? [],
          conditions_considered: input.conditionsConsidered ?? [],
          dates_considered: input.datesConsidered ?? [],
          facts: input.facts ?? [],
          evidence_mentioned: input.evidenceMentioned ?? [],
          rules_mentioned: input.rulesMentioned ?? [],
          observations: input.observations ?? [],
          areas_involved: input.areasInvolved ?? [],
          external_information: input.externalInformation ?? [],
          provider: input.provider ?? null,
          model: input.model ?? null,
          prompt_version: input.promptVersion ?? null,
          raw_text_hash: input.rawTextHash ?? null,
          created_by: input.createdBy,
        }])
        .select(humanDecisionExtractColumns)
        .single();
      if (error || !data) throw new Error(error?.message ?? 'No fue posible crear la extracción humana');
      return mapHumanDecisionExtract(data);
    },

    async findByRun(runId: string): Promise<HumanDecisionExtract | null> {
      const { data, error } = await database
        .from('human_decision_extracts')
        .select(humanDecisionExtractColumns)
        .eq('run_id', runId)
        .limit(1);
      if (error) throw new Error(error.message ?? 'No fue posible leer la extracción humana');
      return data?.[0] ? mapHumanDecisionExtract(data[0]) : null;
    },

    async findLatestByAudit(auditId: string): Promise<HumanDecisionExtract | null> {
      const { data, error } = await database
        .from('human_decision_extracts')
        .select(humanDecisionExtractColumns)
        .eq('audit_id', auditId)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw new Error(error.message ?? 'No fue posible leer la extracción humana');
      return data?.[0] ? mapHumanDecisionExtract(data[0]) : null;
    },
  };
}

export interface AuditComparison {
  id: string;
  auditId: string;
  runId: string;
  aiRunId: string;
  humanRunId: string;
  status: ComparisonStatus;
  discrepancyType: DiscrepancyType | null;
  explanation: string | null;
  counterfactuals: string[];
  rulesInvolved: string[];
  unverifiedHumanClaims: HumanClaimRecord[];
  missingEvidence: string[];
  aiOutcome: string | null;
  humanOutcome: string | null;
  aiOutcomeStatus: string | null;
  humanResolution: string | null;
  evidenceRefs: string[];
  createdAt: string;
}

interface AuditComparisonRow {
  id: string;
  audit_id: string;
  run_id: string;
  ai_run_id: string;
  human_run_id: string;
  status: ComparisonStatus;
  discrepancy_type: DiscrepancyType | null;
  explanation: string | null;
  counterfactuals: unknown;
  rules_involved: unknown;
  unverified_human_claims: unknown;
  missing_evidence: unknown;
  ai_outcome: string | null;
  human_outcome: string | null;
  ai_outcome_status: string | null;
  human_resolution: string | null;
  evidence_refs: unknown;
  created_at: string;
}

function mapAuditComparison(row: AuditComparisonRow): AuditComparison {
  return {
    id: row.id,
    auditId: row.audit_id,
    runId: row.run_id,
    aiRunId: row.ai_run_id,
    humanRunId: row.human_run_id,
    status: row.status,
    discrepancyType: row.discrepancy_type,
    explanation: row.explanation,
    counterfactuals: asStringArray(row.counterfactuals),
    rulesInvolved: asStringArray(row.rules_involved),
    unverifiedHumanClaims: Array.isArray(row.unverified_human_claims) ? (row.unverified_human_claims as HumanClaimRecord[]) : [],
    missingEvidence: asStringArray(row.missing_evidence),
    aiOutcome: row.ai_outcome,
    humanOutcome: row.human_outcome,
    aiOutcomeStatus: row.ai_outcome_status,
    humanResolution: row.human_resolution,
    evidenceRefs: asStringArray(row.evidence_refs),
    createdAt: row.created_at,
  };
}

const auditComparisonColumns = 'id,audit_id,run_id,ai_run_id,human_run_id,status,discrepancy_type,explanation,counterfactuals,rules_involved,unverified_human_claims,missing_evidence,ai_outcome,human_outcome,ai_outcome_status,human_resolution,evidence_refs,created_at';

export function createComparisonRepository(database: DatabaseClient) {
  return {
    async create(input: {
      auditId: string;
      runId: string;
      aiRunId: string;
      humanRunId: string;
      status: ComparisonStatus;
      discrepancyType?: DiscrepancyType | null;
      explanation?: string | null;
      counterfactuals?: string[];
      rulesInvolved?: string[];
      unverifiedHumanClaims?: HumanClaimRecord[];
      missingEvidence?: string[];
      aiOutcome?: string | null;
      humanOutcome?: string | null;
      aiOutcomeStatus?: string | null;
      humanResolution?: string | null;
      evidenceRefs?: string[];
    }): Promise<AuditComparison> {
      const { data, error } = await database
        .from('audit_comparisons')
        .insert([{
          audit_id: input.auditId,
          run_id: input.runId,
          ai_run_id: input.aiRunId,
          human_run_id: input.humanRunId,
          status: input.status,
          discrepancy_type: input.discrepancyType ?? null,
          explanation: input.explanation ?? null,
          counterfactuals: input.counterfactuals ?? [],
          rules_involved: input.rulesInvolved ?? [],
          unverified_human_claims: input.unverifiedHumanClaims ?? [],
          missing_evidence: input.missingEvidence ?? [],
          ai_outcome: input.aiOutcome ?? null,
          human_outcome: input.humanOutcome ?? null,
          ai_outcome_status: input.aiOutcomeStatus ?? null,
          human_resolution: input.humanResolution ?? null,
          evidence_refs: input.evidenceRefs ?? [],
        }])
        .select(auditComparisonColumns)
        .single();
      if (error || !data) throw new Error(error?.message ?? 'No fue posible crear la comparación');
      return mapAuditComparison(data);
    },

    async findLatestByAudit(auditId: string): Promise<AuditComparison | null> {
      const { data, error } = await database
        .from('audit_comparisons')
        .select(auditComparisonColumns)
        .eq('audit_id', auditId)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw new Error(error.message ?? 'No fue posible leer la comparación');
      return data?.[0] ? mapAuditComparison(data[0]) : null;
    },
  };
}

export interface FinalAdjudication {
  id: string;
  auditId: string;
  runId: string;
  adjudicationType: FinalAdjudicationType;
  finalOutcome: string | null;
  comment: string | null;
  evidenceIds: string[];
  adjudicatedBy: string;
  adjudicatedAt: string;
  createdAt: string;
}

interface FinalAdjudicationRow {
  id: string;
  audit_id: string;
  run_id: string;
  adjudication_type: FinalAdjudicationType;
  final_outcome: string | null;
  comment: string | null;
  evidence_ids: unknown;
  adjudicated_by: string;
  adjudicated_at: string;
  created_at: string;
}

function mapFinalAdjudication(row: FinalAdjudicationRow): FinalAdjudication {
  return {
    id: row.id,
    auditId: row.audit_id,
    runId: row.run_id,
    adjudicationType: row.adjudication_type,
    finalOutcome: row.final_outcome,
    comment: row.comment,
    evidenceIds: asStringArray(row.evidence_ids),
    adjudicatedBy: row.adjudicated_by,
    adjudicatedAt: row.adjudicated_at,
    createdAt: row.created_at,
  };
}

const finalAdjudicationColumns = 'id,audit_id,run_id,adjudication_type,final_outcome,comment,evidence_ids,adjudicated_by,adjudicated_at,created_at';

export function createAdjudicationRepository(database: DatabaseClient) {
  return {
    async create(input: {
      auditId: string;
      runId: string;
      adjudicationType: FinalAdjudicationType;
      finalOutcome?: string | null;
      comment?: string | null;
      evidenceIds?: string[];
      adjudicatedBy: string;
    }): Promise<FinalAdjudication> {
      const { data, error } = await database
        .from('final_adjudications')
        .insert([{
          audit_id: input.auditId,
          run_id: input.runId,
          adjudication_type: input.adjudicationType,
          final_outcome: input.finalOutcome ?? null,
          comment: input.comment ?? null,
          evidence_ids: input.evidenceIds ?? [],
          adjudicated_by: input.adjudicatedBy,
        }])
        .select(finalAdjudicationColumns)
        .single();
      if (error || !data) throw new Error(error?.message ?? 'No fue posible registrar la adjudicación');
      return mapFinalAdjudication(data);
    },

    async findLatestByAudit(auditId: string): Promise<FinalAdjudication | null> {
      const { data, error } = await database
        .from('final_adjudications')
        .select(finalAdjudicationColumns)
        .eq('audit_id', auditId)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw new Error(error.message ?? 'No fue posible leer la adjudicación');
      return data?.[0] ? mapFinalAdjudication(data[0]) : null;
    },
  };
}
