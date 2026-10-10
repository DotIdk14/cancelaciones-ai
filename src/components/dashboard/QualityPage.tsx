// =============================================================================
// Calidad: qué tan bien está auditando la IA y con qué evidencia.
//
// ESTA PANTALLA EMPEZABA EN SU REGLA, Y TODA SU ESTRUCTURA SALE DE AHÍ:
// no existe revisión humana en ninguna tabla. `cases` y `audits` no guardan quién
// revisó un dictamen, ni la resolución que una persona dio, ni una corrección
// posterior. Así que la mitad "humana" de la calidad no se puede CALCULAR.
//
// La tentación sería rellenar los huecos con ceros y pintar "Coincidencia IA /
// humano: 0 %". Eso es FALSO: no significa que la IA falle siempre, significa
// que nadie la ha comparado con un humano. Por eso:
//
//   1. Las tres primeras tarjetas muestran `DASH` ("—") en `tone="neutral"`, con
//      una pista que dice qué falta, y NUNCA un porcentaje de cero.
//   2. Los dos paneles que dependen de revisión humana muestran su estado vacío
//      con `emptyTitle="Todavía no hay datos suficientes."` y una descripción que
//      explica qué habría que registrar.
//   3. Arriba del todo va un aviso que dice, en palabras del servidor, POR QUÉ
//      están vacías. Sin ese aviso, un "—" sin explicación parece un fallo de
//      carga; con él, se lee como una limitación conocida del sistema.
//
// Lo que SÍ es real, y por eso tiene las dos gráficas de la fila 3: la
// confianza que declaró el modelo en cada dictamen, y cómo se comporta cuando
// falta evidencia. Esa es la versión honesta de "¿baja la calidad cuando faltan
// evidencias?".
// =============================================================================

import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { ChevronDown, Gauge, Info, Scale, UserCheck } from 'lucide-react';
import type {
  DashboardFilters as DashboardFiltersValue,
  QualityReport,
} from '../../lib/dashboard';
import { defaultDateRange } from '../../lib/dashboard';
import { DASH, formatPercent } from '../../lib/format';
import { CONFIDENCE_HIGH_THRESHOLD, resolutionLabel } from '../../lib/labels';
import { useAiQuality } from '../../lib/useDashboard';
import { Badge, ChartFrame, ErrorCard, Skeleton, StatCard } from '../ui';
import { DashboardFilters } from './DashboardFilters';
import { ConfidenceBandsChart } from './charts/ConfidenceBandsChart';
import { ConfidenceByEvidenceChart } from './charts/ConfidenceByEvidenceChart';

const ICON_PROPS = { size: 18, 'aria-hidden': true } as const;

/** Enteros con separador de miles en el formato local. */
const INT_FMT = new Intl.NumberFormat('es-EC');

/**
 * Estado vacío de los paneles SIN dato. Deliberadamente distinto del
 * `EMPTY_CHART_TITLE` de las otras vistas ("No hay suficientes datos para este
 * periodo"): aquí no es que falten datos del periodo, es que el sistema no
 * registra el dato. Confundir los dos mensajes sería tapar justo lo que esta
 * pantalla tiene que hacer visible.
 */
const EMPTY_TITLE = 'Todavía no hay datos suficientes.';

/** Qué haría falta para que "IA vs resolución humana" tuviera contenido. */
// -----------------------------------------------------------------------------
// Aviso de datos humanos ausentes
// -----------------------------------------------------------------------------

/**
 * Explica por qué las tres primeras tarjetas están vacías.
 *
 * `tone="neutral"` y `bg-surface-2`, NO `danger`: no es un error ni un fallo, es
 * una limitación conocida del sistema. Pintarlo en rojo haría que la gente
 * buscara un problema que no existe (o que arreglara algo que no está roto).
 *
 * El texto NO se redacta aquí: es `humanReview.message`, que viene del servidor
 * para que la explicación de por qué falta un dato viva junto al cálculo que la
 * produce, y no se desincronice si algún día cambia.
 */
