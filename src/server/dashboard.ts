// =============================================================================
// Dashboard — agregación de métricas de auditoría.
// =============================================================================
// La agregación (`aggregateSummary`) es PURA: recibe filas y devuelve el
// `DashboardSummary` que consume la UI, sin tocar red ni base de datos. Solo
// `getDashboardSummary` habla con InsForge, y lo hace leyendo la vista
// `public.audit_dashboard_metrics`, que proyecta escalares de `audits`+`cases`.
//
// Aquí no hay criterio: los grupos de resolución salen de `RESULT_TO_GROUP`
// (src/lib/labels.ts) y la banda de confianza de los umbrales de ese mismo
// archivo. Este módulo cuenta, no dictamina.
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
  DashboardSummary,
  MissingEvidenceBucket,
  RecentCaseRow,
  ResolutionSplitPoint,
  ResultBreakdownPoint,
  TimelinePoint,
} from '../lib/dashboard.js';
import type { AuditStatus } from './cases.js';
import { endOfDayUtc, startOfDayUtc } from './dashboard-filters.js';
import { mapProviderError } from './http.js';
import type { InsForgeClient } from './insforge.js';

// El tipo vive en `src/lib/dashboard.ts` (única definición, también la usa la
// UI). Se reexporta para no obligar a los importadores a saber de dónde viene.
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
  /** Nº de intentos reales de la llamada (elementos de `openrouterAttempts`). */
  attempts_count: number;
}

/** Tope de filas leídas de la vista. Si la vista trae más, `truncated` va en `true`. */
export const DASHBOARD_MAX_ROWS = 5000;

/** Filas de la tabla "casos recientes". */
const RECENT_CASES_LIMIT = 5;

/** Orden fijo de las categorías del donut: siempre las 3, aunque valgan 0. */
const SPLIT_ORDER: readonly ResolutionGroup[] = RESOLUTION_GROUPS;

/**
 * `RESULT_TO_GROUP` indexado de forma parcial: `result` sale de `result_json`
 * (jsonb libre, escrito por el adaptador), así que puede traer un valor de otra
 * versión que no exista en el mapa. Eso se trata como "dato ausente", no como
 * fallo.
 */
const RESULT_GROUP_BY_RESULT: Partial<Record<AuditResultType, ResolutionGroup>> = RESULT_TO_GROUP;

// -----------------------------------------------------------------------------
// Utilidades puras
// -----------------------------------------------------------------------------

/**
 * Bucket de día en UTC. Se usa `toISOString()` y NUNCA la zona horaria local a
 * propósito: la serie temporal es un dato compartido, y si dependiera del
 * navegador, un caso de las 23:00 se contaría en un día distinto según dónde se
 * mirara la gráfica (en UTC−5, en el día anterior). Con UTC, dos personas ven el
 * mismo periodo aunque estén en paises distintos.
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
 * deliberado: en empate de timestamp gana la fila que aparece DESPUÉS en el
 * array, que es la misma fila que quedaría primera con un
 * `ORDER BY created_at DESC` estable.
 */
function isSameOrNewer(candidate: DashboardMetricRow, current: DashboardMetricRow): boolean {
  return millisOf(candidate.created_at) >= millisOf(current.created_at);
}

/** Auditoría vigente de cada caso: la de `created_at` más reciente. */
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

/** Grupo de resolución de un resultado, o `null` si no se puede clasificar. */
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
 * Estados TERMINALES de una auditoría: ya emitió dictamen (`COMPLETED`) o ya
 * cerró en fallo (`ERROR`). `RUNNING` NO es terminal: la auditoría sigue viva.
 */
const TERMINAL_AUDIT_STATUSES: ReadonlySet<AuditStatus> = new Set<AuditStatus>(['COMPLETED', 'ERROR']);

/** `true` si la auditoría ya cerró, emitiendo dictamen o fallando. */
function isTerminalAudit(row: DashboardMetricRow): boolean {
  return TERMINAL_AUDIT_STATUSES.has(row.audit_status);
}

/** Los tres contadores de grupo: se acumulan en los KPIs y se reparten en el donut. */
interface GroupCounts {
  granted: number;
  needsRuling: number;
  insufficient: number;
}

/** Acumula `+1` en la categoría del grupo. */
function bumpGroup(counts: GroupCounts, group: ResolutionGroup): void {
  if (group === 'CONCEDIDAS') counts.granted += 1;
  else if (group === 'REQUIERE_DICTAMINACION') counts.needsRuling += 1;
  else counts.insufficient += 1;
}

