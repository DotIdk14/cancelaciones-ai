// =============================================================================
// Opciones de los filtros del dashboard: qué valores existen REALMENTE.
// =============================================================================
// La fuente es un `DISTINCT` sobre la vista, en SQL. Nada de listas fijas en el
// código: una lista en el frontend ofrecería valores que quizá no corresponden a
// ningún caso, que es exactamente lo que pidió evitar el equipo.
//
// Y hay una consecuencia que conviene tener presente al usarlo: una dimensión sin
// datos NO aparece en la respuesta, y el frontend la oculta. Hoy las seis están
// vacías porque todavía no hay catálogo, así que el dashboard solo mostrará Mes,
// País… cuando existan. Es el comportamiento correcto, no un fallo pendiente.
//
// Los valores llegan como TEXTO CRUDO de la base. Este módulo NO traduce, NO
// deduplica por mayúsculas y NO inventa etiquetas: si la base tiene "México" y
// "mexico", son dos valores distintos y se ofrecen como tales. Decidir si son el
// mismo es una regla de datos (de un catálogo que aún no existe), no una
// normalización que se pueda hacer a ciegas en el servidor. Lo que sí se hace es
// lo que no cambia el significado: recortar los extremos y descartar la
// cadena vacía, que es basura de captura, no un valor.

import {
  CASE_DIMENSIONS,
  CASE_DIMENSION_COLUMN,
  CASE_DIMENSION_LABELS,
  endOfDayUtc,
  startOfDayUtc,
  type CaseDimension,
} from './dashboard-filters.js';
import { mapProviderError } from './http.js';
import type { InsForgeClient } from './insforge.js';

/** Tope de valores por dimensión. Un catálogo real cabe de sobra; si no, es señal. */
const MAX_VALUES_PER_DIMENSION = 200;

/** Una dimensión con sus valores disponibles. */
export interface DimensionOption {
  dimension: CaseDimension;
  label: string;
  /** Valores reales, ordenados. Vacío = la dimensión no tiene datos. */
  values: string[];
}

export interface DashboardFilterOptions {
  generatedAt: string;
  options: DimensionOption[];
}

/**
 * Lee los valores disponibles por dimensión en el rango `from`..`to`.
 *
 * Se consulta UNA VEZ por dimensión, no una por filtro: seis consultas fijas, sin
 * N+1 y sin depender de cuántas filas tenga el periodo. Cada una es un `DISTINCT`
 * con orden, así que el coste no crece con el volumen de auditorías.
 *
 * `is` filtra por el rango para que el menú no ofrezca un valor que no lleva a
 * ninguna fila dentro del periodo que se está viendo: elegir "México" y no ver
 * nada sería peor que no ofrecerlo.
 */
export async function getDashboardFilterOptions(
  client: InsForgeClient,
  from: string,
  to: string,
): Promise<DashboardFilterOptions> {
  const fromIso = startOfDayUtc(from);
  const toIso = endOfDayUtc(to);

  const options: DimensionOption[] = [];
  for (const dimension of CASE_DIMENSIONS) {
    options.push({
      dimension,
      label: CASE_DIMENSION_LABELS[dimension],
      values: await distinctDimensionValues(
        client,
        CASE_DIMENSION_COLUMN[dimension],
        fromIso,
        toIso,
      ),
    });
  }

  return { generatedAt: new Date().toISOString(), options };
}

/**
 * Valores distintos de una columna dentro del rango.
 *
 * El `is` de "no vacío ni solo espacios" se hace en el servidor para que un
 * `NULL` o una cadena en blanco no lleguen nunca a la UI: un `<select>` con una
 * opción en blanco es indistinguible de "sin filtro" y confunde.
 */
async function distinctDimensionValues(
  client: InsForgeClient,
  column: string,
  fromIso: string,
  toIso: string,
): Promise<string[]> {
  const { data, error } = await client.database
    .from('audit_dashboard_metrics')
    .select(column)
    .gte('created_at', fromIso)
    .lte('created_at', toIso)
    .not(column, 'is', null)
    .limit(MAX_VALUES_PER_DIMENSION * 4);

  if (error) throw mapProviderError(error);

  const seen = new Set<string>();
  // Cast por `unknown` porque `select(<una columna>)` hace que el SDK infiera un
  // tipo de error en lugar del tipo de la fila. Ver la nota equivalente en
  // `getAiCosts`.
  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    const raw = row[column];
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (value === '') continue;
    seen.add(value);
  }

  return [...seen].sort((a, b) => a.localeCompare(b, 'es')).slice(0, MAX_VALUES_PER_DIMENSION);
}