function HumanReviewNotice({ report }: { report: QualityReport | null }): ReactNode {
  const message = report?.humanReview.message;
  if (message === undefined) return null;

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-line bg-surface-2 p-4">
      <div className="flex min-w-0 items-start gap-3">
        <Info size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-muted" />
        <p className="max-w-3xl text-sm text-muted">{message}</p>
      </div>
      <Badge tone="neutral" className="shrink-0">
        {report?.humanReview.available ? 'Revisión humana registrada' : 'Sin revisión humana'}
      </Badge>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Tarjetas sin dato
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Página
// -----------------------------------------------------------------------------

export function QualityPage(): ReactNode {
  const [filters, setFilters] = useState<DashboardFiltersValue>(defaultDateRange);
  const { data, isLoading, error, reload } = useAiQuality(filters);

  // Un error global no debe vaciar la pantalla: se muestra arriba y el resto de
  // la página sigue mostrando lo último conocido o su propio estado vacío.
  const handleRetry = useCallback((): void => {
    reload();
  }, [reload]);

  const confidence = data?.confidence;
  const humanReview = data?.humanReview ?? null;
  const bands = confidence?.bands ?? [];
  const byEvidence = confidence?.confidenceByMissingEvidence ?? [];

  const showSkeleton = isLoading && data === null;
  // Sin confianza declarada no hay media que promediar: `DASH`, no `0 %`.
  const avgConfidence = showSkeleton ? null : (confidence?.avgConfidence ?? null);

  // El rango mostrado es el que resolvió el servidor (`report.filters`), no el del
  // control: si difieren, las cifras corresponden al otro.
  const applied = data?.filters ?? filters;

  // Ambos `aria-label` dicen QUÉ se mide y SOBRE QUÉ, con los números dentro: el
  // texto alternativo de una gráfica tiene que poder sustituirla, no describirla.
  const bandsAriaLabel =
    `Distribución de la confianza declarada por el modelo en ${INT_FMT.format(confidence?.auditedCases ?? 0)} ` +
    `dictamen(es) del periodo del ${applied.from} al ${applied.to}: ` +
    `${bands.map((band) => `${band.label} ${band.count}`).join(', ')}.`;
  const byEvidenceAriaLabel =
    'Confianza media del modelo según la evidencia que falta en el expediente, con el umbral de ' +
    `alta confianza marcado en el ${formatPercent(CONFIDENCE_HIGH_THRESHOLD)}. ` +
    `${byEvidence.map((bucket) => `${bucket.label}: ${bucket.avgConfidence === null ? 'sin datos' : formatPercent(bucket.avgConfidence)}`).join('; ')}.`;

  return (
    <div className="dashboard-page quality-page flex flex-col gap-5">
      {/* Fila 0: título + filtros */}
      <section className="dashboard-toolbar quality-toolbar">
        <header className="dashboard-page-heading">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">Calibración y calidad auditora</h1>
            <p className="mt-1 text-sm text-muted">
              Qué tan bien está auditando la IA y con qué evidencia.
            </p>
          </div>
        </header>
        <DashboardFilters value={filters} onChange={setFilters} />
      </section>

      {/* Aviso de por qué las tres primeras tarjetas están vacías. Va lo PRIMERO
          después del header, por encima incluso del error: es una propiedad
          permanente de esta vista, no un estado transitorio, y sin él los `—` de
          abajo se leen como un fallo de carga en lugar de como un dato que el
          sistema no registra. Con el error de validación los datos anteriores se
          descartan, así que aquí no se pinta nada y solo queda el `ErrorCard`. */}
      <HumanReviewNotice report={data} />

      {error !== null && (
        <ErrorCard
          title="No se pudo cargar el informe de calidad"
          message={error}
          onRetry={handleRetry}
          retrying={isLoading}
        />
      )}

      {/* Fila 1: KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {showSkeleton ? (
          Array.from({ length: 4 }, (_, i) => (
            <StatCard
              key={i}
              label="Cargando"
              value={<Skeleton className="h-8 w-24" />}
              isLoading
            />
          ))
        ) : (
          <>
            <StatCard
              label="Casos revisados por persona"
              tone="neutral"
              icon={<UserCheck {...ICON_PROPS} />}
              value={humanReview === null ? DASH : humanReview.reviewedCases}
              hint={humanReview?.available ? 'Revisiones enlazadas a la auditoría filtrada' : 'Sin revisiones en este periodo'}
            />
            <StatCard
              label="Acuerdos"
              tone="success"
              icon={<Scale {...ICON_PROPS} />}
              value={humanReview === null ? DASH : humanReview.agreements}
              hint={humanReview === null ? 'Sin datos' : `${humanReview.comparableReviews} revisiones comparables`}
            />
            <StatCard
              label="Discrepancias"
              tone="warning"
              icon={<Scale {...ICON_PROPS} />}
              value={humanReview === null ? DASH : humanReview.disagreements}
              hint="Resultado humano distinto al de la auditoría referenciada"
            />
            {/* Esta sí es real: la confianza que declaró el modelo. */}
            <StatCard
              label="Confianza promedio"
              tone="brand"
              icon={<Gauge {...ICON_PROPS} />}
              value={avgConfidence === null ? <span className="text-muted">{DASH}</span> : formatPercent(avgConfidence)}
              hint={
                avgConfidence === null
                  ? 'Sin confianza declarada'
                  : `${INT_FMT.format(confidence?.auditedCases ?? 0)} dictamen(s) con confianza`
              }
            />
          </>
        )}
      </div>

      {/* Fila 2: comparaciones humanas */}
      <div className="grid gap-6">
        {data?.truncated === true && (
          <div className="lg:col-span-2">
            <Badge tone="warning">Se muestran los casos más recientes del periodo</Badge>
          </div>
        )}

        <ChartFrame
          title="Acuerdos y discrepancias"
          description="Consulta los dictámenes donde la comparación reportó una discrepancia."
          height={360}
          isLoading={showSkeleton}
          isEmpty={!showSkeleton && !humanReview?.available}
          emptyTitle="Sin revisiones humanas en este periodo."
          emptyDescription="No se fabrican acuerdos ni discrepancias mientras no existan revisiones."
          error={null}
        >
          {humanReview?.available ? (
            <div className="flex h-full flex-col gap-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-sm text-muted">Porcentaje de discrepancia</span>
                <strong className="text-xl tabular-nums text-ink">
                  {humanReview.agreements + humanReview.disagreements === 0
                    ? DASH
                    : formatPercent(humanReview.disagreements / (humanReview.agreements + humanReview.disagreements))}
                </strong>
                <span className="w-full text-xs text-muted">
                  Sobre {humanReview.agreements + humanReview.disagreements} comparaciones clasificadas
                </span>
              </div>
              <details className="quality-discrepancy-menu">
                <summary>
                  <span>Ver discrepancias ({humanReview.discrepancies.length}{humanReview.discrepanciesTruncated ? '+' : ''})</span>
                  <ChevronDown size={16} aria-hidden="true" />
                </summary>
                <div className="quality-discrepancy-list">
                  {humanReview.discrepancies.length === 0 ? (
                    <p className="text-sm text-muted">No hay discrepancias con ambas resoluciones disponibles en este periodo.</p>
                  ) : humanReview.discrepancies.map((item) => (
                    <article key={`${item.caseId}:${item.createdAt}`} className="quality-discrepancy-row">
                      <span className="text-xs text-muted">Expediente {item.caseId.slice(0, 8)}</span>
                      <dl>
                        <div><dt>Resolución IA</dt><dd>{resolutionLabel(item.aiResolution)}</dd></div>
                        <div><dt>Resolución humana</dt><dd>{resolutionLabel(item.humanResolution)}</dd></div>
                      </dl>
                    </article>
                  ))}
                  {humanReview.discrepanciesTruncated && (
                    <p className="px-3 py-2 text-xs text-muted">Se muestran las 100 discrepancias más recientes.</p>
                  )}
                </div>
              </details>
            </div>
          ) : <div />}
        </ChartFrame>
      </div>

      {/* Fila 3: los dos paneles con datos reales */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartFrame
          title="Distribución de confianza"
          description="Banda en la que cayó la confianza declarada por el modelo en cada dictamen del periodo."
          height={300}
          isLoading={showSkeleton}
          // `bands` llega siempre con las 3, así que el único estado vacío posible
          // es que no haya llegado nada todavía: de ahí el chequeo de longitud.
          isEmpty={!showSkeleton && bands.length === 0}
          emptyTitle={EMPTY_TITLE}
          emptyDescription="Ningún dictamen del periodo declaró confianza, así que no hay bandas que repartir."
          error={null}
        >
          <ConfidenceBandsChart data={bands} ariaLabel={bandsAriaLabel} />
        </ChartFrame>

        <ChartFrame
          title="Confianza según evidencia faltante"
          description="Confianza media del modelo por cantidad de evidencias ausentes en el expediente."
          height={300}
          isLoading={showSkeleton}
          isEmpty={!showSkeleton && byEvidence.length === 0}
          emptyTitle={EMPTY_TITLE}
          emptyDescription="Ningún dictamen del periodo declaró cuántas evidencias le faltaban."
          error={null}
        >
          <ConfidenceByEvidenceChart data={byEvidence} ariaLabel={byEvidenceAriaLabel} />
        </ChartFrame>
      </div>
    </div>
  );
}

