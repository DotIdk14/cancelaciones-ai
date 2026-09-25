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
 * MEDIDO CONTRA EL BACKEND REAL DE INSFORGE — 2026-09-25
 * ============================================================================
 * `MISSING_OBJECT_PATTERNS` (abajo) decidió "este objeto de DB está ausente"
 * comparando el `code`/`message` del error contra formas tomadas de la
 * CONVENCIÓN de PostgREST/Postgres y de los fakes locales de este repo. Eso era
 * un SUPUESTO, y este bloque lo daba por verificado cuando no lo estaba. Ya no.
 *
 * Una sonda de SOLO LECTURA, ejecutada contra el proyecto real de producción
 * (`https://4pw4jdzv.us-west.insforge.app`) con la construcción de cliente de
 * esta misma app (`createServerClient` de `@insforge/sdk/ssr`, baseUrl + anon
 * key de `apps/web/.env`, camino anon-key), midió las tres formas de objeto
 * ausente de las que depende el camino de degradación. Cuerpos VERBATIM:
 *
 *   1. TABLA ausente — `from('fact_run_frozen_snapshots').select(…).eq(…).limit(1)`
 *      → HTTP 404
 *      `{"code":"42P01","details":null,"hint":null,"message":"relation \"public.fact_run_frozen_snapshots\" does not exist"}`
 *   2. COLUMNA ausente — `from('fact_extraction_runs').select('parent_fact_run_id')`
 *      → HTTP 400
 *      `{"code":"42703","details":null,"hint":null,"message":"column fact_extraction_runs.parent_fact_run_id does not exist"}`
 *   3. RPC ausente — `rpc('__probe__')`
 *      → HTTP 404
 *      `{"code":"PGRST202","details":"Searched for the function public.__probe__ without parameters or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.","hint":null,"message":"Could not find the function public.__probe__ without parameters in the schema cache"}`
 *   CONTROL — `from('fact_extraction_runs').select('id').limit(1)` → HTTP 200, `[]`.
 *      Auth, conectividad y el camino de PostgREST funcionan: las tres formas
 *      anteriores son ausencias reales, no una sonda que falla.
 *
 * `isFoundationObjectMissing` devuelve `true` para las TRES, emparejando por
 * `code` (`42P01`, `42703`, `PGRST202`). Los cuerpos observados están fijados
 * literalmente en `apps/web/src/server/facts/fact-run-snapshot.test.ts`: un
 * refactor que rompa el reconocimiento rompe la suite, no producción.
 *
 * ============================================================================
 * CORRECCIÓN: `error.code` SÍ se rellena en el camino `from()`/`rpc()`
 * ============================================================================
 * Este fichero afirmaba que `error.code` era siempre `undefined` y que, por
 * tanto, los patrones de `code` eran inertes. Era FALSO, y el razonamiento que
 * lo sostenía también. `InsForgeError` —que expone `.error` y NINGÚN `.code`—
 * lo usan sólo los caminos del SDK que NO son PostgREST (auth, storage, edge
 * functions). En `from()`/`rpc()` el error es un objeto PLANO
 * (`constructor.name === "Object"`, claves propias exactamente
 * `["code","details","hint","message"]`) que produce `@supabase/postgrest-js`
 * al parsear el cuerpo crudo de la respuesta, y ahí `code` viene poblado con el
 * código de Postgres/PostgREST. Por eso los tres cuerpos medidos se reconocen
 * principalmente por su `code`.
 *
 * ============================================================================
 * LO QUE LA MEDICIÓN NO CUBRE
 * ============================================================================
 * La sonda corrió por el camino ANON-KEY, SIN sesión de usuario. NO se midió la
 * forma de un fallo de PERMISIÓN (denegación RLS) bajo sesión autenticada, así
 * que no se afirma ninguna cobertura sobre ese caso. Es coherente con que una
 * denegación RLS llegue como error de negocio (`42501`) y por tanto NO ausencia,
 * pero eso es INFERENCIA a partir de los tests locales, no medición.
 *
 * Un patrón resultó MUERTO como emparejador de `message` y se deja en su sitio:
 * `/column "[^"]+" does not exist/i` (ver la nota junto al patrón). Es inocuo
 * porque la rama de `code` `42703` ya devuelve `true`; borrarlo sería cambiar
 * código que la medición no obliga a cambiar.
 *
 * ============================================================================
 * CONSECUENCIAS CONCRETAS
 * ============================================================================
 *   - `readFrozenSnapshot` (`apps/web/src/server/facts/fact-run-snapshot.ts`)
 *     NO lanza. Antes se afirmaba que sí, y que la evaluación abortaba antes de
 *     evaluarse. MEDIDO y FIJADO en tests: con el cuerpo real `42P01` casa la
 *     línea 210 y devuelve `{ row: null, tableAbsent: true }`; el `throw` de la
 *     línea 211 no se alcanza. `getFrozenEffectiveFacts` degrada a
 *     `source: 'LEGACY_REVIEW_APPLIED'` con `persistenceError: null` y un
 *     `console.warn` grepable de código estable
 *     (`FROZEN_SNAPSHOT_TABLE_ABSENT`). El pipeline de evaluación NO se rompe.
 *   - `persistPolicyEvaluationAtomically`
 *     (`apps/web/src/server/policy/evaluation-persistence.ts:130-131`) lanza
 *     `ENGINE_RUN_INSERT_FAILED` si su RPC no se reconoce. Esa lectura NO se ha
 *     remedido: sigue siendo lectura de código, no evidencia. En la práctica la
 *     forma 3 medida (`PGRST202`) SÍ se reconoce, con lo que ese camino degrada
 *     en vez de lanzar — pero no se ha ejecutado para comprobarlo.
 *
 * Mitigación real: APLICAR LA MIGRACIÓN. Reconocer la forma del error no es la
 * mitigación, es lo que evita que un `false` rompa el pipeline mientras la
 * migración siga sin aplicarse; la migración elimina la dependencia en lugar de
 * confiar en reconocer la forma. Y en cualquier caso la migración debe venir
 * acompañada de verificación en DEV, que la fase no tiene
 * (`docs/reports/POLICY-FOUNDATION-RECOVERY-REPORT.md` §13).
 *
 * ============================================================================
 * LO QUE SIGUE SIN AMPLIARSE
 * ============================================================================
 * DELIBERADAMENTE no se ha ampliado la lista de patrones. Las tres formas
 * productivas están medidas; añadir una forma más sin medirla contra el backend
 * real no es endurecer la detección, es adivinar. `UNKNOWN_IS_NOT_FALSE` y R-3
 * mandan: ante la duda se propaga el error, no se degrada en silencio.
 */

