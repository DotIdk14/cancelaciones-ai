// =============================================================================
// Contrato de datos de la vista "Resumen" (dashboard).
//
// Tipos, constantes y el cliente HTTP que pide el agregado: aqu├¡ no hay
// agregaci├│n ni criterio. El backend resuelve el periodo y devuelve el
// agregado ya calculado; el frontend ├║nicamente lo pinta. Cualquier decisi├│n
// de negocio sigue viviendo en el Audit Skill y en el servidor, nunca en este
// archivo.
// =============================================================================

import type { AuditResultType, CaseStatus } from '../skills/audit/types';
import { isRecord, readError } from './api.js';
import type { ConfidenceBand, ResolutionGroup } from './labels';

// -----------------------------------------------------------------------------
// Filtros
// -----------------------------------------------------------------------------

/** Filtros de la barra superior. Fechas en `YYYY-MM-DD`, `null` = sin filtro. */
export type DashboardFilters = {
  from: string;
  to: string;
  result: string | null;
  status: string | null;
  country?: string | null;
  campus?: string | null;
  modality?: string | null;
  project?: string | null;
  responsible?: string | null;
  guideline?: string | null;
};

/**
 * Dimensiones del caso que el dashboard puede filtrar. Espejo de
 * `CASE_DIMENSIONS` en `src/server/dashboard-filters.ts` (el servidor es la
 * fuente; aquí solo el tipo que viaja al cliente).
 */
export const DASHBOARD_DIMENSIONS = [
  'country',
  'campus',
  'modality',
  'project',
  'responsible',
  'guideline',
] as const;

export type DashboardDimension = (typeof DASHBOARD_DIMENSIONS)[number];

/** Etiqueta en pantalla de cada dimensión. */
export const DIMENSION_LABELS: Record<DashboardDimension, string> = {
  country: 'País',
  campus: 'Campus',
  modality: 'Modalidad',
  project: 'Proyecto',
  responsible: 'Responsable',
  guideline: 'Lineamiento',
};

export type DashboardFilterOptions = Record<DashboardDimension, string[]>;

export const EMPTY_DASHBOARD_FILTER_OPTIONS: DashboardFilterOptions = {
  country: [],
  campus: [],
  modality: [],
  project: [],
  responsible: [],
  guideline: [],
};

// -----------------------------------------------------------------------------
// KPIs
// -----------------------------------------------------------------------------

/** Claves de KPI. `auditedCases` es el denominador de los porcentajes. */
export type KpiKey = 'auditedCases' | 'casesWithMissingEvidence' | 'granted' | 'needsRuling' | 'insufficient' | 'errors';

export interface DashboardKpi {
  auditedCases: number;
  casesWithMissingEvidence: number;
  casesWithMissingEvidencePct: number;
  granted: number;
  grantedPct: number;
  needsRuling: number;
  needsRulingPct: number;
  insufficient: number;
  insufficientPct: number;
  errors: number;
  errorsPct: number;
}

export const EMPTY_KPI: DashboardKpi = {
  auditedCases: 0,
  casesWithMissingEvidence: 0,
  casesWithMissingEvidencePct: 0,
  granted: 0,
  grantedPct: 0,
  needsRuling: 0,
  needsRulingPct: 0,
  insufficient: 0,
  insufficientPct: 0,
  errors: 0,
  errorsPct: 0,
};

/**
 * Campo de porcentaje asociado a cada KPI. Evita repetir la convenci├│n
 * `<clave>Pct` desparramada por los componentes.
 */
export const KPI_PCT: Record<Exclude<KpiKey, 'auditedCases'>, keyof DashboardKpi> = {
  casesWithMissingEvidence: 'casesWithMissingEvidencePct',
  granted: 'grantedPct',
  needsRuling: 'needsRulingPct',
  insufficient: 'insufficientPct',
  errors: 'errorsPct',
};

// -----------------------------------------------------------------------------
// Series
// -----------------------------------------------------------------------------

