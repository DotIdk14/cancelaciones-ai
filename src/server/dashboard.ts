// =============================================================================
// Dashboard ÔÇö agregaci├│n de m├®tricas de auditor├¡a.
// =============================================================================
// La agregaci├│n (`aggregateSummary`) es PURA: recibe filas y devuelve el
// `DashboardSummary` que consume la UI, sin tocar red ni base de datos. Solo
// `getDashboardSummary` habla con InsForge, y lo hace leyendo la vista
// `public.audit_dashboard_metrics`, que proyecta escalares de `audits`+`cases`.
//
// Aqu├¡ no hay criterio: los grupos de resoluci├│n salen de `RESULT_TO_GROUP`
// (src/lib/labels.ts) y la banda de confianza de los umbrales de ese mismo
// archivo. Este m├│dulo cuenta, no dictamina.
// =============================================================================

import { AUDIT_RESULTS, type AuditResultType, type CaseStatus, type ErrorCategory } from '../skills/audit/types.js';
import {
  CONFIDENCE_HIGH_THRESHOLD,
  CONFIDENCE_MEDIUM_THRESHOLD,
  RESOLUTION_GROUPS,
  RESULT_TO_GROUP,
  type ConfidenceBand,
  type ResolutionGroup,
} from '../lib/labels.js';
import type {
  DashboardFilters,
  DashboardDimension,
  DashboardFilterOptions,
  DashboardKpi,
  DashboardSummary,
  MissingEvidenceBucket,
  RecentCaseRow,
  ResolutionSplitPoint,
  ResultBreakdownPoint,
  TimelinePoint,
} from '../lib/dashboard.js';
import type { AuthContext } from './auth.js';
import type { AuditStatus } from './cases.js';
import { CASE_DIMENSIONS, CASE_DIMENSION_COLUMN, endOfDayUtc, startOfDayUtc } from './dashboard-filters.js';
import { mapProviderError } from './http.js';
import type { InsForgeClient } from './insforge.js';
// El vocabulario de los estados de una comparaci├│n vive UNA vez, en la capa que
// escribe esas filas. Importarlo (s├│lo tipo, sin coste en runtime) evita que el
// dashboard tenga su propia lista y que las dos se separen sin que nada falle.
import type { ComparisonStatusRow } from './reviews.js';

// El tipo vive en `src/lib/dashboard.ts` (├║nica definici├│n, tambi├®n la usa la
// UI). Se reexporta para no obligar a los importadores a saber de d├│nde viene.
export type { DashboardFilters };

/** Fila de `public.audit_dashboard_metrics`. Solo escalares: nada de jsonb crudo. */
export interface DashboardMetricRow {
  id: string;
  case_id: string;
  case_status: CaseStatus;
  student_identifier: string | null;
  audit_status: AuditStatus;
  model: string;
  provider: string;
  latency_ms: number | null;
  error_category: ErrorCategory | null;
  attempt_number: number | null;
  created_at: string;
  result: AuditResultType | null;
  confidence: number | null;
  missing_evidence_count: number | null;
  usage_cost_usd: number | null;
  usage_total_tokens: number | null;
  usage_prompt_tokens: number | null;
  usage_completion_tokens: number | null;
  provider_models: string[] | null;
  attempts_cost_usd: number | null;
  attempts_total_tokens: number | null;
  attempts_prompt_tokens: number | null;
  attempts_completion_tokens: number | null;
  /** N┬║ de intentos reales de la llamada (elementos de `openrouterAttempts`). */
  attempts_count: number;
  country: string | null;
  campus: string | null;
  modality: string | null;
  project: string | null;
  responsible: string | null;
  guideline: string | null;
}

const DASHBOARD_DIMENSIONS: readonly DashboardDimension[] = [
  'country',
  'campus',
  'modality',
  'project',
  'responsible',
  'guideline',
];

/**
 * Aplica los filtros por dimensi├│n. Solo se filtra por las dimensiones que la
 * vista actualmente proyecta; el tipo es m├¡nimo (`eq`) porque este archivo no
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

/** Tope de filas le├¡das de la vista. Si la vista trae m├ís, `truncated` va en `true`. */
export const DASHBOARD_MAX_ROWS = 5000;