// -----------------------------------------------------------------------------
// Timeline
// -----------------------------------------------------------------------------

/**
 * Serie temporal por día UTC.
 *
 * SEMÁNTICA DELIBERADAMENTE DISTINTA DE LA DE LOS KPIs:
 * la `timeline` muestra el **volumen de dictámenes emitidos por día** (un caso
 * reauditado cuenta una vez por cada dictamen emitido). Los KPIs cuentan **cada
 * caso una sola vez**, por su estado vigente. Por eso ambos números no tienen por
 * qué coincidir.
 *
 * Se agrupan TODAS las filas (no solo las vigentes por caso), porque lo que
 * mide la gráfica es la actividad del periodo: los dictámenes emitidos, no el
 * estado final de cada caso.
 *
 * Reglas:
 *  - Cada fila `COMPLETED` cuenta en SU propio grupo, según `RESULT_TO_GROUP`.
 *  - Las filas `ERROR` y `RUNNING` no aportan a ninguno de los tres grupos. Los
 *    errores se miden aparte, en su propio KPI, y un dictamen ausente no es un
 *    dictamen contrario. Por eso un día CON dictámenes nunca sale en 0/0/0,
 *    aunque su última auditoría haya sido un ERROR (si manda solo la última del
 *    día, el día entero se pierde).
 *  - Solo emite punto un día con al menos un dictamen. Un día sin dictámenes
 *    tampoco aporta volumen, y un punto en cero sería una barra plana que
 *    inventa actividad donde no la hubo.
 */
