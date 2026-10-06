// =============================================================================
// Distribución de origen: una fila por país o por canal, con el total al final
// de la barra.
//
// Un solo componente sirve a las dos dimensiones: país y canal tienen idéntica
// forma (valor, etiqueta, conteo) y separarlos duplicaría el `sr-only`, el `Cell`
// y el `maxBarSize` sin ganar nada. La dimensión solo cambia el color y los
// textos accesibles.
//
// A diferencia de `ResultsBreakdownChart`, aquí NO se muestran las categorías en
// cero: el catálogo de países y canales es grande y la mayoría no aparece nunca,
// así que una lista con 11 países vacíos taparía el dato real.
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
import type { OriginBreakdownPoint } from '../../../lib/dashboard';
import { ORIGIN_CHART_COLOR } from '../../../lib/labels';
import { AXIS_TICK_STYLE, GRID_STROKE, TOOLTIP_STYLE } from './chartTheme';

const DIMENSION_TITLE: Record<'country' | 'channel', string> = {
  country: 'Distribución de casos por país de origen',
  channel: 'Distribución de casos por canal de origen',
};

const DIMENSION_NOUN: Record<'country' | 'channel', string> = {
  country: 'país',
  channel: 'canal',
};

export function OriginBreakdownChart({
  data,
  dimension,
}: {
  data: OriginBreakdownPoint[];
  dimension: 'country' | 'channel';
}): ReactNode {
  const rows = data.filter((point) => point.count > 0);
  if (rows.length === 0) return null;

  const summary = originSummary(rows, dimension);

  return (
    <>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 4, right: 48, bottom: 4, left: 8 }}
          title={DIMENSION_TITLE[dimension]}
          desc={summary}
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
            dataKey="label"
            width={168}
            tick={AXIS_TICK_STYLE}
            tickLine={false}
            axisLine={{ stroke: GRID_STROKE }}
          />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(255, 255, 255, 0.04)' }} />
          <Bar dataKey="count" name="Casos" maxBarSize={28} isAnimationActive={false}>
            {rows.map((row) => (
              <Cell key={row.value} fill={ORIGIN_CHART_COLOR[dimension]} />
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
          así que el emparejamiento valor↔casos solo existe en la vista. */}
      <p className="sr-only">{summary}</p>
    </>
  );
}

/** Reparto por país o canal leído como frase. */
function originSummary(rows: OriginBreakdownPoint[], dimension: 'country' | 'channel'): string {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const detalle = rows.map((row) => `${row.label}: ${row.count}`).join('; ');
  return `Distribución de ${total} caso(s) por ${DIMENSION_NOUN[dimension]} de origen. ${detalle}.`;
}
