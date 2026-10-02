// =============================================================================
// Resumen (dashboard). Vista agregada del producto.
//
// La p├ígina solo orquesta: pide el agregado con `useDashboard` y lo pinta.
// No calcula porcentajes, no agrupa resultados y no reinterpretan el dictamen:
// esos valores llegan ya resueltos desde el servidor.
// =============================================================================

import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { CircleCheck, FileQuestion, FileWarning, Files, Scale, TriangleAlert } from 'lucide-react';
import type { DashboardFilters as DashboardFiltersValue, KpiKey } from '../../lib/dashboard';
import { defaultDateRange, KPI_PCT } from '../../lib/dashboard';
import { formatPercent } from '../../lib/format';
import { useDashboard } from '../../lib/useDashboard';
import { Badge, ChartFrame, ErrorCard, Skeleton, StatCard } from '../ui';
import { DashboardFilters } from './DashboardFilters';
import { RecentCasesTable } from './RecentCasesTable';
import { EvolutionChart } from './charts/EvolutionChart';
import { ResolutionDonut } from './charts/ResolutionDonut';
import { ResultsBreakdownChart } from './charts/ResultsBreakdownChart';
import type { Tone } from '../ui';

const ICON_PROPS = { size: 18, 'aria-hidden': true } as const;

interface KpiCard {
  key: KpiKey;
  label: string;
  tone: Tone;
  icon: ReactNode;
  /** `false` solo para "Casos auditados": es el denominador, no lleva %. */
  withPct: boolean;
}

const KPI_CARDS: KpiCard[] = [
  { key: 'auditedCases', label: 'Casos auditados', tone: 'neutral', icon: <Files {...ICON_PROPS} />, withPct: false },
  {
    key: 'casesWithMissingEvidence',
    label: 'Casos con evidencia faltante',
    tone: 'warning',
    icon: <FileWarning {...ICON_PROPS} />,
    withPct: true,
  },
  { key: 'granted', label: 'Concedidas', tone: 'success', icon: <CircleCheck {...ICON_PROPS} />, withPct: true },
  { key: 'needsRuling', label: 'Requiere dictaminaci├│n', tone: 'warning', icon: <Scale {...ICON_PROPS} />, withPct: true },
  { key: 'insufficient', label: 'Evidencia insuficiente', tone: 'brand', icon: <FileQuestion {...ICON_PROPS} />, withPct: true },
  { key: 'errors', label: 'Errores', tone: 'danger', icon: <TriangleAlert {...ICON_PROPS} />, withPct: true },
];

const EMPTY_CHART_TITLE = 'No hay suficientes datos para este periodo.';
const EMPTY_TABLE_TITLE = 'Todav├¡a no hay casos auditados en este periodo.';

export function OverviewPage(): ReactNode {
  const [filters, setFilters] = useState<DashboardFiltersValue>(defaultDateRange);
  const { data, isLoading, error, reload } = useDashboard(filters, 'summary');

  // Un error global no debe vaciar la pantalla: se muestra arriba y el resto
  // de la p├ígina sigue intent├índolo con su propio estado.
  const handleRetry = useCallback((): void => {
    reload();
  }, [reload]);

  const kpi = data?.kpi;
  const timeline = data?.timeline ?? [];
  const split = data?.split ?? [];
  const byResult = data?.byResult ?? [];
  const recentCases = data?.recentCases ?? [];

  return (
    <div className="flex flex-col gap-6">
      {/* Fila 0: t├¡tulo + filtros */}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Resumen</h1>
          <p className="mt-1 text-sm text-muted">
            Estado de las auditor├¡as del periodo seleccionado.
          </p>
        </div>
        <DashboardFilters value={filters} onChange={setFilters} />
      </header>

      {error !== null && (
        <ErrorCard
          title="No se pudo cargar el resumen"
          message={error}
          onRetry={handleRetry}
          retrying={isLoading}
        />
      )}

      {/* Fila 1: KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {KPI_CARDS.map((card) => {
          const value = kpi?.[card.key];
          const pctKey = card.key === 'auditedCases' ? null : KPI_PCT[card.key];
          return (
            <StatCard
              key={card.key}
              label={card.label}
              tone={card.tone}
              icon={card.icon}
              value={isLoading || value === undefined ? <Skeleton className="h-8 w-20" /> : value}
              hint={
                card.withPct && pctKey !== null ? (
                  isLoading || kpi === undefined ? (
                    <Skeleton className="mt-2 h-3 w-14" />
                  ) : (
                    `${formatPercent(kpi[pctKey])} del total`
                  )
                ) : undefined
              }
            />
          );
        })}
      </div>

      {/* Fila 2: evoluci├│n + distribuci├│n */}
      <div className="grid gap-6 lg:grid-cols-2">
        {data?.truncated === true && (
          <div className="lg:col-span-2">
            <Badge tone="warning">Se muestran los casos m├ís recientes del periodo</Badge>
          </div>
        )}

        <ChartFrame
          title="Evoluci├│n de casos"
          description="Casos agrupados por grupo de resoluci├│n a lo largo del periodo."
          isLoading={isLoading}
          isEmpty={timeline.length === 0}
          emptyTitle={EMPTY_CHART_TITLE}
          error={null}
        >
          <EvolutionChart data={timeline} />
        </ChartFrame>

        <ChartFrame
          title="Distribuci├│n de resoluciones"
          description="Reparto de los casos auditados en el periodo."
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
          description="Cantidad de casos por cada resultado que puede emitir la auditor├¡a."
          isLoading={isLoading}
          isEmpty={byResult.length === 0}
          emptyTitle={EMPTY_CHART_TITLE}
          error={null}
        >
          <ResultsBreakdownChart data={byResult} />
        </ChartFrame>
      </div>

      {/* Fila 4: casos recientes */}
      <div className="grid gap-6">
        <ChartFrame
          title="Casos recientes"
          description="Los ├║ltimos casos auditados del periodo seleccionado."
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