/** Valores presentes en la vista; los valores nulos o vac├¡os no crean opciones. */
export async function getDashboardFilterOptions(client: InsForgeClient): Promise<DashboardFilterOptions> {
  const columns = DASHBOARD_DIMENSIONS.join(',');
  const { data, error } = await client.database
    .from('audit_dashboard_metrics')
    .select(columns)
    .limit(DASHBOARD_MAX_ROWS);
  if (error) throw mapProviderError(error);

  const options: DashboardFilterOptions = {
    country: [],
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

/** Filas de la tabla "casos recientes". */
const RECENT_CASES_LIMIT = 5;

/** Orden fijo de las categor├¡as del donut: siempre las 3, aunque valgan 0. */
const SPLIT_ORDER: readonly ResolutionGroup[] = RESOLUTION_GROUPS;

/**
 * `RESULT_TO_GROUP` indexado de forma parcial: `result` sale de `result_json`
 * (jsonb libre, escrito por el adaptador), as├¡ que puede traer un valor de otra
 * versi├│n que no exista en el mapa. Eso se trata como "dato ausente", no como
 * fallo.
 */
const RESULT_GROUP_BY_RESULT: Partial<Record<AuditResultType, ResolutionGroup>> = RESULT_TO_GROUP;

// -----------------------------------------------------------------------------
// Utilidades puras
// -----------------------------------------------------------------------------

/**
 * Bucket de d├¡a en UTC. Se usa `toISOString()` y NUNCA la zona horaria local a
 * prop├│sito: la serie temporal es un dato compartido, y si dependiera del
 * navegador, un caso de las 23:00 se contar├¡a en un d├¡a distinto seg├║n d├│nde se
 * mirara la gr├ífica (en UTCÔêÆ5, en el d├¡a anterior). Con UTC, dos personas ven el
 * mismo periodo aunque est├®n en paises distintos.
 */
function utcDayBucket(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso.slice(0, 10);
  return new Date(ms).toISOString().slice(0, 10);
}

function millisOf(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * `true` si `candidate` es al menos tan reciente como `current`. El `>=` es
 * deliberado: en empate de timestamp gana la fila que aparece DESPU├ëS en el
 * array, que es la misma fila que quedar├¡a primera con un
 * `ORDER BY created_at DESC` estable.
 */
function isSameOrNewer(candidate: DashboardMetricRow, current: DashboardMetricRow): boolean {
  return millisOf(candidate.created_at) >= millisOf(current.created_at);
}

/** Auditor├¡a vigente de cada caso: la de `created_at` m├ís reciente. */
function currentAuditsByCase(rows: DashboardMetricRow[]): DashboardMetricRow[] {
  const latest = new Map<string, DashboardMetricRow>();
  for (const row of rows) {
    const previous = latest.get(row.case_id);
    if (previous === undefined || isSameOrNewer(row, previous)) {
      latest.set(row.case_id, row);
    }
  }
  return [...latest.values()];
}

/** Grupo de resoluci├│n de un resultado, o `null` si no se puede clasificar. */
function groupForResult(result: AuditResultType | null): ResolutionGroup | null {
  if (result === null) return null;
  return RESULT_GROUP_BY_RESULT[result] ?? null;
}

/** Porcentaje redondeado a 1 decimal. Nunca `NaN`: si no hay denominador, 0. */
function percentage(part: number, total: number): number {
  if (total <= 0) return 0;
  const value = (part / total) * 100;
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10) / 10;
}

/**
 * Estados TERMINALES de una auditor├¡a: ya emiti├│ dictamen (`COMPLETED`) o ya
 * cerr├│ en fallo (`ERROR`). `RUNNING` NO es terminal: la auditor├¡a sigue viva.
 */
const TERMINAL_AUDIT_STATUSES: ReadonlySet<AuditStatus> = new Set<AuditStatus>(['COMPLETED', 'ERROR']);

/** `true` si la auditor├¡a ya cerr├│, emitiendo dictamen o fallando. */
function isTerminalAudit(row: DashboardMetricRow): boolean {
  return TERMINAL_AUDIT_STATUSES.has(row.audit_status);
}

/** Los tres contadores de grupo: se acumulan en los KPIs y se reparten en el donut. */
interface GroupCounts {
  granted: number;
  needsRuling: number;
  insufficient: number;
}

/** Acumula `+1` en la categor├¡a del grupo. */
function bumpGroup(counts: GroupCounts, group: ResolutionGroup): void {
  if (group === 'CONCEDIDAS') counts.granted += 1;
  else if (group === 'REQUIERE_DICTAMINACION') counts.needsRuling += 1;
  else counts.insufficient += 1;
}

// -----------------------------------------------------------------------------
// Timeline
// -----------------------------------------------------------------------------

/**
 * Serie temporal por d├¡a UTC.
 *
 * SEM├üNTICA DELIBERADAMENTE DISTINTA DE LA DE LOS KPIs:
 * la `timeline` muestra el **volumen de dict├ímenes emitidos por d├¡a** (un caso
 * reauditado cuenta una vez por cada dictamen emitido). Los KPIs cuentan **cada
 * caso una sola vez**, por su estado vigente. Por eso ambos n├║meros no tienen por
 * qu├® coincidir.
 *
 * Se agrupan TODAS las filas (no solo las vigentes por caso), porque lo que
 * mide la gr├ífica es la actividad del periodo: los dict├ímenes emitidos, no el
 * estado final de cada caso.
 *
 * Reglas:
 *  - Cada fila `COMPLETED` cuenta en SU propio grupo, seg├║n `RESULT_TO_GROUP`.
 *  - Las filas `ERROR` y `RUNNING` no aportan a ninguno de los tres grupos. Los
 *    errores se miden aparte, en su propio KPI, y un dictamen ausente no es un
 *    dictamen contrario. Por eso un d├¡a CON dict├ímenes nunca sale en 0/0/0,
 *    aunque su ├║ltima auditor├¡a haya sido un ERROR (si manda solo la ├║ltima del
 *    d├¡a, el d├¡a entero se pierde).
 *  - Solo emite punto un d├¡a con al menos un dictamen. Un d├¡a sin dict├ímenes
 *    tampoco aporta volumen, y un punto en cero ser├¡a una barra plana que
 *    inventa actividad donde no la hubo.
 */
function buildTimeline(rows: DashboardMetricRow[]): TimelinePoint[] {
  const byDay = new Map<string, GroupCounts>();

  for (const row of rows) {
    // Solo `COMPLETED` emite dictamen: `ERROR` y `RUNNING` quedan fuera de los
    // tres grupos por dise├▒o, no por oversight.
    if (row.audit_status !== 'COMPLETED') continue;
    // `result` ausente o de otra versi├│n: es dato ausente, no un grupo inventado.
    const group = groupForResult(row.result);
    if (group === null) continue;

    const day = utcDayBucket(row.created_at);
    const counts = byDay.get(day);
    if (counts === undefined) {
      const fresh: GroupCounts = { granted: 0, needsRuling: 0, insufficient: 0 };
      bumpGroup(fresh, group);
      byDay.set(day, fresh);
      continue;
    }
    bumpGroup(counts, group);
  }

  const timeline: TimelinePoint[] = [];
  // Orden ascendente: `YYYY-MM-DD` ordena lexicogr├íficamente igual que por fecha.
  for (const day of [...byDay.keys()].sort()) {
    const counts = byDay.get(day);
    if (counts === undefined) continue;
    timeline.push({
      bucket: day,
      granted: counts.granted,
      needsRuling: counts.needsRuling,
      insufficient: counts.insufficient,
    });
  }
  return timeline;
}

// -----------------------------------------------------------------------------
// Agregaci├│n
// -----------------------------------------------------------------------------

/**
 * Agrega las filas de la vista en el `DashboardSummary` que consume la UI.
 * Pura: sin red, sin reloj (salvo `generatedAt`) y sin efectos secundarios.
 *
 * `totalAvailable` es el total de filas que la base dice que hay (count exacto),
 * no el tama├▒o de `rows`: es lo ├║nico que permite avisar de una truncaci├│n.
 */
export function aggregateSummary(
  rows: DashboardMetricRow[],
  filters: DashboardFilters,
  totalAvailable: number,
): DashboardSummary {
  const current = currentAuditsByCase(rows);

  // POR QU├ë UN CASO EN CURSO QUEDA FUERA DEL DENOMINADOR:
  // `RUNNING` no ha emitido dictamen ni ha fallado, as├¡ que el caso todav├¡a no
  // est├í auditado: meterlo en `auditedCases` lo inflar├¡a y, sobre todo, hacerlo
  // aparecer en `errors` har├¡a que una tarjeta titulada "Errores" mintiera. Una
  // auditor├¡a EN CURSO no es un fallo. Por lo tanto `auditedCases` cuenta solo
  // los casos cuya auditor├¡a vigente es TERMINAL (`COMPLETED` o `ERROR`), y los
  // cuatro grupos suman exactamente ese n├║mero.
  //
  // Matiz: si un `COMPLETED` llega con `result` nulo o de otra versi├│n, queda
  // sin grupo y sin ser error (dato ausente, no fallo). Eso romper├¡a el reparto,
  // pero es una forma defensiva: el contrato Zod garantiza `COMPLETED` ÔçÆ
  // resultado v├ílido, y as├¡ nunca ocurre con datos reales.
  const terminal = current.filter(isTerminalAudit);
  const auditedCases = terminal.length;
  const casesWithMissingEvidence = terminal.filter((row) => (row.missing_evidence_count ?? 0) > 0).length;

  const counts: GroupCounts = { granted: 0, needsRuling: 0, insufficient: 0 };
  let errors = 0;

  // Todos los resultados en cero desde el principio: la leyenda del desglose es
  // estable aunque no haya ninguno (y el reparto suma lo mismo que los KPIs,
  // porque cuenta las MISMAS auditor├¡as vigentes).
  const byResultCounts = new Map<AuditResultType, number>();
  for (const result of AUDIT_RESULTS) byResultCounts.set(result, 0);

  for (const row of terminal) {
    // `terminal` solo contiene COMPLETED y ERROR, as├¡ que lo que queda aqu├¡ es
    // COMPLETED. `ERROR` es el ├║nico estado no completado que es un fallo real.
    if (row.audit_status === 'ERROR') {
      errors += 1;
      continue;
    }
    // `result` sale de `result_json` (jsonb libre): puede traer un valor de otra
    // versi├│n. `Map.has` lo descarta sin inventar un grupo.
    const result = row.result as AuditResultType;
    if (byResultCounts.has(result)) {
      byResultCounts.set(result, (byResultCounts.get(result) ?? 0) + 1);
    }
    const group = groupForResult(row.result);
    // Resultado nulo o desconocido: dato ausente. NO es un error ni un grupo.
    if (group === null) continue;
    bumpGroup(counts, group);
  }

  const { granted, needsRuling, insufficient } = counts;

  const split: ResolutionSplitPoint[] = SPLIT_ORDER.map((group) => {
    if (group === 'CONCEDIDAS') return { group, count: granted };
    if (group === 'REQUIERE_DICTAMINACION') return { group, count: needsRuling };
    return { group, count: insufficient };
  });

  const byResult: ResultBreakdownPoint[] = AUDIT_RESULTS.map((result) => ({
    result,
    count: byResultCounts.get(result) ?? 0,
  }));

  // `recentCases` refleja lo que hay en la tabla, NO el veredicto: por eso usa
  // `current` y no `terminal`, y un caso con auditor├¡a `RUNNING` sigue
  // apareciendo (con `result` y `confidence` en `null`). Ocultarlo har├¡a que la
  // lista no cuadrase con lo que la persona ve en el listado de casos.
  const recentCases: RecentCaseRow[] = [...current]
    // `reverse()` antes de ordenar para que, en empate de timestamp, gane la fila
    // que estaba despu├®s en el array (misma regla que `isSameOrNewer`). El
    // `sort` de JS es estable, as├¡ que el orden inverso se conserva.
    .reverse()
    .sort((a, b) => millisOf(b.created_at) - millisOf(a.created_at))
    .slice(0, RECENT_CASES_LIMIT)
    .map((row) => ({
      caseId: row.case_id,
      shortId: row.case_id.slice(0, 8),
      result: row.result,
      confidence: row.confidence,
      missingEvidenceCount: row.missing_evidence_count ?? 0,
      caseStatus: row.case_status,
      date: row.created_at,
    }));

  // Los KPI siempre llevan los campos del contrato, aunque valgan 0. El 0 en
  // `casesWithMissingEvidence` es un dato v├ílido: "ning├║n caso auditado ten├¡a
  // evidencia faltante", no una ausencia de medici├│n.
  const kpi: DashboardKpi = {
    auditedCases,
    granted,
    grantedPct: percentage(granted, auditedCases),
    needsRuling,
    needsRulingPct: percentage(needsRuling, auditedCases),
    insufficient,
    insufficientPct: percentage(insufficient, auditedCases),
    errors,
    errorsPct: percentage(errors, auditedCases),
    casesWithMissingEvidence,
    casesWithMissingEvidencePct: percentage(casesWithMissingEvidence, auditedCases),
  };

  return {
    generatedAt: new Date().toISOString(),
    truncated: totalAvailable > DASHBOARD_MAX_ROWS,
    filters,
    kpi,
    timeline: buildTimeline(rows),
    split,
    byResult,
    recentCases,
    execution: aggregateExecution(terminal),
    agreement: aggregateHumanAgreement(current),
    cost: aggregateSummaryCost(rows),
  };
}

// -----------------------------------------------------------------------------
// Consulta
// -----------------------------------------------------------------------------

/**
 * Conjunto de ids de casos creados por un usuario. Se usa para aplicar scope
 * multi-tenant en memoria cuando la vista subyacente no expone `created_by`.
 *
 * TODO: proyectar `created_by` en `public.audit_dashboard_metrics` (y en la
 * vista de comparaciones) para filtrar en SQL en lugar de traer filas ajenas
 * al servidor. Hasta entonces, este filtro en memoria limita la exposici├│n
 * pero `truncated` sigue reflejando el recorte global previo al scope.
 */
async function getOwnedCaseIds(client: InsForgeClient, userId: string): Promise<Set<string>> {
  const { data, error } = await client.database.from('cases').select('id').eq('created_by', userId);
  if (error) throw mapProviderError(error);
  return new Set((data ?? []).map((r) => (r as { id: string }).id));
}

/**
 * Lee la vista de m├®tricas y devuelve el resumen ya agregado.
 * Los l├¡mites del rango son el primer y el ├║ltimo milisegundo del d├¡a, en UTC,
 * y ambos inclusivos: un filtro por d├¡a no puede perder la auditor├¡a de las
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

  // Orden DESCENDENTE. Con `ascending: true` + `limit(5000)` la ventana traía
  // las 5000 filas MÁS ANTIGUAS del rango, y como `recentCases` se construye
  // desde ellas, la tabla titulada "Casos recientes" mostraba los más viejos
  // cuando el periodo superaba el tope. En una herramienta de auditoría eso es
  // una lectura de datos incorrecta, no un detalle de presentación.
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .limit(DASHBOARD_MAX_ROWS);

  // Ning├║n stack trace ni detalle del proveedor al cliente: mapProviderError
  // traduce el error y sanea el mensaje (nada de tokens o URLs internas).
  if (error) throw mapProviderError(error);

  let rows = (data ?? []) as DashboardMetricRow[];
  // Scope multi-tenant: `coordinator` lee agregados globales; `user` solo ve
  // filas de sus propios casos. La vista no expone `created_by`, as├¡ que el
  // filtro ocurre en memoria despu├®s del fetch (ver TODO en `getOwnedCaseIds`).
  if (auth?.role === 'user') {
    const owned = await getOwnedCaseIds(client, auth.sub);
    rows = rows.filter((row) => owned.has(row.case_id));
  }
  return aggregateSummary(rows, filters, count ?? rows.length);
}

// -----------------------------------------------------------------------------
// Bandas de confianza
// -----------------------------------------------------------------------------

/**
 * Banda de confianza de un valor 0..1. `null` si no hay dato: la ausencia de
 * confianza no es "baja confianza", es un dato que no existe.
 */
export function confidenceBand(value: number | null): ConfidenceBand | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (value >= CONFIDENCE_HIGH_THRESHOLD) return 'ALTA';
  if (value >= CONFIDENCE_MEDIUM_THRESHOLD) return 'MEDIA';
  return 'BAJA';
}

// =============================================================================
// IA & Costos
// =============================================================================
// Misma fuente (`audit_dashboard_metrics`) y mismo agregador puro que el
// Resumen, pero con una regla que la otra vista no necesita: aqu├¡ el AUSENTE es
// lo importante. Un coste que OpenRouter no report├│ NO es un coste cero: es un
// coste desconocido. Todo el m├│dulo nace de esa distinci├│n, y por eso los KPI
// llevan banderas `*Available` y los percentiles son `null` en vez de 0.
// =============================================================================

/** Granularidad de la serie de coste. */
export type CostGranularity = 'day' | 'week' | 'month';

/** Cabecera de coste, latencia y volumen del periodo. */
export interface AiCostsKpi {
  totalCostUsd: number;
  avgCostPerCaseUsd: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  avgLatencyMs: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  auditsCounted: number;
  casesCounted: number;
  costAvailable: boolean;
  tokensAvailable: boolean;
  latencyAvailable: boolean;
}

/** Punto de la serie de coste por periodo. `bucket` es la clave de texto. */
export interface CostSeriesPoint {
  bucket: string;
  costUsd: number;
}

/**
 * Consumo por modelo.
 *
 * `totalCostUsd` sigue siendo `number` y NO puede ser `null`: es la SUMA de los
 * costes conocidos, y la suma de una lista vac├¡a es 0, un valor v├ílido. El 0 de
 * un modelo sin coste conocido no significa "este modelo cost├│ cero": significa
 * que no se sabe cu├ínto cost├│. Para distinguirlo est├í `costKnownCalls`.
 *
 * `avgCostUsd` es `null` cuando `costKnownCalls === 0`, porque el promedio de un
 * conjunto vac├¡o no es 0: no hay nada que promediar, as├¡ que el dato no existe.
 * Devolver 0 ah├¡ publicar├¡a una cifra inventada justo donde el riesgo es mayor
 * (auditor├¡as en `ERROR`, que no traen `usage` ni coste por intento).
 */
export interface ModelCostRow {
  model: string;
  calls: number;
  totalCostUsd: number;
  /** `null` si ninguna llamada del modelo tiene coste conocido. */
  avgCostUsd: number | null;
  /**
   * Llamadas del modelo con coste CONOCIDO. `0` significa "coste desconocido",
   * no "coste cero": es el dato de origen que la UI necesita para no imprimir
   * un `$0.0000` que parecer├¡a un gasto real.
   */
  costKnownCalls: number;
}

/** Informe completo de `/api/dashboard/ai-costs`. */
export interface AiCostsReport {
  generatedAt: string;
  truncated: boolean;
  filters: DashboardFilters;
  granularity: CostGranularity;
  kpi: AiCostsKpi;
  costSeries: CostSeriesPoint[];
  byModel: ModelCostRow[];
  reliability: {
    successful: number;
    retried: number;
    fallback: number;
    failed: number;
    executionOutcomes: {
      available: boolean;
      successfulFirstAttempt: number;
      successfulAfterRetry: number;
      fallback: number | null;
      failed: number;
      inProgress: number;
    };
  };
}

/**
 * REGLA ├ÜNICA DE COSTE, en un solo sitio para que ning├║n consumidor pueda
 * inventarse la suya.
 *
 * `usage_cost_usd` es lo que OpenRouter Factur├│ en la llamada que termin├│;
 * `attempts_cost_usd` es la suma de lo que costar├¡an TODOS los intentos
 * registrados, incluido el que fall├│. Se prefiere el primero porque es el dato
 * real de gasto y el segundo es una estimaci├│n por SUMA de datos parciales; el
 * segundo solo aparece cuando el primero no existe (auditor├¡as en `ERROR`, que
 * casi nunca llegan a `usage`).
 *
 * Si AMBOS son `null`, el resultado es `null`: el coste de esa auditor├¡a es
 * DESCONOCIDO. No se devuelve 0 y NUNCA se recalcula un precio a partir de los
 * tokens: hacerlo ser├¡a inventar la tarifa del modelo aqu├¡ y dejarla congelada
 * para siempre, y adem├ís dar├¡a un 0 falso que la UI no puede distinguir de un
 * gasto real de 0 (una llamada gratis o un cr├®dito a coste 0).
 *
 * Los tokens siguen la misma regla, cada magnitud con su propio COALESCE.
 *
 * LA TRIPLETA QUE ESTA EXPRESI├ôN RESUELVE, y que fija un test:
 *   (null, null) -> null   el dato no existe.
 *   (0.02, null) -> 0.02   `usage_cost_usd` manda cuando existe.
 *   (null,    0) -> 0      un 0 LITERAL se respeta como 0.
 *
 * El tercer caso es el que hace que la funci├│n NO est├® arreglando el defecto
 * que se le atribuy├│: `public.audit_dashboard_metrics` antes devolv├¡a
 * `attempts_cost_usd = 0` cuando ning├║n intento reportaba `cost`, as├¡ que este
 * `??` devolv├¡a ese 0 y la UI pintaba `$0` para auditor├¡as cuyo coste se
 * desconoc├¡a. La vista ya no lo emite (el CTE `att` devuelve NULL cuando ning├║n
 * intento trajo el valor), y `(null, 0) -> 0` sigue siendo lo correcto aqu├¡:
 * un 0 expl├¡cito es un dato afirmado, y descartar un dato afirmado ser├¡a
 * inventar un hueco por la v├¡a contraria. Esta funci├│n no valida de d├│nde viene
 * cada columna; la vista es la que garantiza no fabricar ceros.
 */
export const COST_PER_ROW = (row: DashboardMetricRow): number | null => row.usage_cost_usd ?? row.attempts_cost_usd;

const TOTAL_TOKENS_PER_ROW = (row: DashboardMetricRow): number | null => row.usage_total_tokens ?? row.attempts_total_tokens;

const PROMPT_TOKENS_PER_ROW = (row: DashboardMetricRow): number | null => row.usage_prompt_tokens ?? row.attempts_prompt_tokens;

const COMPLETION_TOKENS_PER_ROW = (row: DashboardMetricRow): number | null =>
  row.usage_completion_tokens ?? row.attempts_completion_tokens;

/** Milisegundos por d├¡a, para aritm├®tica de periodos en UTC. */
const COST_MS_PER_DAY = 86_400_000;

/** Milisegundos por semana ISO (7 d├¡as completos). */
const COST_MS_PER_WEEK = 604_800_000;

/**
 * Semana ISO en formato `YYYY-Www`.
 *
 * NO es "la semana del a├▒o calendario": ISO-8601 define que la semana 1 es la
 * que contiene el PRIMER JUEVES del a├▒o, y que la semana empieza el lunes. Las
 * dos reglas juntas producen los casos l├¡mite que un dashboard tiene que ver
 * bien: el 1 de enero puede caer en la semana 53 del a├▒o anterior
 * (2021-01-01 -> `2020-W53`) y el 31 de diciembre puede caer ya en la semana 1
 * del a├▒o siguiente (2025-12-31 -> `2026-W01`). Por eso la clave lleva el A├æO
 * ISO, calculado desde el jueves de la semana, y no el a├▒o calendario de la
 * fecha: agrupar un rango que cruza Nocheviebre por el a├▒o calendario partir├¡a
 * en dos la misma semana y la serie mostrar├¡a un salto que no existe.
 */
function isoWeekBucket(ms: number): string {
  const date = new Date(ms);
  // Lunes = 0 ... domingo = 6.
  const dayOfWeek = (date.getUTCDay() + 6) % 7;
  // El jueves de la semana en curso es lo que define el a├▒o ISO: la semana que
  // lo contiene es la ├║ltima del a├▒o pasado o la primera del nuevo, y el jueves
  // siempre cae dentro del a├▒o al que pertenece la semana.
  const thursdayMs = ms + (3 - dayOfWeek) * COST_MS_PER_DAY;
  const isoYear = new Date(thursdayMs).getUTCFullYear();

  // Lunes de la semana 1 = lunes de la semana que contiene el 4 de enero. Se usa
  // el 4 y NO el 1 porque el 1 de enero puede caer en s├íbado o domingo, es decir
  // en la ├ÜLTIMA semana del a├▒o ISO anterior: con el 1, "enero de 2023" dar├¡a
  // una semana 1 que empieza el 26 de diciembre de 2022.
  const jan4Ms = Date.UTC(isoYear, 0, 4);
  const jan4DayOfWeek = (new Date(jan4Ms).getUTCDay() + 6) % 7;
  const week1MondayMs = jan4Ms - jan4DayOfWeek * COST_MS_PER_DAY;

  const week = Math.floor((thursdayMs - week1MondayMs) / COST_MS_PER_WEEK) + 1;
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/**
 * Clave de periodo en UTC de una fila. Se usa UTC y NUNCA la zona horaria
 * local, por el mismo motivo que en `utcDayBucket`: la serie es un dato
 * compartido y con hora local un mismo gasto caer├¡a en un d├¡a distinto seg├║n
 * d├│nde se mire.
 */
function costBucket(iso: string, granularity: CostGranularity): string {
  const ms = Date.parse(iso);
  // `created_at` es un timestamptz de Postgres y siempre es ISO v├ílido; esta
  // rama solo evita un NaN que romper├¡a la serie entera con una fecha ilegible.
  if (Number.isNaN(ms)) return utcDayBucket(iso);
  if (granularity === 'month') return new Date(ms).toISOString().slice(0, 7);
  if (granularity === 'week') return isoWeekBucket(ms);
  return utcDayBucket(iso);
}

/**
 * Percentil nearest-rank sobre el array YA ORDENADO ascendentemente.
 *
 * F├│rmula: `idx = clamp(ceil(p / 100 * n) - 1, 0, n - 1)`, es decir el primer
 * elemento cuya posici├│n (1-indexada) es `ceil(p/100 * n)`. El `clamp` protege
 * los dos extremos: p50 con n par cae en la mitad inferior del rango, y un
 * redondeo de coma flotante nunca puede devolver un ├¡ndice fuera del array.
 *
 * Se elige nearest-rank y no interpolaci├│n porque el P95 de latencia va
 * junto a un P50 literal: mixing percentiles "de facto" hace que la UI pueda
 * se├▒alar filas concretas, y el nearest-rank siempre se├▒ala una fila real.
 */
function percentileNearestRank(sorted: number[], p: number): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  const raw = Math.ceil((p / 100) * n) - 1;
  const idx = Math.min(Math.max(raw, 0), n - 1);
  const value = sorted[idx];
  // `idx` est├í acotado a [0, n-1] y n > 0, as├¡ que esto no se da: es para que el
  // compilador sepa que hay un n├║mero y no un `undefined` silencioso.
  if (value === undefined) return null;
  return Math.round(value);
}

/**
 * Agrega las filas de la vista en el informe de IA & Costos.
 * Pura: sin red, sin reloj (salvo `generatedAt`) y sin efectos secundarios.
 *
 * `totalAvailable` es el total de filas que la base dice que hay (count exacto),
 * no el tama├▒o de `rows`: es lo ├║nico que permite avisar de una truncaci├│n.
 */
export function aggregateAiCosts(
  rows: DashboardMetricRow[],
  filters: DashboardFilters,
  granularity: CostGranularity,
  totalAvailable: number,
): AiCostsReport {
  let totalCostUsd = 0;
  let totalTokens = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let costAvailable = false;
  let tokensAvailable = false;

  // Denominador de `avgCostPerCaseUsd`: los casos con AL MENOS una fila de coste
  // conocido. No todos los casos del rango.
  const casesWithCost = new Set<string>();

  const latencyValues: number[] = [];

  let successful = 0;
  let failed = 0;
  let retried = 0;
  let fallback = 0;
  let successfulFirstAttempt = 0;
  let successfulAfterRetry = 0;
  let successfulFallback = 0;
  let outcomeFailed = 0;
  let outcomeInProgress = 0;

  const byBucket = new Map<string, number>();
  // `costKnownCalls` lleva el mismo nombre que el campo del DTO a prop├│sito:
  // es el contador que decide si la fila tiene un coste conocido o solo llamadas.
  const byModel = new Map<string, { calls: number; costKnownCalls: number; costUsd: number }>();

  for (const row of rows) {
    const cost = COST_PER_ROW(row);
    if (cost !== null && Number.isFinite(cost)) {
      totalCostUsd += cost;
      costAvailable = true;
      casesWithCost.add(row.case_id);
      const bucket = costBucket(row.created_at, granularity);
      byBucket.set(bucket, (byBucket.get(bucket) ?? 0) + cost);
    }

    const total = TOTAL_TOKENS_PER_ROW(row);
    if (total !== null && Number.isFinite(total)) {
      totalTokens += total;
      tokensAvailable = true;
    }
    const prompt = PROMPT_TOKENS_PER_ROW(row);
    if (prompt !== null && Number.isFinite(prompt)) promptTokens += prompt;
    const completion = COMPLETION_TOKENS_PER_ROW(row);
    if (completion !== null && Number.isFinite(completion)) completionTokens += completion;

    // POR QU├ë SOLO `COMPLETED`: `latency_ms` es el tiempo que tard├│ la llamada
    // cuando la auditor├¡a termin├│ bien. En una fila `ERROR` es el tiempo hasta
    // el fallo (o hasta el deadline), que no es la misma magnitud. Y en las
    // auditor├¡as "stale" curadas por `audit-service.ts` el valor es literalmente
    // la EDAD del run, no su duraci├│n: mezclarlo en la media inflar├¡a el P95
    // con horas que no fueron de c├│mputo. Se mide la latencia de lo que funcion├│;
    // los fallos se miden aparte, en `reliability.failed`.
    if (row.audit_status === 'COMPLETED' && row.latency_ms !== null && Number.isFinite(row.latency_ms)) {
      latencyValues.push(row.latency_ms);
    }

    // ADVERTENCIA PARA LA UI: `successful`, `retried` y `fallback` NO son
    // categor├¡as excluyentes. Una auditor├¡a completada tras un reintento cuenta
    // en las tres, y eso es correcto: cada bloque mide una cosa distinta (o succeeded,
    // o cu├ínto cost├│ insistir). Si la UI los SUMA como si fueran una
    // partici├│n, el total no cuadrar├í con `auditsCounted` y aparecer├í un bug
    // donde no lo hay.
    if (row.audit_status === 'COMPLETED') successful += 1;
    if (row.audit_status === 'ERROR') failed += 1;
    // Reintento REAL dentro de la llamada (varios elementos en
    // `openrouterAttempts`). Es otra cosa que `attempt_number`, que cuenta
    // re-ejecuciones del run completo desde `audit-service.ts`.
    if (row.attempts_count > 1) retried += 1;
    // Fallback de modelo: se intent├│ m├ís de un modelo.
    if ((row.provider_models?.length ?? 0) > 1) fallback += 1;

    if (row.audit_status === 'ERROR') {
      outcomeFailed += 1;
    } else if (row.audit_status === 'RUNNING') {
      outcomeInProgress += 1;
    } else if (row.audit_status === 'COMPLETED') {
      const models = row.provider_models;
      if (row.attempt_number === null || row.attempt_number < 1 || row.attempts_count < 1 || !models || models.length === 0) {
        // Metadatos de ejecuci├│n ausentes en esta fila: no se cuenta en ning├║n
        // desglose (`executionOutcomes` del interfaz queda sin poblar aqu├¡ a
        // prop├│sito; la salida plana de `reliability` es la que consumen UI y pruebas).
      } else if (models.length > 1) {
        successfulFallback += 1;
      } else if (row.attempt_number > 1 || row.attempts_count > 1) {
        successfulAfterRetry += 1;
      } else {
        successfulFirstAttempt += 1;
      }
    }

    const model = byModel.get(row.model);
    if (model === undefined) {
      byModel.set(row.model, { calls: 1, costKnownCalls: cost === null ? 0 : 1, costUsd: cost ?? 0 });
    } else {
      model.calls += 1;
      if (cost !== null) {
        model.costKnownCalls += 1;
        model.costUsd += cost;
      }
    }
  }

  const casesCounted = casesWithCost.size;

  latencyValues.sort((a, b) => a - b);
  const latencyAvailable = latencyValues.length > 0;
  const avgLatencyMs =
    latencyValues.length === 0 ? null : Math.round(latencyValues.reduce((acc, value) => acc + value, 0) / latencyValues.length);

  const costSeries: CostSeriesPoint[] = [];
  // Orden ascendente por clave de texto: en las tres granularidades la clave
  // empieza por el a├▒o (en `week`, el A├æO ISO) y los dos d├¡gitos siguientes van
  // crecientes, as├¡ que el orden lexicogr├ífico coincide con el cronol├│gico.
  for (const bucket of [...byBucket.keys()].sort()) {
    costSeries.push({ bucket, costUsd: byBucket.get(bucket) ?? 0 });
  }

  const byModelRows: ModelCostRow[] = [...byModel.entries()].map(([model, agg]) => ({
    model,
    calls: agg.calls,
    // La SUMA sigue siendo `number` aunque no haya ning├║n coste conocido: 0 es la
    // suma v├ílida de una lista vac├¡a. Lo que dice "no lo sabemos" es
    // `costKnownCalls`, y por eso el promedio de abajo es `null` y no 0.
    totalCostUsd: agg.costUsd,
    // Denominador: las llamadas del modelo con coste CONOCIDO, no `calls`. Si
    // una llamada no tiene coste, promediar sobre `calls` la bajar├¡a a la nada.
    // Y si NINGUNA la tiene, no hay promedio: `null`, no 0.
    avgCostUsd: agg.costKnownCalls === 0 ? null : agg.costUsd / agg.costKnownCalls,
    costKnownCalls: agg.costKnownCalls,
  }));
  // El orden NO mira `avgCostUsd`: con `avgCostUsd: null` una resta dar├¡a NaN y
  // el comparador quedar├¡a sin criterio. Se ordena por la suma (que s├¡ es
  // comparable entre dos modelos), luego por llamadas y luego por nombre.
  byModelRows.sort(
    (a, b) => b.totalCostUsd - a.totalCostUsd || b.calls - a.calls || a.model.localeCompare(b.model),
  );

  const kpi = {
    totalCostUsd,
    avgCostPerCaseUsd: casesCounted === 0 ? 0 : totalCostUsd / casesCounted,
    totalTokens,
    promptTokens,
    completionTokens,
    avgLatencyMs,
    p50LatencyMs: percentileNearestRank(latencyValues, 50),
    p95LatencyMs: percentileNearestRank(latencyValues, 95),
    auditsCounted: rows.length,
    casesCounted,
    costAvailable,
    tokensAvailable,
    latencyAvailable,
  };

  // Salida de fiabilidad: los contadores planos se mantienen por compatibilidad
  // con consumidores existentes; el desglose detallado refleja los outcomes de
  // ejecuci├│n reales cuando la fila aport├│ metadatos suficientes.
  const executionOutcomesAvailable =
    successfulFirstAttempt + successfulAfterRetry + successfulFallback + outcomeFailed + outcomeInProgress > 0;
  const reliability: AiCostsReport['reliability'] = {
    successful,
    retried,
    fallback,
    failed,
    executionOutcomes: {
      available: executionOutcomesAvailable,
      successfulFirstAttempt,
      successfulAfterRetry,
      fallback: executionOutcomesAvailable ? successfulFallback : null,
      failed: outcomeFailed,
      inProgress: outcomeInProgress,
    },
  };

  return {
    generatedAt: new Date().toISOString(),
    truncated: totalAvailable > DASHBOARD_MAX_ROWS,
    filters,
    granularity,
    kpi,
    costSeries,
    byModel: byModelRows,
    reliability,
  };
}

/**
 * Lee la vista de m├®tricas y devuelve el informe de costes ya agregado.
 *
 * MISMOS l├¡mites que `getDashboardSummary`: el rango va del primer al ├║ltimo
 * milisegundo del d├¡a, en UTC y ambos inclusivos (un filtro por d├¡a no puede
 * perder la auditor├¡a de las 23:59:59.999), el tope de filas es el mismo y
 * `count: 'exact'` es lo que permite avisar de una truncaci├│n.
 *
 * POR QU├ë AQU├ì NO SE FILTRA POR `result` (y en el Resumen s├¡): el coste de una
 * auditor├¡a es el mismo sea cual sea su dictamen, y las auditor├¡as en `ERROR`
 * no tienen `result` que filtrar. Filtrar por dictamen har├¡a desaparecer
 * justamente el gasto de los intentos que fallaron, que es la mitad de la
 * pregunta que responde este dashboard. El filtro `status` (estado del caso) s├¡
 * se mantiene: ese criterio lo puso quien est├í mirando, y no oculta coste.
 */

/**
 * Columnas que la vista de costes necesita. `student_identifier` queda FUERA a
 * propósito: esta ruta no emite datos personales y no debe pedirlos.
 */
const AI_COSTS_COLUMNS =
  'id, case_id, created_at, model, provider_models, audit_status, latency_ms, ' +
  'attempts_count, attempts_cost_usd, attempts_total_tokens, attempts_prompt_tokens, ' +
  'attempts_completion_tokens, usage_cost_usd, usage_total_tokens, usage_prompt_tokens, ' +
  'usage_completion_tokens, country, campus, modality, project, responsible, guideline';

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
  if (filters.result !== null) query = query.eq('result', filters.result);
  if (filters.status !== null) query = query.eq('case_status', filters.status);
  query = applyDimensionFilters(query, filters);

  const { data, error, count } = await query
    .order('created_at', { ascending: true })
    .limit(DASHBOARD_MAX_ROWS);

  // Ning├║n stack trace ni detalle del proveedor al cliente: mapProviderError
  // traduce el error y sanea el mensaje (nada de tokens o URLs internas).
  if (error) throw mapProviderError(error);

  let rows = (data ?? []) as DashboardMetricRow[];
  if (auth?.role === 'user') {
    const owned = await getOwnedCaseIds(client, auth.sub);
    rows = rows.filter((row) => owned.has(row.case_id));
  }
  return aggregateAiCosts(rows, filters, granularity, count ?? rows.length);
}