/** Punto de la evoluci├│n temporal por bucket (d├¡a o semana seg├║n el periodo). */
export interface TimelinePoint {
  bucket: string;
  granted: number;
  needsRuling: number;
  insufficient: number;
}

/** Reparto por grupo de resoluci├│n. */
export interface ResolutionSplitPoint {
  group: ResolutionGroup;
  count: number;
}

/** Reparto por resultado de auditor├¡a (sin agrupar). */
export interface ResultBreakdownPoint {
  result: AuditResultType;
  count: number;
}

// -----------------------------------------------------------------------------
// Filas
// -----------------------------------------------------------------------------

/** Fila de la tabla de casos recientes. La PII del estudiante NO viaja aqu├¡. */
export interface RecentCaseRow {
  caseId: string;
  shortId: string;
  /** No se env├¡a desde el servidor; se conserva opcional para no romper la UI. */
  studentIdentifier?: string | null;
  result: AuditResultType | null;
  confidence: number | null;
  missingEvidenceCount: number;
  caseStatus: CaseStatus;
  date: string;
}

// -----------------------------------------------------------------------------
// Envoltorio
// -----------------------------------------------------------------------------

/**
 * Cómo terminó una ejecución de auditoría, en términos TÉCNICOS.
 *
 * OJO, aquí "éxito" NO significa que se concediera la cancelación. Significa que
 * la llamada al modelo terminó correctamente y no quedó en `ERROR`. Son dos
 * cosas distintas y confundirlas haría que "12 ejecuciones exitosas" se leyera
 * como "12 cancelaciones concedidas", que no es lo que pasó.
 *
 * Las cuatro categorías son mutuamente excluyentes y suman el total de
 * ejecuciones del periodo. El desglose es:
 *
 *   - `SUCCESS_FIRST_ATTEMPT`: terminó bien y no necesitó reintento.
 *   - `SUCCESS_AFTER_RETRY`: terminó bien, pero hubo más de un intento.
 *   - `SUCCESS_WITH_FALLBACK`: terminó bien y se probó más de un MODELO.
 *   - `FAILED`: terminó en `ERROR`.
 *
 * `SUCCESS_WITH_FALLBACK` tiene prioridad sobre `SUCCESS_AFTER_RETRY`: si se
 * probaron dos modelos, lo noteworthy es el fallback, no que hubiera reintentado.
 */
export type ExecutionOutcome =
  | 'SUCCESS_FIRST_ATTEMPT'
  | 'SUCCESS_AFTER_RETRY'
  | 'SUCCESS_WITH_FALLBACK'
  | 'FAILED';

/** Orden fijo de las categorías: el que se pinta siempre, aunque valgan 0. */
export const EXECUTION_OUTCOMES: readonly ExecutionOutcome[] = [
  'SUCCESS_FIRST_ATTEMPT',
  'SUCCESS_AFTER_RETRY',
  'SUCCESS_WITH_FALLBACK',
  'FAILED',
];

export const EXECUTION_OUTCOME_LABELS: Record<ExecutionOutcome, string> = {
  SUCCESS_FIRST_ATTEMPT: 'Éxito al primer intento',
  SUCCESS_AFTER_RETRY: 'Éxito tras reintento',
  SUCCESS_WITH_FALLBACK: 'Éxito con fallback',
  FAILED: 'Fallidas',
};

export const EXECUTION_OUTCOME_DESCRIPTIONS: Record<ExecutionOutcome, string> = {
  SUCCESS_FIRST_ATTEMPT: 'La auditoría terminó correctamente al primer intento.',
  SUCCESS_AFTER_RETRY: 'Terminó correctamente, pero tuvo que reintentarse.',
  SUCCESS_WITH_FALLBACK: 'Terminó correctamente después de probar más de un modelo.',
  FAILED: 'La auditoría terminó en error y no produjo dictamen.',
};

/** Un punto de la distribución de resultados técnicos. */
export interface ExecutionOutcomePoint {
  outcome: ExecutionOutcome;
  count: number;
}

