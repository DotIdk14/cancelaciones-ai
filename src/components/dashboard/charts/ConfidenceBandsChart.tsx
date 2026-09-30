// =============================================================================
// Distribución de la confianza declarada por el modelo, por banda.
// Barras verticales con 3 columnas: Alta, Media y Baja.
//
// Las tres bandas se pintan SIEMPRE, incluso las que valen 0. Una banda en
// cero es información ("nadie auditó con confianza baja en este periodo"), y
// si la columna desapareciera, la gráfica cambiaría de forma según el periodo en
// lugar de según el dato. El backend ya garantiza el orden fijo; aquí se pinta
// lo que llega.
//
// El color NO es el único canal: cada barra lleva su valor escrito encima y el
// panel trae la leyenda textual del servidor, así que la lectura no depende de
// distinguir verde de ámbar.
// =============================================================================

import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ConfidenceReport } from '../../../lib/dashboard';
import { formatPercent } from '../../../lib/format';
import type { ConfidenceBand } from '../../../lib/labels';
import { CONFIDENCE_BAND_LABELS } from '../../../lib/labels';
import { AXIS_TICK_STYLE, GRID_STROKE, TOOLTIP_STYLE } from './chartTheme';

type Band = ConfidenceReport['bands'][number];

/**
 * Color por banda. Semántico y con variables CSS ya definidas en `index.css`
 * (`labels.ts` no define uno para confianza, y no se cuela ningún color suelto):
 * verde = alta, ámbar = media, rojo = baja.
 */
const BAND_FILL: Record<ConfidenceBand, string> = {
  ALTA: 'var(--success)',
  MEDIA: 'var(--warning)',
  BAJA: 'var(--danger)',
};

export interface ConfidenceBandsChartProps {
  data: Band[];
  /** Texto alternativo: qué mide y sobre cuántos dictámenes. */
  ariaLabel: string;
}

export function ConfidenceBandsChart({ data, ariaLabel }: ConfidenceBandsChartProps): ReactNode {
  // Sin datos no se inventa un eje vacío: el `ChartFrame` muestra el estado vacío.
  if (data.length === 0) return null;

  return (
    <div role="img" aria-label={ariaLabel} className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} horizontal={true} />
          <XAxis
            dataKey="label"
            tick={AXIS_TICK_STYLE}
            tickLine={false}
            axisLine={{ stroke: GRID_STROKE }}
          />
          <YAxis
            width={44}
            allowDecimals={false}
            tick={AXIS_TICK_STYLE}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            cursor={{ fill: 'rgba(255, 255, 255, 0.04)' }}
            // La firma de `formatter` en Recharts 3 es ancha (`ValueType`,
            // `Payload | TooltipPayloadEntry`), así que el valor se estrecha
            // aquí con `typeof` en vez de castear a ciegas por el tipo.
            formatter={(value, _name, item) => {
              const band = (item as { payload?: Band } | undefined)?.payload;
              const count = typeof value === 'number' ? value : Number.parseFloat(String(value));
              const full = band === undefined ? '' : `${CONFIDENCE_BAND_LABELS[band.band]}: `;
              const share = band === undefined ? '' : ` · ${formatPercent(band.pct / 100)}`;
              return [`${full}${count} dictamen(s)${share}`, 'Confianza'];
            }}
          />
          <Bar dataKey="count" name="Dictámenes" maxBarSize={72} radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {data.map((band) => (
              <Cell key={band.band} fill={BAND_FILL[band.band]} />
            ))}
            <LabelList
              dataKey="count"
              position="top"
              offset={6}
              // La etiqueta larga ("Alta confianza") vive en el tooltip y en el
              // `title` de la leyenda; aquí cabe la corta que es el `dataKey` del
              // eje X.
              formatter={(label) => String(label)}
              style={{ fill: 'var(--text-secondary)', fontSize: 12 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