function buildTimeline(rows: DashboardMetricRow[]): TimelinePoint[] {
  const byDay = new Map<string, GroupCounts>();

  for (const row of rows) {
    // Solo `COMPLETED` emite dictamen: `ERROR` y `RUNNING` quedan fuera de los
    // tres grupos por diseño, no por oversight.
    if (row.audit_status !== 'COMPLETED') continue;
    // `result` ausente o de otra versión: es dato ausente, no un grupo inventado.
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
  // Orden ascendente: `YYYY-MM-DD` ordena lexicográficamente igual que por fecha.
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
// Agregación
// -----------------------------------------------------------------------------

/**
 * Agrega las filas de la vista en el `DashboardSummary` que consume la UI.
 * Pura: sin red, sin reloj (salvo `generatedAt`) y sin efectos secundarios.
 *
 * `totalAvailable` es el total de filas que la base dice que hay (count exacto),
 * no el tamaño de `rows`: es lo único que permite avisar de una truncación.
 */
export function aggregateSummary(
  rows: DashboardMetricRow[],
  filters: DashboardFilters,
  totalAvailable: number,
): DashboardSummary {
  const current = currentAuditsByCase(rows);

  // POR QUÉ UN CASO EN CURSO QUEDA FUERA DEL DENOMINADOR:
  // `RUNNING` no ha emitido dictamen ni ha fallado, así que el caso todavía no
  // está auditado: meterlo en `auditedCases` lo inflaría y, sobre todo, hacerlo
  // aparecer en `errors` haría que una tarjeta titulada "Errores" mintiera. Una
  // auditoría EN CURSO no es un fallo. Por lo tanto `auditedCases` cuenta solo
  // los casos cuya auditoría vigente es TERMINAL (`COMPLETED` o `ERROR`), y los
  // cuatro grupos suman exactamente ese número.
  //
  // Matiz: si un `COMPLETED` llega con `result` nulo o de otra versión, queda
  // sin grupo y sin ser error (dato ausente, no fallo). Eso rompería el reparto,
  // pero es una forma defensiva: el contrato Zod garantiza `COMPLETED` ⇒
  // resultado válido, y así nunca ocurre con datos reales.
  const terminal = current.filter(isTerminalAudit);
  const auditedCases = terminal.length;

  const counts: GroupCounts = { granted: 0, needsRuling: 0, insufficient: 0 };
  let errors = 0;

  // Los 6 resultados en cero desde el principio: la leyenda del desglose es
  // estable aunque no haya ninguno (y el reparto suma lo mismo que los KPIs,
  // porque cuenta las MISMAS auditorías vigentes).
  const byResultCounts = new Map<AuditResultType, number>();
  for (const result of AUDIT_RESULTS) byResultCounts.set(result, 0);

  for (const row of terminal) {
    // `terminal` solo contiene COMPLETED y ERROR, así que lo que queda aquí es
    // COMPLETED. `ERROR` es el único estado no completado que es un fallo real.
    if (row.audit_status === 'ERROR') {
      errors += 1;
      continue;
    }
    // `result` sale de `result_json` (jsonb libre): puede traer un valor de otra
    // versión. `Map.has` lo descarta sin inventar un grupo.
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
  // `current` y no `terminal`, y un caso con auditoría `RUNNING` sigue
  // apareciendo (con `result` y `confidence` en `null`). Ocultarlo haría que la
  // lista no cuadrase con lo que la persona ve en el listado de casos.
  const recentCases: RecentCaseRow[] = [...current]
    // `reverse()` antes de ordenar para que, en empate de timestamp, gane la fila
    // que estaba después en el array (misma regla que `isSameOrNewer`). El
    // `sort` de JS es estable, así que el orden inverso se conserva.
    .reverse()
    .sort((a, b) => millisOf(b.created_at) - millisOf(a.created_at))
    .slice(0, RECENT_CASES_LIMIT)
    .map((row) => ({
      caseId: row.case_id,
      shortId: row.case_id.slice(0, 8),
      studentIdentifier: row.student_identifier,
      result: row.result,
      confidence: row.confidence,
      missingEvidenceCount: row.missing_evidence_count ?? 0,
      caseStatus: row.case_status,
      date: row.created_at,
    }));

  return {
    generatedAt: new Date().toISOString(),
    truncated: totalAvailable > DASHBOARD_MAX_ROWS,
    filters,
    kpi: {
      auditedCases,
      granted,
      grantedPct: percentage(granted, auditedCases),
      needsRuling,
      needsRulingPct: percentage(needsRuling, auditedCases),
      insufficient,
      insufficientPct: percentage(insufficient, auditedCases),
      errors,
      errorsPct: percentage(errors, auditedCases),
    },
    timeline: buildTimeline(rows),
    split,
    byResult,
    recentCases,
  };
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

  const { data, error, count } = await query
    .order('created_at', { ascending: true })
    .limit(DASHBOARD_MAX_ROWS);

  // Ningún stack trace ni detalle del proveedor al cliente: mapProviderError
  // traduce el error y sanea el mensaje (nada de tokens o URLs internas).
  if (error) throw mapProviderError(error);

  const rows = (data ?? []) as DashboardMetricRow[];
  return aggregateSummary(rows, filters, count ?? rows.length);
}

// -----------------------------------------------------------------------------
// Bandas de confianza
// -----------------------------------------------------------------------------

/**
 * Umbrales de confianza reexportados para el servidor: son los mismos que
 * usa la UI (`src/lib/labels.ts`), no una segunda copia que pueda divergir.
 */
export const CONFIDENCE_THRESHOLDS = {
  high: CONFIDENCE_HIGH_THRESHOLD,
  medium: CONFIDENCE_MEDIUM_THRESHOLD,
} as const;

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
// Resumen, pero con una regla que la otra vista no necesita: aquí el AUSENTE es
// lo importante. Un coste que OpenRouter no reportó NO es un coste cero: es un
// coste desconocido. Todo el módulo nace de esa distinción, y por eso los KPI
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
 * costes conocidos, y la suma de una lista vacía es 0, un valor válido. El 0 de
 * un modelo sin coste conocido no significa "este modelo costó cero": significa
 * que no se sabe cuánto costó. Para distinguirlo está `costKnownCalls`.
 *
 * `avgCostUsd` es `null` cuando `costKnownCalls === 0`, porque el promedio de un
 * conjunto vacío no es 0: no hay nada que promediar, así que el dato no existe.
 * Devolver 0 ahí publicaría una cifra inventada justo donde el riesgo es mayor
 * (auditorías en `ERROR`, que no traen `usage` ni coste por intento).
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
   * un `$0.0000` que parecería un gasto real.
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
  reliability: { successful: number; retried: number; fallback: number; failed: number };
}

/**
 * REGLA ÚNICA DE COSTE, en un solo sitio para que ningún consumidor pueda
 * inventarse la suya.
 *
 * `usage_cost_usd` es lo que OpenRouter Facturó en la llamada que terminó;
 * `attempts_cost_usd` es la suma de lo que costarían TODOS los intentos
 * registrados, incluido el que falló. Se prefiere el primero porque es el dato
 * real de gasto y el segundo es una estimación por SUMA de datos parciales; el
 * segundo solo aparece cuando el primero no existe (auditorías en `ERROR`, que
 * casi nunca llegan a `usage`).
 *
 * Si AMBOS son `null`, el resultado es `null`: el coste de esa auditoría es
 * DESCONOCIDO. No se devuelve 0 y NUNCA se recalcula un precio a partir de los
 * tokens: hacerlo sería inventar la tarifa del modelo aquí y dejarla congelada
 * para siempre, y además daría un 0 falso que la UI no puede distinguir de un
 * gasto real de 0 (una llamada gratis o un crédito a coste 0).
 *
 * Los tokens siguen la misma regla, cada magnitud con su propio COALESCE.
 *
 * LA TRIPLETA QUE ESTA EXPRESIÓN RESUELVE, y que fija un test:
 *   (null, null) -> null   el dato no existe.
 *   (0.02, null) -> 0.02   `usage_cost_usd` manda cuando existe.
 *   (null,    0) -> 0      un 0 LITERAL se respeta como 0.
 *
 * El tercer caso es el que hace que la función NO esté arreglando el defecto
 * que se le atribuyó: `public.audit_dashboard_metrics` antes devolvía
 * `attempts_cost_usd = 0` cuando ningún intento reportaba `cost`, así que este
 * `??` devolvía ese 0 y la UI pintaba `$0` para auditorías cuyo coste se
 * desconocía. La vista ya no lo emite (el CTE `att` devuelve NULL cuando ningún
 * intento trajo el valor), y `(null, 0) -> 0` sigue siendo lo correcto aquí:
 * un 0 explícito es un dato afirmado, y descartar un dato afirmado sería
 * inventar un hueco por la vía contraria. Esta función no valida de dónde viene
 * cada columna; la vista es la que garantiza no fabricar ceros.
 */
export const COST_PER_ROW = (row: DashboardMetricRow): number | null => row.usage_cost_usd ?? row.attempts_cost_usd;

const TOTAL_TOKENS_PER_ROW = (row: DashboardMetricRow): number | null => row.usage_total_tokens ?? row.attempts_total_tokens;

const PROMPT_TOKENS_PER_ROW = (row: DashboardMetricRow): number | null => row.usage_prompt_tokens ?? row.attempts_prompt_tokens;

const COMPLETION_TOKENS_PER_ROW = (row: DashboardMetricRow): number | null =>
  row.usage_completion_tokens ?? row.attempts_completion_tokens;

/** Milisegundos por día, para aritmética de periodos en UTC. */
const COST_MS_PER_DAY = 86_400_000;

/** Milisegundos por semana ISO (7 días completos). */
const COST_MS_PER_WEEK = 604_800_000;

/**
 * Semana ISO en formato `YYYY-Www`.
 *
 * NO es "la semana del año calendario": ISO-8601 define que la semana 1 es la
 * que contiene el PRIMER JUEVES del año, y que la semana empieza el lunes. Las
 * dos reglas juntas producen los casos límite que un dashboard tiene que ver
 * bien: el 1 de enero puede caer en la semana 53 del año anterior
 * (2021-01-01 -> `2020-W53`) y el 31 de diciembre puede caer ya en la semana 1
 * del año siguiente (2025-12-31 -> `2026-W01`). Por eso la clave lleva el AÑO
 * ISO, calculado desde el jueves de la semana, y no el año calendario de la
 * fecha: agrupar un rango que cruza Nocheviebre por el año calendario partiría
 * en dos la misma semana y la serie mostraría un salto que no existe.
 */
function isoWeekBucket(ms: number): string {
  const date = new Date(ms);
  // Lunes = 0 ... domingo = 6.
  const dayOfWeek = (date.getUTCDay() + 6) % 7;
  // El jueves de la semana en curso es lo que define el año ISO: la semana que
  // lo contiene es la última del año pasado o la primera del nuevo, y el jueves
  // siempre cae dentro del año al que pertenece la semana.
  const thursdayMs = ms + (3 - dayOfWeek) * COST_MS_PER_DAY;
  const isoYear = new Date(thursdayMs).getUTCFullYear();

  // Lunes de la semana 1 = lunes de la semana que contiene el 4 de enero. Se usa
  // el 4 y NO el 1 porque el 1 de enero puede caer en sábado o domingo, es decir
  // en la ÚLTIMA semana del año ISO anterior: con el 1, "enero de 2023" daría
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
 * compartido y con hora local un mismo gasto caería en un día distinto según
 * dónde se mire.
 */
function costBucket(iso: string, granularity: CostGranularity): string {
  const ms = Date.parse(iso);
  // `created_at` es un timestamptz de Postgres y siempre es ISO válido; esta
  // rama solo evita un NaN que rompería la serie entera con una fecha ilegible.
  if (Number.isNaN(ms)) return utcDayBucket(iso);
  if (granularity === 'month') return new Date(ms).toISOString().slice(0, 7);
  if (granularity === 'week') return isoWeekBucket(ms);
  return utcDayBucket(iso);
}

/**
 * Percentil nearest-rank sobre el array YA ORDENADO ascendentemente.
 *
 * Fórmula: `idx = clamp(ceil(p / 100 * n) - 1, 0, n - 1)`, es decir el primer
 * elemento cuya posición (1-indexada) es `ceil(p/100 * n)`. El `clamp` protege
 * los dos extremos: p50 con n par cae en la mitad inferior del rango, y un
 * redondeo de coma flotante nunca puede devolver un índice fuera del array.
 *
 * Se elige nearest-rank y no interpolación porque el P95 de latencia va
 * junto a un P50 literal: mixing percentiles "de facto" hace que la UI pueda
 * señalar filas concretas, y el nearest-rank siempre señala una fila real.
 */
function percentileNearestRank(sorted: number[], p: number): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  const raw = Math.ceil((p / 100) * n) - 1;
  const idx = Math.min(Math.max(raw, 0), n - 1);
  const value = sorted[idx];
  // `idx` está acotado a [0, n-1] y n > 0, así que esto no se da: es para que el
  // compilador sepa que hay un número y no un `undefined` silencioso.
  if (value === undefined) return null;
  return Math.round(value);
}

/**
 * Agrega las filas de la vista en el informe de IA & Costos.
 * Pura: sin red, sin reloj (salvo `generatedAt`) y sin efectos secundarios.
 *
 * `totalAvailable` es el total de filas que la base dice que hay (count exacto),
 * no el tamaño de `rows`: es lo único que permite avisar de una truncación.
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

  const byBucket = new Map<string, number>();
  // `costKnownCalls` lleva el mismo nombre que el campo del DTO a propósito:
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

    // POR QUÉ SOLO `COMPLETED`: `latency_ms` es el tiempo que tardó la llamada
    // cuando la auditoría terminó bien. En una fila `ERROR` es el tiempo hasta
    // el fallo (o hasta el deadline), que no es la misma magnitud. Y en las
    // auditorías "stale" curadas por `audit-service.ts` el valor es literalmente
    // la EDAD del run, no su duración: mezclarlo en la media inflaría el P95
    // con horas que no fueron de cómputo. Se mide la latencia de lo que funcionó;
    // los fallos se miden aparte, en `reliability.failed`.
    if (row.audit_status === 'COMPLETED' && row.latency_ms !== null && Number.isFinite(row.latency_ms)) {
      latencyValues.push(row.latency_ms);
    }

    // ADVERTENCIA PARA LA UI: `successful`, `retried` y `fallback` NO son
    // categorías excluyentes. Una auditoría completada tras un reintento cuenta
    // en las tres, y eso es correcto: cada bloque mide una cosa distinta (o succeeded,
    // o cuánto costó insistir). Si la UI los SUMA como si fueran una
    // partición, el total no cuadrará con `auditsCounted` y aparecerá un bug
    // donde no lo hay.
    if (row.audit_status === 'COMPLETED') successful += 1;
    if (row.audit_status === 'ERROR') failed += 1;
    // Reintento REAL dentro de la llamada (varios elementos en
    // `openrouterAttempts`). Es otra cosa que `attempt_number`, que cuenta
    // re-ejecuciones del run completo desde `audit-service.ts`.
    if (row.attempts_count > 1) retried += 1;
    // Fallback de modelo: se intentó más de un modelo.
    if ((row.provider_models?.length ?? 0) > 1) fallback += 1;

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
  // empieza por el año (en `week`, el AÑO ISO) y los dos dígitos siguientes van
  // crecientes, así que el orden lexicográfico coincide con el cronológico.
  for (const bucket of [...byBucket.keys()].sort()) {
    costSeries.push({ bucket, costUsd: byBucket.get(bucket) ?? 0 });
  }

  const byModelRows: ModelCostRow[] = [...byModel.entries()].map(([model, agg]) => ({
    model,
    calls: agg.calls,
    // La SUMA sigue siendo `number` aunque no haya ningún coste conocido: 0 es la
    // suma válida de una lista vacía. Lo que dice "no lo sabemos" es
    // `costKnownCalls`, y por eso el promedio de abajo es `null` y no 0.
    totalCostUsd: agg.costUsd,
    // Denominador: las llamadas del modelo con coste CONOCIDO, no `calls`. Si
    // una llamada no tiene coste, promediar sobre `calls` la bajaría a la nada.
    // Y si NINGUNA la tiene, no hay promedio: `null`, no 0.
    avgCostUsd: agg.costKnownCalls === 0 ? null : agg.costUsd / agg.costKnownCalls,
    costKnownCalls: agg.costKnownCalls,
  }));
  // El orden NO mira `avgCostUsd`: con `avgCostUsd: null` una resta daría NaN y
  // el comparador quedaría sin criterio. Se ordena por la suma (que sí es
  // comparable entre dos modelos), luego por llamadas y luego por nombre.
  byModelRows.sort(
    (a, b) => b.totalCostUsd - a.totalCostUsd || b.calls - a.calls || a.model.localeCompare(b.model),
  );

  return {
    generatedAt: new Date().toISOString(),
    truncated: totalAvailable > DASHBOARD_MAX_ROWS,
    filters,
    granularity,
    kpi: {
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
    },
    costSeries,
    byModel: byModelRows,
    reliability: { successful, retried, fallback, failed },
  };
}

/**
 * Lee la vista de métricas y devuelve el informe de costes ya agregado.
 *
 * MISMOS límites que `getDashboardSummary`: el rango va del primer al último
 * milisegundo del día, en UTC y ambos inclusivos (un filtro por día no puede
 * perder la auditoría de las 23:59:59.999), el tope de filas es el mismo y
 * `count: 'exact'` es lo que permite avisar de una truncación.
 *
 * POR QUÉ AQUÍ NO SE FILTRA POR `result` (y en el Resumen sí): el coste de una
 * auditoría es el mismo sea cual sea su dictamen, y las auditorías en `ERROR`
 * no tienen `result` que filtrar. Filtrar por dictamen haría desaparecer
 * justamente el gasto de los intentos que fallaron, que es la mitad de la
 * pregunta que responde este dashboard. El filtro `status` (estado del caso) sí
 * se mantiene: ese criterio lo puso quien está mirando, y no oculta coste.
 */
export async function getAiCosts(
  client: InsForgeClient,
  filters: DashboardFilters,
  granularity: CostGranularity,
): Promise<AiCostsReport> {
  const fromIso = startOfDayUtc(filters.from);
  const toIso = endOfDayUtc(filters.to);

  let query = client.database
    .from('audit_dashboard_metrics')
    .select('*', { count: 'exact' })
    .gte('created_at', fromIso)
    .lte('created_at', toIso);
  if (filters.status !== null) query = query.eq('case_status', filters.status);

  const { data, error, count } = await query
    .order('created_at', { ascending: true })
    .limit(DASHBOARD_MAX_ROWS);

  // Ningún stack trace ni detalle del proveedor al cliente: mapProviderError
  // traduce el error y sanea el mensaje (nada de tokens o URLs internas).
  if (error) throw mapProviderError(error);

  const rows = (data ?? []) as DashboardMetricRow[];
  return aggregateAiCosts(rows, filters, granularity, count ?? rows.length);
}

// =============================================================================
// Calidad
// =============================================================================
// Esta vista NACIO de una ausencia, y el código entero está escrito para no
// taparla.
//
// NO existe revisión humana en ninguna tabla. `cases` y `audits` no guardan quién
// revisó un dictamen, ni la resolución que una persona dio, ni una corrección
// posterior. Por eso la mitad "humana" de la calidad —coincidencia IA/humano,
// matriz de confusión, coincidencia por tipo de caso— NO SE PUEDE CALCULAR.
//
// Y aquí está la diferencia entre una pantalla honesta y una que miente: un
// `agreementPct: 0` afirmaría "la IA coincide con el humano un 0 % de las
// veces", que es una afirmación FALSA sobre un dato que no existe (no es que
// fallen todos: es que nadie los ha comparado). Lo que se devuelve es `null` más
// un motivo legible, y la UI lo pinta como "sin dato", nunca como cero.
//
// Lo que SÍ es real, y es la parte honesta de la pregunta "¿baja la calidad
// cuando faltan evidencias?", es la confianza que el propio modelo declaró en
// cada dictamen. Eso sí se mide, y sí se muestra.
// =============================================================================

/**
 * Etiqueta CORTA de cada banda, para el eje X de la gráfica (donde "Alta
 * confianza" no cabe y "Media confianza" se solaparía con la vecina).
 *
 * NO sustituye a `CONFIDENCE_BAND_LABELS` (`src/lib/labels.ts`), que sigue siendo
 * la forma larga y canónica: el `band` viaja siempre junto a `label`, así que
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
 * Motivo por el que la parte humana del informe no existe.
 *
 * `agreementPct` es SIEMPRE `null` mientras `available` sea `false`. No hay forma
 * de que estas tres magnitudes se confundan con un número: son `null` por tipo,
 * así que TypeScript no deja ni imprimirlas ni compararlas como si lo fueran.
 * Volverlas `number` obligaría a inventar un 0, y ese 0 es exactamente la
 * mentira que esta vista evita.
 */
export interface HumanReviewReport {
  available: false;
  reason: 'NO_HUMAN_REVIEW_DATA';
  /** Explicación en español, lista para pintar tal cual. */
  message: string;
  reviewedCases: number;
  correctedCases: number;
  agreementPct: null;
  confusionMatrix: null;
  agreementByCaseType: null;
}

/**
 *POR QUÉ ESTOS TRES CONTADORES SON 0 Y NO `null`: no son magnitudes derivadas de
 * un cálculo, son la ausencia del campo entero. No existe `reviewed_by` ni
 * `corrected_at` en ninguna tabla, así que el número de casos revisados no es
 * "desconocido": es CERO porque nadie ha revisado nada. El 0 es el dato
 * VERDADERO aquí; lo que sería falso es `agreementPct`, que sí sería el
 * resultado de un cálculo. La UI los muestra como `—` + "sin revisión humana",
 * nunca como un porcentaje.
 */
const HUMAN_REVIEW_MESSAGE =
  'Todavía no hay datos suficientes. El sistema no registra revisión humana ni correcciones, ' +
  'así que la coincidencia IA/humano no se puede calcular. Se muestra únicamente lo que sí ' +
  'existe: la confianza declarada por el modelo en cada dictamen.';

/** Construye el informe humano. Objeto nuevo en cada llamada: nada mutable compartido. */
function noHumanReviewData(): HumanReviewReport {
  return {
    available: false,
    reason: 'NO_HUMAN_REVIEW_DATA',
    message: HUMAN_REVIEW_MESSAGE,
    reviewedCases: 0,
    correctedCases: 0,
    agreementPct: null,
    confusionMatrix: null,
    agreementByCaseType: null,
  };
}

/** Bucket de evidencia faltante. La clave viaja como texto porque `2+` no es un número. */
export type { MissingEvidenceBucket };

/** Orden fijo de los buckets, de menos a más evidencia faltante. */
const MISSING_EVIDENCE_BUCKET_ORDER: readonly MissingEvidenceBucket[] = ['0', '1', '2+'];

/**
 * Etiquetas de cada bucket.
 *
 * El `2+` NO se desglosa en `2`, `3`, `4`… a propósito: la pregunta que responde
 * esta vista es "¿la confianza baja cuando el expediente está incompleto?", y para
 * eso interesa el efecto de una ausencia grande, no la cola de expedientes con
 * seis evidencias ausentes. Además, un bucket por cada valor real haría que la
 * gráfica mostrara un subconjunto arbitrario del periodo en lugar del periodo.
 */
const MISSING_EVIDENCE_BUCKET_LABELS: Record<MissingEvidenceBucket, string> = {
  '0': 'Expediente completo',
  '1': 'Falta 1 evidencia',
  '2+': 'Faltan 2 o más',
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

/** Redondeo a 3 decimales: quita el ruido de coma flotante sin perder precisión útil. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Confianza declarada por el modelo, agrupada.
 *
 * `bands` trae SIEMPRE las 3 bandas, aunque valgan 0: una banda en cero es
 * información ("nunca hubo confianza baja"), y sin ella la gráfica cambiaría de
 * forma al mover el periodo en vez de al dato.
 *
 * `confidenceByMissingEvidence` es al revés a propósito: solo incluye los buckets
 * con al menos una fila. Poner un bucket en cero ahí sería afirmar "con un
 * expediente completo la confianza media es 0 %", que es falso: es que no hay
 * ningún expediente completo en el periodo.
 */
export interface ConfidenceReport {
  /** Dictámenes COMPLETED que declararon confianza (el denominador de `pct`). */
  auditedCases: number;
  /** `null` si ningún dictamen declaró confianza: la media de una lista vacía no es 0. */
  avgConfidence: number | null;
  bands: Array<{ band: ConfidenceBand; label: string; count: number; pct: number }>;
  confidenceByMissingEvidence: Array<{
    bucket: MissingEvidenceBucket;
    label: string;
    count: number;
    avgConfidence: number | null;
  }>;
}

/** Informe completo de `/api/dashboard/quality`. */
export interface QualityReport {
  generatedAt: string;
  truncated: boolean;
  filters: DashboardFilters;
  humanReview: HumanReviewReport;
  confidence: ConfidenceReport;
}

/**
 * Agrega las filas de la vista en el informe de Calidad.
 * Pura: sin red, sin reloj (salvo `generatedAt`) y sin efectos secundarios.
 *
 * `totalAvailable` es el total de filas que la base dice que hay (count exacto),
 * no el tamaño de `rows`: es lo único que permite avisar de una truncación.
 */
export function aggregateQuality(
  rows: DashboardMetricRow[],
  filters: DashboardFilters,
  totalAvailable: number,
): QualityReport {
  let confidenceSum = 0;
  let auditedCases = 0;
  const bandCounts: Record<ConfidenceBand, number> = { ALTA: 0, MEDIA: 0, BAJA: 0 };
  // Suma de confianza y nº de filas por bucket de evidencia faltante.
  const byMissing = new Map<MissingEvidenceBucket, { count: number; sum: number }>();

  for (const row of rows) {
    // SOLO `COMPLETED`. Una auditoría en `ERROR` no emitió dictamen, y una en
    // `RUNNING` todavía no: en los dos casos `confidence` no describe una
    // calidad de auditoría sino el estado del run, y meterla en la media bajaría
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
    // filtró arriba; la comprobación está para no inventar una banda si algún día
    // esa función cambiara.
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
    // `percentage` ya devuelve 0 cuando el denominador es 0, así que un
    // periodo sin dictámenes sale 0/0/0 y no `NaN`.
    pct: percentage(bandCounts[band], auditedCases),
  }));

  // Solo los buckets CON filas. Un bucket ausente no es un 0: es que no hubo
  // ningún caso así en el periodo, y por eso no aparece.
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
    truncated: totalAvailable > DASHBOARD_MAX_ROWS,
    filters,
    humanReview: noHumanReviewData(),
    confidence: {
      auditedCases,
      avgConfidence: auditedCases === 0 ? null : round3(confidenceSum / auditedCases),
      bands,
      confidenceByMissingEvidence,
    },
  };
}