// =============================================================================
// Calidad
// =============================================================================
// Esta vista tiene DOS fuentes, y s├│lo una de las dos existe por construcci├│n:
//
//  1. LA CONFIANZA que declar├│ el modelo en cada dictamen. Vive desde el primer
//     dictamen, y se lee de `public.audit_dashboard_metrics`.
//
//  2. LA REVISI├ôN HUMANA: qu├® decidi├│ una persona, y si el modelo coincidi├│ con
//     esa decisi├│n al comparar. Naci├│ con el m├│dulo de revisi├│n humana
//     (`case_reviews` + `case_comparisons`) y se lee de
//     `public.case_comparisons_dashboard_metrics`.
//
// LA DIFERENCIA ENTRE UNA PANTALLA HONESTA Y UNA QUE MIENTE EST├ü ENTERA EN LO QUE
// HACE ESTE ARCHIVO CUANDO NO HAY DATO. Un `agreementRate: 0` afirmar├¡a "hubo
// cero coincidencias", y eso es FALSO cuando lo que pasa es que nadie compar├│: no
// es que la IA falle siempre, es que todav├¡a no hay nada que medir. Lo que se
// devuelve es `null` m├ís un motivo legible, y la UI lo pinta como "sin dato",
// nunca como cero. Es el mismo criterio que ya separa NULL de 0 en las columnas
// de coste de la vista de m├®tricas (`COST_PER_ROW`, con su tripleta fijada por
// un test m├ís arriba en este archivo), y por eso aqu├¡ hay tests que lo fijan
// tambi├®n.
//
// NADA DE ESTA SECCI├ôN CLASIFICA (NO_RULES_ENGINE). El bloque humano no
// reinterpreta el veredicto de la comparaci├│n: `agrees` y `confidence` los
// escribi├│ el modelo y ya pasaron por `ComparisonResultSchema`
// (src/skills/review/schema.ts). Aqu├¡ s├│lo se cuentan y se promedian. La
// resoluci├│n final del caso sigue siendo la de la persona, y el modelo dice si
// discrepa, no reemplaza la decisi├│n.
// =============================================================================

