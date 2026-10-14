// =============================================================================
// Resumen (dashboard). Vista agregada del producto.
//
// La página solo orquesta: pide el agregado con `useDashboard` y lo pinta.
// No calcula porcentajes, no agrupa resultados y no reinterpretan el dictamen:
// esos valores llegan ya resueltos desde el servidor.
// =============================================================================

import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { ActivityOverview } from './ActivityOverview';
import type { DashboardFilters as DashboardFiltersValue } from '../../lib/dashboard';
import { defaultDateRange } from '../../lib/dashboard';
import { useDashboard } from '../../lib/useDashboard';
import { Badge, ChartFrame, ErrorCard } from '../ui';
import { DashboardFilters } from './DashboardFilters';
import { RecentCasesTable } from './RecentCasesTable';
import { EvolutionChart } from './charts/EvolutionChart';
import { OriginBreakdownChart } from './charts/OriginBreakdownChart';
import { ResolutionDonut } from './charts/ResolutionDonut';
import { ResultsBreakdownChart } from './charts/ResultsBreakdownChart';
import type { OriginBreakdownPoint } from '../../lib/dashboard';


/**
 * `true` cuando no hay nada que graficar: sin puntos, o con "Sin determinar" como
 * único punto. Un gráfico de una sola barra "Sin determinar" no informa nada; el
 * estado vacío sí dice que el origen no es determinable.
 */
function isOnlyUndetermined(points: OriginBreakdownPoint[]): boolean {
  return points.length === 0 || (points.length === 1 && points[0]?.value === 'Sin determinar');
}

const EMPTY_CHART_TITLE = 'No hay suficientes datos para este periodo.';
const EMPTY_TABLE_TITLE = 'Todavía no hay casos auditados en este periodo.';

export function OverviewPage(): ReactNode {
  const [filters, setFilters] = useState<DashboardFiltersValue>(defaultDateRange);
  const { data, isLoading, error, reload } = useDashboard(filters, 'summary');

  // Un error global no debe vaciar la pantalla: se muestra arriba y el resto
  // de la página sigue intentándolo con su propio estado.
  const handleRetry = useCallback((): void => {
    reload();
  }, [reload]);

  const timeline = data?.timeline ?? [];
  const split = data?.split ?? [];
  const byResult = data?.byResult ?? [];
  const byCountry = data?.byCountry?.points ?? [];
  const byChannel = data?.byChannel?.points ?? [];
  const recentCases = data?.recentCases ?? [];

  return (
    <div className="dashboard-page overview-page flex flex-col gap-5">
      {/* Fila 0: título + filtros */}
      <header className="dashboard-page-heading">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Resumen de auditorías</h1>
          <p className="mt-1 text-sm text-muted">
            Ejecuciones, consumo registrado y expedientes del mes calendario · UTC · Producción.
          </p>
        </div>
      </header>

      <section className="dashboard-toolbar" aria-label="Filtros del resumen">
        {data?.identities && <p className="text-sm text-muted">En las auditorías del periodo: {data.identities.students} matrículas únicas · {data.identities.tickets} tickets CaVe · {data.identities.caseFiles} expedientes · {data.identities.requests} solicitudes según ticket y conciliación · {data.identities.auditExecutions} ejecuciones de auditoría. Las ejecuciones y sus costos se conservan completos.</p>}
      <DashboardFilters value={filters} onChange={setFilters} allowResultFilter={false} />
      </section>

      {error !== null && (
        <ErrorCard
          title="No se pudo cargar el resumen"
          message={error}
          onRetry={handleRetry}
          retrying={isLoading}
        />
      )}

      <ActivityOverview activity={data?.activity} loading={isLoading && !data} />

      {/* Fila 2: evolución + distribución */}
      <div className="grid gap-6 lg:grid-cols-2">
        {data?.truncated === true && (
          <div className="lg:col-span-2">
            <Badge tone="warning">Se muestran los casos más recientes del periodo</Badge>
          </div>
        )}

        <ChartFrame
          title="Evolución de dictámenes emitidos"
          description="Todas las versiones completadas, agrupadas por día UTC."
          isLoading={isLoading}
          isEmpty={timeline.length === 0}
          emptyTitle={EMPTY_CHART_TITLE}
          error={null}
        >
          <EvolutionChart data={timeline} />
        </ChartFrame>

        <ChartFrame
          title="Distribución de resoluciones"
          description="Reparto de todas las ejecuciones completadas del periodo."
          height={320}
          isLoading={isLoading}
          isEmpty={split.length === 0}
          emptyTitle={EMPTY_CHART_TITLE}
          error={null}
        >
          <ResolutionDonut data={split} />
        </ChartFrame>
      </div>

      {/* Fila 3: detalle por resultado */}
      <div className="grid gap-6">
        <ChartFrame
          title="Detalle de resultados"
          description="Cantidad de dictámenes emitidos por resultado; incluye reauditorías."
          isLoading={isLoading}
          isEmpty={byResult.length === 0}
          emptyTitle={EMPTY_CHART_TITLE}
          error={null}
        >
          <ResultsBreakdownChart data={byResult} />
        </ChartFrame>
      </div>

      {/* Fila 3b: origen de la cancelación */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartFrame
          title="Distribución por país"
          description="País de operación de donde proviene cada caso auditado."
          height={320}
          isLoading={isLoading}
          isEmpty={isOnlyUndetermined(byCountry)}
          emptyTitle={EMPTY_CHART_TITLE}
          error={null}
        >
          <OriginBreakdownChart data={byCountry} dimension="country" />
        </ChartFrame>

        <ChartFrame
          title="Distribución por canal"
          description="Canal por el que el estudiante expresó la cancelación."
          height={320}
          isLoading={isLoading}
          isEmpty={isOnlyUndetermined(byChannel)}
          emptyTitle={EMPTY_CHART_TITLE}
          error={null}
        >
          <OriginBreakdownChart data={byChannel} dimension="channel" />
        </ChartFrame>
      </div>

      {/* Fila 4: casos recientes */}
      <div className="grid gap-6">
        <ChartFrame
          title="Casos recientes"
          description="Los últimos casos auditados del periodo seleccionado."
          isLoading={isLoading}
          isEmpty={recentCases.length === 0}
          emptyTitle={EMPTY_TABLE_TITLE}
          error={null}
        >
          <RecentCasesTable cases={recentCases} />
        </ChartFrame>
      </div>
    </div>
  );
}
