import { responsibleNames } from './dashboard-responsibles.js';
// Queries for dashboard views. Pure aggregation stays in dashboard.ts.
import { aggregateMonthlyActivity } from './dashboard-activity.js';
import { aggregateEvaluation, evaluationCase, type EvaluationMetricRow } from './dashboard-evaluation.js';
import { CASE_DIMENSION_COLUMN, DASHBOARD_DIMENSIONS } from '../lib/dashboard-shared.js';
import type { DashboardDimension, DashboardFilters } from '../lib/dashboard-shared.js';
import { salesChannelFilterValues } from '../lib/sales-channel-catalog.js';
import type { DashboardFilterOptions, DashboardSummary } from '../lib/dashboard.js';
import type { AuthContext } from './auth.js';
import { capabilitiesForRole } from './capabilities.js';
import { endOfDayUtc, startOfDayUtc } from './dashboard-filters.js';
import { mapProviderError } from './http.js';
import type { InsForgeClient } from './insforge.js';
import { countCaseBuckets } from './cases.js';
import { DASHBOARD_PAGE_SIZE } from './dashboard-contracts.js';
import {
  aggregateAiCosts,
  aggregateQuality,
  aggregateSummary,
} from './dashboard.js';
import type {
  AiCostsReport,
  ComparisonMetricRow,
  CostGranularity,
  DashboardMetricRow,
  HumanReviewInput,
  QualityReport,
} from './dashboard.js';

/** InsForge/PostgREST limita el tamaño de una respuesta aunque la consulta no lo haga. */
const PAGE_SIZE = DASHBOARD_PAGE_SIZE;

/** Lee todas las páginas de una consulta filtrada, antes de agregar KPI. */
async function readAllPages<T>(query: {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: unknown }>;
}): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) throw mapProviderError(error);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

const ACTIVITY_COLUMNS = 'execution_kind,call_metrics,human_result,id,case_id,created_at,model,provider,audit_status,case_status,latency_ms,error_category,attempt_number,result,confidence,missing_evidence_count,provider_models,attempts_count,attempts_cost_usd,attempts_total_tokens,attempts_prompt_tokens,attempts_completion_tokens,usage_cost_usd,usage_total_tokens,usage_prompt_tokens,usage_completion_tokens,country,channel,sales_channel,campus,modality,project,responsible,guideline,is_reaudit,cost_incomplete,tokens_incomplete,usage_is_aggregate';
const COST_COLUMNS = ACTIVITY_COLUMNS.split(',').filter(column => !['result','confidence','missing_evidence_count'].includes(column)).join(',');
const EVALUATION_COLUMNS = 'id,case_id,created_at,case_status,audit_status,result,confidence,missing_evidence_count,country,channel,sales_channel,campus,modality,project,responsible,guideline,external_case_id,case_review_id,review_audit_id,advisor_result,final_result,comparison_id,comparison_status,comparison_agrees,comparison_confidence,latest_execution_status';

/**
 * Aplica los filtros por dimensión. Solo se filtra por las dimensiones que la
 * vista actualmente proyecta; el tipo es mínimo (`eq`) porque este archivo no
 * necesita conocer toda la cadena de PostgREST.
 */
