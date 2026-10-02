// =============================================================================
// Tokens visuales compartidos por las gráficas del dashboard.
//
// Todos los colores son variables CSS ya definidas en `index.css`: las series
// respetan el tema y no se cuela ningún color suelto en los componentes.
// =============================================================================

import type { CSSProperties } from 'react';
import type { ResolutionGroup } from '../../../lib/labels';
import { RESOLUTION_GROUP_CHART_COLOR } from '../../../lib/labels';
import type { ExecutionOutcome } from '../../../lib/dashboard';

/** Color de serie por grupo de resolución. */
export const CHART_COLORS: Record<ResolutionGroup, string> = RESOLUTION_GROUP_CHART_COLOR;

/**
 * Color por resultado TÉCNICO de la ejecución.
 *
 * Deliberadamente DISTINTO de `CHART_COLORS`, que codifica el grupo de
 * resolución (concedida / requiere dictaminación / evidencia insuficiente). Aquí
 * lo que se pinta es si la llamada al modelo terminó bien y cómo, así que
 * mezclar los dos mapas haría que "concedidas" y "éxito al primer intento"
 * compartieran color siendo cosas distintas.
 *
 * `FAILED` usa `--danger` y no un tono neutro porque es la única categoría que
 * representa un fallo real, y su serie tiene que destacar sin depender de que la
 * leyenda esté a la vista.
 */
export const EXECUTION_BAR_FILL: Record<ExecutionOutcome, string> = {
  SUCCESS_FIRST_ATTEMPT: 'var(--success)',
  SUCCESS_AFTER_RETRY: 'var(--accent)',
  SUCCESS_WITH_FALLBACK: 'var(--warning)',
  FAILED: 'var(--danger)',
};

/** Estilo de las etiquetas de los ejes. */
export const AXIS_TICK_STYLE = {
  fill: 'var(--text-muted)',
  fontSize: 12,
} as const;

/** Trazo de la rejilla. */
export const GRID_STROKE = 'var(--border)';

/**
 * Estilo del tooltip. Se aplica con la prop `contentStyle` del `<Tooltip>` de
 * Recharts, que es la vía tipada para estilizar el tooltip por defecto.
 */
export const TOOLTIP_STYLE: CSSProperties = {
  backgroundColor: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  color: 'var(--text-primary)',
  fontSize: 13,
};
