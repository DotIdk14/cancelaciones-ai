import { useState } from 'react';
import type { CostGranularity, DashboardFilters as Filters } from '../../lib/dashboard';
import { defaultDateRange } from '../../lib/dashboard';
import { useAiCosts } from '../../lib/useDashboard';
import { ErrorCard, Skeleton } from '../ui';
import { DashboardFilters } from './DashboardFilters';
import { ActivityCharts } from './ActivityCharts';
import { ActivityOverview } from './ActivityOverview';
import { formatLatency } from '../../lib/format';

const money = (value: number | null): string => value === null ? 'No disponible' : `$${value.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USD`;

export function AiCostsPage() {
  const [filters, setFilters] = useState<Filters>(defaultDateRange);
  const [granularity, setGranularity] = useState<CostGranularity>('day');
  const { data, isLoading, error, reload } = useAiCosts(filters, granularity);
  const a = data?.activity;
  const applied = data?.filters ?? filters;
  const executions = a ? a.audits.executions + a.comparisons.executions : 0;
  const knownCost = a && data?.kpi.costAvailable ? a.knownTotalCostUsd : null;
  const failed = a ? a.audits.failed + a.comparisons.failed : 0;
  const scopeActive = Object.entries(applied).some(([key, value]) => !['from', 'to'].includes(key) && value != null && value !== '');
  return <div className="dashboard-page costs-page flex flex-col gap-5" aria-busy={isLoading}>
    <section className="dashboard-toolbar costs-toolbar">
      <header className="dashboard-page-heading"><div><h1 className="text-2xl font-semibold text-ink">Actividad y consumo</h1><p className="mt-2 text-sm text-muted">Cuánto se ha gastado, cuántos expedientes se han auditado y qué ejecuciones fallaron.</p></div></header>
      <details className="quality-disclosure"><summary>Periodo: {applied.from} al {applied.to} · {scopeActive ? 'Filtros aplicados' : 'Todos los casos de producción'} · Cambiar filtros</summary><div className="pt-4"><DashboardFilters value={filters} onChange={setFilters} allowResultFilter={false} /></div></details>
    </section>
    {error && <ErrorCard title="No se pudo cargar el consumo" message={error} onRetry={reload} retrying={isLoading} />}
    {isLoading && !data ? <Skeleton height={160} /> : a && <>
      <section className="quality-overview" aria-label="Resumen de actividad y consumo">
        <div><h2>Gasto registrado de IA</h2><strong>{money(knownCost)}</strong><p>Auditorías y comparaciones.{a.unknownCostExecutions > 0 ? ' El gasto está incompleto.' : ' Consumo reportado por el proveedor.'}</p></div>
        <div><h2>Expedientes auditados</h2><strong>{a.audits.uniqueCases}</strong><p>{a.audits.executions} ejecuciones de auditoría · {a.comparisons.executions} de comparación.</p></div>
        <div><h2>Ejecuciones fallidas</h2><strong>{failed}</strong><p>{a.audits.failed} de auditoría · {a.comparisons.failed} de comparación.</p></div>
      </section>
      <p className={a.unknownCostExecutions > 0 ? 'text-sm text-warning' : 'text-sm text-muted'} role="status">{!executions ? 'No hay ejecuciones registradas para los filtros elegidos.' : a.unknownCostExecutions > 0 ? `${a.unknownCostExecutions} de ${executions} ejecuciones tienen costo desconocido o parcial. El gasto mostrado es solo la suma disponible; no representa el gasto completo.` : `El costo está reportado para las ${executions} ejecuciones del periodo.`}</p>
      <p className="text-sm text-muted">Una ejecución es un intento de procesar un expediente. Un expediente puede tener varias; las fallidas también pueden generar gasto.</p>
    </>}
    {(!error || data) && <ActivityCharts activity={a} loading={isLoading && !data} granularity={data?.granularity ?? granularity} onGranularityChange={setGranularity} />}
    <details className="quality-disclosure"><summary>Detalle técnico: modelos, tokens y tiempos de respuesta</summary><div className="pt-4">
      <ActivityOverview activity={a} loading={isLoading && !data} />
      {data && <>
        <p className="my-4 text-sm text-muted">Tiempo de las auditorías completadas: promedio {formatLatency(data.kpi.avgLatencyMs)}. La mitad terminó en {formatLatency(data.kpi.p50LatencyMs)} o menos (P50); el 95 % en {formatLatency(data.kpi.p95LatencyMs)} o menos (P95).</p>
        <p className="my-4 text-sm text-muted">Auditorías con reintento: {data.reliability.retried}. Con cambio de modelo: {data.reliability.fallback}. Pueden coincidir en una misma ejecución; no se suman como categorías distintas.</p>
        <div className="overflow-x-auto" role="region" aria-label="Detalle por modelo" tabIndex={0}><table className="student-history-comparison"><thead><tr>{['Modelo', 'Llamadas registradas', 'Llamadas con costo disponible', 'Gasto registrado USD', 'Promedio de llamadas con costo USD'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{data.byModel.map(row => <tr key={row.model}><th scope="row">{row.model}</th><td>{row.calls}</td><td>{row.costKnownCalls} de {row.calls}</td><td>{money(row.costKnownCalls ? row.totalCostUsd : null)}</td><td>{money(row.avgCostUsd)}</td></tr>)}</tbody></table></div>
      </>}
      <p className="mt-4 text-sm text-muted">Datos de producción, sin casos de prueba. Fechas según el inicio de cada ejecución, en UTC. No se estiman costos faltantes. Los tiempos no incluyen auditorías fallidas ni comparaciones.</p>
    </div></details>
  </div>;
}
