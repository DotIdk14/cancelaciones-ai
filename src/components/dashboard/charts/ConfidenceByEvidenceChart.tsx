// =============================================================================
// Confianza media según cuánta evidencia falta en el expediente. Responde a la
// pregunta que SÍ tiene respuesta honesta en esta vista: "¿baja la calidad
// cuando el expediente está incompleto?".
//
// DOS DECISIONES QUE NO SON ESTÉTICAS:
//
//  1. Los valores se mandan como PROPORCIÓN 0..1 (no como porcentaje). La línea
//     de referencia de "alta confianza" es el umbral REAL (0.85), el mismo
//     número que usa `confidenceBand` en el servidor; multiplicar por 100 haría
//     que esa línea dejara de coincidir con el criterio y tendría que volver a
//     escribir el 85 a mano. El EJE sí se pinta en porcentaje, que es como se lee.
//
//  2. Un bucket SIN datos no emite barra. `avgConfidence: null` significa que no
//     hay ningún caso en ese bucket, no que la confianza allí sea 0 %: se
//     transforma en `NaN` justamente para que Recharts no lo dibuje como una
//     barra en el suelo, que se leería como "confianza cero". En su lugar se
//     rotula la categoría como "sin datos" en el eje.
// =============================================================================

import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ConfidenceReport } from '../../../lib/dashboard';
import { CONFIDENCE_HIGH_THRESHOLD } from '../../../lib/labels';
import { formatPercent } from '../../../lib/format';
import { AXIS_TICK_STYLE, GRID_STROKE, TOOLTIP_STYLE } from './chartTheme';

type Bucket = ConfidenceReport['confidenceByMissingEvidence'][number];

/** Rótulo del eje X para un bucket sin datos. Distingue "nada" de "cero". */
const NO_DATA_LABEL = 'sin datos';

/**
 * Fila que se le pasa a Recharts.
 *
 * `value` es `number | null` para poder dejar constancia de la ausencia; el
 * `NaN` se aplica solo al `dataKey` que Recharts lee (`avg`), porque su interno
 * `getValueOf` descarta los valores no numéricos sin dejar rastro. Un `null` en
 * la serie se dibujaría como una barra de altura 0.
 */
interface Row {
  label: string;
  count: number;
  /** Valor legible (0..1) o `NO_DATA_LABEL` si no hay datos. */
  display: string;
  /** `NaN` cuando no hay datos: así Recharts no pinta la barra. */
  avg: number;
}

export interface ConfidenceByEvidenceChartProps {
  data: Bucket[];
  /** Texto alternativo: qué compara y cuál es la lectura principal. */
  ariaLabel: string;
}

export function ConfidenceByEvidenceChart({ data, ariaLabel }: ConfidenceByEvidenceChartProps): ReactNode {
  // Sin filas no se pinta un eje con tres categorías vacías: el `ChartFrame`
  // muestra el estado vacío, que es la lectura correcta.
  if (data.length === 0) return null;

  const rows: Row[] = data.map((bucket) => ({
    label: bucket.avgConfidence === null ? NO_DATA_LABEL : bucket.label,
    count: bucket.count,
    display: bucket.avgConfidence === null ? NO_DATA_LABEL : formatPercent(bucket.avgConfidence),
    // `NaN` es intencionado y está documentado en la cabecera del archivo.
    avg: bucket.avgConfidence ?? Number.NaN,
  }));

  return (
    <div className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        {/* `title`/`desc` en el `<svg>` en vez de un wrapper `role="img"`: ese
            rol es de hijos presentacionales y eliminaría la capa de
            accesibilidad de Recharts 3 (teclado + tooltip `role="status"`). */}
        <BarChart
          data={rows}
          margin={{ top: 20, right: 8, bottom: 0, left: -12 }}
          title="Confianza media según las evidencias que faltan"
          desc={ariaLabel}
        >
          <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} horizontal={true} />
          <XAxis
            dataKey="label"
            tick={AXIS_TICK_STYLE}
            tickLine={false}
            axisLine={{ stroke: GRID_STROKE }}
            interval={0}
            height={48}
            angle={-12}
            textAnchor="end"
          />
          <YAxis
            domain={[0, 1]}
            width={52}
            // El eje se lee en porcentaje aunque los datos sean proporciones.
            tickFormatter={(value: number) => formatPercent(value)}
            tick={AXIS_TICK_STYLE}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            cursor={{ fill: 'rgba(255, 255, 255, 0.04)' }}
            // Firma ancha de Recharts 3: el valor no se usa (viene ya formateado
            // en `payload.display`, y el `dataKey` puede ser `NaN` a propósito),
            // así que se lee el payload ya estrecho a `Row`.
            formatter={(_value, _name, item) => {
              const payload = (item as { payload?: Row } | undefined)?.payload;
              return [`${payload?.display ?? NO_DATA_LABEL}`, 'Confianza media'];
            }}
          />
          {/* El umbral REAL de "alta confianza", el mismo que usa el backend para
              clasificar cada dictamen. Marcado para que se vea si la media de un
              grupo se acerca o se aleja de lo que se considera confiable. */}
          <ReferenceLine
            y={CONFIDENCE_HIGH_THRESHOLD}
            stroke="var(--warning)"
            strokeDasharray="4 4"
            label={{ value: 'Alta confianza', position: 'insideTopRight', fill: 'var(--text-muted)', fontSize: 11 }}
          />
          <Bar dataKey="avg" name="Confianza media" fill="var(--accent)" maxBarSize={72} radius={[4, 4, 0, 0]} isAnimationActive={false}>
            <LabelList dataKey="display" position="top" offset={6} style={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {/* Alternativa textual de 1.1.1 con los valores de cada grupo. */}
      <p className="sr-only">
        {`Confianza media según evidencias faltantes. Umbral de alta confianza: ${formatPercent(
          CONFIDENCE_HIGH_THRESHOLD,
        )}. ${rows
          .map(
            (row) =>
              `${row.label}: ${row.display === NO_DATA_LABEL ? NO_DATA_LABEL : row.display} sobre ${row.count} caso(s)`,
          )
          .join('; ')}.`}
      </p>
    </div>
  );
}
