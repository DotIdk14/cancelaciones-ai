// =============================================================================
// Expedientes del periodo por etapa actual. Cada expediente aparece una sola vez.
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
import type { CaseProgressSummary } from '../../../lib/dashboard';
import { AXIS_TICK_STYLE, GRID_STROKE, TOOLTIP_STYLE } from './chartTheme';

const STAGES = [
  { key: 'drafts', label: 'Borradores', shortLabel: 'Borradores', color: 'var(--text-muted)' },
  { key: 'pendingAudit', label: 'Pendientes de auditar con IA', shortLabel: 'Pendientes IA', color: 'var(--accent)' },
  { key: 'pendingAdvisor', label: 'Pendientes del Asesor', shortLabel: 'Asesor', color: 'var(--chart-origin-country)' },
  { key: 'pendingCoordinator', label: 'Pendientes del Coordinador', shortLabel: 'Coordinador', color: 'var(--chart-origin-channel)' },
  { key: 'finalized', label: 'Finalizados por el Coordinador', shortLabel: 'Finalizados', color: 'var(--success)' },
  { key: 'errors', label: 'Con error de IA', shortLabel: 'Error IA', color: 'var(--danger)' },
] as const;

export function CaseProgressChart({ data }: { data: CaseProgressSummary }): ReactNode {
  const rows = STAGES.map(({ key, label, shortLabel, color }) => ({ key, label, shortLabel, color, count: data[key] }));
  const details = rows.map(({ label, count }) => `${label}: ${count}`).join('; ');
  const description = `Total del periodo: ${data.total} expedientes, incluidos los borradores. Cada expediente aparece una sola vez. ${details}.`;

  return <>
    <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted" aria-label="Leyenda de etapas">
      {STAGES.map(({ key, label, color }) => (
        <li key={key} className="flex items-center gap-2">
          <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: color }} />
          <span>{label}</span>
        </li>
      ))}
    </ul>
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={rows}
        margin={{ top: 8, right: 12, bottom: 18, left: 0 }}
        title="Todos los expedientes por etapa actual"
        desc={description}
      >
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
        <XAxis type="category" dataKey="shortLabel" interval={0} tick={AXIS_TICK_STYLE} tickLine={false} axisLine={{ stroke: GRID_STROKE }} tickMargin={10} />
        <YAxis type="number" allowDecimals={false} tick={AXIS_TICK_STYLE} tickLine={false} axisLine={false} width={32} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ fill: 'rgba(255, 255, 255, 0.04)' }}
          labelFormatter={(shortLabel, payload) => payload[0]?.payload?.label ?? shortLabel}
        />
        <Bar dataKey="count" name="Expedientes" maxBarSize={54} isAnimationActive={false}>
          {rows.map((row) => <Cell key={row.key} fill={row.color} />)}
          <LabelList dataKey="count" position="top" offset={6} style={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
    <p className="sr-only">{description}</p>
  </>;
}
