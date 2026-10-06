// =============================================================================
// Vocabulario y rango de fechas del dashboard que cargan cliente Y servidor.
//
// Vive aquí, y no en `dashboard.ts`, por una razón concreta: `src/server/` usa
// `defaultDateRange()` y `EXECUTION_OUTCOMES` en runtime, y `src/lib/dashboard.ts`
// arrastra `local-dashboard-preview`, que es un modulo de NAVEGADOR (modo preview
// local). Si el servidor dependiera de `dashboard.ts`, Vercel metería ese modulo
// de navegador en la Function: la build pasa y la Function revienta al invocarse
// con `ERR_MODULE_NOT_FOUND: Cannot find module '.../local-dashboard-preview'`.
//
// Este modulo no importa nada. `dashboard.ts` lo reexporta, de modo que los
// imports del cliente no cambian.
// =============================================================================

/**
 * Dimensiones del caso que el dashboard puede filtrar.
 *
 * Única fuente de verdad. Antes de este módulo la lista estaba replicada en cinco
 * sitios (`lib/dashboard.ts`, `server/dashboard-filters.ts`, `server/dashboard.ts` y
 * `DashboardFilters.tsx`), y agregar una dimensión obligaba a tocarlos todos con el
 * riesgo de que uno se quedara atrás. Aquí viven el vocabulario, su etiqueta en
 * pantalla y el nombre de la columna equivalente en `cases`; los demás módulos
 * importan o reexportan.
 *
 * No toda dimensión de esta lista está soportada por el filtro: ver
 * `SUPPORTED_DIMENSIONS` en `src/server/dashboard-filters.ts`, que es una lista
 * deliberadamente más corta (solo las que la vista proyecta y tienen escritor).
 */
export const DASHBOARD_DIMENSIONS = [
  'country',
  'channel',
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
  channel: 'Canal',
  campus: 'Campus',
  modality: 'Modalidad',
  project: 'Proyecto',
  responsible: 'Responsable',
  guideline: 'Lineamiento',
};

/** Columna de `cases` que corresponde a cada dimensión. */
export const CASE_DIMENSION_COLUMN: Record<DashboardDimension, string> = {
  country: 'country',
  channel: 'channel',
  campus: 'campus',
  modality: 'modality',
  project: 'project',
  responsible: 'responsible',
  guideline: 'guideline',
};

/** Filtros de la barra superior. Fechas en `YYYY-MM-DD`, `null` = sin filtro. */
export type DashboardFilters = {
  from: string;
  to: string;
  result: string | null;
  status: string | null;
} & Partial<Record<DashboardDimension, string | null>>;

/**
 * Resultado de ejecutar una auditoría, según reintentos y fallback.
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

/** Fecha local en `YYYY-MM-DD`, sin dependencias de Intl ni de zona horaria. */
function toLocalIsoDate(date: Date): string {
  const year = String(date.getFullYear());
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
    country: null,
    campus: null,
    modality: null,
    project: null,
    responsible: null,
    guideline: null,
  };
}