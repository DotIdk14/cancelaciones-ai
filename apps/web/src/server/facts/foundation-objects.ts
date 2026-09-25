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
 *
 * ============================================================================
 * SUPUESTO NO VERIFICADO — LA MAYOR DEPENDENCIA DE PRODUCCIÓN DE LA FASE
 * ============================================================================
 * `MISSING_OBJECT_PATTERNS` (abajo) decide "este objeto de DB está ausente"
 * comparando el `code`/`message` del error contra un conjunto de formas que
 * provienen de:
 *   1. la CONVENCIÓN de PostgREST/Postgres (`PGRST202/204/205`, `42P01`,
 *      `42883`, `42703`, `relation "…" does not exist`, …), y
 *   2. los fakes locales de este repo
 *      (`apps/web/src/server/facts/foundation-fake-db.ts` y el `DurableDb` de
 *      `apps/web/src/server/jobs/audit-queue.e2e.test.ts`), que hardcodean
 *      exactamente esas cadenas.
 *
 * **NUNCA se ha confirmado contra el backend real de InsForge.** La migración
 * 20260925120000_policy-foundation-immutability.sql NO está aplicada, así que
 * hoy todo camino nuevo está ciego a los objetos de la migración y depende
 * ENTERO de esta función para degradar en vez de romper. Si el backend real
 * señala una tabla o función ausente con una forma distinta, NO degrada: lanza.
 * Consecuencias concretas verificadas por lectura:
 *   - `readFrozenSnapshot` (`apps/web/src/server/facts/fact-run-snapshot.ts`)
 *     lanza y la evaluación aborta antes de evaluarse.
 *   - `persistPolicyEvaluationAtomically`
 *     (`apps/web/src/server/policy/evaluation-persistence.ts`) lanza
 *     `ENGINE_RUN_INSERT_FAILED` y el pipeline de evaluación de producción se
 *     rompe, o el job reintenta indefinidamente.
 *
 * Mitigación real: APLICAR LA MIGRACIÓN elimina esta dependencia para la
 * lectura del snapshot congelado y para los caminos RPC, porque los objetos
 * dejan de faltar. Verificarla exige credenciales DEV, que la fase no tiene
 * (`docs/reports/POLICY-FOUNDATION-RECOVERY-REPORT.md` §13).
 *
 * DELIBERADAMENTE NO se ha ampliado la lista de patrones: reconocer una forma
 * de error que no se puede observar contra el backend real no es endurecer la
 * detección, es adivinar. `UNKNOWN_IS_NOT_FALSE` y R-3 manda: ante la duda se
 * propaga el error, no se degrada en silencio.
 */

/**
 * Formas de error que se interpretan como "el objeto no está".
 *
 * OJO: este conjunto NO está verificado contra el backend real de InsForge. Ver
 * el bloque "SUPUESTO NO VERIFICADO" de la cabecera de este fichero. Las formas
 * proceden de la convención de PostgREST/Postgres y de los fakes locales, y son
 * la única razón por la que producción sigue funcionando con la migración sin
 * aplicar.
 */
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
 *
 * ADVERTENCIA: este es el ÚNICO punto de decisión de toda la fase. Los códigos
 * que reconoce son un SUPUESTO NO VERIFICADO contra el backend real de
 * InsForge (ver la cabecera de este fichero). Con la migración sin aplicar, un
 * `false` aquí no degrada: rompe el pipeline de evaluación en producción.
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
