// Queries for dashboard views. Pure aggregation stays in dashboard.ts.
import { DASHBOARD_DIMENSIONS } from '../lib/dashboard-shared.js';
import type { AuditResultType } from '../skills/audit/types.js';
import type { DashboardDimension, DashboardFilters } from '../lib/dashboard-shared.js';
import type { DashboardFilterOptions, DashboardSummary } from '../lib/dashboard.js';
import type { AuthContext } from './auth.js';
import { capabilitiesForRole } from './capabilities.js';
import { endOfDayUtc, startOfDayUtc } from './dashboard-filters.js';
import { mapProviderError } from './http.js';
import type { InsForgeClient } from './insforge.js';
import {
  aggregateAiCosts,
  aggregateQuality,
  aggregateSummary,
  DASHBOARD_MAX_ROWS,
} from './dashboard.js';
import type {
  AiCostsReport,
  ComparisonMetricRow,
  CostGranularity,
  DashboardMetricRow,
  ExactHumanReviewInput,
  HumanReviewInput,
  QualityReport,
} from './dashboard.js';

/** Proyección mínima para costes; no solicita identificadores personales. */
const AI_COSTS_COLUMNS =
  'id, case_id, created_at, model, provider_models, audit_status, latency_ms, ' +
  'attempts_count, attempts_cost_usd, attempts_total_tokens, attempts_prompt_tokens, ' +
  'attempts_completion_tokens, usage_cost_usd, usage_total_tokens, usage_prompt_tokens, ' +
  'usage_completion_tokens, country, campus, modality, project, responsible, guideline';

/** Proyección mínima para calidad; excluye PII y dictamen humano. */
const AI_QUALITY_COLUMNS =
  'id, created_at, case_status, audit_status, confidence, missing_evidence_count, ' +
  'country, channel, campus, modality, project, responsible, guideline';



/**
 * Aplica los filtros por dimensión. Solo se filtra por las dimensiones que la
 * vista actualmente proyecta; el tipo es mínimo (`eq`) porque este archivo no
 * necesita conocer toda la cadena de PostgREST.
 */
export function applyDimensionFilters<T extends { eq(column: string, value: unknown): T }>(
  query: T,
  filters: DashboardFilters,
): T {
  let filtered = query;
  for (const dimension of DASHBOARD_DIMENSIONS) {
    const value = filters[dimension];
    if (value !== null && value !== undefined) filtered = filtered.eq(dimension, value);
  }
  return filtered;
}



/**
 * Excluye los casos de PRUEBA de una métrica operativa.
 *
 * Se aplica EN SQL (`.eq('is_test', false)`) y ANTES del `count`/`limit`: filtrar
 * en memoria después del recorte contaría las pruebas dentro del total y
 * devolvería un número que no corresponde a ningún periodo real. La vista
 * `audit_dashboard_metrics` (y la de comparaciones) proyectan `is_test` desde la
 * migración `20261008130000_dashboard-view-test-owner-scope.sql`.
 *
 * No distingue de rol a propósito: una prueba NO es trabajo real para NADIE, ni
 * para el Gerente que ve todo. La visibilidad global no convierte una prueba en
 * una métrica operativa.
 */
export function applyTestScope<T extends { eq(column: string, value: unknown): T }>(query: T): T {
  return query.eq('is_test', false);
}



/**
 * Acota una lectura de dashboard a los casos del actor cuando su rol NO tiene
 * capacidad de lectura global (Asesor).
 *
 * Se aplica EN SQL y ANTES del `count`/`limit`. Antes esto se hacía en memoria
 * DESPUÉS del recorte (el TODO de `getOwnedCaseIds`): con más filas que
 * `DASHBOARD_MAX_ROWS` el Asesor veía un total subcontado y, peor, el `truncated`
 * y las opciones de dimensión describían filas ajenas. La vista proyecta
 * `created_by` justo para que el scope viaje en la consulta.
 */
function applyOwnerScope<T extends { eq(column: string, value: unknown): T }>(
  query: T,
  auth?: AuthContext,
): T {
  if (auth && !capabilitiesForRole(auth.role).canReadAllCases) {
    return query.eq('created_by', auth.sub);
  }
  return query;
}



