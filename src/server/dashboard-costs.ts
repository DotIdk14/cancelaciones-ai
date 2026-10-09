// =============================================================================
// Dashboard — métricas de costos
// =============================================================================
import type { DashboardFilters } from '../lib/dashboard.js';
import type { DashboardMetricRow } from './dashboard-contracts.js';
import { utcDayBucket } from './dashboard-utils.js';



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
  _totalAvailable: number,
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
    truncated: false,
    filters,
    granularity,
    kpi,
    costSeries,
    byModel: byModelRows,
    reliability,
  };
}
