import { HistoryForCase } from '../StudentHistory';
import type { ReactNode } from 'react';
import { useState } from 'react';
import type { DashboardFilters as Filters } from '../../lib/dashboard';
import { defaultDateRange } from '../../lib/dashboard';
import type { QualityCase } from '../../lib/dashboard-metrics-contracts';
import { DASH, formatPercent } from '../../lib/format';
import { resolutionLabel } from '../../lib/labels';
import { useAiQuality } from '../../lib/useDashboard';
import { Button, ErrorCard, Panel, Skeleton } from '../ui';
import { DashboardFilters } from './DashboardFilters';

const percent = (value: number | null | undefined): string => value == null ? 'Sin datos' : formatPercent(value);
const states: Record<string, string> = {
  AGREEMENT: 'Coincide con la decisión final', DISAGREEMENT: 'Difiere de la decisión final',
  PENDING_ADVISOR: 'Falta revisión del Asesor', PENDING_COORDINATOR: 'Falta cierre del Coordinador',
  PENDING_COMPARISON: 'Falta comparar con la decisión final', COMPARISON_RUNNING: 'Comparación en curso',
  COMPARISON_ERROR: 'Comparación fallida', AUDIT_ERROR: 'Auditoría fallida',
  AUDIT_RUNNING: 'Auditoría en curso', INVALID_COMPARISON: 'Comparación sin resultado válido',
  PENDING_EVALUATION: 'Sin decisión final', WITHOUT_CONFIDENCE: 'Sin confianza declarada',
  ISSUED: 'Con dictamen de IA', FINALIZED: 'Con decisión final',
};
const dateFormat = new Intl.DateTimeFormat('es-MX', { dateStyle: 'short', timeZone: 'UTC' });
type View = 'results' | 'pending' | 'confidence';

function matches(row: QualityCase, selection: string): boolean {
  if (!selection) return true;
  if (selection === 'ISSUED') return row.aiResolution !== null;
  if (selection === 'FINALIZED') return row.aiResolution !== null && row.finalResolution !== null;
  if (selection === 'PENDING_EVALUATION') return row.aiResolution !== null && row.finalResolution === null;
  if (selection === 'WITHOUT_CONFIDENCE') return row.aiResolution !== null && row.originalConfidence === null;
  return row.state === selection;
}

function CasesTable({ rows }: { rows: QualityCase[] }): ReactNode {
  const [page, setPage] = useState(0);
  const [technical, setTechnical] = useState(false);
  const [historyCase, setHistoryCase] = useState<string | null>(null);
  const totalPages = Math.max(1, Math.ceil(rows.length / 25));
  const current = Math.min(page, totalPages - 1);
  const visible = rows.slice(current * 25, (current + 1) * 25);
  return <>
    <label className="mb-4 flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={technical} onChange={event => setTechnical(event.target.checked)} />Mostrar propuesta del Asesor y confianza de la IA</label>
    {historyCase && <Panel title="Historial de matrícula"><Button variant="ghost" onClick={() => setHistoryCase(null)}>Cerrar historial</Button><HistoryForCase caseId={historyCase} /></Panel>}
    <div role="region" aria-label="Casos de calidad" tabIndex={0} className="overflow-x-auto">
      <table className="w-full text-left text-sm tabular-nums">
        <thead><tr className="border-b border-line text-muted">{['CaVe / caso', 'Responsable', 'Fecha · UTC', 'Dictamen de IA', 'Decisión final', 'Situación', ...(technical ? ['Propuesta del Asesor', 'Confianza del dictamen', 'Confianza de comparación'] : []), 'Consultar'].map(label => <th key={label} scope="col" className="whitespace-nowrap px-3 py-3 font-medium">{label}</th>)}</tr></thead>
        <tbody>{visible.map(row => <tr key={row.auditId} className="border-b border-line text-ink">
          <td className="px-3 py-3">{row.identifier}</td><td className="px-3 py-3">{row.responsibleName ?? row.responsible ?? 'Sin responsable disponible'}</td>
          <td className="whitespace-nowrap px-3 py-3">{dateFormat.format(new Date(row.auditedAt))}</td>
          <td className="px-3 py-3">{row.aiResolution ? resolutionLabel(row.aiResolution) : 'Sin dictamen'}</td>
          <td className="px-3 py-3">{row.finalResolution ? resolutionLabel(row.finalResolution) : 'Pendiente'}</td>
          <td className="px-3 py-3"><span className={row.state === 'DISAGREEMENT' ? 'text-warning' : row.state === 'AGREEMENT' ? 'text-brand' : ''}>{states[row.state]}</span>{row.aiResolution && row.latestExecutionStatus && row.latestExecutionStatus !== 'COMPLETED' && <p className="mt-1 text-xs text-muted">Última auditoría: {row.latestExecutionStatus === 'ERROR' ? 'fallida; se conserva este dictamen' : 'en curso; se conserva este dictamen'}</p>}</td>
          {technical && <><td className="px-3 py-3">{row.advisorResolution ? resolutionLabel(row.advisorResolution) : DASH}</td><td className="px-3 py-3">{percent(row.originalConfidence)}</td><td className="px-3 py-3">{percent(row.comparisonConfidence)}</td></>}
          <td className="px-3 py-3"><a className="text-brand underline underline-offset-4" href={`#/casos/${row.caseId}`} aria-label={`Abrir expediente ${row.identifier}`}>Abrir</a><Button variant="ghost" onClick={() => setHistoryCase(row.caseId)}>Historial</Button></td>
        </tr>)}</tbody>
      </table>
      {!rows.length && <p className="py-6 text-sm text-muted">No hay casos que coincidan con esta selección.</p>}
    </div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
      <span>{rows.length} registros · Página {current + 1} de {totalPages}</span>
      <div className="flex gap-2"><Button variant="secondary" disabled={!current} onClick={() => setPage(current - 1)}>Anterior</Button><Button variant="secondary" disabled={current + 1 >= totalPages} onClick={() => setPage(current + 1)}>Siguiente</Button></div>
    </div>
  </>;
}

