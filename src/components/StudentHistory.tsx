import { HistoryComparisonDetails } from './HistoryComparisonDetails';
import { useEffect, useState } from 'react';
import { readStudentHistory, type StudentHistory as History, type StudentHistoryEntry } from '../lib/student-history';
import { getHistoricalAudit } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { EVIDENCE_STATUS_LABELS, CASE_STATUS_LABELS } from '../lib/labels';
import { Button } from './ui';
type Ticket = History['cases'][number];
const value = (v: string | null | undefined) => v?.replaceAll('_', ' ') || 'Sin registrar';
const fields: Array<[string, (t: Ticket) => string | null]> = [
  ['Ticket CaVe', t => t.externalCaseId], ['Política solicitada · Flokzu', t => t.policy], ['Motivo', t => t.motive],
  ['Creación', t => formatDateTime(t.createdAt)], ['Solicitud Flokzu', t => t.requestDate],
  ['Estado Flokzu', t => t.administrativeStatus], ['Responsable asignado', t => t.responsible],
  ['Dictamen IA', t => t.latestAudit?.result ?? null], ['Resolución humana final', t => t.finalResolution],
  ['Fundamento IA · procedimiento V5', t => t.latestAudit?.procedureSection ?? null],
  ['Flujo de revisión', t => ({ PENDING_ADVISOR: 'Pendiente de Asesor', PENDING_COORDINATOR: 'Pendiente de Coordinador', FINALIZED: 'Finalizado' })[t.workflowState]],
  ['Evidencias', t => String(t.evidenceCount)],
];
function Entry({ caseId, ticket, onSelectAudit }: { caseId: string; ticket: Ticket; onSelectAudit?: (caseId: string, auditId: string) => void }) {
  const [data, setData] = useState<StudentHistoryEntry | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<{ id: string; text: string } | null>(null);
  async function load(offset = 0) {
    setBusy(true); setError('');
    try { const page = await readStudentHistory<StudentHistoryEntry>(caseId, 'student-history-entry', offset, ticket.id);
      setData(old => offset && old ? { ...page, evidences: [...old.evidences, ...page.evidences], audits: [...old.audits, ...page.audits] } : page);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <details onToggle={event => { if (event.currentTarget.open && !data && !busy) void load(); }}>
    <summary>Consultar {ticket.evidenceCount} evidencias y {ticket.auditCount} versiones de auditoría</summary>
    {error && <p role="alert">{error} <button onClick={() => void load()}>Reintentar</button></p>}
    {busy && <p role="status">Consultando…</p>}
    {data && <div className="student-history-entry">
      <h4>Evidencias · expediente de origen {ticket.externalCaseId ?? ticket.id}</h4>
      {!data.evidences.length && <p>Sin evidencias cargadas.</p>}
      <ul>{data.evidences.map(e => <li key={e.id}><a href={'/api/evidence/' + encodeURIComponent(e.id) + '/download?preview=1'} target="_blank" rel="noreferrer">{e.filename}</a><small>{e.mimeType} · {formatDateTime(e.createdAt)} · {EVIDENCE_STATUS_LABELS[e.processingStatus]}</small></li>)}</ul>
      <h4>Versiones del mismo expediente</h4>
      <ul>{data.audits.map(a => <li key={a.id}><span>{formatDateTime(a.createdAt)} · {value(a.result)} · {value(a.status)} · {value(a.procedureSection)}</span>{a.status === 'COMPLETED' && <button className="text-brand" onClick={() => { if (onSelectAudit) { onSelectAudit(ticket.id, a.id); return; } setError(''); void getHistoricalAudit(ticket.id, a.id).then(result => setVerdict({ id: a.id, text: result.resultJson?.audit.reasoning ?? 'Sin razonamiento disponible.' })).catch(() => setError('No se pudo abrir el dictamen.')); }}>Consultar razonamiento original</button>}{verdict?.id === a.id && <p>{verdict.text}</p>}</li>)}</ul>
      {data.nextOffset !== null && <Button disabled={busy} onClick={() => void load(data.nextOffset!)}>Cargar más evidencias y versiones</Button>}
    </div>}
  </details>;
}
export function StudentHistory({ caseId, embedded = false, onSelectAudit }: { caseId: string; embedded?: boolean; onSelectAudit?: (caseId: string, auditId: string) => void }) {
  const [open, setOpen] = useState(() => embedded || new URLSearchParams(window.location.hash.split('?')[1]).get('historial') === '1');
  const [data, setData] = useState<History | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Ticket[]>([]);
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    readStudentHistory<History>(caseId, 'student-history', offset).then(page => { if (!cancelled) { setData(page); setError(''); } }).catch(e => { if (!cancelled) setError((e as Error).message); }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [caseId, offset, retry]);
  return <section className="student-history" aria-label="Historial de matrícula">
    <button hidden={embedded} className="text-brand text-sm" aria-expanded={open} onClick={() => setOpen(!open)}>{data && data.summary.previousCases > 0 ? 'Esta matrícula tiene ' + data.summary.previousCases + ' expedientes anteriores · ' : ''}{open ? 'Cerrar historial' : 'Ver historial'}</button>
    {open && <div className="student-history-panel">
      <header><h2>Historial de matrícula · {data?.studentIdentifier ?? 'Consultando'}</h2><p>{data?.studentName ?? 'Nombre sin registrar'}</p></header>
      <p className="text-muted text-sm">Cada solicitud conserva sus evidencias y decisiones. La comparación es descriptiva y no consume tokens.</p>
      {error && <p role="alert">{error} <Button onClick={() => { setBusy(true); setRetry(n => n + 1); }}>Reintentar</Button></p>}
      {(!data || busy) && !error && <p role="status">Consultando historial…</p>}
      {data && <>
        <p className="student-history-counts">{data.summary.cases} expedientes · {data.summary.audits} ejecuciones de auditoría · {data.summary.evidences} evidencias<br />Última solicitud registrada: {data.summary.lastRequestAt ? formatDateTime(data.summary.lastRequestAt) : 'Sin registrar'}</p>
        {selected.length === 2 && <div className="overflow-x-auto"><h3>Comparación de solicitudes</h3><p className="text-muted text-sm">Resoluciones diferentes pueden corresponder a solicitudes y momentos distintos.</p><table className="student-history-comparison"><thead><tr><th scope="col">Dato</th>{selected.map(t => <th scope="col" key={t.id}>{t.externalCaseId ?? 'Manual'} · {t.id.slice(0, 8)}</th>)}</tr></thead><tbody>{fields.map(([label, read]) => <tr key={label} className={read(selected[0]!) !== read(selected[1]!) ? 'bg-surface-2' : ''}><th scope="row">{label}</th>{selected.map(t => <td key={t.id}>{value(read(t))}</td>)}</tr>)}</tbody></table><HistoryComparisonDetails tickets={selected} /><Button onClick={() => setSelected([])}>Limpiar comparación</Button></div>}
        <ol className="student-history-timeline">{data.cases.filter(ticket => !embedded || ticket.id !== caseId).map(ticket => <li key={ticket.id}>
          <div className="flex flex-wrap items-center justify-between gap-3"><h3>{ticket.externalCaseId ?? 'Expediente manual'}{ticket.id === caseId ? ' · Actual' : ''}</h3><a href={'#/casos/' + ticket.id}>Abrir expediente</a></div>
          <time>{formatDateTime(ticket.createdAt)}</time><span> · {CASE_STATUS_LABELS[ticket.status]}</span>
          <dl>{fields.filter(([label]) => !['Creación', 'Ticket CaVe'].includes(label)).map(([label, read]) => <div key={label}><dt>{label}</dt><dd>{value(read(ticket))}</dd></div>)}</dl>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.some(t => t.id === ticket.id)} disabled={selected.length === 2 && !selected.some(t => t.id === ticket.id)} onChange={e => setSelected(old => e.target.checked ? [...old, ticket] : old.filter(t => t.id !== ticket.id))} />Comparar solicitud (elige dos)</label>
          <Entry caseId={caseId} ticket={ticket} onSelectAudit={onSelectAudit} />
        </li>)}</ol>
        <nav className="flex items-center gap-3" aria-label="Páginas del historial"><Button disabled={offset === 0 || busy} onClick={() => { setBusy(true); setOffset(Math.max(0, offset - 25)); }}>Anterior</Button><span>Página {Math.floor(offset / 25) + 1}</span><Button disabled={data.nextOffset === null || busy} onClick={() => { setBusy(true); setOffset(data.nextOffset!); }}>Siguiente</Button></nav>
      </>}
    </div>}
  </section>;
}

