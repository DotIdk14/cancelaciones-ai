// =============================================================================
// Capa de datos — casos, evidencias y auditorías (solo persistencia).
// =============================================================================
// No hay reglas de negocio aquí: InsForge guarda datos; la IA decide.
// Las funciones server-side usan el cliente privilegiado de InsForge.
// =============================================================================

import type { InsForgeClient } from './insforge.js';
import type { CaseStatus, ErrorCategory, EvidenceStatus } from '../skills/audit/types.js';
import type { CaseReviewRow } from './reviews.js';
import type { AuthContext } from './auth.js';
import { ApiError, mapProviderError } from './http.js';

export interface CaseRow {
  id: string;
  status: CaseStatus;
  student_identifier: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CaseSummaryRow extends CaseRow {
  evidence?: Array<{ count: number }> | null;
  /** Resolución humana del caso (cargada en batch junto con el listado). */
  review?: CaseReviewRow | null;
  /** Auditoría COMPLETED vigente del caso (cargada en batch junto con el listado). */
  audit?: AuditRow | null;
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
  /**
   * Derivado de extracción (migración `20261003010000_derived_extractions.sql`).
   * OPCIONALES a propósito: si la migración no está aplicada, el `select('*')`
   * sigue funcionando y sólo se pierde la caché de extracción.
   */
  extracted_text?: string | null;
  extraction_pipeline_version?: string | null;
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
  evidence_fingerprint: string | null;
  attempt_number: number | null;
  deadline_at: string | null;
  provider_metadata: unknown;
  created_at: string;
}

function dbError(error: unknown, fallback: ErrorCategory = 'DATABASE_ERROR'): never {
  throw mapProviderError(error, fallback);
}

export async function createCase(
  client: InsForgeClient,
  studentIdentifier: string | null,
  createdBy: string,
): Promise<CaseRow> {
  const { data, error } = await client.database
    .from('cases')
    .insert([{ status: 'DRAFT', student_identifier: studentIdentifier, created_by: createdBy }])
    .select()
    .single();
  if (error || !data) dbError(error);
  return data as CaseRow;
}

export async function listCaseSummaries(client: InsForgeClient, auth: AuthContext): Promise<CaseSummaryRow[]> {
  let query = client.database
    .from('cases')
    .select('*,evidence(count)')
    .order('created_at', { ascending: false })
    .limit(100);
  if (auth.role === 'user') {
    query = query.eq('created_by', auth.sub);
  }
  const { data, error } = await query;
  if (error || !data) dbError(error);
  const rows = data as CaseSummaryRow[];

  // Carga en batch la revisión humana y la auditoría COMPLETED vigente de los
  // casos de la página, para que `caseToSummary` derive `effectiveResolution`
  // sin N+1 (FIX 1).
  const caseIds = rows.map((row) => row.id);
  if (caseIds.length === 0) return rows;

  const [{ data: reviewsData, error: reviewsError }, { data: auditsData, error: auditsError }] = await Promise.all([
    client.database.from('case_reviews').select('*').in('case_id', caseIds),
    client.database
      .from('audits')
      .select('*')
      .eq('status', 'COMPLETED')
      .in('case_id', caseIds)
      .order('created_at', { ascending: false }),
  ]);
  if (reviewsError) dbError(reviewsError);
  if (auditsError) dbError(auditsError);

  const reviewMap = new Map<string, CaseReviewRow>();
  for (const review of (reviewsData as CaseReviewRow[] | null) ?? []) {
    if (!reviewMap.has(review.case_id)) reviewMap.set(review.case_id, review);
  }

  const auditMap = new Map<string, AuditRow>();
  for (const audit of (auditsData as AuditRow[] | null) ?? []) {
    if (!auditMap.has(audit.case_id)) auditMap.set(audit.case_id, audit);
  }

  return rows.map((row) => ({
    ...row,
    review: reviewMap.get(row.id) ?? null,
    audit: auditMap.get(row.id) ?? null,
  }));
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

/**
 * Caso visible para el usuario autenticado.
 *
 * - El dueño siempre lo ve.
 * - Un coordinador puede LEER cualquier caso.
 * - Ajeno o inexistente → el mismo 404 (sin enumerar existencia).
 */
export async function getScopedCaseOr404(
  client: InsForgeClient,
  caseId: string,
  auth: AuthContext,
): Promise<CaseRow> {
  const row = await getCaseOr404(client, caseId);
  if (auth.role === 'user' && row.created_by !== auth.sub) {
    throw new ApiError(404, 'NOT_FOUND', 'Caso no encontrado');
  }
  return row;
}

/** Garantiza que una mutación solo toca un caso propio. */
export function assertCaseOwner(row: CaseRow, auth: AuthContext): void {
  if (row.created_by !== auth.sub) {
    throw new ApiError(404, 'NOT_FOUND', 'Caso no encontrado');
  }
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

/**
 * Persiste el texto derivado de una evidencia (PDF/TXT).
 *
 * Los bytes ORIGINALES nunca se tocan (PRESERVE_EVIDENCE_PROVENANCE): esto es un
 * derivado reproducible a partir del binario, con la versión del pipeline que lo
 * produjo. Es una caché, no una fuente de verdad: si la escritura falla (por
 * ejemplo, si la migración `20261003010000_derived_extractions.sql` aún no está
 * aplicada) se registra y se sigue; la auditoría vuelve a extraer y a pagar el
 * coste de cpu, pero nunca se rompe por ello.
 */
export async function persistDerivedExtraction(
  client: InsForgeClient,
  evidenceId: string,
  text: string,
  pipelineVersion: string,
): Promise<void> {
  const { error } = await client.database
    .from('evidence')
    .update({ extracted_text: text, extraction_pipeline_version: pipelineVersion })
    .eq('id', evidenceId);
  if (error) {
    console.warn('[evidence] no se pudo cachear la extracción; se re-extraerá', {
      evidenceId,
      category: 'DATABASE_ERROR',
    });
  }
}

// La regla de vigencia del derivado es lógica pura y vive en `derived.ts` (módulo
// hoja) para que los tests puedan sustituir `cases.ts` sin romper el store en
// memoria. Se reexporta aquí porque conceptualmente sigue siendo parte de la
// evidencia.
export { derivedExtractionOf, type DerivedExtractionCarrier } from './derived.js';

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

/** Evidencia por id, sin filtrar por caso (el scoping se hace luego contra el caso padre). */
export async function getEvidenceByIdOr404(client: InsForgeClient, evidenceId: string): Promise<EvidenceRow> {
  const { data, error } = await client.database
    .from('evidence')
    .select('*')
    .eq('id', evidenceId)
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

/**
 * Última auditoría COMPLETADA del caso, o `null` si no hay ninguna.
 *
 * Distinta de `latestAudit` a propósito: esa devuelve la más reciente sea cual
 * sea su estado, y la más reciente puede estar `RUNNING` o haber fallado. Para
 * registrar una revisión humana hace falta un dictamen que exista de verdad, así
 * que se filtra por `COMPLETED` en SQL en vez de traer todas y descartar en
 * memoria.
 */
export async function latestCompletedAudit(
  client: InsForgeClient,
  caseId: string,
): Promise<AuditRow | null> {
  const { data, error } = await client.database
    .from('audits')
    .select('*')
    .eq('case_id', caseId)
    .eq('status', 'COMPLETED')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) dbError(error);
  const rows = data as AuditRow[] | null;
  if (rows === null || rows.length === 0) return null;
  return rows[0] ?? null;
}

export async function listAuditsByCase(client: InsForgeClient, caseId: string): Promise<AuditRow[]> {
  const { data, error } = await client.database
    .from('audits')
    .select('*')
    .eq('case_id', caseId)
    .order('created_at', { ascending: false });
  if (error) dbError(error);
  return (data as AuditRow[] | null) ?? [];
}

/**
 * Una auditoría CONCRETA por id.
 *
 * Existe para la revisión humana: la comparación tiene que evaluar el dictamen
 * que la revisión referencia (`case_reviews.audit_id`), no "la última del caso".
 * Con `latestAudit` una re-auditoría posterior cambiaría bajo los pies el
 * dictamen comparado y la comparación respondería a una pregunta que nadie
 * preguntó. Una fila COMPLETED es inmutable, así que leerla por id es seguro.
 */
export async function getAuditById(client: InsForgeClient, auditId: string): Promise<AuditRow | null> {
  const { data, error } = await client.database
    .from('audits')
    .select('*')
    .eq('id', auditId)
    .limit(1);
  if (error) dbError(error);
  const rows = data as AuditRow[] | null;
  return rows?.[0] ?? null;
}


export async function latestCompletedAuditByFingerprint(
  client: InsForgeClient,
  caseId: string,
  fingerprint: string,
): Promise<AuditRow | null> {
  const { data, error } = await client.database
    .from('audits')
    .select('*')
    .eq('case_id', caseId)
    .eq('status', 'COMPLETED')
    .eq('evidence_fingerprint', fingerprint)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) dbError(error);
  const rows = data as AuditRow[] | null;
  return rows?.[0] ?? null;
}

export async function latestRunningAuditByFingerprint(
  client: InsForgeClient,
  caseId: string,
  fingerprint: string,
): Promise<AuditRow | null> {
  const { data, error } = await client.database
    .from('audits')
    .select('*')
    .eq('case_id', caseId)
    .eq('status', 'RUNNING')
    .eq('evidence_fingerprint', fingerprint)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) dbError(error);
  const rows = data as AuditRow[] | null;
  return rows?.[0] ?? null;
}

export async function countAuditsByFingerprint(client: InsForgeClient, caseId: string, fingerprint: string): Promise<number> {
  const { data, error } = await client.database
    .from('audits')
    .select('id')
    .eq('case_id', caseId)
    .eq('evidence_fingerprint', fingerprint);
  if (error) dbError(error);
  return (data as Array<{ id: string }> | null)?.length ?? 0;
}

export interface InsertAuditRow {
  case_id: string;
  status: AuditStatus;
  provider: string;
  model: string;
  evidence_fingerprint: string;
  attempt_number: number;
  deadline_at: string;
  provider_metadata?: unknown;
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
    model?: string;
    provider_metadata?: unknown;
  },
): Promise<AuditRow> {
  const { data, error } = await client.database
    .from('audits')
    .update({
      status: patch.status,
      result_json: patch.result_json,
      error_category: patch.error_category,
      latency_ms: patch.latency_ms,
      ...(patch.model ? { model: patch.model } : {}),
      ...(patch.provider_metadata !== undefined ? { provider_metadata: patch.provider_metadata } : {}),
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
