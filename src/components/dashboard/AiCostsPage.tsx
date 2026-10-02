// =============================================================================
// IA & Costos: cuánto cuesta el modelo, cuánto consume y con qué fiabilidad
// responde en el periodo seleccionado.
//
// La página solo orquesta: pide el informe con `useAiCosts` y lo pinta. No
// calcula un precio, no promedia tokens y NO reinterpreta la fiabilidad del
// backend: esos valores llegan ya resueltos.
//
// DOS REGLAS QUE ESTA PANTALLA RESPETA Y QUE NO SON DEGALLES:
//   1. `reliability` NO es una partición. `successful`, `retried`, `fallback` y
//      `failed` se solapan (una auditoría completada tras un reintento cuenta
//      como exitosa Y como reintentada), así que NO se suman en ningún sitio.
//   2. Un modelo sin ninguna llamada con coste conocido tiene un coste
//      DESCONOCIDO, no cero. Se pinta `DASH`, jamás `$0.0000`.
// =============================================================================

import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { Binary, Coins, Receipt, Timer } from 'lucide-react';
import type {
  AiCostsReport,
  CostGranularity,
  DashboardFilters as DashboardFiltersValue,
  ModelCostRow,
} from '../../lib/dashboard';
import { defaultDateRange, hasKnownModelCost } from '../../lib/dashboard';
import type { Tone } from '../ui';
import { Badge, Button, ChartFrame, DataTable, EmptyState, ErrorCard, Panel, Skeleton, StatCard } from '../ui';
import { DASH, formatCost, formatLatency, formatPercent } from '../../lib/format';
import { useAiCosts } from '../../lib/useDashboard';
import { DashboardFilters } from './DashboardFilters';
import { CostOverTimeChart } from './charts/CostOverTimeChart';

const ICON_PROPS = { size: 18, 'aria-hidden': true } as const;

/** Enteros con separador de miles en el formato local. */
const INT_FMT = new Intl.NumberFormat('es-EC');

const EMPTY_TITLE = 'No hay suficientes datos para este periodo.';

// -----------------------------------------------------------------------------
// Granularidad
// -----------------------------------------------------------------------------