/**
 * Valores presentes en la vista; los valores nulos o vacíos no crean opciones.
 *
 * Recibe el alcance autenticado: un Asesor solo ve las dimensiones de SUS casos y
 * ninguna opción debe provenir de un caso de prueba ni de un caso ajeno. Ofrecer
 * una opción que el actor no podría consultar sería un callejón sin salida
 * silencioso (elegirla devuelve cero filas).
 */
export async function getDashboardFilterOptions(
  client: InsForgeClient,
  auth?: AuthContext,
): Promise<DashboardFilterOptions> {
  const columns = DASHBOARD_DIMENSIONS.join(',');
  let query = client.database
    .from('audit_dashboard_metrics')
    .select(columns);
  query = applyOwnerScope(query, auth);
  query = applyTestScope(query);
  const { data, error } = await query.limit(DASHBOARD_MAX_ROWS);
  if (error) throw mapProviderError(error);

  const options: DashboardFilterOptions = {
    country: [],
    channel: [],
    campus: [],
    modality: [],
    project: [],
    responsible: [],
    guideline: [],
  };
  const sets = Object.fromEntries(DASHBOARD_DIMENSIONS.map((key) => [key, new Set<string>()])) as Record<
    DashboardDimension,
    Set<string>
  >;
  for (const row of (data ?? []) as unknown as Array<Record<DashboardDimension, unknown>>) {
    for (const dimension of DASHBOARD_DIMENSIONS) {
      const value = row[dimension];
      if (typeof value === 'string' && value.trim() !== '') sets[dimension].add(value.trim());
    }
  }
  for (const dimension of DASHBOARD_DIMENSIONS) {
    options[dimension] = [...sets[dimension]].sort((a, b) => a.localeCompare(b, 'es'));
  }
  return options;
}



// -----------------------------------------------------------------------------
// Consulta
// -----------------------------------------------------------------------------

/**
 * Lee la vista de métricas y devuelve el resumen ya agregado.
 * Los límites del rango son el primer y el último milisegundo del día, en UTC,
 * y ambos inclusivos: un filtro por día no puede perder la auditoría de las
 * 23:59:59.999.
 */
export async function getDashboardSummary(
  client: InsForgeClient,
  filters: DashboardFilters,
  auth?: AuthContext,
): Promise<DashboardSummary> {
  const fromIso = startOfDayUtc(filters.from);
  const toIso = endOfDayUtc(filters.to);

  let query = client.database
    .from('audit_dashboard_metrics')
    .select('*', { count: 'exact' })
    .gte('created_at', fromIso)
    .lte('created_at', toIso);
  if (filters.result !== null) query = query.eq('result', filters.result);
  if (filters.status !== null) query = query.eq('case_status', filters.status);
  query = applyDimensionFilters(query, filters);
  // Scope del actor y exclusión de pruebas, EN SQL y ANTES del count/limit.
  query = applyOwnerScope(query, auth);
  query = applyTestScope(query);

  // Orden DESCENDENTE. Con `ascending: true` + `limit(5000)` la ventana traía
  // las 5000 filas MÁS ANTIGUAS del rango, y como `recentCases` se construye
  // desde ellas, la tabla titulada "Casos recientes" mostraba los más viejos
  // cuando el periodo superaba el tope. En una herramienta de auditoría eso es
  // una lectura de datos incorrecta, no un detalle de presentación.
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .limit(DASHBOARD_MAX_ROWS);

  // Ningún stack trace ni detalle del proveedor al cliente: mapProviderError
  // traduce el error y sanea el mensaje (nada de tokens o URLs internas).
  if (error) throw mapProviderError(error);

  const rows = (data ?? []) as unknown as DashboardMetricRow[];
  return aggregateSummary(rows, filters, count ?? rows.length);
}