/**
 * Bloque "Rendimiento de IA" del resumen.
 *
 * `total` es el número de ejecuciones clasificadas, y las cuatro categorías lo
 * suman exactamente. `succeeded` y `failed` son los dos totales que se muestran
 * grandes, derivados de las categorías y no contados aparte.
 */
export interface ExecutionReport {
  /** Las cuatro categorías, siempre las cuatro y en orden fijo. */
  byOutcome: ExecutionOutcomePoint[];
  /** `SUCCESS_*` sumados. */
  succeeded: number;
  /** `FAILED`. */
  failed: number;
  /** `succeeded + failed`: todas las ejecuciones del periodo. */
  total: number;
  /**
   * Auditorías con más de un modelo distinto en `openrouterAttempts`. Es el
   * mismo número que alimenta `SUCCESS_WITH_FALLBACK`, expuesto aparte porque
   * "hubo fallback" es un dato del proveedor, no del resultado.
   */
  withFallback: number;
}

/**
 * Bloque "Coincidencia IA / humano" del resumen.
 *
 * `available` es lo primero que hay que mirar: si es `false` no hay NINGÚN
 * dictamen humano y `agreementPct` es `null`. Mostrar `0` en ese caso sería
 * afirmar "la IA nunca coincide con una persona" cuando en realidad lo que no hay
 * es muestra. `null` y `0` son datos distintos y no se confunden.
 */
export interface HumanAgreementReport {
  available: boolean;
  /** Motivo por el que no hay coincidencia calculable, o `null` si sí la hay. */
  reason: string | null;
  /** `matchedReviews / totalHumanReviewed * 100`, o `null` si no hay muestra. */
  agreementPct: number | null;
  /** Auditorías con dictamen humano registrado. Es el DENOMINADOR. */
  totalHumanReviewed: number;
  /** De esas, las que coinciden con el dictamen de la IA. */
  matched: number;
  /** De esas, las que difieren. */
  mismatched: number;
  /** Reparto de las discrepancias por par (IA -> humano), para poder actuar. */
  mismatches: HumanMismatchRow[];
}

/** Una discrepancia concreta: qué dijo la IA y qué dijo la persona. */
export interface HumanMismatchRow {
  auditId: string;
  caseId: string;
  aiResult: AuditResultType | null;
  humanResult: string;
}

export interface DashboardSummary {
  generatedAt: string;
  /** `true` cuando el servidor trunc├│ el conjunto para poder agregarlo. */
  truncated: boolean;
  filters: DashboardFilters;
  kpi: DashboardKpi;
  timeline: TimelinePoint[];
  split: ResolutionSplitPoint[];
  byResult: ResultBreakdownPoint[];
  recentCases: RecentCaseRow[];
  /** Bloque "Rendimiento de IA". */
  execution: ExecutionReport;
  /** Bloque "Coincidencia IA / humano". */
  agreement: HumanAgreementReport;
  /** Coste del periodo, para la primera zona sin obligar a ir a IA & Costos. */
  cost: SummaryCostKpi;
}

/**
 * Coste en la primera zona del resumen.
 *
 * `costAvailable: false` significa que NADIE reportó coste, que es distinto de
 * que el coste fuera cero: por eso el indicador viaja aparte del número.
 */
export interface SummaryCostKpi {
  totalCostUsd: number;
  /** `totalCostUsd / casos con coste conocido`. `null` si no hay coste. */
  avgCostPerCaseUsd: number | null;
  /** Casos con al menos una llamada con coste conocido (el denominador). */
  casesWithCost: number;
  costAvailable: boolean;
}

