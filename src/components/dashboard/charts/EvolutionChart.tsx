// =============================================================================
// Evolución de casos por periodo. Barras apiladas por grupo de resolución.
// Devuelve `null` cuando no hay datos: es el `ChartFrame` quien muestra el
// estado vacío, de modo que esta gráfica nunca decide qué se ve.
// =============================================================================

import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TimelinePoint } from '../../../lib/dashboard';
import { AXIS_TICK_STYLE, CHART_COLORS, GRID_STROKE, TOOLTIP_STYLE } from './chartTheme';

export function EvolutionChart({ data }: { data: TimelinePoint[] }): ReactNode {
  if (data.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={true} horizontal={false} />
        <XAxis
          dataKey="bucket"
          tick={AXIS_TICK_STYLE}
          tickLine={false}
          axisLine={{ stroke: GRID_STROKE }}
          minTickGap={16}
        />
        <YAxis
          allowDecimals={false}
          width={48}
          tick={AXIS_TICK_STYLE}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ fill: 'rgba(255, 255, 255, 0.04)' }}
        />
        <Bar
          dataKey="granted"
          name="Concedidas"
          stackId="a"
          fill={CHART_COLORS.CONCEDIDAS}
          radius={[0, 0, 0, 0]}
        />
        <Bar
          dataKey="needsRuling"
          name="Requiere dictaminación"
          stackId="a"
          fill={CHART_COLORS.REQUIERE_DICTAMINACION}
        />
        <Bar
          dataKey="insufficient"
          name="Evidencia insuficiente"
          stackId="a"
          fill={CHART_COLORS.EVIDENCIA_INSUFICIENTE}
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
