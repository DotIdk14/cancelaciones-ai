import type { ReactNode } from 'react';
import type { ActivityMetrics, MonthlyActivity } from '../../lib/dashboard-metrics-contracts';
import { DASH } from '../../lib/format';
import { Panel, Skeleton, StatCard } from '../ui';
import { formatCostMxn, MXN_CONVERSION_NOTE } from '../../lib/currency';

const money = (value: number | null | undefined): string => formatCostMxn(value, DASH);
const count = (value: number | undefined): string => value === undefined ? DASH : value.toLocaleString('es-MX');
const metrics: Array<{ label: string; key: keyof ActivityMetrics; currency?: boolean }> = [
  { label: 'Ejecuciones', key: 'executions' }, { label: 'Completadas', key: 'completed' },
  { label: 'Fallidas', key: 'failed' }, { label: 'En curso', key: 'running' },
  { label: 'Matrículas únicas', key: 'uniqueStudents' }, { label: 'Tickets CaVe únicos', key: 'uniqueCaveTickets' }, { label: 'Expedientes únicos', key: 'uniqueCases' }, { label: 'Reauditorías', key: 'reaudits' },
  { label: 'Ejecuciones con reintento', key: 'retried' }, { label: 'Ejecuciones con fallback', key: 'fallback' },
  { label: 'Llamadas OpenRouter registradas', key: 'providerCalls' },
  { label: 'Ejecuciones sin trazabilidad de llamadas', key: 'executionsWithoutCallTrace' },
  { label: 'Tokens reportados (pueden ser parciales)', key: 'tokens' }, { label: 'Ejecuciones con tokens incompletos', key: 'executionsWithoutTokenTrace' },
  { label: 'Costo conocido', key: 'knownCostUsd', currency: true },
  { label: 'Ejecuciones con costo desconocido o parcial', key: 'executionsWithUnknownCost' },
  { label: 'Costo medio por ejecución', key: 'avgKnownCostPerExecutionUsd', currency: true },
  { label: 'Costo medio por expediente único', key: 'avgKnownCostPerCaseUsd', currency: true },
];

export function ActivityOverview({ activity, loading }: { activity?: MonthlyActivity; loading: boolean }): ReactNode {
  return <>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy={loading}>
      <StatCard label="Ejecuciones de auditoría" value={loading ? <Skeleton className="h-8 w-20" /> : count(activity?.audits.executions)} hint="Cada ejecución cuenta; incluye fallos y en curso" />
      <StatCard label="Ejecuciones de comparación" value={count(activity?.comparisons.executions)} hint="Consumo independiente del dictamen original" />
      <StatCard label="Costo total conocido de IA" value={money(activity && ((activity.audits.costReportedExecutions ?? 0) + (activity.comparisons.costReportedExecutions ?? 0) > 0 || activity.knownTotalCostUsd > 0) ? activity.knownTotalCostUsd : null)} hint="Auditorías + comparaciones; consumo del proveedor" />
      <StatCard label="Costo desconocido o parcial" value={count(activity?.unknownCostExecutions)} hint="Ejecuciones; no se interpreta como costo cero" />
    </div>
    <Panel title="Actividad y consumo del periodo" description={`Producción · UTC. Los reintentos y fallbacks pueden coincidir. Las medias requieren consumo completo. ${MXN_CONVERSION_NOTE}`}>
      <div role="region" aria-label="Detalle de ejecuciones y consumo" tabIndex={0} className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead><tr className="border-b border-line text-left text-muted"><th scope="col" className="py-3">Métrica</th><th scope="col" className="px-4 py-3 text-right">Auditorías</th><th scope="col" className="px-4 py-3 text-right">Comparaciones</th></tr></thead>
          <tbody>{metrics.map(({ label, key, currency }) => <tr key={key} className="border-b border-line">
            <th scope="row" className="py-2 font-normal text-muted">{label}</th>
            {[activity?.audits, activity?.comparisons].map((item, index) => <td key={index} className="px-4 py-2 text-right text-ink">{key === 'reaudits' && index === 1 ? 'No aplica' : currency ? money(key === 'knownCostUsd' && !item?.costReportedExecutions && !item?.knownCostUsd ? null : item?.[key]) : count(item?.[key] ?? undefined)}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
    </Panel>
  </>;
}