// -----------------------------------------------------------------------------
// Informe de costes de IA (`/api/dashboard/ai-costs`)
//
// Estos tipos son el ESPEJO de los que agrega `src/server/dashboard.ts`. Aqu├¡
// no se calcula nada: ni un precio, ni un percentil, ni una media. Solo se
// declara la forma que llega para poder pintarla sin adivinar.
//
// Dos advertencias que la UI debe respetar y que por eso quedan escritas en los
// tipos, no en un comentario suelto del componente:
//   1. Un 0 en `avgLatencyMs`/`p50`/`p95` no significa "instant├íneo": el servidor
//      devuelve `null` cuando no hay mediciones, y `null` se pinta como `DASH`.
//   2. En `reliability` los cuatro contadores NO son una partici├│n: se solapan
//      (una auditor├¡a completada tras un reintento cuenta en las dos). Sumarlos
//      dar├¡a un total que no cuadra con `auditsCounted`.
// -----------------------------------------------------------------------------

/**
 * Granularidad de la serie de coste. La clave de `bucket` cambia de forma:
 * `day` -> `YYYY-MM-DD`, `week` -> `YYYY-Www` (a├▒o ISO), `month` -> `YYYY-MM`.
 * El frontend NO la parsea: la muestra tal cual.
 */
export type CostGranularity = 'day' | 'week' | 'month';

/**
 * Cabecera de coste, latencia y volumen del periodo.
 *
 * Las banderas `*Available` son la ├║nica forma fiable de distinguir "no hay
 * datos" de "hay datos y valen cero": sin ellas, un `0` de facto es unknowable
 * y la UI acabar├¡a mintiendo con un `$0.0000` o un `0 ms` de Aspecto real.
 */
export interface AiCostsKpi {
  totalCostUsd: number;
  avgCostPerCaseUsd: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  /** `null` cuando el periodo no tiene mediciones de latencia. */
  avgLatencyMs: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  /** Auditor├¡as que entraron en el agregado (noAuditor├¡as, no llamadas al modelo). */
  auditsCounted: number;
  /** Casos distintos con al menos una llamada con coste conocido. */
  casesCounted: number;
  costAvailable: boolean;
  tokensAvailable: boolean;
  latencyAvailable: boolean;
}

/** Punto de la serie de coste por periodo. `bucket` es una clave de texto. */
export interface CostSeriesPoint {
  bucket: string;
  costUsd: number;
}

/** Consumo por modelo. */
export interface ModelCostRow {
  model: string;
  calls: number;
  totalCostUsd: number;
  avgCostUsd: number;
  /**
   * Llamadas de este modelo con coste CONOCIDO. Opcional a prop├│sito: si el
   * servidor todav├¡a no lo env├¡a, `hasKnownModelCost` cae a un criterio seguro
   * (0 en total Y 0 en promedio) en lugar de asumir que todo se conoce.
   *
   * Cuando vale `0` el coste del modelo es DESCONOCIDO, no cero: ninguna de sus
   * llamadas inform├│ `usage_cost_usd` ni `attempts_cost_usd`.
   */
  costKnownCalls?: number;
}

/**
 * Contadores de fiabilidad. NO suman un total: cada uno mide una cosa distinta
 * y las categor├¡as se solapan.
 */
export interface AiCostsReliability {
  successful: number;
  retried: number;
  fallback: number;
  failed: number;
  /** Partici├│n mutuamente excluyente; `null` indica que el fallback no es identificable. */
  executionOutcomes: {
    available: boolean;
    successfulFirstAttempt: number;
    successfulAfterRetry: number;
    fallback: number | null;
    failed: number;
    inProgress: number;
  };
}

/** Informe completo de `/api/dashboard/ai-costs`. */
export interface AiCostsReport {
  generatedAt: string;
  /** `true` cuando el servidor trunc├│ el conjunto para poder agregarlo. */
  truncated: boolean;
  filters: DashboardFilters;
  granularity: CostGranularity;
  kpi: AiCostsKpi;
  costSeries: CostSeriesPoint[];
  byModel: ModelCostRow[];
  reliability: AiCostsReliability;
}

/** Envoltorio de la respuesta HTTP. */
export interface AiCostsResponse {
  costs: AiCostsReport;
}

// -----------------------------------------------------------------------------
// Opciones de los filtros (`/api/dashboard/options`)
//
// Dimensiones del caso que se pueden filtrar. Espejo de `CASE_DIMENSIONS` en
// `src/server/dashboard-filters.ts`; el servidor es la fuente de verdad.
// -----------------------------------------------------------------------------

