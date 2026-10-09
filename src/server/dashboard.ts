// =============================================================================
// Dashboard — agregación de métricas de auditoría.
// =============================================================================
// Las agregaciones son PURAS: reciben filas y devuelven informes sin tocar red
// ni base de datos. Las consultas a InsForge viven en `dashboard-queries.ts`.
//
// Aquí no hay criterio: los grupos de resolución salen de `RESULT_TO_GROUP`
// (src/lib/labels.ts) y la banda de confianza de los umbrales de ese mismo
// archivo. Este módulo cuenta, no dictamina.
// =============================================================================

import { AUDIT_RESULTS, type AuditResultType, type CaseStatus, type ErrorCategory } from '../skills/audit/types.js';
import {
  CONFIDENCE_HIGH_THRESHOLD,
  CONFIDENCE_MEDIUM_THRESHOLD,
  originLabel,
  RESOLUTION_GROUPS,
  RESULT_TO_GROUP,
  UNDETERMINED_LABEL,
  type ConfidenceBand,
  type ResolutionGroup,
} from '../lib/labels.js';
// `EXECUTION_OUTCOMES` viene de `dashboard-shared.ts` (modulo sin dependencias) y
// el resto son solo tipos: `import type` se borra al compilar, asi que la Function
// nunca carga `lib/dashboard.ts` ni su dependencia de navegador
// `local-dashboard-preview`. Ver `src/lib/dashboard-shared.ts`.
import { EXECUTION_OUTCOMES } from '../lib/dashboard-shared.js';
import type {
  DashboardFilters,
  DashboardKpi,
  DashboardSummary,
  ExecutionOutcome,
  ExecutionReport,
  HumanAgreementReport,
  HumanMismatchRow,
  MissingEvidenceBucket,
  OriginBreakdownPoint,
  OriginDistribution,
  RecentCaseRow,
  ResolutionSplitPoint,
  ResultBreakdownPoint,
  SummaryCostKpi,
  TimelinePoint,
} from '../lib/dashboard.js';
import type { AuditStatus } from './cases.js';
// El vocabulario de los estados de una comparación vive UNA vez, en la capa que
// escribe esas filas. Importarlo (sólo tipo, sin coste en runtime) evita que el
// dashboard tenga su propia lista y que las dos se separen sin que nada falle.
import type { ComparisonStatusRow } from './reviews.js';

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
  country: string | null;
  channel: string | null;
  campus: string | null;
  modality: string | null;
  project: string | null;
  responsible: string | null;
  guideline: string | null;
  /**
   * Dictamen humano de `case_reviews` para ESTE `id` de auditoría, o `null` si
   * el caso aún no tiene revisión. Es `null` con frecuencia, y NO es lo mismo
   * que una discrepancia: `null` = nadie ha revisado, `false` = alguien
   * revisó y discrepó.
   */
  human_result: string | null;
}

/** Tope de filas leídas de la vista. Si la vista trae más, `truncated` va en `true`. */
export const DASHBOARD_MAX_ROWS = 5000;

/** Filas de la tabla "casos recientes". */
const RECENT_CASES_LIMIT = 5;

/** Orden fijo de las categorías del donut: siempre las 4, aunque valgan 0. */
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

/** Los cuatro contadores de grupo: se acumulan en los KPIs y se reparten en el donut. */
interface GroupCounts {
  granted: number;
  needsRuling: number;
  rejected: number;
  insufficient: number;
}

