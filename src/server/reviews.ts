// =============================================================================
// Capa de datos — revisión humana y comparación con IA (solo persistencia).
// =============================================================================
// Igual que `cases.ts`: aquí NO hay reglas de negocio ni criterio. InsForge
// guarda; el servicio (`comparison-service.ts`) orquesta y el modelo evalúa.
// Lo único que esta capa decide es el conflicto evidente de "una revisión por
// caso", porque es una restricción de la clave única y no una regla del
// producto: sin ella, dos escrituras simultáneas meterían dos resoluciones
// humanas para el mismo caso y la "resolución final" dejaría de ser única.
// =============================================================================

import type { InsForgeClient } from './insforge.js';
import type { ErrorCategory } from '../skills/audit/types.js';
import type { HumanResolution } from '../skills/review/types.js';
import { ApiError, mapProviderError } from './http.js';

export type ComparisonStatusRow = 'RUNNING' | 'COMPLETED' | 'ERROR';

/** Fila de `case_reviews`: la resolución humana final del caso. */
export interface CaseReviewRow {
  id: string;
  case_id: string;
  /** Auditoría cuyo dictamen se compara. Nunca "la última del caso". */
  audit_id: string;
  result: HumanResolution;
  reviewer_name: string | null;
  comment: string;
  created_at: string;
  created_by: string | null;
}

/** Fila de `case_comparisons`: el juicio IA sobre el dictamen vs. la decisión humana. */
export interface ComparisonRow {
  id: string;
  case_review_id: string;
  audit_id: string;
  status: ComparisonStatusRow;
  result_json: unknown;
  provider: string;
  /** NULL = todavía no se sabe qué modelo emitirá (fila recién abierta). */
  model: string | null;
  error_category: ErrorCategory | null;
  latency_ms: number | null;
  /** Número de veces que la fila se ha armado (insert + rearms). */
  attempt_count: number;
  deadline_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCaseReviewInput {
  caseId: string;
  auditId: string;
  result: HumanResolution;
  reviewerName: string;
  comment: string;
  /** Identidad de quien registra la revisión. */
  userId: string;
}

export interface InsertComparisonInput {
  caseReviewId: string;
  auditId: string;
  deadlineAt: string;
  /**
   * Modelo con el que se va a comparar. Opcional para que la apertura de la fila
   * no dependa de él, pero el servicio SIEMPRE lo pasa: una comparación sin
   * saber qué modelo la emitió no es reproducible ni auditable, que es el mismo
   * motivo por el que `audits.model` es NOT NULL.
   */
  model?: string;
}

export interface RearmComparisonInput {
  deadlineAt: string;
  attemptCount: number;
  model?: string;
}

export interface UpdateComparisonResultInput {
  resultJson: unknown;
  provider: string;
  model: string;
  latencyMs: number;
}

export interface UpdateComparisonErrorInput {
  errorCategory: ErrorCategory;
  latencyMs: number;
}

/** Mensaje único del conflicto "una revisión por caso" (lo comparan cliente y test). */
export const DUPLICATE_REVIEW_MESSAGE =
  'El caso ya tiene una revisión humana registrada; cada caso admite una sola revisión.';

function dbError(error: unknown, fallback: ErrorCategory = 'DATABASE_ERROR'): never {
  throw mapProviderError(error, fallback);
}

/** Violación de clave única de Postgres (23505). */
function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === '23505';
}

/**
 * Registra la revisión humana del caso.
 *
 * `case_reviews.case_id` es UNIQUE en la base, así que la carrera entre dos
 * peticiones simultáneas la resuelve PostgreSQL con un 23505 aunque la
 * comprobación previa pase en las dos. Por eso el 23505 se traduce al mismo
 * 409 que devuelve la comprobación previa: quien llama ve "ya existe revisión"
 * en los dos caminos, nunca un 500 opaco ni una segunda fila.
 */
export async function createCaseReview(
  client: InsForgeClient,
  input: CreateCaseReviewInput,
): Promise<CaseReviewRow> {
  const existing = await getCaseReview(client, input.caseId);
  if (existing) {
    throw new ApiError(409, 'VALIDATION_ERROR', DUPLICATE_REVIEW_MESSAGE);
  }

  const { data, error } = await client.database
    .from('case_reviews')
    .insert([
      {
        case_id: input.caseId,
        audit_id: input.auditId,
        result: input.result,
        reviewer_name: input.reviewerName,
        comment: input.comment,
        created_by: input.userId,
      },
    ])
    .select()
    .single();
  if (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError(409, 'VALIDATION_ERROR', DUPLICATE_REVIEW_MESSAGE);
    }
    dbError(error);
  }
  if (!data) dbError(null);
  return data as CaseReviewRow;
}

