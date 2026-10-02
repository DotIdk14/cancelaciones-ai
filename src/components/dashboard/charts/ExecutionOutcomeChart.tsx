// =============================================================================
// Distribución de resultados técnicos: éxito al primer intento, tras reintento,
// con fallback y fallidas.
// =============================================================================
// Gráfica de barras horizontal: cuatro categorías con nombres largos se leen
// mucho mejor en barras que en un donut, y las comparables entre sí (son un
// reparto del total). Además el color va en la BARRA y la etiqueta fuera, así que
// el dato no depende del color: una barra de largo cero es cero, no "no se ve".

import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  EXECUTION_OUTCOME_LABELS,
  type ExecutionOutcome,
  type ExecutionOutcomePoint,
} from '../../../lib/dashboard';
import { formatPercent } from '../../../lib/format';
import { AXIS_TICK_STYLE, EXECUTION_BAR_FILL, GRID_STROKE, TOOLTIP_STYLE } from './chartTheme';

const SHORT_LABELS: Record<string, string> = {
  SUCCESS_FIRST_ATTEMPT: 'Primer intento',
  SUCCESS_AFTER_RETRY: 'Tras reintento',
  SUCCESS_WITH_FALLBACK: 'Con fallback',
  FAILED: 'Fallidas',
};

interface Row {
  outcome: ExecutionOutcome;
  short: string;
  label: string;
  count: number;
}

export function ExecutionOutcomeChart({ data }: { data: ExecutionOutcomePoint[] }): ReactNode {
  if (data.length === 0) return null;

  // Se normaliza a las 4 filas del vocabulario, para que la leyenda no cambie
  // de largo según el día y el eje no se quede sin su categoría.
  const rows: Row[] = data.map((point) => ({
    outcome: point.outcome,
    short: SHORT_LABELS[point.outcome] ?? point.outcome,
    label: EXECUTION_OUTCOME_LABELS[point.outcome],
    count: point.count,
  }));

  const total = rows.reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        {/*
          `title`/`desc` van al `<svg>` y no en un wrapper `role="img"`: ese rol
          es de hijos presentacionales y sacaría del árbol de accesibilidad el
          `role="application"` y el `tabIndex` que Recharts 3 usa para leer los
          datos con las flechas del teclado.
        */}
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 4, right: 56, bottom: 4, left: 8 }}
          title="Distribución de resultados técnicos de la auditoría"
          desc={summary(rows, total)}
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
            dataKey="short"
            width={124}
            tick={AXIS_TICK_STYLE}
            tickLine={false}
            axisLine={{ stroke: GRID_STROKE }}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            cursor={{ fill: 'rgba(255, 255, 255, 0.04)' }}
            formatter={(value, _name, item) => {
              const row = (item as { payload?: Row } | undefined)?.payload;
              const count = typeof value === 'number' ? value : Number.parseFloat(String(value));
              const share = row !== undefined && total > 0 ? ` · ${formatPercent(count / total)}` : '';
              return [`${count} ejecución(es)${share}`, 'Resultado técnico'];
            }}
          />
          <Bar
            dataKey="count"
            name="Ejecuciones"
            maxBarSize={28}
            isAnimationActive={false}
            label={{
              position: 'right',
              offset: 8,
              // Se deja el tipo a la inferencia (como en los otros charts) y se
              // convierte con `String`, que tolera los tipos raros que Recharts
              // permite en `RenderableText` (`null`, `false`) sin imprimir esos
              // valores literales junto a la barra.
              formatter: (value) => String(value),
              style: { fill: 'var(--text-secondary)', fontSize: 12 },
            }}
          >
            {rows.map((row) => (
              <Cell key={row.outcome} fill={EXECUTION_BAR_FILL[row.outcome]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {/*
        Alternativa textual de 1.1.1. El `label` de la derecha escribe el número
        en otra coordenada que la etiqueta del eje, así que el emparejamiento
        categoría↔número solo existe en la vista.
      */}
      <p className="sr-only">{summary(rows, total)}</p>
    </div>
  );
}

/** Reparto leído como frase, con el porcentaje de cada categoría. */
function summary(rows: Row[], total: number): string {
  const detalle = rows
    .map((row) => {
      const share = total > 0 ? ` (${formatPercent(row.count / total)})` : '';
      return `${row.label}: ${row.count}${share}`;
    })
    .join('; ');
  return `Resultados técnicos de ${total} ejecución(es). ${detalle}.`;
}
