// =============================================================================
// Capa de datos — casos, evidencias y auditorías (solo persistencia).
// =============================================================================
// No hay reglas de negocio aquí: InsForge guarda datos; la IA decide.
// Todas las consultas pasan por RLS (`auth.uid()`), así un caseId ajeno
// devuelve "no encontrado" en lugar de datos.
// =============================================================================

import type { InsForgeClient } from './insforge';
import type { CaseStatus, ErrorCategory, EvidenceStatus } from '../skills/audit/types';
import { ApiError, mapProviderError } from './http';

export interface CaseRow {
  id: string;
  status: CaseStatus;
  student_identifier: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CaseSummaryRow extends CaseRow {
  evidence?: Array<{ count: number }> | null;
}

export interface EvidenceRow {
  id: string;
  case_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  hash: string;
  storage_path: string;
  processing_status: EvidenceStatus;
  transcript_json: unknown;
  created_at: string;
}

export type AuditStatus = 'RUNNING' | 'COMPLETED' | 'ERROR';

export interface AuditRow {
  id: string;
  case_id: string;
  status: AuditStatus;
  provider: string;
  model: string;
  result_json: unknown;
  error_category: ErrorCategory | null;
  latency_ms: number | null;
  created_at: string;
}

function dbError(error: unknown, fallback: ErrorCategory = 'DATABASE_ERROR'): never {
  throw mapProviderError(error, fallback);
}

export async function createCase(
  client: InsForgeClient,
  userId: string,
  studentIdentifier: string | null,
): Promise<CaseRow> {
  const { data, error } = await client.database
    .from('cases')
    .insert([{ status: 'DRAFT', student_identifier: studentIdentifier, created_by: userId }])
    .select()
    .single();
  if (error || !data) dbError(error);
  return data as CaseRow;
}

export async function listCaseSummaries(client: InsForgeClient): Promise<CaseSummaryRow[]> {
  const { data, error } = await client.database
    .from('cases')
    .select('*,evidence(count)')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error || !data) dbError(error);
  return data as CaseSummaryRow[];
}

export async function getCaseOr404(client: InsForgeClient, caseId: string): Promise<CaseRow> {
  const { data, error } = await client.database
    .from('cases')
    .select('*')
    .eq('id', caseId)
    .single();
  if (error) dbError(error);
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'Caso no encontrado');
  return data as CaseRow;
}

export async function listEvidenceRows(client: InsForgeClient, caseId: string): Promise<EvidenceRow[]> {
  const { data, error } = await client.database
    .from('evidence')
    .select('*')
    .eq('case_id', caseId)
    .order('created_at', { ascending: true });
  if (error || !data) dbError(error);
  return data as EvidenceRow[];
}

export async function getEvidenceOr404(
  client: InsForgeClient,
  caseId: string,
  evidenceId: string,
): Promise<EvidenceRow> {
  const { data, error } = await client.database
    .from('evidence')
    .select('*')
    .eq('id', evidenceId)
    .eq('case_id', caseId)
    .single();
  if (error) dbError(error);
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'Evidencia no encontrada');
  return data as EvidenceRow;
}

export interface InsertEvidenceRow {
  case_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  hash: string;
  storage_path: string;
  processing_status: EvidenceStatus;
}

export async function insertEvidence(client: InsForgeClient, row: InsertEvidenceRow): Promise<EvidenceRow> {
  const { data, error } = await client.database.from('evidence').insert([row]).select().single();
  if (error || !data) dbError(error, 'UPLOAD_ERROR');
  return data as EvidenceRow;
}

export async function updateEvidenceStatus(
  client: InsForgeClient,
  evidenceId: string,
  patch: { processing_status: EvidenceStatus; transcript_json: unknown },
): Promise<EvidenceRow> {
  const { data, error } = await client.database
    .from('evidence')
    .update({ processing_status: patch.processing_status, transcript_json: patch.transcript_json })
    .eq('id', evidenceId)
    .select()
    .single();
  if (error || !data) dbError(error, 'UPLOAD_ERROR');
  return data as EvidenceRow;
}

export async function deleteEvidenceRow(client: InsForgeClient, evidenceId: string): Promise<void> {
  const { error } = await client.database.from('evidence').delete().eq('id', evidenceId);
  if (error) dbError(error);
}

export async function latestAudit(client: InsForgeClient, caseId: string): Promise<AuditRow | null> {
  const { data, error } = await client.database
    .from('audits')
    .select('*')
    .eq('case_id', caseId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) dbError(error);
  const rows = data as AuditRow[] | null;
  if (!rows || rows.length === 0) return null;
  return rows[0] ?? null;
}

export interface InsertAuditRow {
  case_id: string;
  status: AuditStatus;
  provider: string;
  model: string;
}

export async function insertAudit(client: InsForgeClient, row: InsertAuditRow): Promise<AuditRow> {
  const { data, error } = await client.database.from('audits').insert([row]).select().single();
  if (error || !data) dbError(error);
  return data as AuditRow;
}

export async function updateAuditResult(
  client: InsForgeClient,
  auditId: string,
  patch: {
    status: AuditStatus;
    result_json: unknown;
    error_category: ErrorCategory | null;
    latency_ms: number;
  },
): Promise<AuditRow> {
  const { data, error } = await client.database
    .from('audits')
    .update({
      status: patch.status,
      result_json: patch.result_json,
      error_category: patch.error_category,
      latency_ms: patch.latency_ms,
    })
    .eq('id', auditId)
    .select()
    .single();
  if (error || !data) dbError(error);
  return data as AuditRow;
}

export async function updateCaseStatus(client: InsForgeClient, caseId: string, status: CaseStatus): Promise<void> {
  const { error } = await client.database.from('cases').update({ status }).eq('id', caseId);
  if (error) dbError(error);
}