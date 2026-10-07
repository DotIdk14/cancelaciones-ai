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
    <>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: -18 }}
          title="Evolución de casos por grupo de resolución"
          desc={timelineSummary(data)}
        >
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
          isAnimationActive={false}
        />
        <Bar
          dataKey="needsRuling"
          name="Requiere dictaminación"
          stackId="a"
          fill={CHART_COLORS.REQUIERE_DICTAMINACION}
          isAnimationActive={false}
        />
        <Bar
          dataKey="rejected"
          name="Rechazados"
          stackId="a"
          fill={CHART_COLORS.RECHAZADOS}
          isAnimationActive={false}
        />
        <Bar
          dataKey="insufficient"
          name="Evidencia insuficiente"
          stackId="a"
          fill={CHART_COLORS.EVIDENCIA_INSUFICIENTE}
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        />
        </BarChart>
      </ResponsiveContainer>
      {/* Alternativa textual de 1.1.1 (A). Sin esto la gráfica era inaccesible:
          el `LabelList` no sirve porque escribe los textos en coordenadas
          distintas a las del eje, y el emparejamiento categoría↔valor solo
          existe visualmente. */}
      <p className="sr-only">{timelineSummary(data)}</p>
    </>
  );
}

/** Serie temporal leída como frase: totales y desglose por periodo. */
function timelineSummary(data: TimelinePoint[]): string {
  const total = data.reduce(
    (sum, point) => sum + point.granted + point.needsRuling + point.rejected + point.insufficient,
    0,
  );
  const conceded = data.reduce((sum, point) => sum + point.granted, 0);
  const ruling = data.reduce((sum, point) => sum + point.needsRuling, 0);
  const rejected = data.reduce((sum, point) => sum + point.rejected, 0);
  const insufficient = data.reduce((sum, point) => sum + point.insufficient, 0);
  const detalle = data
    .map(
      (point) =>
        `${point.bucket}: ${point.granted} concedidas, ${point.needsRuling} por dictaminar, ${point.rejected} rechazados, ${point.insufficient} con evidencia insuficiente`,
    )
    .join('; ');
  return (
    `Evolución de ${total} caso(s) en ${data.length} periodo(s): ` +
    `${conceded} concedidas, ${ruling} por dictaminar, ${rejected} rechazados, ${insufficient} con evidencia insuficiente. ` +
    `Detalle — ${detalle}.`
  );
}
