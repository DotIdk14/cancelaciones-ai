// =============================================================================
// Contrato de datos de la vista "Resumen" (dashboard).
//
// Tipos, constantes y el cliente HTTP que pide el agregado: aquí no hay
// agregación ni criterio. El backend resuelve el periodo y devuelve el
// agregado ya calculado; el frontend únicamente lo pinta. Cualquier decisión
// de negocio sigue viviendo en el Audit Skill y en el servidor, nunca en este
// archivo.
// =============================================================================

import type { AuditResultType, CaseStatus } from '../skills/audit/types';
import { isRecord, readError } from './api';
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
};

/** Endpoints de dashboard. Cada uno devuelve un `DashboardSummary`. */
export type DashboardEndpoint = 'summary' | 'ai-costs' | 'quality';

// -----------------------------------------------------------------------------
// KPIs
// -----------------------------------------------------------------------------

/** Claves de KPI. `auditedCases` es el denominador de los porcentajes. */
export type KpiKey = 'auditedCases' | 'granted' | 'needsRuling' | 'insufficient' | 'errors';

export interface DashboardKpi {
  auditedCases: number;
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
 * Campo de porcentaje asociado a cada KPI. Evita repetir la convención
 * `<clave>Pct` desparramada por los componentes.
 */
export const KPI_PCT: Record<Exclude<KpiKey, 'auditedCases'>, keyof DashboardKpi> = {
  granted: 'grantedPct',
  needsRuling: 'needsRulingPct',
  insufficient: 'insufficientPct',
  errors: 'errorsPct',
};

// -----------------------------------------------------------------------------
// Series
// -----------------------------------------------------------------------------

/** Punto de la evolución temporal por bucket (día o semana según el periodo). */
export interface TimelinePoint {
  bucket: string;
  granted: number;
  needsRuling: number;
  insufficient: number;
}

/** Reparto por grupo de resolución. */
export interface ResolutionSplitPoint {
  group: ResolutionGroup;
  count: number;
}

/** Reparto por resultado de auditoría (sin agrupar). */
export interface ResultBreakdownPoint {
  result: AuditResultType;
  count: number;
}

// -----------------------------------------------------------------------------
// Filas
// -----------------------------------------------------------------------------

/** Fila de la tabla de casos recientes. */
export interface RecentCaseRow {
  caseId: string;
  shortId: string;
  studentIdentifier: string | null;
  result: AuditResultType | null;
  confidence: number | null;
  missingEvidenceCount: number;
  caseStatus: CaseStatus;
  date: string;
}

// -----------------------------------------------------------------------------
// Envoltorio
// -----------------------------------------------------------------------------

export interface DashboardSummary {
  generatedAt: string;
  /** `true` cuando el servidor truncó el conjunto para poder agregarlo. */
  truncated: boolean;
  filters: DashboardFilters;
  kpi: DashboardKpi;
  timeline: TimelinePoint[];
  split: ResolutionSplitPoint[];
  byResult: ResultBreakdownPoint[];
  recentCases: RecentCaseRow[];
}

// -----------------------------------------------------------------------------
// Informe de costes de IA (`/api/dashboard/ai-costs`)
//
// Estos tipos son el ESPEJO de los que agrega `src/server/dashboard.ts`. Aquí
// no se calcula nada: ni un precio, ni un percentil, ni una media. Solo se
// declara la forma que llega para poder pintarla sin adivinar.
//
// Dos advertencias que la UI debe respetar y que por eso quedan escritas en los
// tipos, no en un comentario suelto del componente:
//   1. Un 0 en `avgLatencyMs`/`p50`/`p95` no significa "instantáneo": el servidor
//      devuelve `null` cuando no hay mediciones, y `null` se pinta como `DASH`.
//   2. En `reliability` los cuatro contadores NO son una partición: se solapan
//      (una auditoría completada tras un reintento cuenta en las dos). Sumarlos
//      daría un total que no cuadra con `auditsCounted`.
// -----------------------------------------------------------------------------

/**
 * Granularidad de la serie de coste. La clave de `bucket` cambia de forma:
 * `day` -> `YYYY-MM-DD`, `week` -> `YYYY-Www` (año ISO), `month` -> `YYYY-MM`.
 * El frontend NO la parsea: la muestra tal cual.
 */
export type CostGranularity = 'day' | 'week' | 'month';

/**
 * Cabecera de coste, latencia y volumen del periodo.
 *
 * Las banderas `*Available` son la única forma fiable de distinguir "no hay
 * datos" de "hay datos y valen cero": sin ellas, un `0` de facto es unknowable
 * y la UI acabaría mintiendo con un `$0.0000` o un `0 ms` de Aspecto real.
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
  /** Auditorías que entraron en el agregado (noAuditorías, no llamadas al modelo). */
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
   * Llamadas de este modelo con coste CONOCIDO. Opcional a propósito: si el
   * servidor todavía no lo envía, `hasKnownModelCost` cae a un criterio seguro
   * (0 en total Y 0 en promedio) en lugar de asumir que todo se conoce.
   *
   * Cuando vale `0` el coste del modelo es DESCONOCIDO, no cero: ninguna de sus
   * llamadas informó `usage_cost_usd` ni `attempts_cost_usd`.
   */
  costKnownCalls?: number;
}