export async function getAiCosts(
  client: InsForgeClient,
  filters: DashboardFilters,
  granularity: CostGranularity,
  auth?: AuthContext,
): Promise<AiCostsReport> {
  const fromIso = startOfDayUtc(filters.from);
  const toIso = endOfDayUtc(filters.to);

  let query = client.database
    .from('audit_dashboard_metrics')
    // Columnas EXPLICITAS, no `*`. Esta ruta nunca devuelve datos personales, así
    // que pedir `student_identifier` (y las otras 20 columnas) sería hacer
    // viajar PII por la red —hasta 5000 filas por petición— para descartarla
    // justo después (minimización de datos, GDPR Art. 5(1)(c)). También acorta
    // el `count: 'exact'`, que con `*` cuenta sobre 24 columnas.
    .select(AI_COSTS_COLUMNS, { count: 'exact' })
    .gte('created_at', fromIso)
    .lte('created_at', toIso);
  // Esta ruta ignora `result` a propósito: el coste de una auditoría que falló
  // o que aún no termina también se pagó, y filtrar por dictamen lo ocultaría.
  if (filters.status !== null) query = query.eq('case_status', filters.status);
  query = applyDimensionFilters(query, filters);
  // Scope del actor y exclusión de pruebas, EN SQL y ANTES del count/limit.
  query = applyOwnerScope(query, auth);
  query = applyTestScope(query);

  const { data, error, count } = await query
    .order('created_at', { ascending: true })
    .limit(DASHBOARD_MAX_ROWS);

  // Ningún stack trace ni detalle del proveedor al cliente: mapProviderError
  // traduce el error y sanea el mensaje (nada de tokens o URLs internas).
  if (error) throw mapProviderError(error);

  const rows = (data ?? []) as unknown as DashboardMetricRow[];
  return aggregateAiCosts(rows, filters, granularity, count ?? rows.length);
}



/**
 * Lee la entrada humana del periodo: las comparaciones de la vista de
 * comparaciones y el conteo de revisiones humanas.
 *
 * DOS FUENTES, UNA TARJETA. `case_comparisons` responde de qué se midió la
 * coincidencia y `case_reviews` de cuántas personas registraron su decisión. Se
 * cuentan por separado porque son hechos distintos: una revisión sin comparación
 * cuenta igual, y una comparación sin revisión NO PUEDE existir (el `UNIQUE` de
 * `case_review_id` lo impide), así que la unión de abajo nunca inventa revisiones.
 *
 * MISMOS límites que `getDashboardSummary` (y a diferencia de `getAiCosts`, SÍ
 * filtra por `result`): la coincidencia es una propiedad del dictamen COMPARADO,
 * así que "solo las cancelaciones de venta" tiene que poder responderse. Aquí no
 * hay gasto que se pueda esconder por no tener `result`: las comparaciones sin
 * dictamen se excluyen solas al no estar `COMPLETED`.
 *
 * DELIBERADAMENTE SIN `catch` QUE DEVUELVA CEROES: una vista ausente es un fallo
 * de despliegue, y tragárselo publicaría "no hay revisión humana registrada" sobre
 * una base que SÍ la tiene. El error sale como `ApiError` con su 5xx y la UI lo
 * muestra como error de carga, que es lo que ocurrió. Convertir un fallo de
 * infraestructura en un "no hay datos" es la peor versión posible de la regla de
 * esta vista, porque el hueco es indistinguible de un periodo vacío.
 */