/**
 * Etiqueta CORTA de cada banda, para el eje X de la gr├ífica (donde "Alta
 * confianza" no cabe y "Media confianza" se solapar├¡a con la vecina).
 *
 * NO sustituye a `CONFIDENCE_BAND_LABELS` (`src/lib/labels.ts`), que sigue siendo
 * la forma larga y can├│nica: el `band` viaja siempre junto a `label`, as├¡ que
 * cualquiera que necesite el nombre completo lo tiene sin volver a pedirlo.
 */
const CONFIDENCE_BAND_SHORT_LABELS: Record<ConfidenceBand, string> = {
  ALTA: 'Alta',
  MEDIA: 'Media',
  BAJA: 'Baja',
};

/** Orden fijo de las bandas: siempre las 3, aunque valgan 0. */
const CONFIDENCE_BAND_ORDER: readonly ConfidenceBand[] = ['ALTA', 'MEDIA', 'BAJA'];

/**
 * Fila de `public.case_comparisons_dashboard_metrics`.
 *
 * ESCALARES SOLO, igual que `DashboardMetricRow`: la vista no expone
 * `result_json` ni el comentario humano, y no los expone por una raz├│n concreta.
 * `explanation` y `discrepancyReason` son texto que el modelo escribi├│ sobre un
 * expediente con PII, y nadie los necesita para contar; lo que hace falta son
 * `agrees` y `confidence`, que son dos n├║meros.
 *
 * `agrees` y `confidence` son `null` cuando la fila est├í `RUNNING` o `ERROR` (es
 * as├¡ como las escribe `reviews.ts`) y tambi├®n cuando el `result_json` no trae
 * un valor legible. `null` significa "no hay dato", y por eso el agregador nunca
 * lo cuenta como desacuerdo.
 */
