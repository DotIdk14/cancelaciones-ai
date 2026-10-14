import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { MonthlyActivity } from '../../lib/dashboard-metrics-contracts';
import type { CostGranularity } from '../../lib/dashboard';
import { Button, Panel, Skeleton } from '../ui';
import { AXIS_TICK_STYLE, GRID_STROKE, TOOLTIP_STYLE } from './charts/chartTheme';

const money = (value: number | null | undefined): string => value == null ? 'No disponible' : `$${value.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USD`;
type View = 'cost' | 'activity' | 'average';

export function ActivityCharts({ activity, loading, granularity, onGranularityChange }: {
  activity?: MonthlyActivity; loading: boolean; granularity: CostGranularity; onGranularityChange: (value: CostGranularity) => void;
}) {
  const [view, setView] = useState<View>('cost');
  const series = activity?.series ?? [];
  const hasData = series.some(point => view === 'cost' ? point.knownCostUsd !== null : view === 'average' ? point.avgCostPerAuditUsd !== null : point.audits + point.comparisons > 0);
  const title = view === 'cost' ? 'Gasto registrado de IA' : view === 'activity' ? 'Trabajo realizado por la IA' : 'Costo por ejecución de auditoría';
  const description = view === 'cost' ? 'Incluye auditorías y comparaciones. Los costos no reportados quedan fuera de la suma.' : view === 'activity' ? 'Un expediente puede tener varias ejecuciones. Las auditorías completadas forman parte de las iniciadas.' : 'Incluye las ejecuciones fallidas y en curso. Excluye comparaciones. No es el costo por expediente.';
  return <Panel title="Explorar actividad y consumo" description="Una gráfica, tres formas de consultar el periodo.">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Vista de consumo">
        {([['cost', 'Gasto'], ['activity', 'Actividad'], ['average', 'Costo promedio']] as const).map(([value, label]) => <Button key={value} variant={view === value ? 'primary' : 'secondary'} aria-pressed={view === value} onClick={() => setView(value)}>{label}</Button>)}
      </div>
      <div className="flex items-center gap-2 text-sm text-muted"><label htmlFor="consumption-group">Agrupar por</label><select id="consumption-group" className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-ink" value={granularity} onChange={event => onGranularityChange(event.target.value as CostGranularity)}><option value="day">Día</option><option value="week">Semana</option><option value="month">Mes</option></select></div>
    </div>
    <h3 className="font-semibold text-ink">{title}{view !== 'activity' && ' · USD'}</h3><p className="mt-2 mb-5 text-sm text-muted">{description}</p>
    {loading ? <Skeleton height={280} /> : !hasData ? <div className="py-10 text-sm text-muted" role="status">{view === 'average' && series.length ? 'No hay promedios disponibles: faltan costos completos o no hubo auditorías.' : view === 'cost' && series.length ? 'Hubo actividad, pero el proveedor no reportó costos válidos.' : 'No hay actividad registrada para este periodo.'}</div> : <>
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%"><BarChart data={series} title={title} desc={description} margin={{ top: 12, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={GRID_STROKE} vertical={false} /><XAxis dataKey="bucket" tick={AXIS_TICK_STYLE} minTickGap={30} /><YAxis tick={AXIS_TICK_STYLE} width={65} allowDecimals={view !== 'activity'} tickFormatter={value => view === 'activity' ? String(value) : `$${Number(value).toLocaleString('es-MX', { maximumSignificantDigits: 3 })}`} />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={value => typeof value === 'number' ? view === 'activity' ? `${value} ejecuciones` : money(value) : 'No disponible'} />
          {view === 'activity' ? <><Legend /><Bar dataKey="audits" name="Auditorías iniciadas" fill="var(--accent)" maxBarSize={48} isAnimationActive={false} /><Bar dataKey="completed" name="Auditorías completadas" fill="var(--success)" maxBarSize={48} isAnimationActive={false} /><Bar dataKey="comparisons" name="Comparaciones iniciadas" fill="var(--text-muted)" maxBarSize={48} isAnimationActive={false} /></> : <Bar dataKey={view === 'cost' ? 'knownCostUsd' : 'avgCostPerAuditUsd'} name={title} fill="var(--accent)" maxBarSize={64} isAnimationActive={false} />}
        </BarChart></ResponsiveContainer>
      </div>
      <p className="mt-3 text-xs text-muted">Solo se muestran periodos con actividad. Fechas en UTC; semanas desde el lunes. Un espacio sin costo disponible no equivale a costo cero.</p>
    </>}
    <details className="quality-disclosure"><summary>Consultar valores exactos de la gráfica</summary><div className="overflow-x-auto" role="region" aria-label="Valores de actividad y consumo" tabIndex={0}><table className="student-history-comparison"><caption className="sr-only">Actividad y gasto por periodo UTC</caption><thead><tr>{['Periodo UTC', 'Auditorías iniciadas', 'Completadas', 'Comparaciones', 'Gasto registrado', 'Ejecuciones con costo incompleto', 'Promedio por ejecución de auditoría'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{series.map(point => <tr key={point.bucket}><th scope="row">{point.bucket}</th><td>{point.audits}</td><td>{point.completed}</td><td>{point.comparisons}</td><td>{money(point.knownCostUsd)}</td><td>{point.unknownCostExecutions}</td><td>{money(point.avgCostPerAuditUsd)}</td></tr>)}</tbody></table>{!series.length && <p className="py-4 text-sm text-muted">Sin registros para el periodo elegido.</p>}</div></details>
  </Panel>;
}
