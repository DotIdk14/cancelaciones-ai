// =============================================================================
// Distribución de resoluciones (dona). La leyenda textual bajo la gráfica es
// la lectura principal: el color solo acompaña, nunca es el único canal.
// =============================================================================

import type { ReactNode } from 'react';
import { Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { ResolutionSplitPoint } from '../../../lib/dashboard';
import { formatPercent } from '../../../lib/format';
import { RESOLUTION_GROUP_LABELS } from '../../../lib/labels';
import { CHART_COLORS, TOOLTIP_STYLE } from './chartTheme';

export function ResolutionDonut({ data }: { data: ResolutionSplitPoint[] }): ReactNode {
  const total = data.reduce((sum, point) => sum + point.count, 0);
  if (data.length === 0 || total === 0) return null;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Pie
              data={data}
              dataKey="count"
              nameKey="group"
              innerRadius="55%"
              outerRadius="80%"
              paddingAngle={2}
              stroke="none"
              isAnimationActive={false}
            >
              {data.map((point) => (
                <Cell key={point.group} fill={CHART_COLORS[point.group]} />
              ))}
              <LabelList
                position="center"
                content={() => (
                  <text
                    textAnchor="middle"
                    dominantBaseline="middle"
                    style={{ fill: 'var(--text-primary)', fontSize: 24, fontWeight: 700 }}
                  >
                    {total}
                  </text>
                )}
              />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Leyenda textual: nombre + valor + porcentaje, accesible sin color. */}
      <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
        {data.map((point) => (
          <li key={point.group} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: CHART_COLORS[point.group] }}
            />
            <span className="text-muted">{RESOLUTION_GROUP_LABELS[point.group]}</span>
            <span className="font-semibold text-ink">{point.count}</span>
            <span className="text-xs text-muted">({formatPercent(point.count / total)})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
