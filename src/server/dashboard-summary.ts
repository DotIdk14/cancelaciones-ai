// =============================================================================
// Dashboard — resumen y resultados
// =============================================================================
import { AUDIT_RESULTS, type AuditResultType } from '../skills/audit/types.js';
import { CONFIDENCE_HIGH_THRESHOLD, CONFIDENCE_MEDIUM_THRESHOLD, originLabel, RESOLUTION_GROUPS, RESULT_TO_GROUP, UNDETERMINED_LABEL, type ConfidenceBand, type ResolutionGroup } from '../lib/labels.js';
import { EXECUTION_OUTCOMES } from '../lib/dashboard-shared.js';
import type { DashboardFilters, DashboardKpi, DashboardSummary, ExecutionOutcome, ExecutionReport, HumanAgreementReport, HumanMismatchRow, OriginBreakdownPoint, OriginDistribution, RecentCaseRow, ResolutionSplitPoint, ResultBreakdownPoint, SummaryCostKpi, TimelinePoint } from '../lib/dashboard.js';
import type { AuditStatus } from './cases.js';
import type { DashboardMetricRow } from './dashboard-contracts.js';
import { COST_PER_ROW } from './dashboard-costs.js';
import { millisOf, percentage, utcDayBucket } from './dashboard-utils.js';



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
  _totalAvailable: number,
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
    truncated: false,
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
