// =============================================================================
// Detalle de resultados: una fila por cada resultado que puede emitir el Audit
// Skill, con el total al final de la barra. Se muestran siempre todas las filas
// (incluidas las que están en cero) para que la ausencia de un resultado sea
// visible y no se confunda con "no existe ese dictamen".
// =============================================================================

import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ResultBreakdownPoint } from '../../../lib/dashboard';
import { AUDIT_RESULTS } from '../../../skills/audit/types';
import { RESULT_LABELS, RESULT_TO_GROUP, RESOLUTION_GROUP_CHART_COLOR } from '../../../lib/labels';
import { AXIS_TICK_STYLE, GRID_STROKE, TOOLTIP_STYLE } from './chartTheme';

/** Etiqueta corta para el eje Y: el texto completo no cabe en el ancho útil. */
const SHORT_LABELS: Record<(typeof AUDIT_RESULTS)[number], string> = {
  CANCELACION_VENTA: 'Cancelación de venta',
  CANCELACION_VENTA_PETICION_CLIENTE: 'Cancel. por petición cliente',
  BAJA: 'Baja',
  CANCELACION_VENTA_OPERATIVA: 'Cancel. venta oper.',
  CANCELACION_MATRICULA: 'Cancelación de matrícula',
  DICTAMINACION: 'Dictaminación',
  EVIDENCIA_INSUFICIENTE: 'Evidencia insuficiente',
};

export function ResultsBreakdownChart({ data }: { data: ResultBreakdownPoint[] }): ReactNode {
  if (data.length === 0) return null;

  // Normaliza a las 6 filas del vocabulario para no depender del orden recibido.
  const rows = AUDIT_RESULTS.map((result) => ({
    result,
    label: RESULT_LABELS[result],
    axisLabel: SHORT_LABELS[result],
    count: data.find((point) => point.result === result)?.count ?? 0,
  }));

  return (
    <>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 4, right: 48, bottom: 4, left: 8 }}
          title="Distribución de los dictamenes por tipo de resultado"
          desc={breakdownSummary(rows)}
        >
        <CartesianGrid
          stroke={GRID_STROKE}
          strokeDasharray="3 3"
          horizontal={false}
          vertical={true}
        />
        <XAxis
          type="number"
          allowDecimals={false}
          tick={AXIS_TICK_STYLE}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          type="category"
          dataKey="axisLabel"
          width={168}
          tick={AXIS_TICK_STYLE}
          tickLine={false}
          axisLine={{ stroke: GRID_STROKE }}
        />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(255, 255, 255, 0.04)' }} />
        <Bar dataKey="count" name="Casos" maxBarSize={28} isAnimationActive={false}>
          {rows.map((row) => (
            <Cell
              key={row.result}
              fill={RESOLUTION_GROUP_CHART_COLOR[RESULT_TO_GROUP[row.result]]}
            />
          ))}
          <LabelList
            dataKey="count"
            position="right"
            offset={8}
            style={{ fill: 'var(--text-secondary)', fontSize: 12 }}
          />
        </Bar>
        </BarChart>
      </ResponsiveContainer>
      {/* Alternativa textual de 1.1.1 (A). El `LabelList` de la derecha NO
          cumple: escribe el número en otra coordenada que la etiqueta del eje,
          así que el emparejamiento resultado↔casos solo existe en la vista. */}
      <p className="sr-only">{breakdownSummary(rows)}</p>
    </>
  );
}

/** Reparto por tipo de dictamen leído como frase. */
function breakdownSummary(rows: { label: string; count: number }[]): string {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const conCaso = rows.filter((row) => row.count > 0);
  const detalle = conCaso.map((row) => `${row.label}: ${row.count}`).join('; ');
  const sinCaso = rows.filter((row) => row.count === 0).map((row) => row.label);
  return (
    `Distribución de ${total} caso(s) por tipo de dictamen. ${detalle}.` +
    (sinCaso.length > 0 ? ` Sin casos: ${sinCaso.join(', ')}.` : '')
  );
}
