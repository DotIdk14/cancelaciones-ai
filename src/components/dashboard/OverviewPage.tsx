// =============================================================================
// Resumen (dashboard). Vista agregada del producto.
//
// La página solo orquesta: pide el agregado con `useDashboard` y lo pinta.
// No calcula porcentajes, no agrupa resultados y no reinterpretan el dictamen:
// esos valores llegan ya resueltos desde el servidor.
// =============================================================================

import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { Ban, CircleCheck, FileQuestion, FileWarning, Files, Scale, TriangleAlert } from 'lucide-react';
import type { DashboardFilters as DashboardFiltersValue, KpiKey } from '../../lib/dashboard';
import { defaultDateRange, KPI_PCT } from '../../lib/dashboard';
import { formatPercent } from '../../lib/format';
import { useDashboard } from '../../lib/useDashboard';
import { Badge, ChartFrame, ErrorCard, Skeleton, StatCard } from '../ui';
import { DashboardFilters } from './DashboardFilters';
import { RecentCasesTable } from './RecentCasesTable';
import { EvolutionChart } from './charts/EvolutionChart';
import { OriginBreakdownChart } from './charts/OriginBreakdownChart';
import { ResolutionDonut } from './charts/ResolutionDonut';
import { ResultsBreakdownChart } from './charts/ResultsBreakdownChart';
import type { OriginBreakdownPoint } from '../../lib/dashboard';
import type { Tone } from '../ui';

const ICON_PROPS = { size: 18, 'aria-hidden': true } as const;

/**
 * `true` cuando no hay nada que graficar: sin puntos, o con "Sin determinar" como
 * único punto. Un gráfico de una sola barra "Sin determinar" no informa nada; el
 * estado vacío sí dice que el origen no es determinable.
 */
function isOnlyUndetermined(points: OriginBreakdownPoint[]): boolean {
  return points.length === 0 || (points.length === 1 && points[0]?.value === 'Sin determinar');
}

interface KpiCard {
  key: KpiKey;
  label: string;
  tone: Tone;
  icon: ReactNode;
  /** `false` solo para "Casos auditados": es el denominador, no lleva %. */
  withPct: boolean;
}

type PercentageKpiCard = KpiCard & { key: Exclude<KpiKey, 'auditedCases'> };
function isPercentageKpi(card: KpiCard): card is PercentageKpiCard {
  return card.key !== 'auditedCases';
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
  { key: 'needsRuling', label: 'Requiere dictaminación', tone: 'warning', icon: <Scale {...ICON_PROPS} />, withPct: true },
  { key: 'rejected', label: 'Rechazados', tone: 'danger', icon: <Ban {...ICON_PROPS} />, withPct: true },
  { key: 'insufficient', label: 'Evidencia insuficiente', tone: 'brand', icon: <FileQuestion {...ICON_PROPS} />, withPct: true },
  { key: 'errors', label: 'Errores', tone: 'danger', icon: <TriangleAlert {...ICON_PROPS} />, withPct: true },
];
const ATTENTION_KPIS: ReadonlySet<KpiKey> = new Set(['casesWithMissingEvidence', 'needsRuling', 'errors']);

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

  const kpi = data?.kpi;
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
            Actividad, resultados y expedientes recientes del periodo seleccionado.
          </p>
        </div>
      </header>

      <section className="dashboard-toolbar" aria-label="Filtros del resumen">
        <DashboardFilters value={filters} onChange={setFilters} />
      </section>

      {error !== null && (
        <ErrorCard
          title="No se pudo cargar el resumen"
          message={error}
          onRetry={handleRetry}
          retrying={isLoading}
        />
      )}

      {/* Las cifras que requieren acción quedan juntas y las resoluciones se leen
          como contexto. Se conservan exactamente los agregados del servidor. */}
      <section className="overview-kpi-layout" aria-label="Indicadores operativos">
        <div className="overview-kpi-primary">
          <StatCard
            label="Casos auditados"
            tone="neutral"
            icon={<Files {...ICON_PROPS} />}
            value={isLoading || kpi === undefined ? <Skeleton className="h-8 w-20" /> : kpi.auditedCases}
            className="overview-total-card"
          />
          <div className="overview-attention-grid" aria-label="Casos que requieren atención">
            {KPI_CARDS.filter((card): card is PercentageKpiCard => isPercentageKpi(card) && ATTENTION_KPIS.has(card.key)).map((card) => {
              const value = kpi?.[card.key];
              const pctKey = KPI_PCT[card.key];
              return (
                <StatCard
                  key={card.key}
                  label={card.label}
                  tone={card.tone}
                  icon={card.icon}
                  value={isLoading || value === undefined ? <Skeleton className="h-8 w-20" /> : value}
                  hint={isLoading || kpi === undefined ? <Skeleton className="mt-2 h-3 w-14" /> : `${formatPercent(kpi[pctKey])} del total`}
                />
              );
            })}
          </div>
        </div>
        <div className="overview-kpi-secondary">
          <div className="overview-outcome-grid">
            {KPI_CARDS.filter((card): card is PercentageKpiCard => isPercentageKpi(card) && !ATTENTION_KPIS.has(card.key)).map((card) => {
              const value = kpi?.[card.key];
              const pctKey = KPI_PCT[card.key];
              return (
                <StatCard
                  key={card.key}
                  label={card.label}
                  tone={card.tone}
                  icon={card.icon}
                  value={isLoading || value === undefined ? <Skeleton className="h-8 w-20" /> : value}
                  hint={
                    isLoading || kpi === undefined
                      ? <Skeleton className="mt-2 h-3 w-14" />
                      : `${formatPercent(kpi[pctKey])} del total`
                  }
                />
              );
            })}
          </div>
        </div>
      </section>

      {/* Fila 2: evolución + distribución */}
      <div className="grid gap-6 lg:grid-cols-2">
        {data?.truncated === true && (
          <div className="lg:col-span-2">
            <Badge tone="warning">Se muestran los casos más recientes del periodo</Badge>
          </div>
        )}

        <ChartFrame
          title="Evolución de casos"
          description="Casos agrupados por grupo de resolución a lo largo del periodo."
          isLoading={isLoading}
          isEmpty={timeline.length === 0}
          emptyTitle={EMPTY_CHART_TITLE}
          error={null}
        >
          <EvolutionChart data={timeline} />
        </ChartFrame>

        <ChartFrame
          title="Distribución de resoluciones"
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
          description="Cantidad de casos por cada resultado que puede emitir la auditoría."
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