export interface ComparisonMetricRow {
  id: string;
  case_review_id: string;
  case_id: string;
  /** Estado del CASO, para que el filtro `status` del dashboard aplique tambi├®n aqu├¡. */
  case_status: CaseStatus | null;
  /** Dictamen de la auditor├¡a COMPARADA, para que el filtro `result` aplique. */
  audit_result: AuditResultType | null;
  status: ComparisonStatusRow;
  /** Fecha de la comparaci├│n: es la que recorta el periodo de este bloque. */
  created_at: string;
  agrees: boolean | null;
  confidence: number | null;
}

/**
 * Entrada humana del agregador: lo que la consulta deja para el periodo.
 *
 * Se pasa SEPARADA de las filas de `DashboardMetricRow` a prop├│sito. Son dos
 * fuentes distintas, con dos periodos distintos (`audits.created_at` y
 * `case_comparisons.created_at`) y dos filas distintas, y mezclarlas har├¡a que
 * un filtro del dashboard moviera la coincidencia por un efecto secundario. Por
 * eso `aggregateQuality` la recibe como argumento OBLIGATORIO: un valor por
 * defecto har├¡a que olvidar cablearla en producci├│n se viera como un informe
 * honesto de "no hay revisiones", que es justo la mentira que este bloque evita.
 */
export interface HumanReviewInput {
  /**
   * Revisiones humanas del periodo. Incluye las registradas en el rango M├üS las
   * que son due├▒as de una comparaci├│n del rango (una revisi├│n del 31 de agosto
   * cuya comparaci├│n termin├│ el 2 de septiembre cuenta: es la misma historia
   * humana, y sin ella el bloque se contradir├¡a a s├¡ mismo, diciendo "no hay
   * revisi├│n registrada" junto a una tasa ya calculada).
   */
  reviewedCases: number;
  /** Comparaciones del periodo, ya recortadas por la consulta. */
  comparisons: ComparisonMetricRow[];
  /** Total exacto del periodo, para poder avisar de una truncaci├│n. */
  comparisonsAvailable: number;
}

/**
 * Parte humana del informe de calidad.
 *
 * LO QUE ESTA INTERFAZ PROMETE, POR TIPO: `agreementRate` y
 * `avgComparisonConfidence` son `number | null`, y el `null` significa "no se ha
 * medido". Por eso NO son `number` con un 0 de reserva: un `0` es un dato
 * AFIRMADO ("de todas las comparaciones, ninguna coincidi├│"), y en el caso que
 * importa es FALSO, porque lo que pasa es que todav├¡a no se compar├│ nada. El 0
 * se reserva para los contadores, que son hechos y no promedios: `0` revisiones
 * registradas S├ì es verdad cuando nadie ha revisado nada.
 *
 * `agreementRate` es una RAZ├ôN entre 0 y 1, NO un porcentaje: 0.667 son dos
 * tercios. Se redondea a 3 decimales, igual que las medias de confianza del
 * informe, para que la coma flotante no deje `0.6666666666666666` en la
 * pantalla.
 */
