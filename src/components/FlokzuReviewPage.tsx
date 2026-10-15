import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ClipboardCheck, Search, X } from 'lucide-react';
import { Badge, Button, Panel, Spinner } from './ui';
import { getFlokzuReview, getFlokzuTicket, decideFlokzuTicket, getFlokzuImportHistory, type FlokzuTicketDetail, type FlokzuReviewPageData } from '../lib/api';
import { FLOKZU_CLASSIFICATIONS, FLOKZU_CLASSIFICATION_LABELS, FLOKZU_REVIEW_LABELS, classifyFlokzu, type FlokzuTicket, type FlokzuDecision } from '../shared/flokzu-review';
import { formatDateTime } from '../lib/format';
import { salesChannelCountry, salesChannelDisplay, salesChannelLabel } from '../lib/sales-channel-catalog';

const control = 'min-h-10 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink';
const actions: Array<[FlokzuDecision['action'], string]> = [['CLOSE', 'Confirmar cierre'], ['REACTIVATE', 'Reactivar para auditoría'], ['REASSIGN', 'Reasignar responsable'], ['PENDING', 'Mantener pendiente'], ['DISCREPANCY', 'Marcar discrepancia con Flokzu']];
const message = (e: unknown): string => e instanceof Error ? e.message : 'No se pudo completar la operación. Vuelve a intentarlo.';
function safeLink(value: string): string | null {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}

