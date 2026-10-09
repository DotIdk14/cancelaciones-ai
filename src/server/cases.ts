// =============================================================================
// Capa de datos — casos, evidencias y auditorías (solo persistencia).
// =============================================================================
// No hay reglas de negocio aquí: InsForge guarda datos; la IA decide.
// Las funciones server-side usan el cliente privilegiado de InsForge.
// =============================================================================

import { z } from 'zod';
import type { InsForgeClient } from './insforge.js';
import type { CaseStatus, ErrorCategory, EvidenceStatus } from '../skills/audit/types.js';
import type { CaseReviewRow } from './reviews.js';
import type { AuthContext } from './auth.js';
import { capabilitiesForRole } from './auth.js';
import { ApiError, mapProviderError } from './http.js';
import { computeEvidenceFingerprint } from './audit-fingerprint.js';

export interface CaseRow {
  id: string;
  status: CaseStatus;
  student_identifier: string | null;
  student_name?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /**
   * Fecha de inicio de ciclo aportada por una persona (migración
   * `20261008090000_case-cycle-start-date-human.sql`).
   *
   * OPCIONALES a propósito, igual que los derivados de `EvidenceRow`: si la
   * migración aún no está aplicada, el `select('*')` sigue funcionando y el DTO
   * expone `null` en vez de romperse.
   *
   * `_by` es el AUTOR REAL (uuid de `auth.users`) y lo pone el servidor desde la
   * sesión; `_by_name` es el texto que escribió la persona, solo para mostrar. No
   * existe nombre de usuario autoritativo en el sistema: es el mismo patrón que
   * `case_reviews.reviewer_name`.
   */
  cycle_start_date?: string | null;
  cycle_start_date_by?: string | null;
  cycle_start_date_at?: string | null;
  cycle_start_date_by_name?: string | null;
  /**
   * Clasificación explícita del caso (migración `20261008110000_case-test-flag.sql`):
   * `false` = real, `true` = prueba.
   *
   * OPCIONAL a propósito, como los derivados: si la migración aún no está aplicada
   * el `select('*')` sigue funcionando y el DTO expone `false` (el default de la
   * columna) en vez de romperse. La exclusion de las pruebas de las métricas
   * operativas NO la decide la base: la aplica el servidor en SQL
   * (`applyTestScope`, dashboard-queries.ts).
   */
  is_test?: boolean;
}

export type CaseCreatorRole = 'user' | 'coordinator';

export interface CaseSummaryRow extends CaseRow {
  evidence?: Array<{ count: number }> | null;
  creator_role?: CaseCreatorRole | null;
  /** Resolución humana del caso (cargada en batch junto con el listado). */
  review?: CaseReviewRow | null;
  /** Auditoría COMPLETED vigente del caso (cargada en batch junto con el listado). */
  audit?: AuditRow | null;
  /** Si la última auditoría completada usa los datos actuales del expediente. */
  auditIsCurrent?: boolean | null;
}

async function caseCreatorIdsForRole(client: InsForgeClient, role: CaseCreatorRole): Promise<string[]> {
  const ids: string[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client.database
      .from('app_memberships')
      .select('user_id')
      .eq('role', role)
      .order('user_id', { ascending: true })
      .range(offset, offset + 499);
    if (error || !data) dbError(error);
    const page = data as Array<{ user_id: string }>;
    ids.push(...page.map((row) => row.user_id));
    if (page.length < 500) return ids;
  }
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
  studentName: string | null,
  createdBy: string,
): Promise<CaseRow> {
  const { data, error } = await client.database
    .from('cases')
    .insert([{ status: 'DRAFT', student_identifier: studentIdentifier, student_name: studentName, created_by: createdBy, is_test: false }])
    .select()
    .single();
  if (error || !data) dbError(error);
  return data as CaseRow;
}

/** Actualiza la clasificación operativa desde la capacidad administrativa. */
export async function setCaseTestFlag(client: InsForgeClient, caseId: string, isTest: boolean): Promise<void> {
  const { error } = await client.database.from('cases').update({ is_test: isTest }).eq('id', caseId);
  if (error) dbError(error);
}