export function applyDimensionFilters<T extends { eq(column: string, value: unknown): T; in?(column: string, values: unknown[]): T }>(
  query: T,
  filters: DashboardFilters,
): T {
  let filtered = query;
  for (const dimension of DASHBOARD_DIMENSIONS) {
    const value = filters[dimension];
    if (value !== null && value !== undefined) {
      if (dimension === 'salesChannel' && filtered.in) {
        filtered = filtered.in(dimension, salesChannelFilterValues(value));
      } else {
        filtered = filtered.eq(dimension, value);
      }
    }
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
 * capacidad de lectura global.
 *
 * Se aplica EN SQL y ANTES del `count`/`limit`. Antes esto se hacía en memoria
 * DESPUÉS del recorte: con más filas que
 * el Asesor veía un total subcontado y, peor, el `truncated`
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
 * Recibe el alcance autenticado: los miembros ven dimensiones de todos los
 * casos; ninguna opción proviene de casos de prueba. Así cada filtro disponible
 * corresponde a filas que el actor puede consultar.
 */
export async function getDashboardFilterOptions(
  client: InsForgeClient,
  auth?: AuthContext,
): Promise<DashboardFilterOptions> {
  const columns = DASHBOARD_DIMENSIONS.map((dimension) =>
    `${dimension}:${CASE_DIMENSION_COLUMN[dimension]}`,
  ).join(',');
  let query = client.database
    .from('audit_activity_metrics_with_sales_channel')
    .select(columns);
  query = applyOwnerScope(query, auth);
  query = applyTestScope(query);
  query = query.order('id', { ascending: true });
  const data = await readAllPages<Record<DashboardDimension, unknown>>(query as never);

  const options: DashboardFilterOptions = {
    country: [],
    salesChannel: [],
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
  for (const row of data) {
    for (const dimension of DASHBOARD_DIMENSIONS) {
      const value = row[dimension];
      if (typeof value === 'string' && value.trim() !== '') sets[dimension].add(value.trim());
    }
  }
  for (const dimension of DASHBOARD_DIMENSIONS) {
    options[dimension] = [...sets[dimension]].sort((a, b) => a.localeCompare(b, 'es'));
  }
  const labels = await responsibleNames(client, options.responsible);
  if (Object.keys(labels).length) options.responsibleLabels = labels;
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
    .from('audit_activity_metrics_with_sales_channel')
    .select(ACTIVITY_COLUMNS, { count: 'exact' })
    .gte('created_at', fromIso)
    .lte('created_at', toIso);
  if (filters.result !== null) query = query.eq('result', filters.result);
  if (filters.status !== null) query = query.eq('case_status', filters.status);
  query = applyDimensionFilters(query, filters);
  // Scope del actor y exclusión de pruebas, EN SQL y ANTES del count/limit.
  query = applyOwnerScope(query, auth);
  query = applyTestScope(query);

  query = query.order('created_at', { ascending: false }).order('id', { ascending: false });
  const rows = await readAllPages<DashboardMetricRow>(query as never);
  const canReadConsumption = capabilitiesForRole(auth?.role).canManageCases;
  const canReviewOwnCases = capabilitiesForRole(auth?.role).canReviewOwnCases;
  const [caseBuckets, advisorAssignmentBuckets, comparisons] = await Promise.all([
    auth ? countCaseBuckets(client, auth, { createdFrom: fromIso, createdTo: toIso, excludeTests: true, scopeToActor: false }) : Promise.resolve(null),
    auth && canReviewOwnCases
      ? countCaseBuckets(client, auth, { assignedTo: auth.sub, excludeTests: true, scopeToActor: false })
      : Promise.resolve(null),
    canReadConsumption ? getComparisonActivity(client, filters, auth) : Promise.resolve([]),
  ]);
  const caseProgress = caseBuckets ? {
    total: caseBuckets.ALL,
    drafts: caseBuckets.DRAFTS,
    pendingAudit: caseBuckets.PENDING_AUDIT,
    pendingAdvisor: caseBuckets.PENDING_ADVISOR,
    pendingCoordinator: caseBuckets.PENDING_COORDINATOR,
    finalized: caseBuckets.COMPLETED,
    errors: caseBuckets.ERRORS,
  } : null;
  const advisorAssignments = advisorAssignmentBuckets ? {
    total: advisorAssignmentBuckets.ALL,
    drafts: advisorAssignmentBuckets.DRAFTS,
    pendingAudit: advisorAssignmentBuckets.PENDING_AUDIT,
    pendingAdvisor: advisorAssignmentBuckets.PENDING_ADVISOR,
    pendingCoordinator: advisorAssignmentBuckets.PENDING_COORDINATOR,
    finalized: advisorAssignmentBuckets.COMPLETED,
    errors: advisorAssignmentBuckets.ERRORS,
  } : null;
  let identities = null;
  try { const result = await client.database.rpc('dashboard_request_identities', { p_case_ids: [...new Set(rows.map(row=>row.case_id))] });
    if (!result.error && result.data) identities = { ...(result.data as {students:number;tickets:number;caseFiles:number;requests:number}),auditExecutions:rows.length };
  } catch { /* Contadores no disponibles hasta validar la migración; no inventar ceros. */ }
  return { ...aggregateSummary(rows, filters, rows.length), caseProgress, ...(canReviewOwnCases ? { advisorAssignments } : {}), ...(canReadConsumption ? { activity: aggregateMonthlyActivity(rows, comparisons) } : {}), identities };
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
    .from('audit_activity_metrics_with_sales_channel')
    // Columnas EXPLICITAS, no `*`. Esta ruta nunca devuelve datos personales, así
    // que pedir `student_identifier` (y las otras 20 columnas) sería hacer
    // viajar PII por la red —hasta 5000 filas por petición— para descartarla
    // justo después (minimización de datos, GDPR Art. 5(1)(c)). También acorta
    // el `count: 'exact'`, que con `*` cuenta sobre 24 columnas.
    .select(COST_COLUMNS, { count: 'exact' })
    .gte('created_at', fromIso)
    .lte('created_at', toIso);
  // Esta ruta ignora `result` a propósito: el coste de una auditoría que falló
  // o que aún no termina también se pagó, y filtrar por dictamen lo ocultaría.
  if (filters.status !== null) query = query.eq('case_status', filters.status);
  query = applyDimensionFilters(query, filters);
  // Scope del actor y exclusión de pruebas, EN SQL y ANTES del count/limit.
  query = applyOwnerScope(query, auth);
  query = applyTestScope(query);

  query = query.order('created_at', { ascending: true }).order('id', { ascending: true });
  const rows = await readAllPages<DashboardMetricRow>(query as never);
  const comparisons = await getComparisonActivity(client, { ...filters, result: null }, auth);
  const all = [...rows, ...comparisons];
  return { ...aggregateAiCosts(all, filters, granularity, all.length), activity: aggregateMonthlyActivity(rows, comparisons, granularity) };
}




/** Consumo por ejecución de comparación, incluidas las versiones archivadas. */
async function getComparisonActivity(client: InsForgeClient, filters: DashboardFilters, auth?: AuthContext): Promise<DashboardMetricRow[]> {
  let query = client.database.from('comparison_activity_metrics_with_sales_channel').select(ACTIVITY_COLUMNS)
    .gte('created_at', startOfDayUtc(filters.from)).lte('created_at', endOfDayUtc(filters.to));
  if (filters.result !== null) query = query.eq('result', filters.result);
  if (filters.status !== null) query = query.eq('case_status', filters.status);
  query = applyTestScope(applyOwnerScope(applyDimensionFilters(query, filters), auth));
  return readAllPages<DashboardMetricRow>(query.order('created_at', { ascending: true }).order('id', { ascending: true }) as never);
}

async function getEvaluationRows(client: InsForgeClient, filters: DashboardFilters, auth?: AuthContext, historical = false): Promise<EvaluationMetricRow[]> {
  let query = client.database.from(historical ? 'audit_evaluation_metrics_with_sales_channel' : 'current_audit_evaluation_metrics_with_sales_channel').select(EVALUATION_COLUMNS)
    .gte('created_at', startOfDayUtc(filters.from)).lte('created_at', endOfDayUtc(filters.to));
  if (filters.result !== null) query = query.eq('result', filters.result);
  if (filters.status !== null) query = query.eq('case_status', filters.status);
  if (filters.evaluation === 'WITHOUT_CONFIDENCE') query = query.eq('has_valid_confidence', false).eq('audit_status', 'COMPLETED');
  else if (filters.evaluation === 'PENDING_EVALUATION') query = query.eq('has_final_resolution', false).eq('audit_status', 'COMPLETED');
  else if (filters.evaluation === 'ISSUED') query = query.eq('audit_status', 'COMPLETED');
  else if (filters.evaluation === 'FINALIZED') query = query.eq('has_final_resolution', true);
  else if (filters.evaluation) query = query.eq('evaluation_state', filters.evaluation);
  query = applyTestScope(applyOwnerScope(applyDimensionFilters(query, filters), auth));
  return readAllPages<EvaluationMetricRow>(query.order('created_at', { ascending: false }).order('id', { ascending: false }) as never);
}

/** Resolución final y comparación de la misma versión; la fecha de revisión no cambia la cohorte. */
function humanInputForRows(rows: EvaluationMetricRow[]): HumanReviewInput {
  const details = rows.map(evaluationCase);
  const comparisons = rows.flatMap((row, index) => {
    const detail = details[index]!;
    if (!detail.finalResolution || !detail.comparisonId) return [];
    return [{ id: detail.comparisonId, case_review_id: row.case_review_id, case_id: row.case_id,
      case_status: row.case_status, audit_result: row.result, status: row.comparison_status,
      created_at: row.created_at, agrees: detail.substantiveAgreement, confidence: detail.comparisonConfidence,
      human_result: detail.finalResolution } as ComparisonMetricRow];
  });
  return { reviewedCases: details.filter(row => row.finalResolution !== null).length, comparisons, comparisonsAvailable: comparisons.length };
}

export async function getHumanReviewInput(client: InsForgeClient, filters: DashboardFilters, auth?: AuthContext): Promise<HumanReviewInput> {
  return humanInputForRows(await getEvaluationRows(client, filters, auth));
}

export async function getAiQuality(client: InsForgeClient, filters: DashboardFilters, auth?: AuthContext): Promise<QualityReport> {
  const rows = await getEvaluationRows(client, filters, auth);
  const history = await getEvaluationRows(client, filters, auth, true);
  const report = aggregateQuality(rows, filters, rows.length, humanInputForRows(rows));
  report.evaluation = { ...aggregateEvaluation(rows, history.length), historicalRows: history.map(evaluationCase) };
  const names = await responsibleNames(client, [...rows, ...history].map(row => row.responsible));
  for (const item of [...report.evaluation.rows, ...report.evaluation.historicalRows ?? []]) {
    item.responsibleName = item.responsible ? names[item.responsible] ?? null : null;
  }
  report.humanReview.message = 'Concordancia con la resolución final humana; no demuestra corrección absoluta. Una versión vigente por expediente, seleccionada antes del rango y los filtros. Las propuestas del Asesor siguen pendientes hasta el cierre del Coordinador.';
  return report;
}

