import type { ReactNode } from 'react';
import { useState } from 'react';
import type { DashboardFilters as Filters } from '../../lib/dashboard';
import { defaultDateRange } from '../../lib/dashboard';
import type { QualityCase } from '../../lib/dashboard-metrics-contracts';
import { DASH, formatPercent } from '../../lib/format';
import { resolutionLabel } from '../../lib/labels';
import { useAiQuality } from '../../lib/useDashboard';
import { Button, ChartFrame, ErrorCard, Panel, Skeleton, StatCard } from '../ui';
import { DashboardFilters } from './DashboardFilters';
import { ConfidenceBandsChart } from './charts/ConfidenceBandsChart';
import { ConfidenceByEvidenceChart } from './charts/ConfidenceByEvidenceChart';

const percent = (value: number | null | undefined): string => value == null ? DASH : formatPercent(value);
const states: Record<string, string> = {
  AGREEMENT: 'Acuerdo final', DISAGREEMENT: 'Discrepancia final',
  PENDING_ADVISOR: 'Pendiente de Asesor', PENDING_COORDINATOR: 'Pendiente de Coordinador',
  PENDING_COMPARISON: 'Sin comparación final', COMPARISON_RUNNING: 'Comparación en curso',
  COMPARISON_ERROR: 'Comparación fallida', AUDIT_ERROR: 'Error técnico de auditoría',
  AUDIT_RUNNING: 'Auditoría en curso', INVALID_COMPARISON: 'Comparación sin resultado válido',
  PENDING_EVALUATION: 'Pendientes de evaluación', WITHOUT_CONFIDENCE: 'Sin confianza original', ISSUED: 'Dictámenes emitidos', FINALIZED: 'Evaluados humanamente',
};
const dateFormat = new Intl.DateTimeFormat('es-MX', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' });

function CasesTable({ rows }: { rows: QualityCase[] }): ReactNode {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(rows.length / 25));
  const current = Math.min(page, totalPages - 1);
  const visible = rows.slice(current * 25, (current + 1) * 25);
  return <>
    <div role="region" aria-label="Expedientes del indicador de calidad" tabIndex={0} className="overflow-x-auto">
      <table className="w-full text-left text-sm tabular-nums">
        <thead><tr className="border-b border-line text-muted">{['CaVe / caso', 'Responsable', 'Auditoría · UTC', 'Resolución IA', 'Confianza original', 'Propuesta Asesor', 'Final Coordinador', 'Comparación', 'Confianza comparación', 'Evaluación', 'Expediente'].map(label => <th key={label} scope="col" className="whitespace-nowrap px-3 py-3 font-medium">{label}</th>)}</tr></thead>
        <tbody>{visible.map(row => <tr key={row.auditId} className="border-b border-line text-ink">
          <td className="px-3 py-3">{row.identifier}</td><td className="px-3 py-3">{row.responsibleName ?? row.responsible ?? DASH}</td>
          <td className="whitespace-nowrap px-3 py-3">{dateFormat.format(new Date(row.auditedAt))}</td>
          <td className="px-3 py-3">{row.aiResolution ? resolutionLabel(row.aiResolution) : DASH}</td>
          <td className="px-3 py-3">{percent(row.originalConfidence)}</td>
          <td className="px-3 py-3">{row.advisorResolution ? resolutionLabel(row.advisorResolution) : DASH}</td>
          <td className="px-3 py-3">{row.finalResolution ? resolutionLabel(row.finalResolution) : DASH}</td>
          <td className="px-3 py-3">{row.substantiveAgreement === null ? DASH : row.substantiveAgreement ? 'Acuerdo' : 'Discrepancia'}</td>
          <td className="px-3 py-3">{percent(row.comparisonConfidence)}</td><td className="px-3 py-3">{states[row.state]}{row.aiResolution && row.latestExecutionStatus && row.latestExecutionStatus !== 'COMPLETED' && <p className="mt-1 text-xs text-muted">Última ejecución: {row.latestExecutionStatus === 'ERROR' ? 'error técnico' : 'en curso'}</p>}</td>
          <td className="px-3 py-3"><a className="text-brand underline underline-offset-4" href={`#/casos/${row.caseId}`} aria-label={`Abrir expediente ${row.identifier}`}>Abrir</a></td>
        </tr>)}</tbody>
      </table>
      {!rows.length && <p className="py-6 text-sm text-muted">No hay expedientes en el universo seleccionado.</p>}
    </div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
      <span>{rows.length} registros · Página {current + 1} de {totalPages}</span>
      <div className="flex gap-2"><Button variant="secondary" disabled={!current} onClick={() => setPage(current - 1)}>Anterior</Button><Button variant="secondary" disabled={current + 1 >= totalPages} onClick={() => setPage(current + 1)}>Siguiente</Button></div>
    </div>
  </>;
}