/** Borra un borrador solo cuando está realmente vacío y nunca fue auditado. */
export async function deleteUnusedDraftCase(client: InsForgeClient, caseId: string): Promise<void> {
  const [
    { data: evidence, error: evidenceError },
    { data: audits, error: auditsError },
    { data: reviews, error: reviewsError },
    { data: comments, error: commentsError },
  ] = await Promise.all([
    client.database.from('evidence').select('id').eq('case_id', caseId).limit(1),
    client.database.from('audits').select('id').eq('case_id', caseId).limit(1),
    client.database.from('case_reviews').select('id').eq('case_id', caseId).limit(1),
    client.database.from('case_area_comments').select('id').eq('case_id', caseId).limit(1),
  ]);
  if (evidenceError || auditsError || reviewsError || commentsError) {
    dbError(evidenceError ?? auditsError ?? reviewsError ?? commentsError);
  }
  if ((evidence?.length ?? 0) > 0 || (audits?.length ?? 0) > 0 || (reviews?.length ?? 0) > 0 || (comments?.length ?? 0) > 0) {
    throw new ApiError(409, 'VALIDATION_ERROR', 'Solo se pueden borrar borradores sin actividad ni evidencias');
  }
  const { error } = await client.database.from('cases').delete().eq('id', caseId);
  if (error) dbError(error);
}

/** Elimina un intento de auditoría sin revisión humana asociada. */
export async function deleteUnreviewedAudit(client: InsForgeClient, caseId: string, auditId: string): Promise<void> {
  const [
    { data: audit, error: auditError },
    { data: review, error: reviewError },
    { data: comparison, error: comparisonError },
  ] = await Promise.all([
    client.database.from('audits').select('id,status').eq('id', auditId).eq('case_id', caseId).limit(1),
    client.database.from('case_reviews').select('id').eq('audit_id', auditId).limit(1),
    client.database.from('case_comparisons').select('id').eq('audit_id', auditId).limit(1),
  ]);
  if (auditError || reviewError || comparisonError) dbError(auditError ?? reviewError ?? comparisonError);
  if (!audit || audit.length === 0) throw new ApiError(404, 'NOT_FOUND', 'Dictamen no encontrado');
  if (audit[0]?.status === 'RUNNING') throw new ApiError(409, 'VALIDATION_ERROR', 'No se puede borrar una auditoría en curso');
  if ((review?.length ?? 0) > 0 || (comparison?.length ?? 0) > 0) {
    throw new ApiError(409, 'VALIDATION_ERROR', 'No se puede borrar un dictamen con revisión o comparación humana');
  }
  const { error } = await client.database.from('audits').delete().eq('id', auditId).eq('case_id', caseId);
  if (error) dbError(error);
}

async function enrichCaseSummaries(
  client: InsForgeClient,
  rows: CaseSummaryRow[],
  snapshot: string,
): Promise<CaseSummaryRow[]> {
  const pageSize = 100;
  // Las relaciones se consultan por bloques acotados, evitando tanto N+1 como
  // URLs PostgREST con miles de UUID. `id DESC` resuelve empates de fecha.
  const reviewMap = new Map<string, CaseReviewRow>();
  const auditMap = new Map<string, AuditRow>();
  const evidencesByCase = new Map<string, EvidenceRow[]>();
  for (let offset = 0; offset < rows.length; offset += pageSize) {
    const caseIds = rows.slice(offset, offset + pageSize).map((row) => row.id);
    const [{ data: reviewsData, error: reviewsError }] = await Promise.all([
      client.database.from('case_reviews').select('*').in('case_id', caseIds),
    ]);
    if (reviewsError) dbError(reviewsError);
    for (const review of (reviewsData as CaseReviewRow[] | null) ?? []) {
      if (!reviewMap.has(review.case_id)) reviewMap.set(review.case_id, review);
    }
    // Un caso puede acumular más auditorías que el límite REST. Paginar también
    // esta consulta evita perder la auditoría COMPLETED más reciente del lote.
    for (let auditOffset = 0; ; auditOffset += 500) {
      const { data: auditsData, error: auditsError } = await client.database
        .from('audits')
        .select('id,case_id,status,provider,model,result_json,error_category,latency_ms,evidence_fingerprint,created_at')
        .eq('status', 'COMPLETED')
        .lte('created_at', snapshot)
        .in('case_id', caseIds)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(auditOffset, auditOffset + 499);
      if (auditsError || !auditsData) dbError(auditsError);
      const auditPage = auditsData as AuditRow[];
      for (const audit of auditPage) {
        if (!auditMap.has(audit.case_id)) auditMap.set(audit.case_id, audit);
      }
      // Cada caso solo necesita su primera fila por el orden DESC. Si todos ya
      // tienen dictamen, las páginas más antiguas no pueden cambiar el resultado.
      if (auditMap.size === caseIds.length || auditPage.length < 500) break;
    }

    // Se requiere la evidencia íntegra para comparar la huella del dictamen.
    // Se pagina aparte para no depender del tope REST en casos con muchos archivos.
    for (let evidenceOffset = 0; ; evidenceOffset += 500) {
      const { data: evidenceData, error: evidenceError } = await client.database
        .from('evidence')
        .select('id,case_id,hash,transcript_json')
        .in('case_id', caseIds)
        .order('id', { ascending: true })
        .range(evidenceOffset, evidenceOffset + 499);
      if (evidenceError || !evidenceData) dbError(evidenceError);
      const page = evidenceData as EvidenceRow[];
      for (const evidence of page) {
        const group = evidencesByCase.get(evidence.case_id) ?? [];
        group.push(evidence);
        evidencesByCase.set(evidence.case_id, group);
      }
      if (page.length < 500) break;
    }
  }

  const creatorIds = [...new Set(rows.map((row) => row.created_by).filter((id): id is string => Boolean(id)))];
  const creatorRoleById = new Map<string, CaseCreatorRole>();
  for (let offset = 0; offset < creatorIds.length; offset += pageSize) {
    const ids = creatorIds.slice(offset, offset + pageSize);
    const { data, error } = await client.database
      .from('app_memberships')
      .select('user_id,role')
      .in('user_id', ids);
    if (error || !data) dbError(error);
    for (const membership of data as Array<{ user_id: string; role: string }>) {
      if (membership.role === 'user' || membership.role === 'coordinator') {
        creatorRoleById.set(membership.user_id, membership.role);
      }
    }
  }

  return rows.map((row) => {
    const review = reviewMap.get(row.id) ?? null;
    const audit = auditMap.get(row.id) ?? null;
    const auditIsCurrent = audit === null
      ? null
      : audit.evidence_fingerprint === computeEvidenceFingerprint(evidencesByCase.get(row.id) ?? [], row.cycle_start_date ?? null);
    return {
      ...row,
      review,
      audit,
      auditIsCurrent,
      creator_role: row.created_by ? creatorRoleById.get(row.created_by) ?? null : null,
    };
  });
}