/** Etiquetas del selector. El valor viaja tal cual a `?granularity=`. */
const GRANULARITIES: ReadonlyArray<{ value: CostGranularity; label: string }> = [
  { value: 'day', label: 'Día' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mes' },
];

/**
 * Cómo se nombra y con qué forma se escribe la clave de cada periodo. No se
 * parsea ni se convierte a fecha: solo se documenta la forma para que quien lee
 * el eje X sepa qué significa `2026-W40`.
 */
const BUCKET_FORMAT: Record<CostGranularity, string> = {
  day: 'día (YYYY-MM-DD)',
  week: 'semana ISO (YYYY-Www)',
  month: 'mes (YYYY-MM)',
};

/** Título de la serie según la granularidad elegida. */
const SERIES_TITLE: Record<CostGranularity, string> = {
  day: 'Costo por día',
  week: 'Costo por semana',
  month: 'Costo por mes',
};

/**
 * Grupo de tres botones con `aria-pressed`. Un `role="group"` (no un `select`)
 * porque son tres opciones excluyentes de un control compacto y el estado
 * activo tiene que verse, no quedar escondido hasta abrir el control.
 */
function GranularityPicker({
  value,
  onChange,
}: {
  value: CostGranularity;
  onChange: (next: CostGranularity) => void;
}): ReactNode {
  return (
    <div role="group" aria-label="Granularidad del periodo" className="flex items-end gap-2">
      <span className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
        Agrupar coste por
      </span>
      {GRANULARITIES.map((option) => (
        <Button
          key={option.value}
          variant={value === option.value ? 'primary' : 'secondary'}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className="px-3 py-2"
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Fila 2b: tabla de coste por modelo
// -----------------------------------------------------------------------------

const TH_CLASS =
  'border-b border-line px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted';
const TH_NUM_CLASS = `${TH_CLASS} text-right`;
const TD_CLASS = 'border-b border-line/70 px-3 py-2.5 text-ink';
const TD_NUM_CLASS = `${TD_CLASS} text-right tabular-nums`;

/**
 * Celda de coste total. Si el modelo no tiene ninguna llamada con coste conocido
 * el dato NO es cero: es desconocido, y se dice con `DASH` y un aviso explícito
 * en lugar de imprimir un `$0.0000` que parecería un gasto real.
 */
function CostCell({ row }: { row: ModelCostRow }): ReactNode {
  if (hasKnownModelCost(row)) return <>{formatCost(row.totalCostUsd)}</>;
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      <span className="text-muted">{DASH}</span>
      <Badge tone="warning" title="Ninguna llamada a este modelo informó coste de uso.">
        Coste no reportado
      </Badge>
    </span>
  );
}

function ModelCostTable({ rows }: { rows: ModelCostRow[] }): ReactNode {
  if (rows.length === 0) return <EmptyState title={EMPTY_TITLE} />;

  return (
    <DataTable caption="Costo por modelo">
      <thead>
        <tr>
          <th scope="col" className={TH_CLASS}>
            Modelo
          </th>
          <th scope="col" className={TH_NUM_CLASS}>
            Llamadas
          </th>
          <th scope="col" className={TH_NUM_CLASS}>
            Costo total
          </th>
          <th scope="col" className={TH_NUM_CLASS}>
            Costo promedio
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const known = hasKnownModelCost(row);
          return (
            <tr key={row.model}>
              {/* `break-all`: los ids de modelo (`proveedor/nombre-largo`) no
                  tienen espacios donde cortar y desbordarían la celda. */}
              <td className={TD_CLASS}>
                <span className="break-all font-mono text-sm">{row.model}</span>
              </td>
              <td className={TD_NUM_CLASS}>{INT_FMT.format(row.calls)}</td>
              <td className={TD_NUM_CLASS}>
                <CostCell row={row} />
              </td>
              <td className={TD_NUM_CLASS}>
                {known ? formatCost(row.avgCostUsd) : <span className="text-muted">{DASH}</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </DataTable>
  );
}

// -----------------------------------------------------------------------------
// Fila 3: tokens, latencia y fiabilidad
// -----------------------------------------------------------------------------

/** Una magnitud de tokens con su barra de proporción en CSS. */
function TokenRow({ label, value, ratio }: { label: string; value: number; ratio: number }): ReactNode {
  const pct = Math.round(ratio * 100);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
        <span className="text-xs text-muted">{formatPercent(ratio)}</span>
      </div>
      <div className="text-2xl font-bold text-ink">{INT_FMT.format(value)}</div>
      <div
        role="img"
        aria-label={`${label}: ${INT_FMT.format(value)} tokens, ${pct} % del total`}
        className="h-2 w-full overflow-hidden rounded-full bg-surface-3"
      >
        <div className="h-2 rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function TokensPanel({ report }: { report: AiCostsReport | null }): ReactNode {
  const kpi = report?.kpi;
  if (kpi === undefined || !kpi.tokensAvailable) return <EmptyState title={EMPTY_TITLE} />;

  const total = kpi.totalTokens;
  // `totalTokens` es la suma de ambos, pero se protege el caso 0 para que la
  // barra no se calcule con una división por cero.
  const safeTotal = total > 0 ? total : 1;

  return (
    <div className="flex flex-col gap-5">
      <TokenRow label="Input" value={kpi.promptTokens} ratio={kpi.promptTokens / safeTotal} />
      <TokenRow label="Output" value={kpi.completionTokens} ratio={kpi.completionTokens / safeTotal} />
    </div>
  );
}

interface LatencyRow {
  label: string;
  value: number | null;
}

function LatencyPanel({ report }: { report: AiCostsReport | null }): ReactNode {
  const kpi = report?.kpi;
  if (kpi === undefined || !kpi.latencyAvailable) return <EmptyState title={EMPTY_TITLE} />;

  const rows: LatencyRow[] = [
    { label: 'Promedio', value: kpi.avgLatencyMs },
    { label: 'P50', value: kpi.p50LatencyMs },
    { label: 'P95', value: kpi.p95LatencyMs },
  ];

  return (
    <div className="flex flex-col gap-3">
      <dl className="flex flex-col gap-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted">{row.label}</dt>
            <dd className="text-2xl font-bold text-ink">{formatLatency(row.value)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted">
        P95 es el tiempo por debajo del cual respondió el 95 % de las auditorías del periodo: es la
        cola lenta, no un promedio. P50 es la mediana, el caso típico.
      </p>
    </div>
  );
}

interface ReliabilityRow {
  label: string;
  tone: Tone;
  hint: string;
}

const RELIABILITY_ROWS: ReadonlyArray<ReliabilityRow & { key: 'successful' | 'retried' | 'fallback' | 'failed' }> = [
  { key: 'successful', label: 'Exitosas', tone: 'success', hint: 'Auditorías completadas.' },
  { key: 'retried', label: 'Reintentos', tone: 'warning', hint: 'Auditorías que reintentaron dentro de la llamada.' },
  { key: 'fallback', label: 'Fallback', tone: 'brand', hint: 'Auditorías que probaron más de un modelo.' },
  { key: 'failed', label: 'Fallos', tone: 'danger', hint: 'Auditorías que terminaron en error.' },
];

function ReliabilityPanel({ report }: { report: AiCostsReport | null }): ReactNode {
  const reliability = report?.reliability;
  if (reliability === undefined || (report?.kpi.auditsCounted ?? 0) === 0) {
    return <EmptyState title={EMPTY_TITLE} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <dl className="flex flex-col gap-2">
        {RELIABILITY_ROWS.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted" title={row.hint}>
              {row.label}
            </dt>
            <dd>
              <Badge tone={row.tone}>{INT_FMT.format(reliability[row.key])}</Badge>
            </dd>
          </div>
        ))}
      </dl>
      {/* La aclaración es obligatoria: sin ella, cuatro números en fila se leen
          como un reparto y la gente los suma. */}
      <p className="text-xs text-muted">
        Estas métricas no suman un total: una auditoría completada tras un reintento cuenta como
        exitosa y como reintentada.
      </p>
      <div className="mt-2 border-t border-line pt-3">
        <h3 className="text-sm font-semibold text-ink">Resultado técnico excluyente</h3>
        {!reliability.executionOutcomes.available ? (
          <p className="mt-2 text-xs text-muted">
            No disponible: los intentos registrados no permiten separar con fiabilidad los resultados.
          </p>
        ) : (
          <>
            <dl className="mt-2 flex flex-col gap-2">
              <OutcomeRow label="Exitosa al primer intento" value={reliability.executionOutcomes.successfulFirstAttempt} tone="success" />
              <OutcomeRow label="Exitosa tras reintento" value={reliability.executionOutcomes.successfulAfterRetry} tone="warning" />
              <OutcomeRow label="Fallback de modelo" value={reliability.executionOutcomes.fallback} tone="brand" />
              <OutcomeRow label="Fallida" value={reliability.executionOutcomes.failed} tone="danger" />
              <OutcomeRow label="En curso" value={reliability.executionOutcomes.inProgress} tone="neutral" />
            </dl>
            <p className="mt-2 text-xs text-muted">
              Las categorías son mutuamente excluyentes y describen ejecución técnica; no indican si se concedió una cancelación.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function OutcomeRow({ label, value, tone }: { label: string; value: number | null; tone: Tone }): ReactNode {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd>{value === null ? <Badge tone="neutral">No disponible</Badge> : <Badge tone={tone}>{INT_FMT.format(value)}</Badge>}</dd>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Página
// -----------------------------------------------------------------------------

export function AiCostsPage(): ReactNode {
  const [filters, setFilters] = useState<DashboardFiltersValue>(defaultDateRange);
  const [granularity, setGranularity] = useState<CostGranularity>('day');
  const { data, isLoading, error, reload } = useAiCosts(filters, granularity);

  // Un error global no debe vaciar la pantalla: se muestra arriba y el resto de
  // la página sigue mostrando lo último conocido o su propio estado vacío.
  const handleRetry = useCallback((): void => {
    reload();
  }, [reload]);

  const kpi = data?.kpi;
  const costSeries = data?.costSeries ?? [];
  const byModel = data?.byModel ?? [];
  // El rango mostrado es el que el servidor resolvió (`report.filters`), no el
  // del control: si difieren, la cifra corresponde al otro.
  const applied = data?.filters ?? filters;

  // El rango se muestra tal cual (`YYYY-MM-DD`), NO con `formatDate`: las
  // fechas de los filtros son fecha-sin-hora y `new Date('2026-09-28')` se
  // interpreta como UTC medianoche, que en un huso negativo se ve como el día
  // ANTERIOR. El texto crudo coincide exactamente con el control de fecha y con
  // lo que devolvió el servidor, así que no puede mentir por una zona horaria.
  const chartAriaLabel = `Costo de las auditorías de IA en el periodo del ${applied.from} al ${applied.to}, agrupado por ${BUCKET_FORMAT[granularity]}.`;

  return (
    <div className="flex flex-col gap-6">
      {/* Fila 0: título + filtros */}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">IA &amp; Costos</h1>
          <p className="mt-1 text-sm text-muted">
            Cuánto cuesta usar el modelo y con qué fiabilidad responde en el periodo seleccionado.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <DashboardFilters value={filters} onChange={setFilters} />
          <GranularityPicker value={granularity} onChange={setGranularity} />
        </div>
      </header>

      {error !== null && (
        <ErrorCard
          title="No se pudieron cargar los costos de IA"
          message={error}
          onRetry={handleRetry}
          retrying={isLoading}
        />
      )}

      {/* Fila 1: KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Costo total IA"
          tone="brand"
          icon={<Coins {...ICON_PROPS} />}
          value={isLoading || kpi === undefined ? <Skeleton className="h-8 w-24" /> : kpi.costAvailable ? formatCost(kpi.totalCostUsd) : DASH}
          hint={
            isLoading || kpi === undefined ? (
              <Skeleton className="mt-2 h-3 w-32" />
            ) : kpi.costAvailable ? (
              `${INT_FMT.format(kpi.auditsCounted)} auditorías en el periodo`
            ) : (
              'Sin datos de coste reportados'
            )
          }
        />
        <StatCard
          label="Costo promedio por caso"
          tone="brand"
          icon={<Receipt {...ICON_PROPS} />}
          value={isLoading || kpi === undefined ? <Skeleton className="h-8 w-24" /> : kpi.costAvailable ? formatCost(kpi.avgCostPerCaseUsd) : DASH}
          hint={
            isLoading || kpi === undefined ? (
              <Skeleton className="mt-2 h-3 w-28" />
            ) : kpi.costAvailable ? (
              `${INT_FMT.format(kpi.casesCounted)} casos con coste medido`
            ) : (
              'Sin datos de coste reportados'
            )
          }
        />
        <StatCard
          label="Tokens consumidos"
          tone="neutral"
          icon={<Binary {...ICON_PROPS} />}
          value={isLoading || kpi === undefined ? <Skeleton className="h-8 w-24" /> : kpi.tokensAvailable ? INT_FMT.format(kpi.totalTokens) : DASH}
          hint={
            isLoading || kpi === undefined ? (
              <Skeleton className="mt-2 h-3 w-28" />
            ) : (
              `${INT_FMT.format(kpi.auditsCounted)} auditorías`
            )
          }
        />
        <StatCard
          label="Tiempo promedio de respuesta"
          tone="neutral"
          icon={<Timer {...ICON_PROPS} />}
          value={isLoading || kpi === undefined ? <Skeleton className="h-8 w-24" /> : formatLatency(kpi.latencyAvailable ? kpi.avgLatencyMs : null)}
          hint={
            isLoading || kpi === undefined ? (
              <Skeleton className="mt-2 h-3 w-28" />
            ) : kpi.latencyAvailable ? (
              'P50 y P95 en el panel de latencia'
            ) : (
              'Sin datos de latencia'
            )
          }
        />
      </div>

      {/* Fila 2: serie de coste + coste por modelo */}
      <div className="grid gap-6 lg:grid-cols-2">
        {data?.truncated === true && (
          <div className="lg:col-span-2">
            <Badge tone="warning">Se muestran los casos más recientes del periodo</Badge>
          </div>
        )}

        <ChartFrame
          title={SERIES_TITLE[granularity]}
          description={`Coste de las auditorías de IA, agrupado por ${BUCKET_FORMAT[granularity]}.`}
          isLoading={isLoading}
          isEmpty={costSeries.length === 0}
          emptyTitle={EMPTY_TITLE}
          error={null}
        >
          <div className="flex h-full flex-col justify-between gap-2">
            <div className="min-h-0 flex-1">
              <CostOverTimeChart data={costSeries} ariaLabel={chartAriaLabel} />
            </div>
            {/* Rótulo legible del rango realmente aplicado. La clave del eje se
                muestra tal cual (el backend la define) y aquí se aclara qué
                periodo representa, que es lo que el eje no puede decir solo. */}
            <p className="shrink-0 text-xs text-muted">
              Rango aplicado: {applied.from} – {applied.to}. Cada rótulo del eje es una clave de{' '}
              {BUCKET_FORMAT[granularity]}.
            </p>
          </div>
        </ChartFrame>

        <Panel
          title="Costo por modelo"
          description="Llamadas y gasto por cada modelo usado en el periodo."
        >
          {isLoading && byModel.length === 0 ? (
            <Skeleton height={260} />
          ) : (
            <ModelCostTable rows={byModel} />
          )}
        </Panel>
      </div>

      {/* Fila 3: tokens, latencia y fiabilidad */}
      <div className="grid gap-6 md:grid-cols-3">
        <Panel title="Tokens" description="Reparto entre entrada y salida del modelo.">
          {isLoading && data === null ? <Skeleton height={160} /> : <TokensPanel report={data} />}
        </Panel>
        <Panel title="Latencia" description="Tiempo de respuesta de la auditoría.">
          {isLoading && data === null ? <Skeleton height={160} /> : <LatencyPanel report={data} />}
        </Panel>
        <Panel title="Errores y reintentos" description="Cómo termina cada auditoría.">
          {isLoading && data === null ? <Skeleton height={160} /> : <ReliabilityPanel report={data} />}
        </Panel>
      </div>
    </div>
  );
}
