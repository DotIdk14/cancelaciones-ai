export type AuditStatus = 'DRAFT' | 'READY' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type UserRole = 'AUDITOR' | 'OWNER';

export interface Audit {
  id: string;
  displayName: string | null;
  status: AuditStatus;
  externalCaseId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Evidence {
  id: string;
  auditId: string;
  originalFilename: string;
  safeFilename: string;
  mimeType: string;
  detectedMimeType: string;
  sizeBytes: number;
  sha256: string;
  storageBucket: string;
  storageKey: string | null;
  status: EvidenceStatus;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
}

export type EvidenceStatus = 'PENDING' | 'STORED' | 'FAILED' | 'RETIRED';

export const MAX_EVIDENCE_FILE_BYTES = 50 * 1024 * 1024;
export const EVIDENCE_BUCKET = 'dictamen-evidencias';

export const ALLOWED_EVIDENCE_TYPES = [
  { extension: 'pdf', mimeType: 'application/pdf', signatures: ['25504446'] },
  { extension: 'png', mimeType: 'image/png', signatures: ['89504e47'] },
  { extension: 'jpg', mimeType: 'image/jpeg', signatures: ['ffd8ff'] },
  { extension: 'jpeg', mimeType: 'image/jpeg', signatures: ['ffd8ff'] },
  { extension: 'webp', mimeType: 'image/webp', signatures: ['52494646'] },
  { extension: 'mp3', mimeType: 'audio/mpeg', signatures: ['494433', 'fffb', 'fff3', 'fff2'] },
  { extension: 'wav', mimeType: 'audio/wav', signatures: ['52494646'] },
  { extension: 'm4a', mimeType: 'audio/mp4', signatures: ['000000'] },
  { extension: 'txt', mimeType: 'text/plain', signatures: [] },
  { extension: 'csv', mimeType: 'text/csv', signatures: [] },
  { extension: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', signatures: ['504b0304'] },
  { extension: 'xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', signatures: ['504b0304'] },
] as const;

export type EvidenceTypeRule = (typeof ALLOWED_EVIDENCE_TYPES)[number];

export interface ProvenanceRef {
  evidenceId: string;
  page?: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
  timestampStart?: number;
  timestampEnd?: number;
}

export interface Fact<T = unknown> {
  id: string;
  type: string;
  value: T;
  source: ProvenanceRef;
  extractionConfidence?: number;
}

export interface EngineRun {
  id: string;
  auditId: string;
  policyVersion: string;
  rulesVersion: string;
  decisionStatus?: 'READY_TO_APPROVE' | 'REVIEW_REQUIRED' | 'CONFLICTED' | 'INDETERMINATE';
  createdAt: string;
}

export interface AIUsage {
  auditId: string;
  provider: string;
  operation: string;
  estimatedCost: number;
  currency: string;
}

export interface Job {
  id: string;
  auditId: string;
  jobType: JobType;
  status: JobStatus;
  operationScope: string;
  idempotencyKey: string;
  inputFingerprint: string;
  progress: number;
  attemptCount: number;
  maxAttempts: number;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  createdAt: string;
}

export type JobType = 'METADATA_PROBE' | 'EVIDENCE_PROCESSING' | 'FACT_EXTRACTION';
export type JobStatus = 'QUEUED' | 'RUNNING' | 'RETRY_SCHEDULED' | 'SUCCEEDED' | 'FAILED' | 'CANCELLATION_REQUESTED' | 'CANCELLED';
export type JobErrorKind = 'TRANSIENT' | 'PERMANENT' | 'CANCELLED';

export interface ClaimedJob {
  jobId: string;
  attemptId: string;
  auditId: string;
  jobType: JobType;
  payload: Record<string, unknown>;
  attemptNumber: number;
}

const allowedJobTransitions: Record<JobStatus, JobStatus[]> = {
  QUEUED: ['RUNNING', 'CANCELLATION_REQUESTED', 'CANCELLED'],
  RUNNING: ['SUCCEEDED', 'RETRY_SCHEDULED', 'FAILED', 'CANCELLATION_REQUESTED', 'CANCELLED'],
  RETRY_SCHEDULED: ['RUNNING', 'CANCELLATION_REQUESTED', 'CANCELLED'],
  SUCCEEDED: [],
  FAILED: ['QUEUED'],
  CANCELLATION_REQUESTED: ['CANCELLED', 'RUNNING'],
  CANCELLED: [],
};

export function canTransitionJobStatus(from: JobStatus, to: JobStatus): boolean {
  return allowedJobTransitions[from].includes(to);
}

export function stableFingerprint(value: unknown): string {
  return JSON.stringify(sortForFingerprint(value));
}

function sortForFingerprint(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForFingerprint);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, sortForFingerprint(entry)]),
    );
  }
  return value;
}

const allowedTransitions: Record<AuditStatus, AuditStatus[]> = {
  DRAFT: ['READY', 'FAILED'],
  READY: ['PROCESSING', 'FAILED'],
  PROCESSING: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: ['READY'],
};

export function canTransitionAuditStatus(from: AuditStatus, to: AuditStatus): boolean {
  return allowedTransitions[from].includes(to);
}

export function sanitizeFilename(filename: string): string {
  const normalized = filename.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const basename = normalized.split(/[\\/]/).pop() ?? 'archivo';
  const safe = basename
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120);
  return safe || 'archivo';
}

export function getFileExtension(filename: string): string {
  const safe = sanitizeFilename(filename);
  const index = safe.lastIndexOf('.');
  return index >= 0 ? safe.slice(index + 1).toLowerCase() : '';
}

export function getEvidenceTypeRule(filename: string, declaredMimeType: string): EvidenceTypeRule | null {
  const extension = getFileExtension(filename);
  return ALLOWED_EVIDENCE_TYPES.find((rule) => rule.extension === extension && rule.mimeType === declaredMimeType) ?? null;
}

export function detectMimeType(filename: string, declaredMimeType: string, firstBytes: Uint8Array): string | null {
  const rule = getEvidenceTypeRule(filename, declaredMimeType);
  if (!rule) return null;
  if (rule.signatures.length === 0) return rule.mimeType;
  const hex = Array.from(firstBytes.slice(0, 16)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return rule.signatures.some((signature) => hex.startsWith(signature)) ? rule.mimeType : null;
}

export function validateEvidenceFile(input: {
  filename: string;
  declaredMimeType: string;
  sizeBytes: number;
  firstBytes: Uint8Array;
}): { ok: true; detectedMimeType: string; safeFilename: string } | { ok: false; reason: string } {
  if (input.sizeBytes <= 0) return { ok: false, reason: 'El archivo esta vacio.' };
  if (input.sizeBytes > MAX_EVIDENCE_FILE_BYTES) return { ok: false, reason: 'El archivo supera el limite de 50 MB.' };
  const safeFilename = sanitizeFilename(input.filename);
  const detectedMimeType = detectMimeType(safeFilename, input.declaredMimeType, input.firstBytes);
  if (!detectedMimeType) return { ok: false, reason: 'El tipo de archivo no esta permitido o no coincide con su contenido.' };
  return { ok: true, detectedMimeType, safeFilename };
}

export function buildEvidenceStorageKey(input: { auditId: string; evidenceId: string; safeFilename: string }): string {
  return `audits/${input.auditId}/originals/${input.evidenceId}/${sanitizeFilename(input.safeFilename)}`;
}