export function QualityPage(): ReactNode {
  const [filters, setFilters] = useState<Filters>(defaultDateRange);
  const [historical, setHistorical] = useState(false);
  const { data, isLoading, error, reload } = useAiQuality(filters);
  const e = data?.evaluation;
  const confidence = data?.confidence;
  const human = data?.humanReview;
  const loading = isLoading && !data;
  const applied = data?.filters ?? filters;
  const selectMetric = (evaluation: string): void => { setHistorical(false); setFilters({ ...filters, evaluation }); };
  const metrics = [
    { label: 'Dictámenes emitidos', value: e?.issued, filter: 'ISSUED', hint: 'Versiones vigentes con decisión válida' },
    { label: 'Evaluados humanamente', value: e?.finalized, filter: 'FINALIZED', hint: 'Resolución final del Coordinador' },
    { label: 'Acuerdos finales', value: e?.agreements, filter: 'AGREEMENT', hint: 'Acuerdo sustantivo del comparador' },
    { label: 'Discrepancias finales', value: e?.disagreements, filter: 'DISAGREEMENT', hint: 'Discrepancia sustantiva del comparador' },
    { label: 'Pendientes de evaluación', value: e?.pendingEvaluation, filter: 'PENDING_EVALUATION', hint: 'Sin resolución humana final comparable' },
    { label: 'Pendientes de Asesor', value: e?.rows.filter(row => row.state === 'PENDING_ADVISOR').length, filter: 'PENDING_ADVISOR', hint: 'Sin propuesta para esta versión' },
    { label: 'Pendientes de Coordinador', value: e?.rows.filter(row => row.state === 'PENDING_COORDINATOR').length, filter: 'PENDING_COORDINATOR', hint: 'La propuesta aún es provisional' },
    { label: 'Sin comparación final', value: e?.rows.filter(row => row.state === 'PENDING_COMPARISON').length, filter: 'PENDING_COMPARISON', hint: 'Finalizados, sin llamada de comparación' },
    { label: 'Comparaciones en curso', value: e?.rows.filter(row => row.state === 'COMPARISON_RUNNING').length, filter: 'COMPARISON_RUNNING', hint: 'Todavía sin acuerdo ni discrepancia' },
    { label: 'Comparaciones fallidas', value: e?.failedComparisons, filter: 'COMPARISON_ERROR', hint: 'Fuera del denominador de concordancia' },
    { label: 'Sin confianza disponible', value: e?.withoutConfidence, filter: 'WITHOUT_CONFIDENCE', hint: 'No equivale a confianza cero' },
  ];
  return <div className="dashboard-page quality-page flex flex-col gap-5" aria-busy={isLoading}>
    <section className="dashboard-toolbar quality-toolbar">
      <header className="dashboard-page-heading"><div><h1 className="text-2xl font-semibold tracking-tight text-ink">Calibración y calidad auditora</h1><p className="mt-1 text-sm text-muted">Concordancia con la resolución humana final · Producción · UTC.</p></div></header>
      <DashboardFilters value={filters} onChange={setFilters} />
      <label className="mt-3 block text-sm text-muted">Estado de evaluación
        <select className="mt-1 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink" value={filters.evaluation ?? ''} onChange={event => setFilters({ ...filters, evaluation: event.target.value || null })}>
          <option value="">Todos los estados</option>{Object.entries(states).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
    </section>
    {error && <ErrorCard title="No se pudo cargar el informe de calidad" message={error} onRetry={reload} retrying={isLoading} />}
    {human && <p className="text-sm text-muted">{human.message}</p>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Concordancia final" value={percent(e?.agreementRate)} hint={`${e?.agreements ?? 0} acuerdos / ${e?.validComparisons ?? 0} comparaciones finales válidas`} />
      <StatCard label="Cobertura de evaluación" value={percent(e?.coverageRate)} hint={`${e?.validComparisons ?? 0} comparaciones válidas / ${e?.issued ?? 0} dictámenes elegibles`} />
      <StatCard label="Confianza promedio original" value={percent(confidence?.avgConfidence)} hint={`${confidence?.auditedCases ?? 0} dictámenes con confianza válida`} />
      <StatCard label="Confianza de comparación" value={percent(human?.avgComparisonConfidence)} hint={`${e?.rows.filter(row => row.comparisonConfidence !== null).length ?? 0} comparaciones con confianza válida`} />
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Consultar expedientes de cada indicador">
      {metrics.map(metric => <div key={metric.filter} className="flex flex-col gap-2">
        <StatCard label={metric.label} value={loading ? <Skeleton className="h-8 w-20" /> : metric.value ?? DASH} hint={metric.hint} />
        <Button variant="secondary" className="text-sm" onClick={() => selectMetric(metric.filter)}>Ver {metric.label.toLowerCase()}</Button>
      </div>)}
    </div>
    <Panel title="Universo de evaluación" description={`Del ${applied.from} al ${applied.to} · Una versión vigente por expediente. Las versiones anteriores conservan sus decisiones y confianza.`}>
      <p className="mb-3 text-sm text-muted">{e?.pendingEvaluation ?? 0} pendientes de evaluación final. Última ejecución técnica: {e?.technicalErrors ?? 0} errores y {e?.runningAudits ?? 0} en curso. Un fallo posterior no borra un dictamen anterior.</p>
      <p className="mb-3 text-sm text-muted">Acuerdo exacto de códigos: {e?.exactAgreements ?? 0} / {e?.exactComparisons ?? 0} resoluciones finales ({percent(e?.exactComparisons ? e.exactAgreements / e.exactComparisons : null)}). Se mide por separado del acuerdo sustantivo.</p>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold text-ink">{historical ? 'Histórico de versiones del periodo' : 'Expedientes del indicador'}</h2><Button variant="secondary" onClick={() => setHistorical(!historical)}>{historical ? 'Ver dictamen vigente' : `Ver histórico (${e?.historicalVersions ?? 0})`}</Button></div>
      <CasesTable key={`${JSON.stringify(applied)}:${historical}`} rows={(historical ? e?.historicalRows : e?.rows) ?? []} />
    </Panel>
    <Panel title="Calibración observada" description="Confianza original y concordancia sobre la misma muestra evaluada. Una brecha positiva sugiere sobreconfianza; negativa, subconfianza. Las muestras pequeñas no permiten conclusiones firmes.">
      <div role="region" aria-label="Calibración por banda de confianza" tabIndex={0} className="overflow-x-auto">
        <table className="w-full text-left text-sm tabular-nums"><thead><tr className="border-b border-line text-muted">{['Confianza original', 'Casos', 'Evaluados', 'Acuerdos', 'Discrepancias', 'Confianza media', 'Concordancia observada', 'Brecha'].map(label => <th scope="col" key={label} className="whitespace-nowrap px-3 py-3">{label}</th>)}</tr></thead>
        <tbody>{e?.calibration.map(band => <tr key={band.band} className="border-b border-line text-ink">{[band.band, band.cases, band.evaluated, band.agreements, band.disagreements, percent(band.declaredConfidence), percent(band.observedAgreement), band.gap === null ? DASH : `${(band.gap * 100).toFixed(1)} pp`].map((value, index) => <td key={index} className="px-3 py-3">{value}</td>)}</tr>)}</tbody></table>
      </div>
    </Panel>
    <div className="grid gap-6 lg:grid-cols-2">
      <ChartFrame title="Distribución de confianza original" description="Solo dictámenes vigentes con confianza válida." height={300} isLoading={loading} isEmpty={!confidence?.auditedCases} emptyTitle="Sin confianza disponible" error={null}>
        <ConfidenceBandsChart data={confidence?.bands ?? []} ariaLabel={`Confianza original en ${confidence?.auditedCases ?? 0} dictámenes vigentes.`} />
      </ChartFrame>
      <ChartFrame title="Confianza según evidencia faltante" description="La ausencia de confianza queda fuera del promedio." height={300} isLoading={loading} isEmpty={!confidence?.confidenceByMissingEvidence.length} emptyTitle="Sin datos disponibles" error={null}>
        <ConfidenceByEvidenceChart data={confidence?.confidenceByMissingEvidence ?? []} ariaLabel="Confianza original por cantidad de evidencias faltantes." />
      </ChartFrame>
    </div>
  </div>;
}
