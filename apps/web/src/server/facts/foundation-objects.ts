/**
 * DETECCIÓN DE DISPONIBILIDAD de los objetos de la migración
 * `migrations/20260925120000_policy-foundation-immutability.sql`.
 *
 * ============================================================================
 * POR QUÉ ESTE MÓDULO EXISTE
 * ============================================================================
 * Esa migración está ESCRITA Y REVISADA pero deliberadamente NO APLICADA
 * (Task 9 §1: el único backend configurado es el proyecto base de producción y
 * no hay cliente de base de datos autorizado). En NINGUNA base de datos real
 * existen todavía `freeze_fact_run_v1`, `create_derived_fact_run_v1`,
 * `persist_policy_evaluation_v1` ni la tabla `fact_run_frozen_snapshots`.
 *
 * R-3: todo camino nuevo DETECTA si su objeto existe y, si no existe, degrada al
 * comportamiento de HOY. La degradación NUNCA es silenciosa: emite un aviso con
 * un código estable que se puede grepear en los logs.
 *
 * ============================================================================
 * LA LÍNEA QUE NO SE CRUZA: AUSENCIA vs FALLO
 * ============================================================================
 * Un error de NEGOCIO del RPC (`AUTH_REQUIRED`, `FACT_RUN_EMPTY`, `FORBIDDEN`,
 * `POLICY_SOURCE_NOT_REGISTERED`, `FROZEN_SNAPSHOT_MISSING`...) NO es ausencia
 * del objeto: es una respuesta autoritativa del servidor y se PROPAGA. Si se
 * confundieran los dos, un fallo de autorización se disfrazaría de "funciona
 * bien porque cayó al camino viejo", que es exactamente la clase de bug que
 * borra evidencia de máquina sin dejar rastro.
 */

/** Códigos de error de PostgREST/Postgres que significan "el objeto no está". */
const MISSING_OBJECT_PATTERNS: readonly RegExp[] = [
  // PostgREST: PGRST202 = función ausente del schema cache,
  // PGRST204 = columna ausente, PGRST205 = tabla ausente.
  /PGRST20[245]\b/,
  /could not find the (?:table|function|column)/i,
  // Postgres: 42P01 undefined_table, 42883 undefined_function, 42703 undefined_column.
  /\b42P01\b/,
  /\b42883\b/,
  /\b42703\b/,
  /undefined_(?:table|function|column|object)/i,
  /relation "[^"]+" does not exist/i,
  /column "[^"]+" does not exist/i,
  /function [a-z0-9_.]+ does not exist/i,
  // `DurableDb` de apps/web/src/server/jobs/audit-queue.e2e.test.ts:84-142 es el
  // fake local sin migraciones y responde exactamente este texto para una
  // función que no reconoce. Es AUSENCIA, no fallo: el E2E de pipeline depende
  // de que el camino nuevo caiga al viejo aquí.
  /^Unsupported rpc \S+$/i,
];

export interface FoundationErrorLike {
  message?: string | null;
  code?: string | null;
}

/**
 * `true` SÓLO cuando el servidor (o el fake local) dice que el objeto no
 * existe. Ante la duda devuelve `false`: preferimos propagar un error a
 * degradar en silencio.
 */
export function isFoundationObjectMissing(_fn: string, error: FoundationErrorLike | null | undefined): boolean {
  if (!error) return false;
  const code = typeof error.code === 'string' ? error.code.trim() : '';
  if (code && MISSING_OBJECT_PATTERNS.some((pattern) => pattern.test(code))) return true;
  const message = typeof error.message === 'string' ? error.message.trim() : '';
  if (!message) return false;
  return MISSING_OBJECT_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Aviso de degradación. Va a `console.warn` a propósito: no hay logger
 * estructurado en el servidor y `audit_log` no es el sitio (esta degradación no
 * es un evento de auditoría, es una verdad sobre el despliegue). El prefijo es
 * estable para poder grepearlo.
 */
export function warnFoundationDegradation(code: string, detail: string): void {
  console.warn(`[policy-foundation:${code}] ${detail}`);
}