/** Página acotada para la UI. `snapshot` fija el conjunto ante inserciones nuevas. */
export async function listCaseSummaryPage(
  client: InsForgeClient,
  auth: AuthContext,
  options: { offset: number; limit: number; snapshot: string; status?: CaseStatus; creatorRole?: CaseCreatorRole },
): Promise<CaseSummaryRow[]> {
  const creatorIds = options.creatorRole ? await caseCreatorIdsForRole(client, options.creatorRole) : null;
  if (creatorIds?.length === 0) return [];
  let query = client.database
    .from('cases')
    .select('*,evidence(count)')
    .lte('created_at', options.snapshot)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });
  if (!capabilitiesForRole(auth.role).canReadAllCases) query = query.eq('created_by', auth.sub);
  if (options.status) query = query.eq('status', options.status);
  if (creatorIds) query = query.in('created_by', creatorIds);
  const { data, error } = await query.range(options.offset, options.offset + options.limit - 1);
  if (error || !data) dbError(error);
  return enrichCaseSummaries(client, data as CaseSummaryRow[], options.snapshot);
}

export async function countCaseSummaryStatuses(
  client: InsForgeClient,
  auth: AuthContext,
  creatorRole?: CaseCreatorRole,
): Promise<Record<CaseStatus | 'ALL', number>> {
  const statuses: CaseStatus[] = ['DRAFT', 'READY', 'AUDITING', 'COMPLETED', 'ERROR'];
  const creatorIds = creatorRole ? await caseCreatorIdsForRole(client, creatorRole) : null;
  if (creatorIds?.length === 0) {
    return { ALL: 0, DRAFT: 0, READY: 0, AUDITING: 0, COMPLETED: 0, ERROR: 0 };
  }
  const count = async (status?: CaseStatus): Promise<number> => {
    let query = client.database.from('cases').select('id', { count: 'exact', head: true });
    if (!capabilitiesForRole(auth.role).canReadAllCases) query = query.eq('created_by', auth.sub);
    if (creatorIds) query = query.in('created_by', creatorIds);
    if (status) query = query.eq('status', status);
    const result = await query;
    if (result.error) dbError(result.error);
    return result.count ?? 0;
  };
  const [all, ...values] = await Promise.all([count(), ...statuses.map((status) => count(status))]);
  return { ALL: all, ...Object.fromEntries(statuses.map((status, index) => [status, values[index] ?? 0])) } as Record<CaseStatus | 'ALL', number>;
}