export async function getCaseReview(client: InsForgeClient, caseId: string): Promise<CaseReviewRow | null> {
  const { data, error } = await client.database
    .from('case_reviews')
    .select('*')
    .eq('case_id', caseId)
    .limit(1);
  if (error) dbError(error);
  const rows = data as CaseReviewRow[] | null;
  return rows?.[0] ?? null;
}

/**
 * Abre la comparación en RUNNING. La fila se inserta ANTES de llamar al modelo:
 * si la función muere a mitad de ejecución, el estado queda durable y la
 * siguiente llamada lo retoma sobre la MISMA fila (NO_PROCESS_LOCAL_DURABILITY).
 */
export async function insertComparison(
  client: InsForgeClient,
  input: InsertComparisonInput,
): Promise<ComparisonRow> {
  const { data, error } = await client.database
    .from('case_comparisons')
    .insert([
      {
        case_review_id: input.caseReviewId,
        audit_id: input.auditId,
        status: 'RUNNING',
        provider: 'openrouter',
        ...(input.model ? { model: input.model } : {}),
        attempt_count: 1,
        deadline_at: input.deadlineAt,
      },
    ])
    .select()
    .single();
  if (error) dbError(error);
  if (!data) dbError(null);
  return data as ComparisonRow;
}

/** Comparación vigente de una revisión (la única, por el UNIQUE de `case_review_id`). */
export async function getLatestComparisonForReview(
  client: InsForgeClient,
  caseReviewId: string,
): Promise<ComparisonRow | null> {
  const { data, error } = await client.database
    .from('case_comparisons')
    .select('*')
    .eq('case_review_id', caseReviewId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) dbError(error);
  const rows = data as ComparisonRow[] | null;
  return rows?.[0] ?? null;
}

/**
 * Reabre la MISMA fila para otro intento.
 *
 * Existe para que reanudar (run interrumpido) y reintentar (comparación en
 * ERROR) NO creen una fila nueva: `case_review_id` es UNIQUE, así que una
 * segunda fila por revisión no sería posible y "crear otra" no es ni siquiera
 * una opción. Además limpia `result_json` y `error_category`: un resultado
 * parcial o un error viejo que sobrevivieran a un nuevo intento se leerían
 * como veredicto de la comparación que sí terminó bien.
 */
export async function rearmComparison(
  client: InsForgeClient,
  comparisonId: string,
  input: RearmComparisonInput,
): Promise<ComparisonRow> {
  const { data, error } = await client.database
    .from('case_comparisons')
    .update({
      status: 'RUNNING',
      result_json: null,
      error_category: null,
      latency_ms: null,
      attempt_count: input.attemptCount,
      deadline_at: input.deadlineAt,
      ...(input.model ? { model: input.model } : {}),
    })
    .eq('id', comparisonId)
    .select()
    .single();
  if (error) dbError(error);
  if (!data) dbError(null);
  return data as ComparisonRow;
}

export async function updateComparisonResult(
  client: InsForgeClient,
  comparisonId: string,
  input: UpdateComparisonResultInput,
): Promise<ComparisonRow> {
  const { data, error } = await client.database
    .from('case_comparisons')
    .update({
      status: 'COMPLETED',
      result_json: input.resultJson,
      error_category: null,
      latency_ms: input.latencyMs,
      provider: input.provider,
      model: input.model,
    })
    .eq('id', comparisonId)
    .select()
    .single();
  if (error) dbError(error);
  if (!data) dbError(null);
  return data as ComparisonRow;
}

export async function updateComparisonError(
  client: InsForgeClient,
  comparisonId: string,
  input: UpdateComparisonErrorInput,
): Promise<ComparisonRow> {
  const { data, error } = await client.database
    .from('case_comparisons')
    .update({
      status: 'ERROR',
      result_json: null,
      error_category: input.errorCategory,
      latency_ms: input.latencyMs,
    })
    .eq('id', comparisonId)
    .select()
    .single();
  if (error) dbError(error);
  if (!data) dbError(null);
  return data as ComparisonRow;
}

/** Historial de comparaciones del caso, de la más reciente a la más antigua. */
export async function listComparisonsForCase(client: InsForgeClient, caseId: string): Promise<ComparisonRow[]> {
  const review = await getCaseReview(client, caseId);
  if (!review) return [];
  const { data, error } = await client.database
    .from('case_comparisons')
    .select('*')
    .eq('case_review_id', review.id)
    .order('created_at', { ascending: false });
  if (error) dbError(error);
  return (data as ComparisonRow[] | null) ?? [];
}