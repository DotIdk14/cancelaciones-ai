import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { MonthlyActivity } from '../../lib/dashboard-metrics-contracts';
import type { ModelCostRow } from '../../lib/dashboard';
import { ChartFrame } from '../ui';
import { AXIS_TICK_STYLE, GRID_STROKE, TOOLTIP_STYLE } from './charts/chartTheme';

export function ActivityCharts({ activity, models, loading }: { activity?: MonthlyActivity; models: ModelCostRow[]; loading: boolean }) {
  const series = activity?.series ?? [];
  const plots = [
    { key: 'knownCostUsd', title: 'Costo conocido de IA · USD', color: 'var(--accent)' },
    { key: 'tokens', title: 'Tokens a lo largo del tiempo', color: '#8ab9ee' },
    { key: 'audits', title: 'Actividad de auditorías', color: 'var(--accent)' },
    { key: 'avgCostPerAuditUsd', title: 'Costo promedio por auditoría · USD', color: '#c0a1e5' },
  ] as const;
  return <>
    <p className="text-sm text-muted">Producción · UTC · Las semanas empiezan en lunes. Costo conocido de auditorías y comparaciones; el promedio corresponde solo a auditorías. Tokens y promedio sin consumo completo quedan vacíos.</p>
    <div className="grid gap-5 lg:grid-cols-2">
      {plots.map(plot => <ChartFrame key={plot.key} title={plot.title} height={250} isLoading={loading} isEmpty={!series.some(point => point[plot.key] != null)} emptyTitle="Sin datos registrados" error={null}>
        <ResponsiveContainer width="100%" height="100%"><LineChart data={series} title={plot.title} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
          <CartesianGrid stroke={GRID_STROKE} vertical={false} /><XAxis dataKey="bucket" tick={AXIS_TICK_STYLE} minTickGap={25} /><YAxis tick={AXIS_TICK_STYLE} width={65} />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={value => typeof value === 'number' ? value.toLocaleString('es-MX', { maximumFractionDigits: plot.key.includes('Cost') ? 6 : 0 }) : 'Sin dato'} />
          <Line dataKey={plot.key} name={plot.title} stroke={plot.color} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
          {plot.key === 'audits' && <Line dataKey="completed" name="Auditorías completadas" stroke="var(--success)" strokeDasharray="4 4" dot={{ r: 3 }} isAnimationActive={false} />}
        </LineChart></ResponsiveContainer>
      </ChartFrame>)}
    </div>
    <ChartFrame title="Distribución del costo conocido por modelo · USD" height={280} isLoading={loading} isEmpty={!models.some(model => (model.costKnownCalls ?? 0) > 0)} emptyTitle="Sin costos reportados por modelo" error={null}>
      <ResponsiveContainer width="100%" height="100%"><BarChart data={models.filter(model => (model.costKnownCalls ?? 0) > 0)} title="Costo conocido por modelo" layout="vertical" margin={{ left: 12, right: 20 }}>
        <CartesianGrid stroke={GRID_STROKE} horizontal={false} /><YAxis type="category" dataKey="model" width={140} tick={AXIS_TICK_STYLE} /><XAxis type="number" tick={AXIS_TICK_STYLE} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={value => typeof value === 'number' ? `$${value.toFixed(6)} USD` : 'Sin dato'} /><Bar dataKey="totalCostUsd" name="Costo conocido" fill="var(--accent)" isAnimationActive={false} />
      </BarChart></ResponsiveContainer>
    </ChartFrame>
    <details className="text-sm text-muted"><summary className="cursor-pointer text-brand">Consultar valores exactos y cobertura</summary><div className="overflow-x-auto" role="region" aria-label="Datos de actividad" tabIndex={0}><table className="student-history-comparison"><thead><tr>{['Periodo UTC', 'Ejecuciones de auditoría', 'Completadas', 'Comparaciones', 'Tokens', 'Costo conocido USD', 'Costo incompleto', 'Promedio auditoría USD'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{series.map(point => <tr key={point.bucket}>{[point.bucket, point.audits, point.completed, point.comparisons, point.tokens ?? 'No disponible', point.knownCostUsd?.toFixed(6) ?? 'No disponible', point.unknownCostExecutions, point.avgCostPerAuditUsd?.toFixed(6) ?? 'No disponible'].map((value, i) => <td key={i}>{value}</td>)}</tr>)}</tbody></table></div></details>
  </>;
}