/** Contrato legado: devuelve todos los casos, conservado para clientes existentes. */
export async function listCaseSummaries(client: InsForgeClient, auth: AuthContext): Promise<CaseSummaryRow[]> {
  const pageSize = 100;
  const snapshot = new Date().toISOString();
  const rows: CaseSummaryRow[] = [];
  for (let offset = 0; ; offset += pageSize) {
    let query = client.database
      .from('cases')
      .select('*,evidence(count)')
      .lte('created_at', snapshot)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });
    if (!capabilitiesForRole(auth.role).canReadAllCases) query = query.eq('created_by', auth.sub);
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error || !data) dbError(error);
    const page = data as CaseSummaryRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return enrichCaseSummaries(client, rows, snapshot);
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
 * - Un rol con `canReadAllCases` (coordinador, gerente) puede LEER cualquier caso.
 * - Ajeno o inexistente → el mismo 404 (sin enumerar existencia).
 *
 * La pregunta que se hace es "¿TIENE la capacidad de leer todos?", no "¿el rol
 * es exactamente este?": nombrar el rol aquí congelaría el vocabulario de roles
 * en cada guard, que es justo lo que `capabilitiesForRole` evita.
 */
export async function getScopedCaseOr404(
  client: InsForgeClient,
  caseId: string,
  auth: AuthContext,
): Promise<CaseRow> {
  const row = await getCaseOr404(client, caseId);
  if (!capabilitiesForRole(auth.role).canReadAllCases && row.created_by !== auth.sub) {
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

/**
 * Proyecta el origen que extrajo la auditoría a las dimensiones del caso.
 *
 * Regla que protege contra el borrado: un `null` del modelo significa "no
 * determinable", NUNCA "borrar lo que ya se sabía". Por eso las claves con valor
 * `null`/`undefined` no se incluyen en el patch: un update parcial del assessment
 * no puede vaciar un dato que una auditoría anterior ya había establecido. Si no
 * queda ninguna clave, no se toca la base.
 *
 * El dictamen es la fuente de verdad y vive en `audits.result_json`; estas
 * columnas son una proyección para poder filtrar, y por eso sus fallos no
 * invalidan el dictamen (ver la llamada en `audit-service.ts`).
 */
export async function updateCaseDimensions(
  client: InsForgeClient,
  caseId: string,
  dimensions: { country?: string | null; channel?: string | null },
): Promise<void> {
  const patch: Record<string, string> = {};
  if (dimensions.country != null) patch.country = dimensions.country;
  if (dimensions.channel != null) patch.channel = dimensions.channel;
  if (Object.keys(patch).length === 0) return;
  const { error } = await client.database.from('cases').update(patch).eq('id', caseId);
  if (error) dbError(error);
}

// =============================================================================
// Fecha de inicio de ciclo aportada por una persona.
// =============================================================================
//
// QUÉ ES Y QUÉ NO ES
//   Es la fecha de inicio de clases que una persona escribió porque el dictamen
//   no pudo acreditarla con la evidencia del expediente. Es un DATO CON
//   PROCEDENCIA (quién y cuándo), no evidencia del caso: no proviene de un
//   documento, no se cita en `audits.result_json` y no crea criterio. El
//   criterio sigue siendo el procedimiento V5 del owner (POLICY_IS_IMMUTABLE).
//
// SOBRE EL RANGO: CABO DE COHERENCIA, NO NORMA
//   La política no dice qué fechas son admisibles y aquí no se inventa ninguna.
//   Lo único que se rechaza es lo que no es una fecha (formato, calendario), lo
//   que está fuera del mundo del producto (año 2000-2100) y lo que todavía no
//   ha pasado. Poner más restricciones sobre QUÉ fecha es válida sería
//   inventar política.

/** Máximo del nombre escrito por la persona. Igual que `reviewer_name`. */
export const CYCLE_START_DATE_BY_NAME_MAX = 120;
const CYCLE_START_DATE_MIN_YEAR = 2000;
const CYCLE_START_DATE_MAX_YEAR = 2100;

/** ISO estricto: `21/08/2026` y `2026-8-2` no lo pasan. */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * ¿Es una fecha que existe en el calendario?
 *
 * El formato y el rango no bastan: el patrón ISO acepta `2026-02-30` y
 * `2025-02-29`, y Postgres los rechaza con 22007. Sin esta comprobación ese
 * error llegaría al cliente como un 500 en vez de un 400 con mensaje útil.
 */
function isRealCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  // Ida y vuelta: cubre también el desbordamiento (29 de febrero inexistente).
  return parsed.toISOString().slice(0, 10) === value;
}

/** Hoy en UTC. El servidor corre en UTC, así que el corte de "no futura" es el día. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Body de `PATCH /api/cases/:caseId`.
 *
 * `.strict()` por el mismo motivo que en el resto del proyecto: el autor y la
 * hora los pone el servidor desde la sesión, y aceptarlos en el cuerpo sería
 * permitir que el cliente elija quién capturó la fecha.
 */
/**
 * Valida la fecha de inicio en ORDEN y se detiene en el primer fallo.
 *
 * Por qué `superRefine` y no una cadena de `.refine()`: cada `.refine()` de Zod
 * corre siempre, así que una cadena no para. Con `21/08/2026` (el error más
 * probable, porque es el de teclear) el operador leía TRES avisos a la vez:
 * "formato AAAA-MM-DD", "no existe en el calendario" y "no puede ser futura" —
 * dos de ellos derivados de la primera y falsos. Tres mensajes contradictorios
 * hacen que una persona dude de qué corregir.
 *
 * El orden es el que ayuda a corregir: primero el formato, porque sin él no hay
 * fecha que pueda ser real, estar en rango ni no ser futura. El orden de los
 * REQUISITOS no cambia: son los mismos cuatro, todos siguen evalúándose cuando
 * los anteriores pasan.
 */
function checkCycleStartDate(
  value: string,
  ctx: z.RefinementCtx,
): void {
  if (!ISO_DATE_PATTERN.test(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La fecha de inicio debe tener formato AAAA-MM-DD' });
    return;
  }
  if (!isRealCalendarDate(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La fecha de inicio no existe en el calendario' });
    return;
  }
  const year = Number(value.slice(0, 4));
  if (year < CYCLE_START_DATE_MIN_YEAR || year > CYCLE_START_DATE_MAX_YEAR) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `El año de la fecha de inicio debe estar entre ${CYCLE_START_DATE_MIN_YEAR} y ${CYCLE_START_DATE_MAX_YEAR}`,
    });
    return;
  }
  if (value > todayIso()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La fecha de inicio de clases no puede ser futura' });
  }
}