/**
 * Formas de error que se interpretan como "el objeto no está".
 *
 * Estado: los tres caminos de producción están MEDIDOS contra el backend real
 * de InsForge (ver el bloque "MEDIDO CONTRA EL BACKEND REAL" de la cabecera de
 * este fichero, 2026-09-25) y los cuerpos observados están fijados en
 * `fact-run-snapshot.test.ts`. El resto de formas proceden de la convención de
 * PostgREST/Postgres y de los fakes locales, y siguen sin estar medidas.
 */
const MISSING_OBJECT_PATTERNS: readonly RegExp[] = [
  // PostgREST: PGRST202 = función ausente del schema cache (MEDIDO),
  // PGRST204 = columna ausente, PGRST205 = tabla ausente.
  /PGRST20[245]\b/,
  /could not find the (?:table|function|column)/i,
  // Postgres: 42P01 undefined_table (MEDIDO), 42883 undefined_function,
  // 42703 undefined_column (MEDIDO).
  /\b42P01\b/,
  /\b42883\b/,
  /\b42703\b/,
  /undefined_(?:table|function|column|object)/i,
  /relation "[^"]+" does not exist/i,
  // PATRÓN MUERTO, INOCUO. MEDIDO: Postgres emite el nombre de columna SIN
  // comillas en el mensaje de PostgREST, y el real es
  // `column fact_extraction_runs.parent_fact_run_id does not exist`, así que este
  // patrón nunca casa. Se deja deliberadamente: el cuerpo real lo lleva la
  // rama de `code` `42703`, que ya devuelve `true`, y cambiarlo sin medición
  // sería tocar código que funciona. Si alguien lo "arregla", el test
  // `el patrón muerto de columna NO casa con el mensaje real` le dirá cuál es
  // la forma verdadera.
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
 * ADVERTENCIA: este es el ÚNICO punto de decisión de toda la fase. Las tres
 * formas que ve producción hoy están MEDIDAS contra el backend real de
 * InsForge (ver la cabecera de este fichero); las demás proceden de la
 * convención de PostgREST/Postgres y de los fakes. Con la migración sin
 * aplicar, un `false` aquí no degrada: rompe el pipeline de evaluación en
 * producción. La sonda corrió por el camino anon-key: la forma de un fallo de
 * permiso (RLS) bajo sesión autenticada NO está medida.
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
