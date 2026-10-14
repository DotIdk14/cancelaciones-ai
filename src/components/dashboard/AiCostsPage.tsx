import { useState } from 'react';
import type { CostGranularity, DashboardFilters as Filters } from '../../lib/dashboard';
import { defaultDateRange } from '../../lib/dashboard';
import { useAiCosts } from '../../lib/useDashboard';
import { Button, ErrorCard } from '../ui';
import { DashboardFilters } from './DashboardFilters';
import { ActivityCharts } from './ActivityCharts';
import { ActivityOverview } from './ActivityOverview';
import { formatCost, formatLatency } from '../../lib/format';

export function AiCostsPage() {
  const [filters, setFilters] = useState<Filters>(defaultDateRange);
  const [granularity, setGranularity] = useState<CostGranularity>('day');
  const { data, isLoading, error, reload } = useAiCosts(filters, granularity);
  return <div className="dashboard-page costs-page flex flex-col gap-5" aria-busy={isLoading}>
    <header className="dashboard-page-heading"><div><h1 className="text-2xl font-semibold text-ink">Actividad y consumo</h1><p className="mt-1 text-sm text-muted">Uso registrado de IA · Acceso del Gerente.</p></div></header>
    <section className="dashboard-toolbar costs-toolbar" aria-label="Filtros de actividad y consumo">
      <DashboardFilters value={filters} onChange={setFilters} allowResultFilter={false} />
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Agrupar consumo por">
        <span className="text-sm text-muted">Agrupar por</span>{([['day', 'Día'], ['week', 'Semana'], ['month', 'Mes']] as const).map(([value, label]) => <Button key={value} variant={granularity === value ? 'primary' : 'secondary'} aria-pressed={granularity === value} onClick={() => setGranularity(value)}>{label}</Button>)}
      </div>
    </section>
    {error && <ErrorCard title="No se pudo cargar el consumo" message={error} onRetry={reload} retrying={isLoading} />}
    {data && <p className="text-sm text-muted">Periodo aplicado: {data.filters.from} a {data.filters.to} · {data.activity?.unknownCostExecutions ?? 'Sin dato'} ejecuciones con costo desconocido o parcial.</p>}
    <ActivityCharts activity={data?.activity} models={data?.byModel ?? []} loading={isLoading && !data} />
    <details><summary className="cursor-pointer text-sm text-brand">Detalle técnico del periodo</summary><ActivityOverview activity={data?.activity} loading={isLoading && !data} />
      {data && <>
        <p className="my-4 text-sm text-muted">Latencia de auditorías: promedio {formatLatency(data.kpi.avgLatencyMs)} · P50 {formatLatency(data.kpi.p50LatencyMs)} · P95 {formatLatency(data.kpi.p95LatencyMs)}.</p>
        <p className="my-4 text-sm text-muted">Fiabilidad: {data.reliability.successful} exitosas · {data.reliability.retried} con reintento · {data.reliability.fallback} con fallback · {data.reliability.failed} fallidas. Estas categorías se solapan y no se suman.</p>
        <div className="overflow-x-auto" role="region" aria-label="Detalle por modelo" tabIndex={0}><table className="student-history-comparison"><thead><tr>{['Modelo', 'Llamadas', 'Costo conocido USD', 'Promedio por llamada USD'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{data.byModel.map(row => <tr key={row.model}><th scope="row">{row.model}</th><td>{row.calls}</td><td>{row.costKnownCalls ? formatCost(row.totalCostUsd) : 'No reportado'}</td><td>{formatCost(row.avgCostUsd)}</td></tr>)}</tbody></table></div>
      </>}
    </details>
  </div>;
}