export interface DashboardOptionsResponse {
  options: DashboardFilterOptions;
}

/**
 * `true` cuando el coste del modelo se puede mostrar como cifra.
 *
 * Es la ├ÜNICA fuente de verdad para esa decisi├│n, para que ninguna pantalla
 * imprima `$0.0000` por un dato que el proveedor nunca report├│. Criterios, en
 * orden: el campo expl├¡cito si viene; si no, la forma degenerada (total y
 * promedio a 0) que un modelo sin coste conocido produce siempre.
 */
export function hasKnownModelCost(row: ModelCostRow): boolean {
  if (typeof row.costKnownCalls === 'number' && Number.isFinite(row.costKnownCalls)) {
    return row.costKnownCalls > 0;
  }
  return !(row.totalCostUsd === 0 && row.avgCostUsd === 0);
}

// -----------------------------------------------------------------------------
// Informe de calidad (`/api/dashboard/quality`)
//
// ESPEJO de los tipos que agrega `src/server/dashboard.ts`. Aqu├¡ no se calcula
// nada: ni una media, ni una banda, ni un porcentaje.
//
// LA REGLA DE ESTA VISTA, escrita en los tipos para que ninguna pantalla pueda
// salt├írsela por descuido: una magnitud que NO SE HA MEDIDO llega como `null`,
// NUNCA como 0. Un `agreementRate: 0` afirmar├¡a "la IA coincide con el humano
// un 0 % de las veces", y eso es falso cuando lo que pasa es que nadie ha
// comparado todav├¡a. La UI pinta esas tarjetas con `DASH` ("ÔÇö"), no con `0 %`.
//
// OJO, PORQUE ES LA PARTE QUE M├üS SE CONFUNDE: el `0` S├ì es un dato v├ílido en
// los CONTADORES (`reviewedCases: 0` quiere decir "nadie ha revisado nada", y eso
// es verdad). Lo que no puede ser 0 es un PROMEDIO sin nada que promediar. Por
// eso los contadores son `number` y `agreementRate` / `avgComparisonConfidence`
// son `number | null`.
// -----------------------------------------------------------------------------

/**
 * Bucket de evidencia faltante.
 *
 * Vive aqu├¡, y no en `src/server/dashboard.ts`, por la misma raz├│n que
 * `DashboardFilters`: la lista de tipos del dashboard est├í en el cliente para que
 * el servidor la importe y la reexporte, en vez de haber dos definiciones que
 * puedan divergir. Es texto y no n├║mero porque `'2+'` no es un valor: es "dos o
 * m├ís", un conjunto que no cabe en un entero.
 */
export type MissingEvidenceBucket = '0' | '1' | '2+';

/**
 * Parte humana del informe de calidad: la revisi├│n que registr├│ una persona y si
 * el modelo coincidi├│ con ella al comparar.
 *
 * `agreementRate` y `avgComparisonConfidence` son `number | null`, y el `null`
 * significa "NO SE HA MEDIDO". Se calcula en el servidor, sobre las comparaciones
 * `COMPLETED` del periodo; el frontend s├│lo lo pinta.
 *
 * `agreementRate` es una RAZ├ôN entre 0 y 1, no un porcentaje: 0.667 son dos
 * tercios. Un `0` aqu├¡ s├¡ es un dato LEG├ìTIMO (hubo comparaciones completadas y
 * ninguna coincidi├│); lo que nunca puede ser 0 es "no hab├¡a nada que medir", y
 * ese estado es exactamente el `null`.
 */