/**
 * Contadores de fiabilidad. NO suman un total: cada uno mide una cosa distinta
 * y las categorías se solapan.
 */
export interface AiCostsReliability {
  successful: number;
  retried: number;
  fallback: number;
  failed: number;
}

/** Informe completo de `/api/dashboard/ai-costs`. */
export interface AiCostsReport {
  generatedAt: string;
  /** `true` cuando el servidor truncó el conjunto para poder agregarlo. */
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

/**
 * `true` cuando el coste del modelo se puede mostrar como cifra.
 *
 * Es la ÚNICA fuente de verdad para esa decisión, para que ninguna pantalla
 * imprima `$0.0000` por un dato que el proveedor nunca reportó. Criterios, en
 * orden: el campo explícito si viene; si no, la forma degenerada (total y
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
// ESPEJO de los tipos que agrega `src/server/dashboard.ts`. Aquí no se calcula
// nada: ni una media, ni una banda, ni un porcentaje.
//
// LA REGLA DE ESTA VISTA, escrita en los tipos para que ninguna pantalla pueda
// saltársela por descuido: la parte HUMANA de la calidad no existe, y por eso
// llega como `null`, NUNCA como 0. Un `agreementPct: 0` afirmaría "la IA
// coincide con el humano un 0 % de las veces", y eso es falso: no es que falle
// siempre, es que el sistema no registra revisión humana con la que compararla.
// La UI pinta esas tres tarjetas con `DASH` ("—"), no con `0 %`.
// -----------------------------------------------------------------------------

/**
 * Bucket de evidencia faltante.
 *
 * Vive aquí, y no en `src/server/dashboard.ts`, por la misma razón que
 * `DashboardFilters`: la lista de tipos del dashboard está en el cliente para que
 * el servidor la importe y la reexporte, en vez de haber dos definiciones que
 * puedan divergir. Es texto y no número porque `'2+'` no es un valor: es "dos o
 * más", un conjunto que no cabe en un entero.
 */
export type MissingEvidenceBucket = '0' | '1' | '2+';

/**
 * Parte humana del informe de calidad: siempre ausente, y siempre por el mismo
 * motivo. El servidor no la calcula porque no puede: no hay revisión humana en
 * ninguna tabla.
 *
 * `available` está declarado como el literal `false` (y no `boolean`) a propósito:
 * mientras siga siendo `false`, TypeScript exige que los tres campos de abajo
 * sean `null`, así que nadie puede devolver un 0 "para ir dejando hueco" sin que
 * el compilador lo diga.
 */
export interface HumanReviewReport {
  available: false;
  reason: 'NO_HUMAN_REVIEW_DATA';
  /** Explicación en español, lista para pintar tal cual bajo las tarjetas vacías. */
  message: string;
  reviewedCases: number;
  correctedCases: number;
  agreementPct: null;
  confusionMatrix: null;
  agreementByCaseType: null;
}

/** Confianza declarada por el modelo, agrupada. */
export interface ConfidenceReport {
  /** Dictámenes COMPLETED con confianza declarada (denominador de `pct`). */
  auditedCases: number;
  /** `null` cuando ningún dictamen declaró confianza. */
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
  /** `true` cuando el servidor truncó el conjunto para poder agregarlo. */
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

/** `Date` -> `YYYY-MM-DD` en hora local (no UTC: evita el salto de día). */
function toLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Últimos 30 días (hoy y hace 30 días), en hora local y sin dependencias. */
export function defaultDateRange(): DashboardFilters {
  const today = new Date();
  const from = new Date(today.getTime());
  from.setDate(from.getDate() - 30);
  return {
    from: toLocalIsoDate(from),
    to: toLocalIsoDate(today),
    result: null,
    status: null,
  };
}

// -----------------------------------------------------------------------------
// Cliente HTTP
// -----------------------------------------------------------------------------

/**
 * Query común a los endpoints del dashboard. `result` y `status` se omiten
 * cuando valen `null`: mandarlos como la cadena `"null"` haría que el servidor
 * no los reconociera como ausentes.
 */
function buildFiltersParams(filters: DashboardFilters): URLSearchParams {
  const params = new URLSearchParams();
  params.set('from', filters.from);
  params.set('to', filters.to);
  if (filters.result !== null) params.set('result', filters.result);
  if (filters.status !== null) params.set('status', filters.status);
  return params;
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
 * los códigos HTTP.
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
 * validación de que el envoltorio venga antes de castear a ciegas.
 *
 * `granularity` va siempre explícito (aunque sea `day`): omitirlo obliga al
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
 * validación del envoltorio antes de castear a ciegas.
 *
 * El cliente NO decide si hay datos humanos ni completa los que faltan: si el
 * servidor dice que no hay revisión humana, aquí llega igual y la pantalla lo
 * explica. Calcularlo "por si acaso" en el frontend sería el sitio peor para
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