export function FlokzuReviewPage({ previewOnly = false }: { previewOnly?: boolean }): ReactNode {
  const [result, setResult] = useState<FlokzuReviewPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ scope: 'pending', classification: '', search: '', campus: '', policy: '', assignedTo: '', from: '', to: '' });
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [assignees, setAssignees] = useState<Array<{ userId: string; name: string | null }>>([]);
  const [selected, setSelected] = useState<FlokzuTicket | null>(null);
  const [detail, setDetail] = useState<FlokzuTicketDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const detailRequest = useRef(0);
  const detailPanel = useRef<HTMLElement>(null);
  const [action, setAction] = useState<FlokzuDecision['action']>('PENDING');
  const [reason, setReason] = useState('');
  const [observation, setObservation] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const selectedId = selected?.id;

  useEffect(() => {
    if (!selectedId) return;
    detailPanel.current?.focus({ preventScroll: true });
    if (window.matchMedia?.('(max-width: 1279px)').matches) detailPanel.current?.scrollIntoView({ block: 'start' });
  }, [selectedId]);

  useEffect(() => {
    if (previewOnly) { setAssignees([{ userId: 'demo-advisor', name: 'Asesor de demostración' }]); return; }
    let current = true;
    void getFlokzuImportHistory().then(value => { if (current) setAssignees(value.assignmentOptions); }).catch(e => { if (current) setError(message(e)); });
    return () => { current = false; };
  }, [previewOnly]);
  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      setLoading(true); setError(null);
      const request = previewOnly ? Promise.resolve(previewPage(filters)) : getFlokzuReview({ ...filters, offset: String(offset) });
      void request.then(value => { if (current) setResult(value); }).catch(e => { if (current) setError(message(e)); }).finally(() => { if (current) setLoading(false); });
    }, 250);
    return () => { current = false; window.clearTimeout(timer); };
  }, [filters, offset, refresh, previewOnly]);

  const open = async (ticket: FlokzuTicket): Promise<void> => {
    const requestId = ++detailRequest.current;
    setSelected(ticket); setDetail(null); setError(null); setSuccess(null); setDetailLoading(true);
    setAction('PENDING'); setReason(''); setObservation(''); setAssignedTo(ticket.assignedTo ?? ''); setConfirmed(false);
    try {
      const value = previewOnly ? previewDetail(ticket) : await getFlokzuTicket(ticket.id);
      if (requestId === detailRequest.current) { setDetail(value); setSelected(value.ticket); }
    } catch (e) { if (requestId === detailRequest.current) setError(`No se pudo abrir el detalle de ${ticket.externalCaseId}. ${message(e)}`); }
    finally { if (requestId === detailRequest.current) setDetailLoading(false); }
  };
  const save = async (): Promise<void> => {
    if (!detail || saving) return;
    setSaving(true); setError(null);
    try {
      const decision: FlokzuDecision = { caseId: detail.ticket.id, revision: detail.ticket.revision, action, reason, observation,
        ...(action === 'CLOSE' ? { confirmed } : {}), ...(action === 'REACTIVATE' || action === 'REASSIGN' ? { assignedTo: assignedTo || null } : {}) };
      await decideFlokzuTicket(decision);
      await open(detail.ticket); setSuccess('Decisión administrativa registrada con su historial.'); setRefresh(v => v + 1);
    } catch (e) { setError(message(e)); }
    finally { setSaving(false); }
  };
  const moreHistory = async (): Promise<void> => {
    if (!detail || detail.historyNextOffset === null) return;
    const id = detailRequest.current;
    setDetailLoading(true);
    try { const page = await getFlokzuTicket(detail.ticket.id, detail.historyNextOffset); if (id === detailRequest.current) setDetail({ ...page, history: [...detail.history, ...page.history] }); }
    catch (e) { setError(message(e)); } finally { setDetailLoading(false); }
  };
  const filter = (key: keyof typeof filters, value: string): void => { setFilters(v => ({ ...v, [key]: value })); setOffset(0); };
  const ticket = detail?.ticket;
  const diagnosis = detail ? classifyFlokzu(detail.data) : null;
  const nextStep = ticket?.reviewState === 'CLOSED' ? 'El Coordinador confirmó el cierre. El expediente y sus dictámenes se conservan en el histórico.'
    : ticket?.reviewState === 'REACTIVATED' ? 'El Coordinador reactivó este ticket para auditoría. Conserva el responsable asignado y la discrepancia con Flokzu para seguimiento.'
    : ticket?.reviewState === 'PENDING' ? 'El Coordinador decidió mantenerlo pendiente. Para enviarlo a auditoría, reactívalo con un motivo y un Asesor.'
    : diagnosis?.nextStep;
  const incomplete = !detail || (action === 'CLOSE' && !confirmed) || ((action === 'REACTIVATE' || action === 'DISCREPANCY') && !reason.trim()) || (action === 'REACTIVATE' && (!assignedTo || (ticket?.discrepancy && !observation.trim())));

  return <div className="mx-auto flex max-w-[1680px] flex-col gap-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold">Revisión Flokzu</h1><p className="mt-2 max-w-3xl text-sm text-muted">Concilia cierres y etapas antes de enviar trabajo a auditoría. Cada decisión conserva el dato original y su historial.</p></div><a href="#/importacion-tickets" className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-sm text-brand">Importar Excel diario</a></header>
    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger"><span>{error}</span><Button variant="secondary" onClick={() => { setRefresh(v => v + 1); if (selected) void open(selected); }}>Reintentar</Button></div>}
    {success && <p role="status" className="text-sm text-success">{success}</p>}
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5" aria-label="Conteos globales de revisión administrativa">{[
      ['Pendientes de revisión', result?.counts.pending], ['Rechazados', result?.counts.rejected], ['Finalizados', result?.counts.finalized], ['En otras etapas', result?.counts.otherStage], ['Con discrepancias', result?.counts.discrepancies],
    ].map(([label, count]) => <div key={label} className="rounded-xl border border-line bg-surface-1 p-4"><p className="text-xs text-muted">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{count ?? '—'}</p></div>)}</div>
    <Panel title="Tickets administrativos" description="Selecciona cualquier parte de la fila para ver la etapa, el motivo y la acción disponible. Un ticket fuera del reparto no implica un dictamen rechazado.">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs text-muted">Búsqueda por CaVe, matrícula o estudiante<div className="relative mt-1"><Search className="pointer-events-none absolute left-3 top-3" size={16} aria-hidden="true" /><input className={`${control} pl-9`} value={filters.search} onChange={e => filter('search', e.target.value)} placeholder="CaVe, matrícula o nombre" /></div></label>
        <label className="text-xs text-muted">Bandeja<select className={`${control} mt-1`} value={filters.scope} onChange={e => filter('scope', e.target.value)}><option value="pending">Pendientes de revisión</option><option value="history">Cierres confirmados</option><option value="discrepancies">Con discrepancias</option><option value="all">Todos los tickets</option></select></label>
        <label className="text-xs text-muted">Clasificación<select className={`${control} mt-1`} value={filters.classification} onChange={e => filter('classification', e.target.value)}><option value="">Todas</option>{FLOKZU_CLASSIFICATIONS.map(c => <option key={c} value={c}>{FLOKZU_CLASSIFICATION_LABELS[c]}</option>)}</select></label>
        <label className="text-xs text-muted">Responsable<select className={`${control} mt-1`} value={filters.assignedTo} onChange={e => filter('assignedTo', e.target.value)}><option value="">Todos</option>{assignees.map(a => <option key={a.userId} value={a.userId}>{a.name ?? a.userId}</option>)}</select></label>
        <label className="text-xs text-muted">Campus (valor completo)<input className={`${control} mt-1`} value={filters.campus} onChange={e => filter('campus', e.target.value)} /></label>
        <label className="text-xs text-muted">Política reportada (valor completo)<input className={`${control} mt-1`} value={filters.policy} onChange={e => filter('policy', e.target.value)} /></label>
        <label className="text-xs text-muted">Solicitud desde<input type="date" className={`${control} mt-1`} value={filters.from} onChange={e => filter('from', e.target.value)} /></label>
        <label className="text-xs text-muted">Solicitud hasta<input type="date" className={`${control} mt-1`} value={filters.to} onChange={e => filter('to', e.target.value)} /></label>
      </div>
      <div className="mt-5 grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(340px,460px)]">
        <div className="min-w-0">
          {loading ? <div role="status" className="flex items-center gap-2 py-12 text-sm text-muted"><Spinner label="Consultando tickets" /> Consultando tickets…</div> : result?.tickets.length ? <div role="region" aria-label="Tabla de tickets Flokzu" tabIndex={0} className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-left text-sm"><thead className="bg-surface-2 text-xs text-muted"><tr>{['CaVe / estudiante', 'Clasificación / motivo', 'Etapa / canal de venta', 'Responsable', 'Solicitud', 'Revisión'].map(h => <th key={h} className="px-3 py-3">{h}</th>)}</tr></thead>
              <tbody>{result.tickets.map(t => <tr key={t.id} tabIndex={saving ? -1 : 0} aria-label={`Revisar ticket ${t.externalCaseId}`} aria-controls="flokzu-ticket-detail"
                onClick={() => { if (!saving && !window.getSelection()?.toString()) void open(t); }}
                onKeyDown={event => { if (event.target === event.currentTarget && !saving && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); void open(t); } }}
                className={`cursor-pointer border-t border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${selected?.id === t.id ? 'bg-brand/10' : 'hover:bg-surface-2'}`}>
                <td className="min-w-44 px-3 py-3"><button type="button" tabIndex={-1} aria-pressed={selected?.id === t.id} className="min-h-10 text-left text-brand underline-offset-4 hover:underline" disabled={saving} onClick={event => { event.stopPropagation(); void open(t); }}>{t.externalCaseId}</button><span className="block">{t.studentName ?? 'Estudiante sin nombre'}</span><span className="text-xs text-muted">{t.studentIdentifier ?? 'Sin matrícula'}</span></td>
                <td className="min-w-56 px-3 py-3"><Badge tone={t.discrepancy ? 'warning' : 'neutral'}>{FLOKZU_CLASSIFICATION_LABELS[t.classification]}</Badge><p className="mt-2 text-xs text-muted">{t.reason}</p></td>
                <td className="min-w-44 px-3 py-3 text-xs"><span className="block">{t.currentTask ?? 'Etapa no reportada'}</span><span className="mt-2 block text-muted">Canal de venta: {salesChannelDisplay(t.salesChannelReported)}</span></td>
                <td className="px-3 py-3 text-xs text-muted">{assignees.find(a => a.userId === t.assignedTo)?.name ?? t.assignedTo ?? 'Sin asignación'}</td>
                <td className="whitespace-nowrap px-3 py-3 text-xs text-muted">{t.requestDate ?? 'Sin fecha'}</td><td className="px-3 py-3 text-xs">{FLOKZU_REVIEW_LABELS[t.reviewState]}</td>
              </tr>)}</tbody>
            </table>
          </div> : !error && <div className="flex flex-col items-center gap-2 py-12 text-center"><ClipboardCheck size={28} className="text-muted" aria-hidden="true" /><p className="text-sm">No hay tickets con estos filtros.</p><p className="text-xs text-muted">Consulta el histórico o cambia la bandeja.</p></div>}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><Button variant="ghost" disabled={offset === 0 || loading || previewOnly} onClick={() => setOffset(v => Math.max(0, v - 50))}>Anterior</Button><span className="text-xs text-muted">Página {Math.floor(offset / 50) + 1} · hasta 50 tickets</span><Button variant="ghost" disabled={result?.nextOffset == null || loading || previewOnly} onClick={() => setOffset(result?.nextOffset ?? 0)}>Siguiente</Button></div>
        </div>
        <aside ref={detailPanel} id="flokzu-ticket-detail" tabIndex={-1} aria-label="Detalle administrativo del ticket" className="min-w-0 scroll-mt-4 rounded-xl border border-line bg-surface-2 p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
          {!selected ? <p className="py-12 text-center text-sm text-muted">Selecciona una fila para revisar por qué el ticket quedó fuera del reparto y decidir su destino.</p> : <>
            <div className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold">{selected.externalCaseId}</h2><Button variant="ghost" aria-label="Cerrar panel del ticket" disabled={saving} onClick={() => { ++detailRequest.current; setSelected(null); setDetail(null); }}><X size={18} aria-hidden="true" /></Button></div>
            {detailLoading && <p role="status" className="mt-4 flex items-center gap-2 text-sm"><Spinner label="Cargando detalle" /> Cargando detalle…</p>}
            {detail && ticket && <>
              <p className="mt-2 text-sm">{ticket.studentName} · {ticket.studentIdentifier}</p>
              <section className="mt-4 space-y-2 text-sm" aria-label="Motivo y siguiente paso">
                <h3 className="font-semibold">Por qué aparece aquí</h3>
                <p>{diagnosis?.reason ?? ticket.reason}</p>
                <h3 className="pt-2 font-semibold">Qué hacer ahora</h3>
                <p className="text-muted">{nextStep}</p>
                {diagnosis && diagnosis.classification !== ticket.classification && <p className="text-warning">La clasificación guardada es {FLOKZU_CLASSIFICATION_LABELS[ticket.classification]}. Los datos corresponden a {FLOKZU_CLASSIFICATION_LABELS[diagnosis.classification]}; vuelve a importar el Excel para actualizarla. Esta lectura no cambia la asignación ni una decisión manual.</p>}
              </section>
              <p className="mt-2 text-xs text-muted">{FLOKZU_REVIEW_LABELS[ticket.reviewState]} · {ticket.eligible ? 'Elegible para auditoría' : 'Fuera de la bandeja activa'}</p>
              {ticket.discrepancy && <p className="mt-2 text-xs text-warning">La discrepancia sigue registrada hasta que el Coordinador revise los datos y decida cómo continuar.</p>}
              <dl className="mt-4 space-y-3 text-sm">{[
                ['Estado original', detail.data.operations.statusReported], ['Tarea actual', detail.data.operations.currentTask], ['Finalizado', detail.data.operations.finalizedReported],
                ['Canal de venta reportado · Flokzu', salesChannelLabel(detail.data.operations.salesChannelReported) ?? 'No reportado en la última importación'],
                ['País asociado al canal · catálogo CaVe', salesChannelCountry(detail.data.operations.salesChannelReported)],
                ['Responsable asignado', assignees.find(a => a.userId === ticket.assignedTo)?.name ?? ticket.assignedTo],
                ...Object.entries(detail.data.academic).map(([k,v]) => [academicLabels[k] ?? k, v]),
                ...Object.entries(detail.data.procedure).map(([k,v]) => [procedureLabels[k] ?? k, v]),
                ...Object.entries(detail.data.operations).filter(([k]) => !['statusReported','currentTask','finalizedReported','salesChannelReported'].includes(k)).map(([k,v]) => [operationLabels[k] ?? k, v]),
                ...(detail.data.administrativeComments ?? []).map(c => [c.label,c.value]),
              ].map(([label,value],i) => <div key={`${label}-${i}`}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{value || 'No disponible'}</dd></div>)}</dl>
              <p className="mt-3 text-xs text-muted">El canal de venta es el valor reportado por Flokzu; el canal de origen confirmado en el dictamen se determina por separado con evidencia.</p>
              <h3 className="mt-5 text-sm font-semibold">Referencias de evidencia</h3><ul className="mt-2 space-y-2 text-xs">{detail.data.evidenceReferences.map((ref,i) => <li key={i} className="break-words"><span className="block text-muted">{ref.label}</span>{safeLink(ref.value) ? <a className="text-brand underline underline-offset-4" href={safeLink(ref.value)!} target="_blank" rel="noopener noreferrer">{ref.value}</a> : ref.value}</li>)}</ul>
              <a className="mt-4 inline-block text-sm text-brand underline underline-offset-4" href={`#/casos/${encodeURIComponent(ticket.id)}`}>Abrir expediente y dictámenes conservados</a>
              <form className="mt-5 space-y-3 border-t border-line pt-4" onSubmit={e => { e.preventDefault(); void save(); }}>
                <h3 className="text-sm font-semibold">Decisión de coordinación</h3>
                <label className="block text-xs text-muted">Acción<select className={`${control} mt-1`} value={action} disabled={saving} onChange={e => { setAction(e.target.value as FlokzuDecision['action']); setConfirmed(false); }}>{actions.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                {(action === 'REACTIVATE' || action === 'REASSIGN') && <label className="block text-xs text-muted">Responsable{action === 'REACTIVATE' ? ' (obligatorio)' : ''}<select className={`${control} mt-1`} value={assignedTo} disabled={saving} onChange={e => setAssignedTo(e.target.value)}><option value="">Sin asignación</option>{assignees.map(a => <option key={a.userId} value={a.userId}>{a.name ?? a.userId}</option>)}</select></label>}
                <label className="block text-xs text-muted">Motivo{action === 'REACTIVATE' || action === 'DISCREPANCY' ? ' (obligatorio)' : ' / observación'}<textarea className={`${control} mt-1`} maxLength={2000} rows={3} value={reason} disabled={saving} onChange={e => setReason(e.target.value)} /></label>
                {action === 'REACTIVATE' && ticket.discrepancy && <label className="block text-xs text-muted">Observación de la discrepancia (obligatoria)<textarea className={`${control} mt-1`} maxLength={2000} rows={2} value={observation} disabled={saving} onChange={e => setObservation(e.target.value)} /></label>}
                {action === 'CLOSE' && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 accent-brand" checked={confirmed} disabled={saving} onChange={e => setConfirmed(e.target.checked)} />Confirmo que este ticket no requiere auditoría adicional. Se conservará en el histórico.</label>}
                {previewOnly && <p className="text-xs text-warning">Datos sintéticos. Las decisiones están deshabilitadas en esta vista previa.</p>}
                <Button type="submit" disabled={incomplete || saving || previewOnly}>{saving ? 'Guardando…' : 'Registrar decisión'}</Button>
              </form>
              <h3 className="mt-6 text-sm font-semibold">Historial de importaciones y decisiones</h3>
              <ol className="mt-2 space-y-3">{detail.history.map(event => <li key={event.id} className="border-t border-line pt-3 text-xs"><p className="font-semibold">{eventLabels[event.action] ?? event.action} · {formatDateTime(event.createdAt)}</p><p className="mt-1 text-muted">Usuario: {event.actor ?? 'Migración inicial'}{event.batchId ? ` · Importación ${event.batchId}` : ''}</p><p className="mt-1 whitespace-pre-wrap break-words">{event.reason}</p><details className="mt-2"><summary className="cursor-pointer text-brand">Ver valores anteriores y nuevos</summary><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs text-muted">{JSON.stringify({ anterior: event.before, nuevo: event.after }, null, 2)}</pre></details></li>)}</ol>
              {detail.history.length === 0 && <p className="mt-2 text-xs text-muted">Sin intervenciones registradas.</p>}
              {detail.historyNextOffset !== null && <Button variant="ghost" disabled={detailLoading} onClick={() => { void moreHistory(); }}>Cargar más historial</Button>}
            </>}
          </>}
        </aside>
      </div>
    </Panel>
  </div>;
}
const academicLabels: Record<string,string> = { campus:'Campus', university:'Universidad', countryReported:'País reportado', program:'Programa', level:'Nivel', block:'Bloque', programKey:'Clave de programa', entryDate:'Fecha de ingreso' };
const procedureLabels: Record<string,string> = { policyReported:'Política reportada', motive:'Motivo', description:'Descripción', requestDate:'Fecha de solicitud', administrativeStartDate:'Fecha de inicio administrativo' };
const operationLabels: Record<string,string> = { reviewerReported:'Revisor reportado', supervisorReported:'Supervisor reportado', requesterReported:'Solicitante', requesterArea:'Área del solicitante' };
const eventLabels: Record<string,string> = { BASELINE:'Conciliación inicial', IMPORT:'Importación diaria', CLOSE:'Cierre confirmado', REACTIVATE:'Reactivación manual', REASSIGN:'Reasignación', PENDING:'Mantener pendiente', DISCREPANCY:'Discrepancia registrada' };

function previewPage(filters: { scope: string; classification: string; search: string }): FlokzuReviewPageData {
  const tickets: FlokzuTicket[] = ['REJECTED', 'FINALIZED', 'OTHER_STAGE', 'VERIFY'].map((classification,i) => ({ id:`demo-flokzu-${i}`, externalCaseId:`CaVe-${90001+i}`, studentIdentifier:`MAT-DEMO-${i+1}`, studentName:`Estudiante de demostración ${i+1}`,
    classification:classification as FlokzuTicket['classification'], reviewState:'OPEN', eligible:false, discrepancy:i===3, reason:i===0 ? 'Excluido de auditoría activa porque Flokzu reporta la solicitud como RECHAZADA.' : i===3 ? 'Estado REVISIÓN y Finalizado Sí: requiere verificar la contradicción.' : 'La solicitud está cerrada o todavía corresponde a otra etapa.', revision:1,assignedTo:null,updatedAt:'2026-10-13T12:00:00Z',campus:'UTEL',policy:'Política reportada de demostración',requestDate:'2026-10-12', currentTask:classification==='OTHER_STAGE' ? '[HD] [REVISION REPLICA] [CV]' : '[BACKOFFICE] [REVISION BO] [CV]', salesChannelReported:'CALL_CENTER_DIRECTAS' }));
  return { tickets:tickets.map(t => ({ ...t, reason: classifyFlokzu(previewDetail(t).data).reason })).filter(t => (filters.scope !== 'history') && (filters.scope !== 'discrepancies' || t.discrepancy) && (!filters.classification || t.classification===filters.classification) && `${t.externalCaseId} ${t.studentIdentifier} ${t.studentName}`.toLowerCase().includes(filters.search.toLowerCase())),nextOffset:null,counts:{pending:4,rejected:1,finalized:1,otherStage:1,discrepancies:1} };
}
function previewDetail(ticket: FlokzuTicket): FlokzuTicketDetail {
  return { ticket, historyNextOffset:null, data:{ academic:{campus:'UTEL',university:null,countryReported:null,program:'Programa sintético',level:null,block:null,programKey:null,entryDate:null},procedure:{policyReported:ticket.policy,motive:'Solicitud de demostración',description:'Datos sintéticos para revisar la pantalla sin conexión al backend.',requestDate:ticket.requestDate,administrativeStartDate:null},operations:{salesChannelReported:ticket.salesChannelReported,currentTask:ticket.classification==='OTHER_STAGE' ? '[HD] [REVISION REPLICA] [CV]' : '[BACKOFFICE] [REVISION BO] [CV]',statusReported:ticket.classification==='REJECTED' ? 'RECHAZADA' : ticket.classification==='FINALIZED' ? 'FINALIZADO' : 'REVISIÓN',finalizedReported:ticket.classification==='VERIFY' || ticket.classification==='FINALIZED' ? 'Sí' : 'No',reviewerReported:null,supervisorReported:null,requesterReported:null,requesterArea:null},evidenceReferences:[{label:'Referencia de demostración',value:'evidencia-sintetica.pdf'}],administrativeComments:[{label:'Comentario administrativo',value:'Pendiente de conciliación por el Coordinador.'}] },history:[{id:'demo-event',action:'IMPORT',actor:'Coordinador de demostración',createdAt:'2026-10-13T12:00:00Z',reason:ticket.reason,before:null,after:{classification:ticket.classification,reviewState:'OPEN'},batchId:'demo-batch'}] };
}
