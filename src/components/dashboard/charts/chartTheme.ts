// =============================================================================
// Tokens visuales compartidos por las gráficas del dashboard.
//
// Todos los colores son variables CSS ya definidas en `index.css`: las series
// respetan el tema y no se cuela ningún color suelto en los componentes.
// =============================================================================

import type { CSSProperties } from 'react';
import type { ResolutionGroup } from '../../../lib/labels';
import { RESOLUTION_GROUP_CHART_COLOR } from '../../../lib/labels';

/** Color de serie por grupo de resolución. */
export const CHART_COLORS: Record<ResolutionGroup, string> = RESOLUTION_GROUP_CHART_COLOR;

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