/** Acumula `+1` en la categoría del grupo. */
function bumpGroup(counts: GroupCounts, group: ResolutionGroup): void {
  if (group === 'CONCEDIDAS') counts.granted += 1;
  else if (group === 'REQUIERE_DICTAMINACION') counts.needsRuling += 1;
  else if (group === 'RECHAZADOS') counts.rejected += 1;
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
      const fresh: GroupCounts = { granted: 0, needsRuling: 0, rejected: 0, insufficient: 0 };
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
      rejected: counts.rejected,
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
// -----------------------------------------------------------------------------
// Clasificación técnica de la ejecución
// -----------------------------------------------------------------------------

/**
 * Clasifica UNA ejecución en las cuatro categorías técnicas.
 *
 * "Éxito" aquí es un hecho del TRANSPORTE, no del dictamen: la auditoría
 * terminó correctamente y no quedó en `ERROR`. Que el dictamen sea una
 * cancelación o una baja es otra pregunta, y por eso esta función NUNCA mira
 * `result`: si lo mirara, "12 ejecuciones exitosas" se leería como "12
 * cancelaciones concedidas", que es una afirmación falsa sobre el producto.
 *
 * Las señales, todas datos reales que ya trae la vista:
 *   - `audit_status`: `COMPLETED` = terminó bien, `ERROR` = falló.
 *   - `attempts_count`: cuántos intentos REALES hizo la llamada.
 *   - `provider_models`: los modelos DISTINTOS que se probaron.
 */
export function classifyExecution(row: DashboardMetricRow): ExecutionOutcome {
  // `RUNNING` no ha terminado: no es un éxito ni un fallo.
  if (row.audit_status !== 'COMPLETED') return 'FAILED';

  const distinctModels = row.provider_models?.length ?? 0;
  if (distinctModels > 1) return 'SUCCESS_WITH_FALLBACK';

  const attempts = row.attempts_count;
  if (typeof attempts === 'number' && attempts > 1) return 'SUCCESS_AFTER_RETRY';

  return 'SUCCESS_FIRST_ATTEMPT';
}

/**
 * Reparto de resultados técnicos de las ejecuciones TERMINALES del periodo.
 *
 * Se cuenta sobre `terminal` (las vigentes de cada caso), no sobre todas las
 * filas: si un caso se auditó tres veces, lo que interesa es cómo terminó.
 */
export function aggregateExecution(terminal: DashboardMetricRow[]): ExecutionReport {
  const counts = new Map<ExecutionOutcome, number>();
  for (const outcome of EXECUTION_OUTCOMES) counts.set(outcome, 0);
  let withFallback = 0;

  for (const row of terminal) {
    const outcome = classifyExecution(row);
    counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
    if ((row.provider_models?.length ?? 0) > 1) withFallback += 1;
  }

  const first = counts.get('SUCCESS_FIRST_ATTEMPT') ?? 0;
  const retry = counts.get('SUCCESS_AFTER_RETRY') ?? 0;
  const fallback = counts.get('SUCCESS_WITH_FALLBACK') ?? 0;
  const failed = counts.get('FAILED') ?? 0;

  return {
    byOutcome: EXECUTION_OUTCOMES.map((outcome) => ({ outcome, count: counts.get(outcome) ?? 0 })),
    succeeded: first + retry + fallback,
    failed,
    total: terminal.length,
    withFallback,
  };
}

// -----------------------------------------------------------------------------
// Coincidencia entre el dictamen de la IA y el dictamen humano
// -----------------------------------------------------------------------------

/** Tope de discrepancias que se devuelven en detalle. */
const DISCREPANCY_LIMIT = 20;

export function aggregateHumanAgreement(current: DashboardMetricRow[]): HumanAgreementReport {
  const mismatches: HumanMismatchRow[] = [];
  let totalHumanReviewed = 0;
  let matched = 0;

  for (const row of current) {
    const human = row.human_result ?? null;
    if (human === null || human.trim() === '') continue;
    totalHumanReviewed += 1;

    const isKnownHuman = (AUDIT_RESULTS as readonly string[]).includes(human);
    if (isKnownHuman && row.result !== null && human === row.result) {
      matched += 1;
      continue;
    }
    mismatches.push({
      auditId: row.id,
      caseId: row.case_id,
      aiResult: row.result,
      humanResult: human,
    });
  }

  if (totalHumanReviewed === 0) {
    return {
      available: false,
      reason: 'NO_HUMAN_REVIEWS',
      agreementPct: null,
      totalHumanReviewed: 0,
      matched: 0,
      mismatched: 0,
      mismatches: [],
    };
  }

  return {
    available: true,
    reason: null,
    agreementPct: (matched / totalHumanReviewed) * 100,
    totalHumanReviewed,
    matched,
    mismatched: totalHumanReviewed - matched,
    mismatches: mismatches.sort((a, b) => a.caseId.localeCompare(b.caseId)).slice(0, DISCREPANCY_LIMIT),
  };
}

/**
 * Coste del periodo para la primera zona del resumen.
 *
 * Se cuenta sobre TODAS las filas, no sobre `terminal`: el coste de una
 * ejecución que acabó en ERROR también se pagó.
 */
export function aggregateSummaryCost(rows: DashboardMetricRow[]): SummaryCostKpi {
  let total = 0;
  let costKnownAudits = 0;
  const casesWithCost = new Set<string>();

  for (const row of rows) {
    const cost = COST_PER_ROW(row);
    if (cost === null) continue;
    total += cost;
    costKnownAudits += 1;
    casesWithCost.add(row.case_id);
  }

  const cases = casesWithCost.size;
  return {
    totalCostUsd: total,
    avgCostPerCaseUsd: cases === 0 ? null : total / cases,
    casesWithCost: cases,
    costAvailable: costKnownAudits > 0,
  };
}

/**
 * Distribución de una dimensión de origen sobre las auditorías TERMINALES.
 *
 * Mismo criterio de terminalidad que el resto del resumen: un caso en curso no
 * tiene dictamen, así que no tiene origen que contar. Se cuenta por código crudo
 * (no por etiqueta) para que dos valores que compartieran etiqueta no se fusionen.
 */
export function aggregateOrigin(
  rows: DashboardMetricRow[],
  dimension: 'country' | 'channel',
): OriginDistribution {
  const counts = new Map<string, number>();
  let totalWithOrigin = 0;

  for (const row of rows.filter(isTerminalAudit)) {
    const raw = row[dimension];
    const value = raw == null || raw === '' ? UNDETERMINED_LABEL : raw;
    if (value !== UNDETERMINED_LABEL) totalWithOrigin += 1;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const points: OriginBreakdownPoint[] = [...counts.entries()]
    .map(([value, count]) => ({ value, label: originLabel(dimension, value), count }))
    // Frecuencia descendente; empate resuelto por etiqueta para que el orden sea
    // estable entre ejecuciones y el gráfico no baile. "Sin determinar" siempre al
    // final: es la ausencia de dato, no una categoría que compita con las demás.
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'es'))
    .sort((a, b) => Number(a.value === UNDETERMINED_LABEL) - Number(b.value === UNDETERMINED_LABEL));

  return { points, totalWithOrigin };
}

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
  // cinco grupos (cuatro de resolución + errores) suman exactamente ese número.
  //
  // Matiz: si un `COMPLETED` llega con `result` nulo o de otra versión, queda
  // sin grupo y sin ser error (dato ausente, no fallo). Eso rompería el reparto,
  // pero es una forma defensiva: el contrato Zod garantiza `COMPLETED` ⇒
  // resultado válido, y así nunca ocurre con datos reales.
  const terminal = current.filter(isTerminalAudit);
  const auditedCases = terminal.length;
  const casesWithMissingEvidence = terminal.filter((row) => (row.missing_evidence_count ?? 0) > 0).length;

  const counts: GroupCounts = { granted: 0, needsRuling: 0, rejected: 0, insufficient: 0 };
  let errors = 0;

  // Todos los resultados en cero desde el principio: la leyenda del desglose es
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

  const { granted, needsRuling, rejected, insufficient } = counts;

  const split: ResolutionSplitPoint[] = SPLIT_ORDER.map((group) => {
    if (group === 'CONCEDIDAS') return { group, count: granted };
    if (group === 'REQUIERE_DICTAMINACION') return { group, count: needsRuling };
    if (group === 'RECHAZADOS') return { group, count: rejected };
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
      result: row.result,
      confidence: row.confidence,
      missingEvidenceCount: row.missing_evidence_count ?? 0,
      caseStatus: row.case_status,
      date: row.created_at,
      country: row.country,
      channel: row.channel,
    }));

  // Los KPI siempre llevan los campos del contrato, aunque valgan 0. El 0 en
  // `casesWithMissingEvidence` es un dato válido: "ningún caso auditado tenía
  // evidencia faltante", no una ausencia de medición.
  const kpi: DashboardKpi = {
    auditedCases,
    granted,
    grantedPct: percentage(granted, auditedCases),
    needsRuling,
    needsRulingPct: percentage(needsRuling, auditedCases),
    rejected,
    rejectedPct: percentage(rejected, auditedCases),
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
    byCountry: aggregateOrigin(rows, 'country'),
    byChannel: aggregateOrigin(rows, 'channel'),
    recentCases,
    execution: aggregateExecution(terminal),
    agreement: aggregateHumanAgreement(current),
    cost: aggregateSummaryCost(rows),
  };
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
  let successfulFirstAttempt = 0;
  let successfulAfterRetry = 0;
  let successfulFallback = 0;
  let outcomeFailed = 0;
  let outcomeInProgress = 0;

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

    if (row.audit_status === 'ERROR') {
      outcomeFailed += 1;
    } else if (row.audit_status === 'RUNNING') {
      outcomeInProgress += 1;
    } else if (row.audit_status === 'COMPLETED') {
      const models = row.provider_models;
      if (row.attempt_number === null || row.attempt_number < 1 || row.attempts_count < 1 || !models || models.length === 0) {
        // Metadatos de ejecución ausentes en esta fila: no se cuenta en ningún
        // desglose (`executionOutcomes` del interfaz queda sin poblar aquí a
        // propósito; la salida plana de `reliability` es la que consumen UI y pruebas).
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
  // ejecución reales cuando la fila aportó metadatos suficientes.
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

// =============================================================================
// Calidad
// =============================================================================
// Esta vista tiene DOS fuentes, y sólo una de las dos existe por construcción:
//
//  1. LA CONFIANZA que declaró el modelo en cada dictamen. Vive desde el primer
//     dictamen, y se lee de `public.audit_dashboard_metrics`.
//
//  2. LA REVISIÓN HUMANA: qué decidió una persona, y si el modelo coincidió con
//     esa decisión al comparar. Nació con el módulo de revisión humana
//     (`case_reviews` + `case_comparisons`) y se lee de
//     `public.case_comparisons_dashboard_metrics`.
//
// LA DIFERENCIA ENTRE UNA PANTALLA HONESTA Y UNA QUE MIENTE ESTÁ ENTERA EN LO QUE
// HACE ESTE ARCHIVO CUANDO NO HAY DATO. Un `agreementRate: 0` afirmaría "hubo
// cero coincidencias", y eso es FALSO cuando lo que pasa es que nadie comparó: no
// es que la IA falle siempre, es que todavía no hay nada que medir. Lo que se
// devuelve es `null` más un motivo legible, y la UI lo pinta como "sin dato",
// nunca como cero. Es el mismo criterio que ya separa NULL de 0 en las columnas
// de coste de la vista de métricas (`COST_PER_ROW`, con su tripleta fijada por
// un test más arriba en este archivo), y por eso aquí hay tests que lo fijan
// también.
//
// NADA DE ESTA SECCIÓN CLASIFICA (NO_RULES_ENGINE). El bloque humano no
// reinterpreta el veredicto de la comparación: `agrees` y `confidence` los
// escribió el modelo y ya pasaron por `ComparisonResultSchema`
// (src/skills/review/schema.ts). Aquí sólo se cuentan y se promedian. La
// resolución final del caso sigue siendo la de la persona, y el modelo dice si
// discrepa, no reemplaza la decisión.
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
 * Fila de `public.case_comparisons_dashboard_metrics`.
 *
 * ESCALARES SOLO, igual que `DashboardMetricRow`: la vista no expone
 * `result_json` ni el comentario humano, y no los expone por una razón concreta.
 * `explanation` y `discrepancyReason` son texto que el modelo escribió sobre un
 * expediente con PII, y nadie los necesita para contar; lo que hace falta son
 * `agrees` y `confidence`, que son dos números.
 *
 * `agrees` y `confidence` son `null` cuando la fila está `RUNNING` o `ERROR` (es
 * así como las escribe `reviews.ts`) y también cuando el `result_json` no trae
 * un valor legible. `null` significa "no hay dato", y por eso el agregador nunca
 * lo cuenta como desacuerdo.
 */
export interface ComparisonMetricRow {
  id: string;
  case_review_id: string;
  case_id: string;
  /** Estado del CASO, para que el filtro `status` del dashboard aplique también aquí. */
  case_status: CaseStatus | null;
  /** Dictamen de la auditoría COMPARADA, para que el filtro `result` aplique. */
  audit_result: AuditResultType | null;
  status: ComparisonStatusRow;
  /** Fecha de la comparación: es la que recorta el periodo de este bloque. */
  created_at: string;
  agrees: boolean | null;
  confidence: number | null;
}

/**
 * Entrada humana del agregador: lo que la consulta deja para el periodo.
 *
 * Se pasa SEPARADA de las filas de `DashboardMetricRow` a propósito. Son dos
 * fuentes distintas, con dos periodos distintos (`audits.created_at` y
 * `case_comparisons.created_at`) y dos filas distintas, y mezclarlas haría que
 * un filtro del dashboard moviera la coincidencia por un efecto secundario. Por
 * eso `aggregateQuality` la recibe como argumento OBLIGATORIO: un valor por
 * defecto haría que olvidar cablearla en producción se viera como un informe
 * honesto de "no hay revisiones", que es justo la mentira que este bloque evita.
 */
export interface HumanReviewInput {
  /**
   * Revisiones humanas del periodo. Incluye las registradas en el rango MÁS las
   * que son dueñas de una comparación del rango (una revisión del 31 de agosto
   * cuya comparación terminó el 2 de septiembre cuenta: es la misma historia
   * humana, y sin ella el bloque se contradiría a sí mismo, diciendo "no hay
   * revisión registrada" junto a una tasa ya calculada).
   */
  reviewedCases: number;
  /** Comparaciones del periodo, ya recortadas por la consulta. */
  comparisons: ComparisonMetricRow[];
  /** Total exacto del periodo, para poder avisar de una truncación. */
  comparisonsAvailable: number;
}

/**
 * Parte humana del informe de calidad.
 *
 * LO QUE ESTA INTERFAZ PROMETE, POR TIPO: `agreementRate` y
 * `avgComparisonConfidence` son `number | null`, y el `null` significa "no se ha
 * medido". Por eso NO son `number` con un 0 de reserva: un `0` es un dato
 * AFIRMADO ("de todas las comparaciones, ninguna coincidió"), y en el caso que
 * importa es FALSO, porque lo que pasa es que todavía no se comparó nada. El 0
 * se reserva para los contadores, que son hechos y no promedios: `0` revisiones
 * registradas SÍ es verdad cuando nadie ha revisado nada.
 *
 * `agreementRate` es una RAZÓN entre 0 y 1, NO un porcentaje: 0.667 son dos
 * tercios. Se redondea a 3 decimales, igual que las medias de confianza del
 * informe, para que la coma flotante no deje `0.6666666666666666` en la
 * pantalla.
 */
export interface HumanReviewReport {
  /** `true` si existe al menos UNA revisión humana en el periodo. */
  available: boolean;
  /**
   * Explicación del estado actual, en español, lista para pintar tal cual.
   *
   * La redacta el SERVIDOR y no el frontend a propósito: la explicación de por
   * qué falta un dato tiene que vivir junto al cálculo que la produce, y todos
   * los números que aparecen en el texto salen de las cifras de este mismo
   * objeto. Si el mensaje lo compusiera la UI, podría decir "no hay datos" con
   * datos delante sin que nadie lo notara.
   */
  message: string;
  /** Revisiones humanas registradas que el periodo contiene. */
  reviewedCases: number;
  /**
   * Revisiones con resultado humano y de auditoría disponibles: en el flujo de
   * comparaciones son las `COMPLETED`, las únicas con veredicto y el
   * denominador de `agreementRate`. Exigida por `ExactHumanReviewReport`.
   */
  comparableReviews: number;
  /** Comparaciones `COMPLETED`: las únicas con veredicto. */
  completedComparisons: number;
  /** Comparaciones `RUNNING`: en curso, sin veredicto todavía. */
  pendingComparisons: number;
  /** Comparaciones `ERROR`: terminadas en fallo, sin veredicto. */
  failedComparisons: number;
  /** De las completadas, cuántas afirmaron coincidencia (`agrees === true`). */
  agreements: number;
  /** De las completadas, cuántas afirmaron discrepancia (`agrees === false`). */
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
 * texto no pueda contradecir a los números que acompaña: si los dos salieran de
 * recorridos distintos, un `message` podría acabar diciendo "2 comparaciones
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
 * POR QUÉ `RUNNING` Y `ERROR` NO SON NI UN ACUERDO NI UN DESACUERDO: una
 * comparación en curso todavía no tiene veredicto, y una fallida no llegó a
 * emitirlo. Contarlas como desacuerdo publicaría una discrepancia que nadie
 * registró, que es justo el defecto que este bloque evita. Se informan aparte,
 * en `pendingComparisons` y `failedComparisons`.
 *
 * `agrees === null` en una fila `COMPLETED` es una forma defensiva: la fila
 * AFIRMA que terminó (eso dice su `status`, y es un dato), pero no trae
 * veredicto legible. Suma a `completed` —porque terminó— y ni a `agreements` ni a
 * `disagreements`, porque no hay nada que repartir entre esos dos. Nunca ocurre
 * con datos reales: `updateComparisonResult` sólo escribe un `result_json` que ya
 * pasó `ComparisonResultSchema` (src/skills/review/schema.ts).
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

    // Ausente o no finito: dato ausente. Promediarlo bajaría la confianza media
    // de la comparación con un valor que nadie declaró.
    const confidence = row.confidence;
    if (confidence !== null && Number.isFinite(confidence)) {
      counts.confidenceSum += confidence;
      counts.confidenceReported += 1;
    }
  }

  return counts;
}

/** `1 revisión humana` / `2 revisiones humanas`. El número SIEMPRE delante. */
function pluralizar(cantidad: number, singular: string, plural: string): string {
  return `${cantidad} ${cantidad === 1 ? singular : plural}`;
}

/** Enumera sin Oxford coma: `a, b y c`. Nunca recibe una lista vacía. */
function enumerar(partes: readonly string[]): string {
  if (partes.length === 0) return '';
  if (partes.length === 1) return partes[0] ?? '';
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1] ?? ''}`;
}

/**
 * Estado sin una sola revisión humana. El texto va FIJO y un test lo fija
 * entero: es el mensaje que la UI explica bajo las tarjetas vacías, y si cambia
 * tiene que cambiar a propósito.
 */
const SIN_REVISION_MESSAGE =
  'Todavía no hay ninguna revisión humana registrada en el periodo, así que no hay nada que comparar: ' +
  'la coincidencia entre el dictamen de la IA y la decisión de una persona no se puede calcular. ' +
  'Se muestra únicamente lo que sí existe: la confianza declarada por el modelo en cada dictamen.';

/**
 * Frase de apertura, común a todos los estados con revisiones: el número de
 * revisiones del periodo sale de `input.reviewedCases`, ya contado por la
 * consulta, así que el texto nunca puede afirmar más de lo que el dato sostiene.
 */
function cabeceraRevisiones(reviewedCases: number): string {
  return `Hay ${pluralizar(reviewedCases, 'revisión humana registrada', 'revisiones humanas registradas')} en el periodo`;
}

/**
 * POR QUÉ EL SERVIDOR REDACTA EL `message` Y NO LA UI
 *
 * La explicación de por qué falta un dato tiene que vivir JUNTO al cálculo que la
 * produce, o las dos piezas se desincronizan sin que nada falle. Con el mensaje
 * aquí, todos los números que aparecen en el texto salen de `counts` —el mismo
 * objeto que alimenta las cifras de la tarjeta— y la UI lo pinta tal cual
 * (`src/components/dashboard/QualityPage.tsx`).
 *
 * Y hay un criterio más fuerte que el de no contradecirse: el texto no puede
 * AFIRMAR un estado que los datos no sostienen. Por eso "en curso" y "falló" son
 * cláusulas condicionales y no un menú fijo: cuando no hay nada en curso, el
 * mensaje no dice "en curso", porque eso insinuaría una actividad que no existe.
 *
 * LA REGLA DE LOS ESTADOS, en orden:
 *   1. Sin revisiones                  -> el mensaje fijo de arriba.
 *   2. Revisiones y NINGUNA comparación -> "ninguna tiene comparación": no hay
 *      nada en curso porque no se empezó nada. Es un tercer estado, distinto
 *      tanto de "en curso" como de "falló".
 *   3. Sin completadas, sólo en curso   -> la tasa todavía no se puede calcular.
 *   4. Sin completadas, sólo fallidas   -> se dice que FALLARON, nunca "en curso".
 *   5. Sin completadas, de las dos      -> las dos, con la misma reserva.
 *   6. Con completadas, nada pendiente  -> se mide sobre ellas y ya.
 *   7. Con completadas y resto          -> se mide SÓLO sobre las completadas, y se
 *      dice explícitamente que las demás no cuentan.
 */
function humanReviewMessage(input: HumanReviewInput, counts: HumanReviewCounts, available: boolean): string {
  if (!available) return SIN_REVISION_MESSAGE;

  const cabecera = cabeceraRevisiones(input.reviewedCases);
  const { completed, pending, failed } = counts;

  // Estado 2: hay revisiones pero ni una comparación. No hay nada en curso
  // porque no se empezó nada, y decirlo con "en curso" sería mentir.
  if (input.comparisons.length === 0) {
    return (
      `${cabecera} y ninguna tiene comparación: la coincidencia entre el dictamen de la IA ` +
      `y la decisión de una persona todavía no se puede calcular porque no se ha comparado ` +
      `ningún caso del periodo.`
    );
  }

  const sinCompletadas =
    `${cabecera}, con ${pluralizar(pending, 'comparación en curso', 'comparaciones en curso')} ` +
    `y ${pluralizar(failed, 'comparación fallida', 'comparaciones fallidas')}, ninguna completada todavía: ` +
    `la coincidencia entre el dictamen de la IA y la decisión de una persona no se puede calcular. ` +
    `Las comparaciones que no se completaron no cuentan ni como acuerdo ni como desacuerdo, y se informan aparte.`;

  // Estado 3: sólo en curso.
  if (completed === 0 && pending > 0 && failed === 0) {
    return (
      `${cabecera}, con ${pluralizar(pending, 'comparación en curso', 'comparaciones en curso')} ` +
      `y ninguna completada todavía: la coincidencia entre el dictamen de la IA y la decisión de ` +
      `una persona no se puede calcular hasta que exista una comparación completada.`
    );
  }

  // Estado 4: sólo fallidas. El verbo va en plural porque el texto tiene que
  // poder hablar del conjunto aunque haya una sola.
  if (completed === 0 && failed > 0 && pending === 0) {
    return (
      `${cabecera}, con ${pluralizar(failed, 'comparación fallida', 'comparaciones fallidas')}: ` +
      `ninguna llegó a emitir veredicto, así que la coincidencia entre el dictamen de la IA y la ` +
      `decisión de una persona no se puede calcular. Las comparaciones que fallaron no aportan ni ` +
      `acuerdo ni desacuerdo, y se informan aparte.`
    );
  }

  // Estado 5: en curso y fallidas, sin ninguna completada.
  if (completed === 0) return sinCompletadas;

  // Estado 6: hay completadas y nada más. La palabra "fallida" no aparece por
  // ningún lado: no hay ninguna, y nombrarla insinuaría un fallo inexistente.
  if (pending === 0 && failed === 0) {
    return (
      `${cabecera}, con ${pluralizar(completed, 'comparación completada', 'comparaciones completadas')}: ` +
      `la coincidencia entre el dictamen de la IA y la decisión de una persona se mide solo sobre ` +
      `ellas, porque todas las comparaciones del periodo terminaron.`
    );
  }

  // Estado 7: hay completadas y además alguna en curso o fallida. Se enumeran
  // SÓLO las que existen: nombrar una categoría vacía ("y 0 fallidas") insinuaría
  // un fallo que no ocurrió, que es la misma mentira en su forma más pequeña.
  const partes = [pluralizar(completed, 'comparación completada', 'comparaciones completadas')];
  if (pending > 0) partes.push(pluralizar(pending, 'comparación en curso', 'comparaciones en curso'));
  if (failed > 0) partes.push(`${failed} ${failed === 1 ? 'fallida' : 'fallidas'}`);

  return (
    `${cabecera}: ${enumerar(partes)}. La coincidencia entre el dictamen de la IA y la decisión de ` +
    `una persona se mide solo sobre las comparaciones completadas: las que no llegaron a completarse ` +
    `no cuentan ni como acuerdo ni como desacuerdo, y se informan aparte.`
  );
}

/**
 * Agrega la entrada humana del periodo en el bloque `humanReview` del informe.
 *
 * PURA: sin red, sin reloj y sin efectos secundarios. Recibe la entrada YA
 * recortada por periodo y filtros (`getHumanReviewInput`) y aquí sólo cuenta y
 * promedia.
 *
 * LA REGLA NÚMERO UNO, y la razón de que este bloque exista:
 *   `agreementRate` es `number | null` y vale `null` CUANDO `completedComparisons`
 *   es 0. Nunca 0.
 *
 * Un 0 ahí afirmaría "de todas las comparaciones, ninguna coincidió", y eso es
 * FALSO cuando lo que ocurre es que todavía no se comparó nada: no es que el
 * modelo falle siempre, es que no hay nada que medir. Por eso el 0 se queda
 * reservado para los CONTADORES, que son hechos (`0` revisiones registradas SÍ es
 * verdad cuando nadie ha revisado nada) y para el caso en que sí hubo
 * comparaciones completadas y ninguna coincidió, que es una afirmación
 * verdadera sobre un dato que existe.
 *
 * NADA DE ESTA FUNCIÓN CLASIFICA (NO_RULES_ENGINE). `agrees` y `confidence` los
 * escribió el modelo y ya pasaron por `ComparisonResultSchema`
 * (src/skills/review/schema.ts). Aquí sólo se cuentan y se promedian; la
 * resolución final del caso sigue siendo la de la persona.
 */
export function aggregateHumanReview(input: HumanReviewInput): HumanReviewReport {
  const counts = countComparisons(input.comparisons);
  // `available` responde "¿sabe el sistema algo de revisión humana?", así que
  // basta con que exista una revisión O una comparación: el agregado es puro y
  // no puede asumir que la consulta ya hizo esta unión.
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
    ? 'No hay revisiones humanas registradas para las auditorías de este periodo; la coincidencia no se puede calcular.'
    : comparableReviews === 0
      ? `Hay ${input.reviews.length} revisión(es), pero no hay un resultado disponible en su auditoría exacta para calcular coincidencia.`
      : `Coincidencia exacta entre el resultado humano y el de la auditoría referenciada: ${agreements} de ${comparableReviews} revisiones comparables.`;

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
  humanReview: HumanReviewReport;
  confidence: ConfidenceReport;
}

/**
 * Agrega las filas de la vista en el informe de Calidad.
 * Pura: sin red, sin reloj (salvo `generatedAt`) y sin efectos secundarios.
 *
 * `totalAvailable` es el total de filas que la base dice que hay (count exacto),
 * no el tamaño de `rows`: es lo único que permite avisar de una truncación.
 *
 * `humanReview` es OBLIGATORIO a propósito (ver `HumanReviewInput`): viene de
 * OTRA fuente y OTRO periodo, y darle un valor por defecto haría que olvidarla
 * al cablearla en producción se viera como un informe honesto de "no hay
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
    // CADA FUENTE AVISA DE SU PROPIO RECORTE. La parte humana tiene su propio
    // tope: si se recortó ÉSTA y no las auditorías, la tarjeta tiene que decirlo,
    // porque su tasa se calculó sobre menos comparaciones de las que existen.
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
