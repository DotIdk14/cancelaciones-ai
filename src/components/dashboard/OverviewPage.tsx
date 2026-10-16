// =============================================================================
// Resumen de expedientes del periodo. El servidor deriva el conteo de casos y
// de la etapa actual de revisión; la página solo lo presenta.
// =============================================================================

import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import type { DashboardFilters as DashboardFiltersValue } from '../../lib/dashboard';
import { defaultDateRange } from '../../lib/dashboard';
import type { OriginBreakdownPoint } from '../../lib/dashboard';
import { formatDate } from '../../lib/format';
import { getLocalPreviewRole } from '../../lib/local-ui-preview';
import { isLocalDashboardPreview } from '../../lib/local-dashboard-preview';
import { useDashboard } from '../../lib/useDashboard';
import { useSession } from '../../lib/useSession';
import { ChartFrame, ErrorCard, StatCard } from '../ui';
import { DashboardFilters } from './DashboardFilters';
import { CaseProgressChart } from './charts/CaseProgressChart';
import { OriginBreakdownChart } from './charts/OriginBreakdownChart';

const EMPTY_CHART_TITLE = 'No hay suficientes datos para este periodo.';

function isOnlyUndetermined(points: OriginBreakdownPoint[]): boolean {
  return points.length === 0 || (points.length === 1 && ['Sin determinar', 'No reportado'].includes(points[0]?.value ?? ''));
}

function dateLabel(value: string): string {
  return formatDate(`${value}T12:00:00.000Z`);
}

export function OverviewPage(): ReactNode {
  const [filters, setFilters] = useState<DashboardFiltersValue>(defaultDateRange);
  const { data, isLoading, error, reload } = useDashboard(filters, 'summary');
  const { capabilities } = useSession();
  const handleRetry = useCallback((): void => reload(), [reload]);
  const progress = data?.caseProgress;
  const advisorAssignments = data?.advisorAssignments;
  const showAdvisorAssignments = isLocalDashboardPreview()
    ? getLocalPreviewRole() === 'user'
    : capabilities.canReviewOwnCases;

  const byCountry = data?.byCountry?.points ?? [];
  const bySalesChannel = data?.bySalesChannel?.points ?? [];

  return (
    <div className="dashboard-page overview-page flex flex-col gap-5">
      <header className="dashboard-page-heading">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Resumen de expedientes</h1>
          <p className="mt-1 text-sm text-muted">Del {dateLabel(filters.from)} al {dateLabel(filters.to)} · Horario UTC</p>
        </div>
        <details className="overview-disclosure overview-filters">
          <summary className="text-sm">Elegir periodo</summary>
          <div className="dashboard-toolbar mt-3">
            <DashboardFilters value={filters} onChange={setFilters} allowResultFilter={false} periodOnly />
          </div>
        </details>
      </header>

      {error !== null && <ErrorCard title="No se pudo cargar el resumen" message={error} onRetry={handleRetry} retrying={isLoading} />}

      {showAdvisorAssignments && (
        <section className="rounded-xl border border-line bg-surface-1 p-4" aria-labelledby="advisor-assignments-title">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 id="advisor-assignments-title" className="text-base font-semibold text-ink">Contactos asignados</h2>
              <p className="mt-1 text-xs text-muted">Asignaciones actuales del Asesor, agrupadas por etapa.</p>
            </div>
            <p className="text-sm text-muted">Total: <strong className="text-ink">{isLoading ? '…' : advisorAssignments?.total ?? 0}</strong></p>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Borradores" value={advisorAssignments?.drafts ?? 0} isLoading={isLoading} />
            <StatCard label="Por auditar" value={advisorAssignments?.pendingAudit ?? 0} isLoading={isLoading} />
            <StatCard label="Dictamen del Asesor" value={advisorAssignments?.pendingAdvisor ?? 0} isLoading={isLoading} />
            <StatCard label="Cierre del Coordinador" value={advisorAssignments?.pendingCoordinator ?? 0} isLoading={isLoading} />
            <StatCard label="Completados" value={advisorAssignments?.finalized ?? 0} isLoading={isLoading} />
            <StatCard label="Errores" value={advisorAssignments?.errors ?? 0} isLoading={isLoading} />
          </div>
        </section>
      )}

      <ChartFrame
        title="Expedientes por etapa"
        description={progress ? <>Total del periodo: <strong className="text-ink">{progress.total}</strong>. Incluye borradores; cada expediente se cuenta una sola vez.</> : 'Total de expedientes del periodo, incluidos los borradores, agrupados por etapa actual.'}
        height={330}
        isLoading={isLoading}
        isEmpty={progress?.total === 0}
        emptyTitle="No hay expedientes en este periodo."
      >
        {progress ? <CaseProgressChart data={progress} /> : <p className="p-4 text-sm text-muted">No hay conteos disponibles para este periodo.</p>}
      </ChartFrame>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartFrame
          title="Expedientes por país"
          description="País de operación registrado para los expedientes con dictamen de IA."
          height={320}
          isLoading={isLoading}
          isEmpty={isOnlyUndetermined(byCountry)}
          emptyTitle={EMPTY_CHART_TITLE}
        >
          <OriginBreakdownChart data={byCountry} dimension="country" />
        </ChartFrame>

        <ChartFrame
          title="Expedientes por canal de venta"
          description="Canal reportado en los tickets de Flokzu; el país asociado se toma del catálogo CaVe y no sustituye el país de origen evidenciado."
          height={320}
          isLoading={isLoading}
          isEmpty={isOnlyUndetermined(bySalesChannel)}
          emptyTitle={EMPTY_CHART_TITLE}
        >
          <OriginBreakdownChart data={bySalesChannel} dimension="salesChannel" />
        </ChartFrame>
      </div>
    </div>
  );
}