export interface HumanReviewReport {
  /** `true` si existe al menos una revisi├│n enlazada a una auditor├¡a filtrada. */
  available: boolean;
  /**
   * Explicaci├│n del estado actual, en espa├▒ol, lista para pintar tal cual.
   *
   * La redacta el SERVIDOR y no la UI: la raz├│n de por qu├® falta un dato tiene
   * que vivir junto al c├ílculo que la produce, y los n├║meros que aparecen en el
   * texto salen de las cifras de este mismo objeto. Un mensaje compuesto en el
   * frontend podr├¡a decir "no hay datos" teniendo datos delante sin que nadie lo
   * notara.
   */
  message: string;
  /** Revisiones humanas enlazadas al audit_id exacto de una auditor├¡a filtrada. */
  reviewedCases: number;
  /** Revisiones con resultado humano y resultado de auditor├¡a disponibles. */
  comparableReviews: number;
  agreements: number;
  disagreements: number;
  /** Coincidencias exactas de la revisi├│n y el audit_id al que est├í anclada. */
  agreementRate: number | null;
}

/** Confianza declarada por el modelo, agrupada. */
export interface ConfidenceReport {
  /** Dict├ímenes COMPLETED con confianza declarada (denominador de `pct`). */
  auditedCases: number;
  /** `null` cuando ning├║n dictamen declar├│ confianza. */
  avgConfidence: number | null;
  /** Siempre las 3 bandas en orden fijo (ALTA, MEDIA, BAJA), aunque valgan 0. */
  bands: Array<{ band: ConfidenceBand; label: string; count: number; pct: number }>;
  /** SOLO los buckets con al menos un caso: un bucket sin filas no es un 0. */
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
  /** `true` cuando el servidor trunc├│ el conjunto para poder agregarlo. */
  truncated: boolean;
  filters: DashboardFilters;
  humanReview: HumanReviewReport;
  confidence: ConfidenceReport;
}

/** Envoltorio de la respuesta HTTP. */
export interface QualityResponse {
  quality: QualityReport;
}

// -----------------------------------------------------------------------------
// Utilidades
// -----------------------------------------------------------------------------

/** `Date` -> `YYYY-MM-DD` en hora local (no UTC: evita el salto de d├¡a). */
function toLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** ├Ültimos 30 d├¡as (hoy y hace 30 d├¡as), en hora local y sin dependencias. */
export function defaultDateRange(): DashboardFilters {
  const today = new Date();
  const from = new Date(today.getTime());
  from.setDate(from.getDate() - 30);
  return {
    from: toLocalIsoDate(from),
    to: toLocalIsoDate(today),
    result: null,
    status: null,
    country: null,
    campus: null,
    modality: null,
    project: null,
    responsible: null,
    guideline: null,
  };
}

// -----------------------------------------------------------------------------
// Cliente HTTP
// -----------------------------------------------------------------------------

/**
 * Query com├║n a los endpoints del dashboard. `result` y `status` se omiten
 * cuando valen `null`: mandarlos como la cadena `"null"` har├¡a que el servidor
 * no los reconociera como ausentes.
 */
function buildFiltersParams(filters: DashboardFilters): URLSearchParams {
  const params = new URLSearchParams();
  params.set('from', filters.from);
  params.set('to', filters.to);
  if (filters.result !== null) params.set('result', filters.result);
  if (filters.status !== null) params.set('status', filters.status);
  for (const dimension of ['country', 'campus', 'modality', 'project', 'responsible', 'guideline'] as const) {
    const value = filters[dimension];
    if (value != null) params.set(dimension, value);
  }
  return params;
}

export async function fetchDashboardFilterOptions(signal?: AbortSignal): Promise<DashboardFilterOptions> {
  const res = await fetch('/api/dashboard/options', { signal });
  if (!res.ok) throw await readError(res);
  const data: unknown = await res.json();
  if (!isRecord(data) || !isRecord(data.options)) {
    throw new Error('La respuesta del servidor no tiene el formato esperado.');
  }
  return data.options as unknown as DashboardFilterOptions;
}

/** Query del resumen, en el orden que espera `parseDashboardFilters`. */
export function buildSummaryQuery(filters: DashboardFilters): string {
  return buildFiltersParams(filters).toString();
}