/** Las barras seleccionan el detalle local; nunca cambian el denominador del resumen. */
function CountBar({ label, count, total, selection, tone = 'var(--accent)', onSelect }: {
  label: string; count: number; total: number; selection: string; tone?: string; onSelect: (value: string) => void;
}): ReactNode {
  return <button type="button" className="quality-count-bar" onClick={() => onSelect(selection)} aria-label={`${label}: ${count} casos. Ver casos en la tabla`}>
    <span className="quality-bar-label">{label}</span>
    <span className="quality-bar-track" aria-hidden="true"><span style={{ width: `${total ? count / total * 100 : 0}%`, backgroundColor: tone }} /></span>
    <span className="quality-bar-value">{count}<small>{total ? formatPercent(count / total) : 'Sin casos'}</small></span>
  </button>;
}

export function QualityPage(): ReactNode {
  const [filters, setFilters] = useState<Filters>(defaultDateRange);
  const [historical, setHistorical] = useState(false);
  const [selection, setSelection] = useState('');
  const [view, setView] = useState<View>('results');
  const { data, isLoading, error, reload } = useAiQuality(filters);
  const e = data?.evaluation;
  const loading = isLoading && !data;
  const applied = data?.filters ?? filters;
  const rows = e?.rows ?? [];
  const count = (state: string): number => rows.filter(row => row.state === state).length;
  const selectCases = (value: string): void => { setHistorical(false); setSelection(value); };
  const withoutComparison = e ? e.issued - e.validComparisons : 0;
  const pendingComparison = count('PENDING_COMPARISON') + count('COMPARISON_RUNNING') + count('COMPARISON_ERROR') + count('INVALID_COMPARISON');
  const currentRows = (historical ? e?.historicalRows ?? [] : rows).filter(row => matches(row, selection));
  const changeFilters = (next: Filters): void => { setFilters(next); setSelection(''); };
  const scopeActive = Object.entries(applied).some(([key, value]) => !['from', 'to'].includes(key) && value != null && value !== '');

  return <div className="dashboard-page quality-page flex flex-col gap-5" aria-busy={isLoading}>
    <section className="dashboard-toolbar quality-toolbar">
      <header className="dashboard-page-heading"><div><h1 className="text-2xl font-semibold tracking-tight text-ink">Calidad de las auditorías</h1><p className="mt-2 text-sm text-muted">¿La IA coincide con la decisión final? ¿Qué casos faltan por revisar?</p></div></header>
      <details className="quality-disclosure"><summary>Periodo: {applied.from} al {applied.to} · {scopeActive ? 'Filtros aplicados' : 'Todos los casos de producción'} · Cambiar filtros</summary><div className="pt-4"><DashboardFilters value={filters} onChange={changeFilters} /></div></details>
    </section>
    {error && <ErrorCard title="No se pudo cargar el informe de calidad" message={error} onRetry={reload} retrying={isLoading} />}
    {loading ? <Skeleton height={160} /> : e && <>
      <section className="quality-overview" aria-label="Resumen de calidad">
        <div><h2>Casos con dictamen de IA</h2><strong>{e.issued}</strong><p>Un dictamen vigente por expediente.</p></div>
        <div><h2>Coincidencia con la decisión final</h2><strong>{e.validComparisons ? percent(e.agreementRate) : 'Aún sin evaluar'}</strong><p>{e.validComparisons ? `${e.agreements} de ${e.validComparisons} casos comparados coinciden; ${e.disagreements} difieren.` : 'Todavía no hay comparaciones finales válidas.'}</p></div>
        <div><h2>Sin decisión final</h2><strong>{e.pendingEvaluation}</strong><p>{count('PENDING_ADVISOR')} esperan la resolución del Asesor · {count('PENDING_COORDINATOR')} al Coordinador.</p></div>
      </section>
      <p className="text-sm text-muted" role="status">{e.issued === 0 ? 'No hay dictámenes emitidos para los filtros elegidos.' : e.validComparisons === 0 ? `Hay ${e.issued} dictámenes, pero todavía no podemos medir cuánto coincide la IA con la decisión final.${pendingComparison ? ` ${pendingComparison} casos ya tienen decisión final y falta una comparación válida.` : ''}` : `La coincidencia se ha medido en ${e.validComparisons} de ${e.issued} dictámenes (${percent(e.coverageRate)}).${withoutComparison ? ` Quedan ${withoutComparison} sin comparación final válida.` : ''}`}</p>
    </>}
    <Panel title="Explorar la calidad" description="Elige una pregunta. Los filtros de periodo, país y canal se aplican a todas las vistas.">
      <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Vista de la gráfica">
        {([['results', '¿Coincide la IA?'], ['pending', '¿Qué falta revisar?'], ['confidence', '¿Qué tan segura está la IA?']] as const).map(([value, label]) => <Button key={value} variant={view === value ? 'primary' : 'secondary'} aria-pressed={view === value} onClick={() => setView(value)}>{label}</Button>)}
      </div>
      {loading ? <Skeleton height={200} /> : !e ? <p className="text-sm text-muted">{error ? 'El informe no está disponible. Usa Reintentar para volver a cargarlo.' : 'Sin datos disponibles.'}</p> : view === 'results' ? <>
        <h3 className="mb-2 font-semibold text-ink">Resultado frente a la decisión final</h3>
        <p className="mb-5 text-sm text-muted">Las barras muestran los {e.issued} dictámenes. La coincidencia se calcula solo con los casos ya comparados.</p>
        <CountBar label="Coinciden" count={e.agreements} total={e.issued} selection="AGREEMENT" onSelect={selectCases} />
        <CountBar label="Difieren" count={e.disagreements} total={e.issued} selection="DISAGREEMENT" tone="var(--warning)" onSelect={selectCases} />
        <div className="quality-count-bar quality-count-static"><span className="quality-bar-label">Sin comparación final</span><span className="quality-bar-track" aria-hidden="true"><span style={{ width: `${e.issued ? withoutComparison / e.issued * 100 : 0}%`, backgroundColor: 'var(--text-muted)' }} /></span><span className="quality-bar-value">{withoutComparison}<small>{e.issued ? formatPercent(withoutComparison / e.issued) : 'Sin casos'}</small></span></div>
        {withoutComparison > 0 && <Button variant="ghost" onClick={() => setView('pending')}>Ver qué falta para completar la evaluación</Button>}
        <p className="mt-4 text-sm text-muted">Coincidir con la decisión final no garantiza que el dictamen sea correcto. Las diferencias requieren revisar el expediente.</p>
      </> : view === 'pending' ? <>
        <h3 className="mb-2 font-semibold text-ink">Dónde se detiene la evaluación</h3><p className="mb-5 text-sm text-muted">Casos con dictamen que aún no tienen una comparación final válida. Selecciona una barra para consultar los casos.</p>
        {(['PENDING_ADVISOR', 'PENDING_COORDINATOR', 'PENDING_COMPARISON', 'COMPARISON_RUNNING', 'COMPARISON_ERROR', 'INVALID_COMPARISON'] as const).filter(state => count(state) > 0 || state === 'PENDING_ADVISOR' || state === 'PENDING_COORDINATOR').map(state => <CountBar key={state} label={states[state]!} count={count(state)} total={withoutComparison} selection={state} tone={state === 'COMPARISON_ERROR' || state === 'INVALID_COMPARISON' ? 'var(--warning)' : 'var(--accent)'} onSelect={selectCases} />)}
        {!withoutComparison && <p className="mt-4 text-sm text-muted">{e.issued ? 'Todos los dictámenes tienen comparación final válida.' : 'No hay dictámenes para evaluar en esta selección.'}</p>}
      </> : <>
        <h3 className="mb-2 font-semibold text-ink">Seguridad declarada frente a coincidencia observada</h3>
        <p className="mb-4 text-sm text-muted">La confianza es lo que declara la IA; no es un porcentaje de aciertos comprobados. Ambas barras usan los mismos casos ya comparados.</p>
        <div className="mb-5 flex flex-wrap gap-5 text-sm text-muted"><span><i className="quality-legend" style={{ backgroundColor: 'var(--text-muted)' }} />Confianza declarada</span><span><i className="quality-legend" style={{ backgroundColor: 'var(--accent)' }} />Coincidencia observada</span></div>
        {e.calibration.filter(band => band.cases > 0).map(band => <div className="quality-calibration" key={band.band}>
          <div className="mb-2 flex flex-wrap justify-between gap-2 text-sm"><strong className="text-ink">Confianza de {band.band}</strong><span className="text-muted">{band.evaluated} de {band.cases} casos comparados</span></div>
          {band.evaluated ? <>{[['Confianza declarada', band.declaredConfidence, 'var(--text-muted)'], ['Coincidencia observada', band.observedAgreement, 'var(--accent)']].map(([label, value, color]) => <div className="quality-count-bar quality-count-static" key={String(label)}><span className="quality-bar-label">{label}</span><span className="quality-bar-track" aria-hidden="true"><span style={{ width: `${Number(value) * 100}%`, backgroundColor: String(color) }} /></span><span className="quality-bar-value">{percent(value as number | null)}</span></div>)}</> : <p className="text-sm text-muted">Aún no hay casos comparados en este grupo. No se puede contrastar su confianza.</p>}
        </div>)}
        {!e.calibration.some(band => band.cases > 0) && <p className="text-sm text-muted">No hay dictámenes con confianza disponible.</p>}
        <p className="mt-4 text-sm text-muted">{e.withoutConfidence} dictámenes sin confianza declarada. Con pocos casos comparados, la muestra no permite conclusiones firmes.</p>
      </>}
    </Panel>
    <Panel title={historical ? 'Histórico de dictámenes' : 'Consultar casos'} description="El filtro de esta tabla no cambia los indicadores ni la gráfica de arriba.">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <label className="flex flex-col gap-2 text-sm text-muted" htmlFor="quality-case-selection">Casos que quieres consultar<select id="quality-case-selection" className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-ink" value={selection} onChange={event => setSelection(event.target.value)}><option value="">Todos los casos</option>{Object.entries(states).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <Button variant="secondary" onClick={() => setHistorical(!historical)}>{historical ? 'Volver a dictámenes vigentes' : `Consultar histórico (${e?.historicalVersions ?? 0})`}</Button>
      </div>
      {selection && <p className="mb-3 text-sm text-muted" role="status">Mostrando: {states[selection]}. <button className="text-brand underline underline-offset-4" onClick={() => setSelection('')}>Ver todos los casos</button></p>}
      {loading ? <Skeleton height={150} /> : <CasesTable key={`${JSON.stringify(applied)}:${historical}:${selection}`} rows={currentRows} />}
    </Panel>
    <details className="quality-disclosure"><summary>Cómo se calculan estos datos y estado técnico</summary><div className="quality-method text-sm text-muted">
      <p>Se usa un dictamen vigente por expediente, seleccionado antes de aplicar el periodo. Las fechas corresponden a la auditoría y se muestran en UTC. Los casos de prueba quedan fuera.</p>
      <p>La decisión final pertenece al Coordinador. La propuesta del Asesor queda pendiente hasta ese cierre. El comparador de IA evalúa el acuerdo con la decisión final de la misma versión.</p>
      <p>Coincidencia: casos que coinciden / comparaciones finales válidas. Avance de comparación: comparaciones válidas / dictámenes emitidos. Los errores y las comparaciones en curso no cuentan como diferencias.</p>
      <p>Coincidencia exacta del código de resolución: {e?.exactAgreements ?? DASH} de {e?.exactComparisons ?? DASH}. Se calcula aparte de la coincidencia que evalúa el comparador.</p>
      <p>Confianza media del dictamen: {percent(data?.confidence.avgConfidence)}. Confianza media del comparador: {percent(data?.humanReview.avgComparisonConfidence)}. Un valor ausente no equivale a cero.</p>
      <p>Últimas auditorías: {e?.technicalErrors ?? DASH} fallidas y {e?.runningAudits ?? DASH} en curso. Un fallo posterior no borra un dictamen anterior.</p>
      {data?.confidence.confidenceByMissingEvidence.map(bucket => <p key={bucket.bucket}>{bucket.label}: confianza media {percent(bucket.avgConfidence)} en {bucket.count} dictámenes.</p>)}
    </div></details>
  </div>;
}