export async function getHumanReviewInput(
  client: InsForgeClient,
  filters: DashboardFilters,
  auth?: AuthContext,
): Promise<HumanReviewInput> {
  const fromIso = startOfDayUtc(filters.from);
  const toIso = endOfDayUtc(filters.to);

  // Fuente principal: comparaciones (qué se comparó y su estado).
  let compQuery = client.database
    .from('case_comparisons_dashboard_metrics')
    .select('*', { count: 'exact' })
    .gte('created_at', fromIso)
    .lte('created_at', toIso);

  if (filters.result !== null) compQuery = compQuery.eq('audit_result', filters.result);
  if (filters.status !== null) compQuery = compQuery.eq('case_status', filters.status);
  compQuery = applyDimensionFilters(compQuery, filters);
  // Scope del actor y exclusión de pruebas, EN SQL y ANTES del count/limit.
  compQuery = applyOwnerScope(compQuery, auth);
  compQuery = applyTestScope(compQuery);

  const { data: compsData, error: compsError, count: compsCount } = await compQuery.order('created_at', { ascending: true }).limit(DASHBOARD_MAX_ROWS);
  if (compsError) throw mapProviderError(compsError);
  const comparisons = (compsData ?? []) as ComparisonMetricRow[];
  const comparisonsAvailable = compsCount ?? comparisons.length;

  // Conteo de revisiones humanas dentro del periodo.
  //
  // El scope y la exclusión de pruebas NO se pueden aplicar en la tabla
  // `case_reviews` directamente (no tiene `is_test`), así que se filtran por el
  // CASO al que pertenecen con un embed `!inner` a `cases`: PostgREST resuelve
  // `cases.is_test=eq.false` y `cases.created_by=eq.<sub>` en la MISMA consulta,
  // sin traer los ids de todos los casos al servidor (un `.in` con miles de uuid
  // reventaría la URL y no escala).
  let reviewsQuery = client.database
    .from('case_reviews')
    .select('id,case_id,cases!inner(is_test,created_by)')
    .eq('cases.is_test', false)
    .gte('created_at', fromIso)
    .lte('created_at', toIso);
  if (auth && !capabilitiesForRole(auth.role).canReadAllCases) {
    reviewsQuery = reviewsQuery.eq('cases.created_by', auth.sub);
  }
  const { data: reviewsData, error: reviewsError } = await reviewsQuery.limit(DASHBOARD_MAX_ROWS);
  if (reviewsError) throw mapProviderError(reviewsError);
  const reviewsInRange = (reviewsData ?? []) as Array<{ id: string; case_id: string }>;
  const reviewIdsInRange = new Set(reviewsInRange.map((r) => r.id));

  // Las revisiones contadas son las del periodo MÁS las revisiones referenciadas
  // por comparaciones que cayeron en el periodo aunque la revisión esté fuera.
  const comparisonReviewIds = new Set(comparisons.map((c) => c.case_review_id).filter(Boolean as any));
  let reviewedCases = reviewIdsInRange.size;
  for (const id of comparisonReviewIds) {
    if (!reviewIdsInRange.has(id)) reviewedCases += 1;
  }

  return { reviewedCases, comparisons, comparisonsAvailable };
}



export async function getExactHumanReviewInput(
  client: InsForgeClient,
  audits: DashboardMetricRow[],
): Promise<ExactHumanReviewInput> {
  const auditsById = new Map(audits.map((audit) => [audit.id, audit]));
  const auditIds = [...auditsById.keys()];
  if (auditIds.length === 0) {
    return { reviews: [], reviewsAvailable: 0, auditsById };
  }
  const { data, error, count } = await client.database
    .from('case_reviews')
    .select('id,audit_id,result', { count: 'exact' })
    .in('audit_id', auditIds)
    .limit(DASHBOARD_MAX_ROWS);
  if (error) throw mapProviderError(error);

  const reviews = ((data ?? []) as Array<{ id: string; audit_id: string; result: AuditResultType }>)
    .filter((review) => auditsById.has(review.audit_id));
  return { reviews, reviewsAvailable: count ?? reviews.length, auditsById };
}


export async function getAiQuality(
  client: InsForgeClient,
  filters: DashboardFilters,
  auth?: AuthContext,
): Promise<QualityReport> {
  const fromIso = startOfDayUtc(filters.from);
  const toIso = endOfDayUtc(filters.to);

  let query = client.database
    .from('audit_dashboard_metrics')
    .select(AI_QUALITY_COLUMNS, { count: 'exact' })
    .gte('created_at', fromIso)
    .lte('created_at', toIso);
  if (filters.result !== null) query = query.eq('result', filters.result);
  if (filters.status !== null) query = query.eq('case_status', filters.status);
  query = applyDimensionFilters(query, filters);
  // Scope del actor y exclusión de pruebas, EN SQL y ANTES del count/limit.
  query = applyOwnerScope(query, auth);
  query = applyTestScope(query);

  const { data, error, count } = await query.order('created_at', { ascending: true }).limit(DASHBOARD_MAX_ROWS);

  // Ningún stack trace ni detalle del proveedor al cliente: mapProviderError
  // traduce el error y sanea el mensaje (nada de tokens o URLs internas).
  if (error) throw mapProviderError(error);

  const rows = (data ?? []) as unknown as DashboardMetricRow[];
  // Obtener la entrada humana (comparisons + reviewedCases) recortada por periodo y filtros.
  const humanInput = await getHumanReviewInput(client, filters, auth);
  // `aggregateQuality` acepta un HumanReviewInput y lo transforma en el
  // bloque humano que viaja al navegador.
  return aggregateQuality(rows, filters, count ?? rows.length, humanInput);
}
