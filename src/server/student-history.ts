import { z } from 'zod';
import type { InsForgeClient } from './insforge.js';
import type { AuthContext } from './auth.js';
import { capabilitiesForRole } from './capabilities.js';
import { ApiError, mapProviderError } from './errors.js';
import { getScopedCaseOr404, type CaseRow, type AuditRow, type EvidenceRow } from './cases.js';
import { getCaseReview } from './reviews.js';
import { auditHistoryItemToDto, deriveWorkflowState } from './dto.js';
import type { FlokzuCaseData } from './flokzu-parser.js';

export function historyOffset(value: unknown): number {
  const parsed = z.string().regex(/^\d{1,6}$/).transform(Number).refine(n => n <= 100000).safeParse(value ?? '0');
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Paginación inválida.');
  return parsed.data;
}
function assertReadable(auth: AuthContext): void {
  if (!capabilitiesForRole(auth.role).canReadAllCases) throw new ApiError(404, 'NOT_FOUND', 'Historial no disponible.');
}
function identifier(row: CaseRow): string {
  const parsed = z.string().min(1).max(200).safeParse(row.student_identifier);
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'El expediente no tiene una matrícula válida.');
  return parsed.data;
}
export async function studentHistory(client: InsForgeClient, row: CaseRow, auth: AuthContext, offset: number) {
  assertReadable(auth);
  const matricula = identifier(row);
  // Solo matrícula exacta: sin coerción numérica, coincidencias por nombre ni mezcla de tickets.
  const summary = { cases: 0, audits: 0, evidences: 0, previousCases: 0, lastRequestAt: null as string | null };
  for (let start = 0; ; start += 500) {
    const { data, error } = await client.database.from('cases')
      .select('id,created_at,evidence(count),audits(count)').eq('student_identifier', matricula)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(start, start + 499);
    if (error) throw mapProviderError(error);
    const page = (data ?? []) as Array<{ id: string; created_at: string; evidence: Array<{ count: number }>; audits: Array<{ count: number }> }>;
    for (const item of page) {
      summary.cases++;
      summary.audits += item.audits[0]?.count ?? 0;
      summary.evidences += item.evidence[0]?.count ?? 0;
      if (item.created_at < row.created_at) summary.previousCases++;
      if (!summary.lastRequestAt) summary.lastRequestAt = item.created_at;
    }
    if (page.length < 500) break;
  }
  const { data, error } = await client.database.from('cases')
    .select('id,status,student_identifier,student_name,created_by,assigned_to,external_source,external_case_id,flokzu_data,created_at,updated_at')
    .eq('student_identifier', matricula).order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 24);
  if (error) throw mapProviderError(error);
  const cases = await Promise.all(((data ?? []) as CaseRow[]).map(async item => {
    const scoped = await getScopedCaseOr404(client, item.id, auth);
    const [latest, review, evidenceCount, auditCount] = await Promise.all([
      client.database.from('audits').select('*').eq('case_id', item.id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1),
      getCaseReview(client, item.id),
      client.database.from('evidence').select('id', { count: 'exact', head: true }).eq('case_id', item.id),
      client.database.from('audits').select('id', { count: 'exact', head: true }).eq('case_id', item.id),
    ]);
    for (const result of [latest, evidenceCount, auditCount]) if (result.error) throw mapProviderError(result.error);
    const audit = ((latest.data ?? []) as AuditRow[])[0];
    const flokzu = item.flokzu_data as FlokzuCaseData | null;
    return { id: item.id, externalCaseId: item.external_case_id ?? null, createdAt: item.created_at,
      requestDate: flokzu?.procedure?.requestDate ?? null, policy: flokzu?.procedure?.policyReported ?? null,
      motive: flokzu?.procedure?.motive ?? null, administrativeStatus: flokzu?.operations?.statusReported ?? null,
      status: item.status, responsible: scoped.assigned_name ?? scoped.assigned_to ?? null,
      evidenceCount: evidenceCount.count ?? 0, auditCount: auditCount.count ?? 0,
      latestAudit: audit ? auditHistoryItemToDto(audit) : null,
      finalResolution: review?.coordinator_decision ? review.coordinator_resolution ?? review.result : null,
      workflowState: deriveWorkflowState(review) };
  }));
  return { studentIdentifier: matricula, studentName: row.student_name ?? null, summary, cases,
    nextOffset: offset + cases.length < summary.cases ? offset + 25 : null };
}
export async function studentHistoryEntry(client: InsForgeClient, row: CaseRow, auth: AuthContext, targetId: string, offset: number) {
  assertReadable(auth);
  const target = await getScopedCaseOr404(client, targetId, auth);
  if (identifier(row) !== target.student_identifier) throw new ApiError(404, 'NOT_FOUND', 'Expediente no disponible.');
  const [evidences, audits] = await Promise.all([
    client.database.from('evidence').select('id,case_id,filename,mime_type,created_at,processing_status').eq('case_id', targetId).order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 49),
    client.database.from('audits').select('*').eq('case_id', targetId).order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 49),
  ]);
  for (const result of [evidences, audits]) if (result.error) throw mapProviderError(result.error);
  return { evidences: ((evidences.data ?? []) as EvidenceRow[]).slice(0, 50).map(e => ({ id: e.id, caseId: e.case_id, filename: e.filename, mimeType: e.mime_type, createdAt: e.created_at, processingStatus: e.processing_status })),
    audits: ((audits.data ?? []) as AuditRow[]).map(auditHistoryItemToDto), nextOffset: (evidences.data?.length === 50 || audits.data?.length === 50) ? offset + 50 : null };
}
