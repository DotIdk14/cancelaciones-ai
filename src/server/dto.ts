// =============================================================================
// DTOs — forma exacta que consume la UI (contrato de API).
// =============================================================================

import type { ErrorCategory, EvidenceStatus, TranscriptData } from '../skills/audit/types';
import { readTranscriptFromJson } from './evidence-prep';
import type { AuditRow, AuditStatus, CaseRow, CaseSummaryRow, EvidenceRow } from './cases';

export interface CaseSummaryDto {
  id: string;
  status: CaseRow['status'];
  studentIdentifier: string | null;
  evidenceCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CaseDetailDto {
  id: string;
  status: CaseRow['status'];
  studentIdentifier: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EvidenceDto {
  id: string;
  caseId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  hash: string;
  storagePath: string;
  processingStatus: EvidenceStatus;
  transcript: TranscriptData | null;
  createdAt: string;
}

export interface AuditDetailDto {
  id: string;
  caseId: string;
  status: AuditStatus;
  provider: string;
  model: string;
  resultJson: unknown;
  errorCategory: ErrorCategory | null;
  latencyMs: number | null;
  createdAt: string;
}

export function caseToSummary(row: CaseSummaryRow): CaseSummaryDto {
  const count = row.evidence?.[0]?.count ?? 0;
  return {
    id: row.id,
    status: row.status,
    studentIdentifier: row.student_identifier,
    evidenceCount: count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function caseToDetail(row: CaseRow): CaseDetailDto {
  return {
    id: row.id,
    status: row.status,
    studentIdentifier: row.student_identifier,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function evidenceToDto(row: EvidenceRow): EvidenceDto {
  const transcript = row.processing_status === 'READY' ? readTranscriptFromJson(row.transcript_json) : null;
  return {
    id: row.id,
    caseId: row.case_id,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    hash: row.hash,
    storagePath: row.storage_path,
    processingStatus: row.processing_status,
    transcript,
    createdAt: row.created_at,
  };
}

/** JSONB llega como objeto; por defensa, si viene string se parsea. */
function parseJsonField(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

export function auditToDto(row: AuditRow): AuditDetailDto {
  return {
    id: row.id,
    caseId: row.case_id,
    status: row.status,
    provider: row.provider,
    model: row.model,
    resultJson: row.status === 'COMPLETED' ? parseJsonField(row.result_json) : null,
    errorCategory: row.error_category,
    latencyMs: row.latency_ms,
    createdAt: row.created_at,
  };
}