const CycleStartDateInputSchema = z
  .object({
    cycleStartDate: z.string().superRefine(checkCycleStartDate),
    // `.trim()` ANTES de `.min(1)`: un nombre de espacios no es un nombre, es una
    // ausencia, y sin ese orden pasaría la validación y llegaría vacío.
    cycleStartDateByName: z
      .string()
      .trim()
      .min(1, 'Falta el nombre de quien captura la fecha')
      .max(
        CYCLE_START_DATE_BY_NAME_MAX,
        `El nombre no puede superar ${CYCLE_START_DATE_BY_NAME_MAX} caracteres`,
      ),
  })
  .strict();

export interface CaseCycleStartDateInput {
  cycleStartDate: string;
  cycleStartDateByName: string;
}

/**
 * Valida el cuerpo ANTES de tocar la base (VALIDATE_BEFORE_EFFECT).
 *
 * Traduce los fallos de Zod al `ApiError` que `handleRoute` ya sabe convertir en
 * un 400 con mensaje en español.
 */
export function parseCaseCycleStartDateInput(raw: unknown): CaseCycleStartDateInput {
  const parsed = CycleStartDateInputSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || 'cycleStartDate'}: ${issue.message}`)
      .join(' | ');
    throw new ApiError(400, 'VALIDATION_ERROR', `VALIDATION_ERROR: ${detail}`);
  }
  return parsed.data;
}

/**
 * Guarda la fecha de inicio que aportó una persona, con su autor y su hora.
 *
 * Es un UPSERT sobre la fila del caso, no un histórico: guardar dos veces PISA
 * fecha, autor, nombre y hora. Mismo criterio que los comentarios por área (una
 * fila vigente, no un registro), y como la fila del caso es una sola no puede
 * duplicarse nada.
 *
 * `updated_at` no se escribe aquí a mano: lo mueve el disparador
 * `cases_set_updated_at` del baseline, igual que en cualquier otra escritura
 * sobre `cases`. Poner la columna además del trigger sería una segunda fuente
 * de verdad para la misma marca.
 *
 * El alcance NO lo decide esta función: quien la llama ya resolvió el caso con
 * `getScopedCaseOr404` + `assertCaseOwner`, porque la RLS no protege esta
 * escritura (el cliente del servidor escribe como superusuario).
 */
export async function setCaseCycleStartDate(
  client: InsForgeClient,
  caseId: string,
  value: { date: string; byUserId: string; byName: string },
): Promise<void> {
  const { error } = await client.database
    .from('cases')
    .update({
      cycle_start_date: value.date,
      cycle_start_date_by: value.byUserId,
      cycle_start_date_at: new Date().toISOString(),
      cycle_start_date_by_name: value.byName,
    })
    .eq('id', caseId);
  if (error) dbError(error);
}