export interface HumanReviewReport {
  /** `true` si existe al menos UNA revisi├│n humana en el periodo. */
  available: boolean;
  /**
   * Explicaci├│n del estado actual, en espa├▒ol, lista para pintar tal cual.
   *
   * La redacta el SERVIDOR y no el frontend a prop├│sito: la explicaci├│n de por
   * qu├® falta un dato tiene que vivir junto al c├ílculo que la produce, y todos
   * los n├║meros que aparecen en el texto salen de las cifras de este mismo
   * objeto. Si el mensaje lo compusiera la UI, podr├¡a decir "no hay datos" con
   * datos delante sin que nadie lo notara.
   */
  message: string;
  /** Revisiones humanas registradas que el periodo contiene. */
  reviewedCases: number;
  /**
   * Revisiones con resultado humano y de auditor├¡a disponibles: en el flujo de
   * comparaciones son las `COMPLETED`, las ├║nicas con veredicto y el
   * denominador de `agreementRate`. Exigida por `ExactHumanReviewReport`.
   */
  comparableReviews: number;
  /** Comparaciones `COMPLETED`: las ├║nicas con veredicto. */
  completedComparisons: number;
  /** Comparaciones `RUNNING`: en curso, sin veredicto todav├¡a. */
  pendingComparisons: number;
  /** Comparaciones `ERROR`: terminadas en fallo, sin veredicto. */
  failedComparisons: number;
  /** De las completadas, cu├íntas afirmaron coincidencia (`agrees === true`). */
  agreements: number;
  /** De las completadas, cu├íntas afirmaron discrepancia (`agrees === false`). */
  disagreements: number;
  /** `agreements / completedComparisons`, o `null` si no hay comparaciones completadas. */
  agreementRate: number | null;
  /** Media de `confidence` de las COMPLETED que lo declararon, o `null` si ninguna. */
  avgComparisonConfidence: number | null;
}

/**
 * Contadores de las comparaciones del periodo, ya reducez por estado.
 *
 * Se calculan UNA vez y alimentan tanto el informe como el `message`, para que el
 * texto no pueda contradecir a los n├║meros que acompa├▒a: si los dos salieran de
 * recorridos distintos, un `message` podr├¡a acabar diciendo "2 comparaciones
 * completadas" junto a un `completedComparisons: 3`.
 */
interface HumanReviewCounts {
  completed: number;
  pending: number;
  failed: number;
  agreements: number;
  disagreements: number;
  /** Comparaciones COMPLETED que declararon confianza (denominador de la media). */
  confidenceReported: number;
  confidenceSum: number;
}

/**
 * Recorre las comparaciones del periodo y las reparte por estado.
 *
 * POR QU├ë `RUNNING` Y `ERROR` NO SON NI UN ACUERDO NI UN DESACUERDO: una
 * comparaci├│n en curso todav├¡a no tiene veredicto, y una fallida no lleg├│ a
 * emitirlo. Contarlas como desacuerdo publicar├¡a una discrepancia que nadie
 * registr├│, que es justo el defecto que este bloque evita. Se informan aparte,
 * en `pendingComparisons` y `failedComparisons`.
 *
 * `agrees === null` en una fila `COMPLETED` es una forma defensiva: la fila
 * AFIRMA que termin├│ (eso dice su `status`, y es un dato), pero no trae
 * veredicto legible. Suma a `completed` ÔÇöporque termin├│ÔÇö y ni a `agreements` ni a
 * `disagreements`, porque no hay nada que repartir entre esos dos. Nunca ocurre
 * con datos reales: `updateComparisonResult` s├│lo escribe un `result_json` que ya
 * pas├│ `ComparisonResultSchema` (src/skills/review/schema.ts).
 */
function countComparisons(comparisons: ComparisonMetricRow[]): HumanReviewCounts {
  const counts: HumanReviewCounts = {
    completed: 0,
    pending: 0,
    failed: 0,
    agreements: 0,
    disagreements: 0,
    confidenceReported: 0,
    confidenceSum: 0,
  };

  for (const row of comparisons) {
    if (row.status === 'RUNNING') {
      counts.pending += 1;
      continue;
    }
    if (row.status === 'ERROR') {
      counts.failed += 1;
      continue;
    }

    counts.completed += 1;
    if (row.agrees === true) counts.agreements += 1;
    else if (row.agrees === false) counts.disagreements += 1;

    // Ausente o no finito: dato ausente. Promediarlo bajar├¡a la confianza media
    // de la comparaci├│n con un valor que nadie declar├│.
    const confidence = row.confidence;
    if (confidence !== null && Number.isFinite(confidence)) {
      counts.confidenceSum += confidence;
      counts.confidenceReported += 1;
    }
  }

  return counts;
}

/** `1 revisi├│n humana` / `2 revisiones humanas`. El n├║mero SIEMPRE delante. */
function pluralizar(cantidad: number, singular: string, plural: string): string {
  return `${cantidad} ${cantidad === 1 ? singular : plural}`;
}

