// =============================================================================
// Costo de las auditorías de IA a lo largo del periodo. Barras simples (no
// apiladas): solo hay una magnitud, `costUsd`.
//
// SOBRE LA CLAVE DE `bucket`: cambia de forma según la granularidad pedida
// (`2026-09-28` para día, `2026-W40` para semana ISO, `2026-09` para mes) y la
// gráfica la muestra TAL CUAL, sin parsearla ni reformatearla. ElBackend es el
// único que sabe qué periodo representa cada clave; convertirla aquí obligaría
// al frontend a reimplementar el agrupamiento y a poder discrepar de él.
//
// Devuelve `null` sin datos: es el `ChartFrame` quien muestra el estado vacío,
// de modo que esta gráfica nunca decide qué se ve.
// =============================================================================

import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CostSeriesPoint } from '../../../lib/dashboard';
import { formatCost } from '../../../lib/format';
import { AXIS_TICK_STYLE, GRID_STROKE, TOOLTIP_STYLE } from './chartTheme';

/**
 * Pinta el coste de una barra con el formato de moneda del producto. Recharts
 * entrega el valor ya como número en barras, pero el tipo de la prop es amplio:
 * se estrecha aquí para no propagar `NaN` si llegara como texto.
 */
function formatCostValue(value: number | string): string {
  return formatCost(typeof value === 'number' ? value : Number.parseFloat(value));
}

export interface CostOverTimeChartProps {
  data: CostSeriesPoint[];
  /** Texto alternativo del gráfico: periodo y magnitud, en una sola frase. */
  ariaLabel: string;
}

export function CostOverTimeChart({ data, ariaLabel }: CostOverTimeChartProps): ReactNode {
  if (data.length === 0) return null;

  return (
    <div role="img" aria-label={ariaLabel} className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} horizontal={true} />
          <XAxis
            dataKey="bucket"
            tick={AXIS_TICK_STYLE}
            tickLine={false}
            axisLine={{ stroke: GRID_STROKE }}
            minTickGap={16}
          />
          <YAxis
            width={64}
            tick={AXIS_TICK_STYLE}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) => formatCostValue(value)}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            cursor={{ fill: 'rgba(255, 255, 255, 0.04)' }}
            formatter={(value) => formatCostValue(value as number | string)}
          />
          <Bar dataKey="costUsd" name="Costo" fill="var(--accent)" maxBarSize={40} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
