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
    <div className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        {/* `title`/`desc` van al propio `<svg>` de Recharts. Envolverlo en un
            `role="img"` sería PEOR: `img` es un rol de hijos presentacionales,
            así que sacaría del árbol de accesibilidad el `role="application"` y
            el `tabIndex=0` que Recharts 3 añade para poder leer los datos con
            las flechas del teclado. */}
        <BarChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: -12 }}
          title="Costo de las auditorías de IA por periodo"
          desc={ariaLabel}
        >
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
          <Bar
            dataKey="costUsd"
            name="Costo"
            fill="var(--accent)"
            maxBarSize={40}
            radius={[4, 4, 0, 0]}
            // Sin esto, cambiar la granularidad remonta la gráfica y reproduce
            // la animación completa de las barras.
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
      {/* Alternativa textual de 1.1.1 que SUSTITUYE al gráfico: describe qué
          mide y cuánto costó, con los valores. Sin esto, un usuario de lector
          de pantalla solo hearía "Costo de las auditorías de IA por periodo". */}
      <p className="sr-only">{dataSummary(data)}</p>
    </div>
  );
}

/** Resumen legible de la serie: periodo, total y el día más caro. */
function dataSummary(data: CostSeriesPoint[]): string {
  const total = data.reduce((sum, point) => sum + point.costUsd, 0);
  // `data` nunca llega vacío (el componente retorna `null` antes), pero sin
  // este guardia TypeScript no lo puede probar y el índice quedaría `undefined`.
  const peor = data.reduce<CostSeriesPoint | undefined>(
    (max, point) => (max === undefined || point.costUsd > max.costUsd ? point : max),
    undefined,
  );
  const parte = data
    .map((point) => `${point.bucket}: ${formatCostValue(point.costUsd)}`)
    .join('; ');
  const pico =
    peor === undefined
      ? ''
      : ` El día más caro fue ${peor.bucket} con ${formatCostValue(peor.costUsd)}.`;
  return (
    `Costo total ${formatCostValue(total)} en ${data.length} periodo(s).${pico} ` +
    `Detalle por periodo — ${parte}.`
  );
}