/** Enumera sin Oxford coma: `a, b y c`. Nunca recibe una lista vac├¡a. */
function enumerar(partes: readonly string[]): string {
  if (partes.length === 0) return '';
  if (partes.length === 1) return partes[0] ?? '';
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1] ?? ''}`;
}

/**
 * Estado sin una sola revisi├│n humana. El texto va FIJO y un test lo fija
 * entero: es el mensaje que la UI explica bajo las tarjetas vac├¡as, y si cambia
 * tiene que cambiar a prop├│sito.
 */
const SIN_REVISION_MESSAGE =
  'Todav├¡a no hay ninguna revisi├│n humana registrada en el periodo, as├¡ que no hay nada que comparar: ' +
  'la coincidencia entre el dictamen de la IA y la decisi├│n de una persona no se puede calcular. ' +
  'Se muestra ├║nicamente lo que s├¡ existe: la confianza declarada por el modelo en cada dictamen.';

/**
 * Frase de apertura, com├║n a todos los estados con revisiones: el n├║mero de
 * revisiones del periodo sale de `input.reviewedCases`, ya contado por la
 * consulta, as├¡ que el texto nunca puede afirmar m├ís de lo que el dato sostiene.
 */
function cabeceraRevisiones(reviewedCases: number): string {
  return `Hay ${pluralizar(reviewedCases, 'revisi├│n humana registrada', 'revisiones humanas registradas')} en el periodo`;
}

/**
 * POR QU├ë EL SERVIDOR REDACTA EL `message` Y NO LA UI
 *
 * La explicaci├│n de por qu├® falta un dato tiene que vivir JUNTO al c├ílculo que la
 * produce, o las dos piezas se desincronizan sin que nada falle. Con el mensaje
 * aqu├¡, todos los n├║meros que aparecen en el texto salen de `counts` ÔÇöel mismo
 * objeto que alimenta las cifras de la tarjetaÔÇö y la UI lo pinta tal cual
 * (`src/components/dashboard/QualityPage.tsx`).
 *
 * Y hay un criterio m├ís fuerte que el de no contradecirse: el texto no puede
 * AFIRMAR un estado que los datos no sostienen. Por eso "en curso" y "fall├│" son
 * cl├íusulas condicionales y no un men├║ fijo: cuando no hay nada en curso, el
 * mensaje no dice "en curso", porque eso insinuar├¡a una actividad que no existe.
 *
 * LA REGLA DE LOS ESTADOS, en orden:
 *   1. Sin revisiones                  -> el mensaje fijo de arriba.
 *   2. Revisiones y NINGUNA comparaci├│n -> "ninguna tiene comparaci├│n": no hay
 *      nada en curso porque no se empez├│ nada. Es un tercer estado, distinto
 *      tanto de "en curso" como de "fall├│".
 *   3. Sin completadas, s├│lo en curso   -> la tasa todav├¡a no se puede calcular.
 *   4. Sin completadas, s├│lo fallidas   -> se dice que FALLARON, nunca "en curso".
 *   5. Sin completadas, de las dos      -> las dos, con la misma reserva.
 *   6. Con completadas, nada pendiente  -> se mide sobre ellas y ya.
 *   7. Con completadas y resto          -> se mide S├ôLO sobre las completadas, y se
 *      dice expl├¡citamente que las dem├ís no cuentan.
 */
function humanReviewMessage(input: HumanReviewInput, counts: HumanReviewCounts, available: boolean): string {
  if (!available) return SIN_REVISION_MESSAGE;

  const cabecera = cabeceraRevisiones(input.reviewedCases);
  const { completed, pending, failed } = counts;

  // Estado 2: hay revisiones pero ni una comparaci├│n. No hay nada en curso
  // porque no se empez├│ nada, y decirlo con "en curso" ser├¡a mentir.
  if (input.comparisons.length === 0) {
    return (
      `${cabecera} y ninguna tiene comparaci├│n: la coincidencia entre el dictamen de la IA ` +
      `y la decisi├│n de una persona todav├¡a no se puede calcular porque no se ha comparado ` +
      `ning├║n caso del periodo.`
    );
  }

  const sinCompletadas =
    `${cabecera}, con ${pluralizar(pending, 'comparaci├│n en curso', 'comparaciones en curso')} ` +
    `y ${pluralizar(failed, 'comparaci├│n fallida', 'comparaciones fallidas')}, ninguna completada todav├¡a: ` +
    `la coincidencia entre el dictamen de la IA y la decisi├│n de una persona no se puede calcular. ` +
    `Las comparaciones que no se completaron no cuentan ni como acuerdo ni como desacuerdo, y se informan aparte.`;

  // Estado 3: s├│lo en curso.
  if (completed === 0 && pending > 0 && failed === 0) {
    return (
      `${cabecera}, con ${pluralizar(pending, 'comparaci├│n en curso', 'comparaciones en curso')} ` +
      `y ninguna completada todav├¡a: la coincidencia entre el dictamen de la IA y la decisi├│n de ` +
      `una persona no se puede calcular hasta que exista una comparaci├│n completada.`
    );
  }

  // Estado 4: s├│lo fallidas. El verbo va en plural porque el texto tiene que
  // poder hablar del conjunto aunque haya una sola.
  if (completed === 0 && failed > 0 && pending === 0) {
    return (
      `${cabecera}, con ${pluralizar(failed, 'comparaci├│n fallida', 'comparaciones fallidas')}: ` +
      `ninguna lleg├│ a emitir veredicto, as├¡ que la coincidencia entre el dictamen de la IA y la ` +
      `decisi├│n de una persona no se puede calcular. Las comparaciones que fallaron no aportan ni ` +
      `acuerdo ni desacuerdo, y se informan aparte.`
    );
  }

  // Estado 5: en curso y fallidas, sin ninguna completada.
  if (completed === 0) return sinCompletadas;

  // Estado 6: hay completadas y nada m├ís. La palabra "fallida" no aparece por
  // ning├║n lado: no hay ninguna, y nombrarla insinuar├¡a un fallo inexistente.
  if (pending === 0 && failed === 0) {
    return (
      `${cabecera}, con ${pluralizar(completed, 'comparaci├│n completada', 'comparaciones completadas')}: ` +
      `la coincidencia entre el dictamen de la IA y la decisi├│n de una persona se mide solo sobre ` +
      `ellas, porque todas las comparaciones del periodo terminaron.`
    );
  }

  // Estado 7: hay completadas y adem├ís alguna en curso o fallida. Se enumeran
  // S├ôLO las que existen: nombrar una categor├¡a vac├¡a ("y 0 fallidas") insinuar├¡a
  // un fallo que no ocurri├│, que es la misma mentira en su forma m├ís peque├▒a.
  const partes = [pluralizar(completed, 'comparaci├│n completada', 'comparaciones completadas')];
  if (pending > 0) partes.push(pluralizar(pending, 'comparaci├│n en curso', 'comparaciones en curso'));
  if (failed > 0) partes.push(`${failed} ${failed === 1 ? 'fallida' : 'fallidas'}`);

  return (
    `${cabecera}: ${enumerar(partes)}. La coincidencia entre el dictamen de la IA y la decisi├│n de ` +
    `una persona se mide solo sobre las comparaciones completadas: las que no llegaron a completarse ` +
    `no cuentan ni como acuerdo ni como desacuerdo, y se informan aparte.`
  );
}

/**
 * Agrega la entrada humana del periodo en el bloque `humanReview` del informe.
 *
 * PURA: sin red, sin reloj y sin efectos secundarios. Recibe la entrada YA
 * recortada por periodo y filtros (`getHumanReviewInput`) y aqu├¡ s├│lo cuenta y
 * promedia.
 *
 * LA REGLA N├ÜMERO UNO, y la raz├│n de que este bloque exista:
 *   `agreementRate` es `number | null` y vale `null` CUANDO `completedComparisons`
 *   es 0. Nunca 0.
 *
 * Un 0 ah├¡ afirmar├¡a "de todas las comparaciones, ninguna coincidi├│", y eso es
 * FALSO cuando lo que ocurre es que todav├¡a no se compar├│ nada: no es que el
 * modelo falle siempre, es que no hay nada que medir. Por eso el 0 se queda
 * reservado para los CONTADORES, que son hechos (`0` revisiones registradas S├ì es
 * verdad cuando nadie ha revisado nada) y para el caso en que s├¡ hubo
 * comparaciones completadas y ninguna coincidi├│, que es una afirmaci├│n
 * verdadera sobre un dato que existe.
 *
 * NADA DE ESTA FUNCI├ôN CLASIFICA (NO_RULES_ENGINE). `agrees` y `confidence` los
 * escribi├│ el modelo y ya pasaron por `ComparisonResultSchema`
 * (src/skills/review/schema.ts). Aqu├¡ s├│lo se cuentan y se promedian; la
 * resoluci├│n final del caso sigue siendo la de la persona.
 */
export function aggregateHumanReview(input: HumanReviewInput): HumanReviewReport {
  const counts = countComparisons(input.comparisons);
  // `available` responde "┬┐sabe el sistema algo de revisi├│n humana?", as├¡ que
  // basta con que exista una revisi├│n O una comparaci├│n: el agregado es puro y
  // no puede asumir que la consulta ya hizo esta uni├│n.
  const available = input.reviewedCases > 0 || input.comparisons.length > 0;

  const agreementRate =
    counts.completed === 0 ? null : round3(counts.agreements / counts.completed);
  const avgComparisonConfidence =
    counts.confidenceReported === 0 ? null : round3(counts.confidenceSum / counts.confidenceReported);

  return {
    available,
    message: humanReviewMessage(input, counts, available),
    reviewedCases: input.reviewedCases,
    comparableReviews: counts.completed,
    completedComparisons: counts.completed,
    pendingComparisons: counts.pending,
    failedComparisons: counts.failed,
    agreements: counts.agreements,
    disagreements: counts.disagreements,
    agreementRate,
    avgComparisonConfidence,
  };
}

/** Bucket de evidencia faltante. La clave viaja como texto porque `2+` no es un n├║mero. */
export type { MissingEvidenceBucket };

/** Orden fijo de los buckets, de menos a m├ís evidencia faltante. */
const MISSING_EVIDENCE_BUCKET_ORDER: readonly MissingEvidenceBucket[] = ['0', '1', '2+'];

/**
 * Etiquetas de cada bucket.
 *
 * El `2+` NO se desglosa en `2`, `3`, `4`ÔÇª a prop├│sito: la pregunta que responde
 * esta vista es "┬┐la confianza baja cuando el expediente est├í incompleto?", y para
 * eso interesa el efecto de una ausencia grande, no la cola de expedientes con
 * seis evidencias ausentes. Adem├ís, un bucket por cada valor real har├¡a que la
 * gr├ífica mostrara un subconjunto arbitrario del periodo en lugar del periodo.
 */
const MISSING_EVIDENCE_BUCKET_LABELS: Record<MissingEvidenceBucket, string> = {
  '0': 'Expediente completo',
  '1': 'Falta 1 evidencia',
  '2+': 'Faltan 2 o m├ís',
};

/**
 * Bucket de evidencia faltante de una fila.
 *
 * `missing_evidence_count` ausente se trata como 0, igual que hace
 * `recentCases`: es el valor por defecto que emite la vista y evita que una fila
 * sin dato desaparezca del reparto (y con ella, del numerador y del denominador
 * de la media).
 */
function missingEvidenceBucket(count: number | null): MissingEvidenceBucket {
  const missing = count ?? 0;
  if (missing >= 2) return '2+';
  if (missing === 1) return '1';
  return '0';
}

/** Redondeo a 3 decimales: quita el ruido de coma flotante sin perder precisi├│n ├║til. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function aggregateExactHumanReview(input: ExactHumanReviewInput): ExactHumanReviewReport {
  let comparableReviews = 0;
  let agreements = 0;
  let disagreements = 0;
  for (const review of input.reviews) {
    const audit = input.auditsById.get(review.audit_id);
    if (audit?.audit_status !== 'COMPLETED' || audit.result === null) continue;
    comparableReviews += 1;
    if (audit.result === review.result) agreements += 1;
    else disagreements += 1;
  }

  const available = input.reviews.length > 0;
  const agreementRate = comparableReviews === 0 ? null : round3(agreements / comparableReviews);
  const message = !available
    ? 'No hay revisiones humanas registradas para las auditor├¡as de este periodo; la coincidencia no se puede calcular.'
    : comparableReviews === 0
      ? `Hay ${input.reviews.length} revisi├│n(es), pero no hay un resultado disponible en su auditor├¡a exacta para calcular coincidencia.`
      : `Coincidencia exacta entre el resultado humano y el de la auditor├¡a referenciada: ${agreements} de ${comparableReviews} revisiones comparables.`;

  return {
    available,
    message,
    reviewedCases: input.reviews.length,
    comparableReviews,
    agreements,
    disagreements,
    agreementRate,
  };
}

/**
 * Confianza declarada por el modelo, agrupada.
 *
 * `bands` trae SIEMPRE las 3 bandas, aunque valgan 0: una banda en cero es
 * informaci├│n ("nunca hubo confianza baja"), y sin ella la gr├ífica cambiar├¡a de
 * forma al mover el periodo en vez de al dato.
 *
 * `confidenceByMissingEvidence` es al rev├®s a prop├│sito: solo incluye los buckets
 * con al menos una fila. Poner un bucket en cero ah├¡ ser├¡a afirmar "con un
 * expediente completo la confianza media es 0 %", que es falso: es que no hay
 * ning├║n expediente completo en el periodo.
 */
export interface ConfidenceReport {
  /** Dict├ímenes COMPLETED que declararon confianza (el denominador de `pct`). */
  auditedCases: number;
  /** `null` si ning├║n dictamen declar├│ confianza: la media de una lista vac├¡a no es 0. */
  avgConfidence: number | null;
  bands: Array<{ band: ConfidenceBand; label: string; count: number; pct: number }>;
  confidenceByMissingEvidence: Array<{
    bucket: MissingEvidenceBucket;
    label: string;
    count: number;
    avgConfidence: number | null;
  }>;
}

export interface ExactHumanReviewInput {
  reviews: Array<{ id: string; audit_id: string; result: AuditResultType }>;
  reviewsAvailable: number;
  auditsById: Map<string, DashboardMetricRow>;
}

export interface ExactHumanReviewReport {
  available: boolean;
  message: string;
  reviewedCases: number;
  comparableReviews: number;
  agreements: number;
  disagreements: number;
  agreementRate: number | null;
}

/** Informe completo de `/api/dashboard/quality`. */
export interface QualityReport {
  generatedAt: string;
  truncated: boolean;
  filters: DashboardFilters;
  humanReview: ExactHumanReviewReport;
  confidence: ConfidenceReport;
}

/**
 * Agrega las filas de la vista en el informe de Calidad.
 * Pura: sin red, sin reloj (salvo `generatedAt`) y sin efectos secundarios.
 *
 * `totalAvailable` es el total de filas que la base dice que hay (count exacto),
 * no el tama├▒o de `rows`: es lo ├║nico que permite avisar de una truncaci├│n.
 *
 * `humanReview` es OBLIGATORIO a prop├│sito (ver `HumanReviewInput`): viene de
 * OTRA fuente y OTRO periodo, y darle un valor por defecto har├¡a que olvidarla
 * al cablearla en producci├│n se viera como un informe honesto de "no hay
 * revisiones", que es justo la mentira que este bloque evita. El compilador
 * obliga a pasar algo, y ese algo no puede ser inventado.
 */
export function aggregateQuality(
  rows: DashboardMetricRow[],
  filters: DashboardFilters,
  totalAvailable: number,
  humanReview: HumanReviewInput,
): QualityReport {
  let confidenceSum = 0;
  let auditedCases = 0;
  const bandCounts: Record<ConfidenceBand, number> = { ALTA: 0, MEDIA: 0, BAJA: 0 };
  // Suma de confianza y n┬║ de filas por bucket de evidencia faltante.
  const byMissing = new Map<MissingEvidenceBucket, { count: number; sum: number }>();

  for (const row of rows) {
    // SOLO `COMPLETED`. Una auditor├¡a en `ERROR` no emiti├│ dictamen, y una en
    // `RUNNING` todav├¡a no: en los dos casos `confidence` no describe una
    // calidad de auditor├¡a sino el estado del run, y meterla en la media bajar├¡a
    // la confianza media con datos que no son de confianza.
    if (row.audit_status !== 'COMPLETED') continue;

    const confidence = row.confidence;
    // Ausente o no finito: dato ausente. No se cuela en la media ni cuenta como
    // banda baja (la ausencia de confianza NO es baja confianza).
    if (confidence === null || !Number.isFinite(confidence)) continue;

    auditedCases += 1;
    confidenceSum += confidence;

    const band = confidenceBand(confidence);
    // `confidenceBand` solo devuelve `null` con un valor no finito, que ya se
    // filtr├│ arriba; la comprobaci├│n est├í para no inventar una banda si alg├║n d├¡a
    // esa funci├│n cambiara.
    if (band !== null) bandCounts[band] += 1;

    const bucket = missingEvidenceBucket(row.missing_evidence_count);
    const agg = byMissing.get(bucket);
    if (agg === undefined) byMissing.set(bucket, { count: 1, sum: confidence });
    else {
      agg.count += 1;
      agg.sum += confidence;
    }
  }

  const bands: ConfidenceReport['bands'] = CONFIDENCE_BAND_ORDER.map((band) => ({
    band,
    label: CONFIDENCE_BAND_SHORT_LABELS[band],
    count: bandCounts[band],
    // `percentage` ya devuelve 0 cuando el denominador es 0, as├¡ que un
    // periodo sin dict├ímenes sale 0/0/0 y no `NaN`.
    pct: percentage(bandCounts[band], auditedCases),
  }));

  // Solo los buckets CON filas. Un bucket ausente no es un 0: es que no hubo
  // ning├║n caso as├¡ en el periodo, y por eso no aparece.
  const confidenceByMissingEvidence = MISSING_EVIDENCE_BUCKET_ORDER.flatMap((bucket) => {
    const agg = byMissing.get(bucket);
    if (agg === undefined) return [];
    return [
      {
        bucket,
        label: MISSING_EVIDENCE_BUCKET_LABELS[bucket],
        count: agg.count,
        avgConfidence: agg.count === 0 ? null : round3(agg.sum / agg.count),
      },
    ];
  });

  return {
    generatedAt: new Date().toISOString(),
    // CADA FUENTE AVISA DE SU PROPIO RECORTE. La parte humana tiene su propio
    // tope: si se recort├│ ├ëSTA y no las auditor├¡as, la tarjeta tiene que decirlo,
    // porque su tasa se calcul├│ sobre menos comparaciones de las que existen.
    truncated: totalAvailable > DASHBOARD_MAX_ROWS || humanReview.comparisonsAvailable > DASHBOARD_MAX_ROWS,
    filters,
    humanReview: aggregateHumanReview(humanReview),
    confidence: {
      auditedCases,
      avgConfidence: auditedCases === 0 ? null : round3(confidenceSum / auditedCases),
      bands,
      confidenceByMissingEvidence,
    },
  };
}

/**
 * Lee la entrada humana del periodo: las comparaciones de la vista de
 * comparaciones y el conteo de revisiones humanas.
 *
 * DOS FUENTES, UNA TARJETA. `case_comparisons` responde de qu├® se midi├│ la
 * coincidencia y `case_reviews` de cu├íntas personas registraron su decisi├│n. Se
 * cuentan por separado porque son hechos distintos: una revisi├│n sin comparaci├│n
 * cuenta igual, y una comparaci├│n sin revisi├│n NO PUEDE existir (el `UNIQUE` de
 * `case_review_id` lo impide), as├¡ que la uni├│n de abajo nunca inventa revisiones.
 *
 * MISMOS l├¡mites que `getDashboardSummary` (y a diferencia de `getAiCosts`, S├ì
 * filtra por `result`): la coincidencia es una propiedad del dictamen COMPARADO,
 * as├¡ que "solo las cancelaciones de venta" tiene que poder responderse. Aqu├¡ no
 * hay gasto que se pueda esconder por no tener `result`: las comparaciones sin
 * dictamen se excluyen solas al no estar `COMPLETED`.
 *
 * DELIBERADAMENTE SIN `catch` QUE DEVUELVA CEROES: una vista ausente es un fallo
 * de despliegue, y trag├írselo publicar├¡a "no hay revisi├│n humana registrada" sobre
 * una base que S├ì la tiene. El error sale como `ApiError` con su 5xx y la UI lo
 * muestra como error de carga, que es lo que ocurri├│. Convertir un fallo de
 * infraestructura en un "no hay datos" es la peor versi├│n posible de la regla de
 * esta vista, porque el hueco es indistinguible de un periodo vac├¡o.
 */
export async function getHumanReviewInput(
  client: InsForgeClient,
  filters: DashboardFilters,
  auth?: AuthContext,
): Promise<HumanReviewInput> {
  const fromIso = startOfDayUtc(filters.from);
  const toIso = endOfDayUtc(filters.to);

  // Scope multi-tenant: se carga una sola vez por llamada de dashboard.
  const owned = auth?.role === 'user' ? await getOwnedCaseIds(client, auth.sub) : null;

  // Fuente principal: comparaciones (qu├® se compar├│ y su estado).
  let compQuery = client.database
    .from('case_comparisons_dashboard_metrics')
    .select('*', { count: 'exact' })
    .gte('created_at', fromIso)
    .lte('created_at', toIso);

  if (filters.result !== null) compQuery = compQuery.eq('audit_result', filters.result);
  if (filters.status !== null) compQuery = compQuery.eq('case_status', filters.status);
  compQuery = applyDimensionFilters(compQuery, filters);

  const { data: compsData, error: compsError, count: compsCount } = await compQuery.order('created_at', { ascending: true }).limit(DASHBOARD_MAX_ROWS);
  if (compsError) throw mapProviderError(compsError);
  let comparisons = (compsData ?? []) as ComparisonMetricRow[];
  if (owned !== null) {
    comparisons = comparisons.filter((c) => owned.has(c.case_id));
  }
  const comparisonsAvailable = compsCount ?? comparisons.length;

  // Conteo de revisiones humanas dentro del periodo.
  const { data: reviewsData, error: reviewsError } = await client.database
    .from('case_reviews')
    .select('id,case_id')
    .gte('created_at', fromIso)
    .lte('created_at', toIso)
    .limit(DASHBOARD_MAX_ROWS);
  if (reviewsError) throw mapProviderError(reviewsError);
  let reviewsInRange = (reviewsData ?? []) as Array<{ id: string; case_id: string }>;
  if (owned !== null) {
    reviewsInRange = reviewsInRange.filter((r) => owned.has(r.case_id));
  }
  const reviewIdsInRange = new Set(reviewsInRange.map((r) => r.id));

  // Las revisiones contadas son las del periodo M├üS las revisiones referenciadas
  // por comparaciones que cayeron en el periodo aunque la revisi├│n est├® fuera.
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

/**
 * Lee las DOS fuentes del informe de calidad y devuelve el informe ya agregado.
 *
 * MISMOS l├¡mites que `getDashboardSummary` (y a diferencia de `getAiCosts`, este
 * S├ì filtra por `result`): la calidad de un dictamen es una propiedad de ESE
 * dictamen, as├¡ que "solo las cancelaciones de venta" tiene que poder
 * responderse. Aqu├¡ no hay gasto que se pueda esconder por no tener `result`:
 * las auditor├¡as sin dictamen ya se excluyen por ser `COMPLETED` con confianza.
 *
 * Mismos l├¡mites de rango: del primer al ├║ltimo milisegundo del d├¡a, en UTC y
 * ambos inclusivos (un filtro por d├¡a no puede perder la auditor├¡a de las
 * 23:59:59.999), el tope de filas es el mismo y `count: 'exact'` es lo que
 * permite avisar de una truncaci├│n.
 */
/**
 * Columnas que la vista de calidad necesita. Sin `student_identifier` ni
 * `human_result`: esta ruta publica confianza y conteos, y arrastrar el
 * identificador del alumno o su dictamen humano sería Minimización de datos
 * incumplida (GDPR Art. 5(1)(c)) — PII viajando sin devolverse.
 *
 * Las seis dimensiones sí se piden aunque no se devuelvan en la respuesta: sin
 * ellas el filtro por dimensión no se puede aplicar en SQL, y filtrar en
 * memoria después de traer el conjunto daría métricas distintas de las que dice
 * `truncated`.
 */
const AI_QUALITY_COLUMNS =
  'id, created_at, case_status, audit_status, confidence, missing_evidence_count, ' +
  'country, campus, modality, project, responsible, guideline';

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

  const { data, error, count } = await query.order('created_at', { ascending: true }).limit(DASHBOARD_MAX_ROWS);

  // Ning├║n stack trace ni detalle del proveedor al cliente: mapProviderError
  // traduce el error y sanea el mensaje (nada de tokens o URLs internas).
  if (error) throw mapProviderError(error);

  let rows = (data ?? []) as DashboardMetricRow[];
  if (auth?.role === 'user') {
    const owned = await getOwnedCaseIds(client, auth.sub);
    rows = rows.filter((row) => owned.has(row.case_id));
  }
  // Obtener la entrada humana (comparisons + reviewedCases) recortada por periodo y filtros.
  const humanInput = await getHumanReviewInput(client, filters, auth);
  // `aggregateQuality` ahora acepta un HumanReviewInput y lo transforma en el
  // bloque humano que viaja al navegador.
  return aggregateQuality(rows, filters, count ?? rows.length, humanInput);
}