/**
 * Lee la vista de métricas y devuelve el informe de Calidad ya agregado.
 *
 * MISMOS límites que `getDashboardSummary` (y a diferencia de `getAiCosts`, este
 * SÍ filtra por `result`): la calidad de un dictamen es una propiedad de ESE
 * dictamen, así que "solo las cancelaciones de venta" tiene que poder
 * responderse. Aquí no hay gasto que se pueda esconder por no tener `result`:
 * las auditorías sin dictamen ya se excluyen por ser `COMPLETED` con confianza.
 *
 * Mismos límites de rango: del primer al último milisegundo del día, en UTC y
 * ambos inclusivos (un filtro por día no puede perder la auditoría de las
 * 23:59:59.999), el tope de filas es el mismo y `count: 'exact'` es lo que
 * permite avisar de una truncación.
 */
export async function getAiQuality(
  client: InsForgeClient,
  filters: DashboardFilters,
): Promise<QualityReport> {
  const fromIso = startOfDayUtc(filters.from);
  const toIso = endOfDayUtc(filters.to);

  let query = client.database
    .from('audit_dashboard_metrics')
    .select('*', { count: 'exact' })
    .gte('created_at', fromIso)
    .lte('created_at', toIso);
  if (filters.result !== null) query = query.eq('result', filters.result);
  if (filters.status !== null) query = query.eq('case_status', filters.status);

  const { data, error, count } = await query
    .order('created_at', { ascending: true })
    .limit(DASHBOARD_MAX_ROWS);

  // Ningún stack trace ni detalle del proveedor al cliente: mapProviderError
  // traduce el error y sanea el mensaje (nada de tokens o URLs internas).
  if (error) throw mapProviderError(error);

  const rows = (data ?? []) as DashboardMetricRow[];
  return aggregateQuality(rows, filters, count ?? rows.length);
}
