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
import type { CoordinatorDecision, HumanResolution } from '../skills/review/types.js';
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
  /**
   * Bloque del coordinador (migración `20261008120000`). OPCIONALES a propósito,
   * como los derivados de `CaseRow`: si la migración aún no está aplicada, el
   * `select('*')` sigue funcionando y `coordinator_decision` llega `undefined`,
   * que `deriveWorkflowState` lee igual que `null` (aún sin finalizar).
   */
  coordinator_decision?: CoordinatorDecision | null;
  coordinator_resolution?: HumanResolution | null;
  coordinator_created_by?: string | null;
  coordinator_created_at?: string | null;
  coordinator_comment?: string | null;
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
  /** Nombre de quien revisa, DERIVADO en el servidor de la sesión (no del cliente). */
  reviewerName: string;
  comment: string;
  /** Identidad de quien registra la revisión. */
  userId: string;
}

export interface FinalizeCaseReviewInput {
  caseId: string;
  /** `APPROVE` conserva `result`; `CHANGE` la sustituye por `resolution`. */
  decision: CoordinatorDecision;
  /** Resolución final; requerida solo cuando `decision === 'CHANGE'`. */
  resolution: HumanResolution | null;
  comment: string;
  /** Identidad del coordinador (uuid de la sesión), derivada en el servidor. */
  coordinatorUserId: string;
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

/** Mensaje único del conflicto "una finalización por caso" (el coordinador no decide dos veces). */
export const DUPLICATE_FINALIZATION_MESSAGE =
  'El caso ya tiene la decisión final del coordinador registrada; la finalización es única e inmutable.';

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
 * Registra la decisión final del coordinador sobre una revisión de asesor.
 *
 * SÓLO persiste: la etapa la resuelve el endpoint con `deriveWorkflowState` +
 * `capabilitiesForRole`. Aquí se garantiza que la decisión sea coherente y
 * única:
 *   - sin revisión de asesor → 400 (no hay qué finalizar);
 *   - ya finalizada (`coordinator_decision` presente) → 409 estable (la decisión
 *     final es inmutable y un segundo POST no pisa nada);
 *   - `CHANGE` exige `resolution` válida y DISTINTA de `result`; `APPROVE` la
 *     deja NULL (se conserva `result`).
 *
 * El actor (`coordinator_created_by`) y la hora (`coordinator_created_at`) los
 * pone SIEMPRE el servidor desde la sesión; nunca se aceptan del cliente.
 * `result` (la decisión del asesor) NO se modifica: la decisión del coordinador
 * se guarda APARTE para no perder la traza de quién propuso qué.
 *
 * La comprobación previa de "ya finalizada" NO basta por sí sola: dos
 * finalizaciones concurrentes (o un doble clic) pueden pasarla las dos y
 * escribir a la vez. Por eso la escritura va CONDICIONADA a que la decisión
 * siga siendo NULL (`is('coordinator_decision', null)`): la base resuelve la
 * carrera y solo una fila se actualiza. La que pierde ve CERO filas y recibe el
 * MISMO 409 que la comprobación previa, sin haber mutado nada.
 */
export async function finalizeCaseReview(
  client: InsForgeClient,
  input: FinalizeCaseReviewInput,
): Promise<CaseReviewRow> {
  const existing = await getCaseReview(client, input.caseId);
  if (!existing) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'El caso no tiene revisión de asesor que finalizar; regístrala antes de decidir.',
    );
  }
  if (existing.coordinator_decision != null) {
    throw new ApiError(409, 'VALIDATION_ERROR', DUPLICATE_FINALIZATION_MESSAGE);
  }
  if (input.decision === 'CHANGE') {
    if (!input.resolution) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'La decisión CHANGE exige una resolución final distinta de la del asesor.',
      );
    }
    if (input.resolution === existing.result) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'La decisión CHANGE exige una resolución distinta de la del asesor.',
      );
    }
  }

  const { data, error } = await client.database
    .from('case_reviews')
    .update({
      coordinator_decision: input.decision,
      coordinator_resolution: input.decision === 'CHANGE' ? input.resolution : null,
      coordinator_created_by: input.coordinatorUserId,
      coordinator_created_at: new Date().toISOString(),
      coordinator_comment: input.comment,
    })
    .eq('id', existing.id)
    // Guarda atómica: la fila solo se finaliza si `coordinator_decision` sigue
    // NULL. Un update condicional que afecta 0 filas significa "otra
    // finalización ganó la carrera" (o la fila dejó de estar pendiente), y eso
    // se traduce al MISMO 409 estable. Sin `.single()`: un 0-rows no debe
    // convertirse en un PGRST116 que el mapeador leería como fallo de proveedor.
    .is('coordinator_decision', null)
    .select();
  if (error) dbError(error);
  const rows = (data as CaseReviewRow[] | null) ?? [];
  if (rows.length === 0) {
    throw new ApiError(409, 'VALIDATION_ERROR', DUPLICATE_FINALIZATION_MESSAGE);
  }
  return rows[0]!;
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