/**
 * Pide el agregado del periodo al backend. Ruta relativa: la SPA siempre habla
 * con su propio origen, nunca con un host hardcodeado.
 *
 * Lanza `ApiError` (mismo contrato que el resto de `api.ts`) cuando la
 * respuesta no es `200`, para que la UI pueda normalizar el error sin conocer
 * los c├│digos HTTP.
 */
export async function fetchDashboardSummary(
  filters: DashboardFilters,
  signal?: AbortSignal,
): Promise<DashboardSummary> {
  const res = await fetch(`/api/dashboard/summary?${buildSummaryQuery(filters)}`, { signal });
  if (!res.ok) throw await readError(res);

  const data: unknown = await res.json();
  if (!isRecord(data) || !isRecord(data.summary)) {
    throw new Error('La respuesta del servidor no tiene el formato esperado.');
  }
  return data.summary as unknown as DashboardSummary;
}

/**
 * Pide el informe de costes de IA del periodo. Mismo contrato que
 * `fetchDashboardSummary`: ruta relativa, `ApiError` en respuesta no exitosa y
 * validaci├│n de que el envoltorio venga antes de castear a ciegas.
 *
 * `granularity` va siempre expl├¡cito (aunque sea `day`): omitirlo obliga al
 * cliente a adivinar el criterio por defecto del servidor.
 */
export async function fetchAiCosts(
  filters: DashboardFilters,
  granularity: CostGranularity,
  signal?: AbortSignal,
): Promise<AiCostsReport> {
  const params = buildFiltersParams(filters);
  params.set('granularity', granularity);

  const res = await fetch(`/api/dashboard/ai-costs?${params.toString()}`, { signal });
  if (!res.ok) throw await readError(res);

  const data: unknown = await res.json();
  if (!isRecord(data) || !isRecord(data.costs)) {
    throw new Error('La respuesta del servidor no tiene el formato esperado.');
  }
  return data.costs as unknown as AiCostsReport;
}

/**
 * Pide el informe de calidad de IA del periodo. Mismo contrato que
 * `fetchAiCosts`: ruta relativa, `ApiError` en respuesta no exitosa y
 * validaci├│n del envoltorio antes de castear a ciegas.
 *
 * El cliente NO decide si hay datos humanos ni completa los que faltan: si el
 * servidor dice que no hay revisi├│n humana, aqu├¡ llega igual y la pantalla lo
 * explica. Calcularlo "por si acaso" en el frontend ser├¡a el sitio peor para
 * inventar una cifra de coincidencia.
 */
export async function fetchAiQuality(
  filters: DashboardFilters,
  signal?: AbortSignal,
): Promise<QualityReport> {
  const res = await fetch(`/api/dashboard/quality?${buildFiltersParams(filters).toString()}`, { signal });
  if (!res.ok) throw await readError(res);

  const data: unknown = await res.json();
  if (!isRecord(data) || !isRecord(data.quality)) {
    throw new Error('La respuesta del servidor no tiene el formato esperado.');
  }
  return data.quality as unknown as QualityReport;
}

/**
 * Pide los valores disponibles para los filtros de dimensión.
 *
 * Solo manda el RANGO, no el resto de filtros: el menú debe ofrecer todo lo que
 * hay en el periodo para poder cambiar de dimensión desde cero. Si además
 * filtrara por dimensión, elegir un valor dejaría el resto del menú vacío y no se
 * podría cambiar a otro sin limpiar antes.
 */
export async function fetchDashboardOptions(
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<DashboardFilterOptions> {
  const params = new URLSearchParams({ from, to });
  const res = await fetch(`/api/dashboard/options?${params.toString()}`, { signal });
  if (!res.ok) throw await readError(res);

  const data: unknown = await res.json();
  if (!isRecord(data) || !isRecord(data.options)) {
    throw new Error('La respuesta del servidor no tiene el formato esperado.');
  }
  for (const dimension of DASHBOARD_DIMENSIONS) {
    if (!Array.isArray(data.options[dimension])) {
      throw new Error('La respuesta del servidor no tiene el formato esperado.');
    }
  }
  return data.options as unknown as DashboardFilterOptions;
}
