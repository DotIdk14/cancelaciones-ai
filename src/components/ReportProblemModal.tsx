import type { FormEvent, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { addIncidentComment, getIncidents, reportProblem, toErrorState } from '../lib/api';
import type { IncidentModule, IncidentTicketDto } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { Button, ErrorCard } from './ui';

const MODULES: IncidentModule[] = ['Resumen', 'Calidad', 'IA y Costos', 'Expedientes', 'Nueva auditoría', 'Incidencias', 'Otro'];

export function ReportProblemModal({
  module,
  context,
  onClose,
}: {
  module: IncidentModule;
  context: { route?: string; correlationId?: string };
  onClose: () => void;
}): ReactNode {
  const [selectedModule, setSelectedModule] = useState<IncidentModule>(module);
  const [description, setDescription] = useState('');
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tickets, setTickets] = useState<IncidentTicketDto[]>([]);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busyTicket, setBusyTicket] = useState<string | null>(null);

  const refreshTickets = async (): Promise<void> => {
    try {
      const result = await getIncidents();
      setTickets(result.tickets);
    } catch (cause) {
      setError(toErrorState(cause).message);
    }
  };

  useEffect(() => { void refreshTickets(); }, []);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (description.trim().length < 10 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const ticket = await reportProblem({ module: selectedModule, description, context });
      setTicketId(ticket.id);
      await refreshTickets();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo enviar el reporte.');
    } finally {
      setSubmitting(false);
    }
  };

  const addComment = async (ticket: IncidentTicketDto): Promise<void> => {
    const comment = (comments[ticket.id] ?? '').trim();
    if (!comment || busyTicket) return;
    setBusyTicket(ticket.id);
    setError(null);
    try {
      await addIncidentComment({ ticketId: ticket.id, comment });
      setComments((current) => ({ ...current, [ticket.id]: '' }));
      await refreshTickets();
    } catch (cause) {
      setError(toErrorState(cause).message);
    } finally {
      setBusyTicket(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="report-problem-title" className="w-full max-w-xl rounded-2xl border border-line bg-surface-1 p-5 shadow-xl">
        <header className="flex items-start justify-between gap-4">
          <div><h2 id="report-problem-title" className="text-lg font-semibold text-ink">Reportar un problema</h2><p className="mt-1 text-sm text-muted">Describe lo que ocurrió. Se adjunta contexto básico de la vista para facilitar el seguimiento.</p></div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Cerrar"><X size={18} /></button>
        </header>
        {ticketId && (
          <div className="mt-6 rounded-xl border border-success/40 bg-success/10 p-4">
            <strong className="text-ink">Reporte recibido</strong>
            <p className="mt-1 text-sm text-muted">Identificador: <code>INC-{ticketId.slice(0, 8).toUpperCase()}</code> · Estado: Abierto</p>
          </div>
        )}
        {!ticketId && (
          <form className="mt-5 flex flex-col gap-4" onSubmit={(event) => void submit(event)} aria-busy={submitting}>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Módulo afectado
              <select value={selectedModule} onChange={(event) => setSelectedModule(event.target.value as IncidentModule)} className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-ink">
                {MODULES.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Descripción
              <textarea required minLength={10} maxLength={5000} rows={5} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="¿Qué intentabas hacer y qué pasó?" className="resize-y rounded-lg border border-line bg-surface-2 px-3 py-2 text-ink" />
              <span className="text-xs font-normal text-muted">{description.length}/5,000</span>
            </label>
            {(context.route || context.correlationId) && <p className="text-xs text-muted">Contexto incluido: {context.route ?? 'vista actual'}{context.correlationId ? ` · correlación ${context.correlationId}` : ''}</p>}
            {error && <ErrorCard title="No se pudo enviar el reporte" message={error} />}
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={submitting}>Cancelar</Button><Button variant="primary" type="submit" loading={submitting} loadingLabel="Enviando" disabled={description.trim().length < 10}>Enviar reporte</Button></div>
          </form>
        )}
        <section className="mt-6 border-t border-line pt-4" aria-labelledby="my-incidents-title">
          <h3 id="my-incidents-title" className="text-sm font-semibold text-ink">Mis reportes</h3>
          {tickets.length === 0 ? <p className="mt-2 text-xs text-muted">Aún no tienes reportes.</p> : (
            <ul className="mt-3 max-h-64 space-y-3 overflow-y-auto pr-1">
              {tickets.map((ticket) => (
                <li key={ticket.id} className="rounded-xl border border-line bg-surface-2/60 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm text-ink">INC-{ticket.id.slice(0, 8).toUpperCase()} · {ticket.module}</strong><span className="text-xs text-muted">{ticket.status === 'OPEN' ? 'Abierto' : ticket.status === 'IN_PROGRESS' ? 'En seguimiento' : 'Resuelto'} · {formatDateTime(ticket.updated_at)}</span></div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{ticket.description}</p>
                  {ticket.events.length > 1 && <ol className="mt-2 space-y-1 border-l border-line pl-3">{ticket.events.slice(1).map((event) => <li key={event.id} className="text-xs text-muted"><time>{formatDateTime(event.created_at)}</time> · {event.body}</li>)}</ol>}
                  <div className="mt-3 flex gap-2"><input aria-label={`Seguimiento para INC-${ticket.id.slice(0, 8)}`} maxLength={5000} value={comments[ticket.id] ?? ''} onChange={(event) => setComments((current) => ({ ...current, [ticket.id]: event.target.value }))} placeholder="Agregar información" className="min-w-0 flex-1 rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-ink" /><Button variant="secondary" onClick={() => void addComment(ticket)} disabled={busyTicket === ticket.id || !(comments[ticket.id] ?? '').trim()} loading={busyTicket === ticket.id}>Enviar</Button></div>
                </li>
              ))}
            </ul>
          )}
        </section>
        {error && <div className="mt-4"><ErrorCard title="No se pudo completar la acción" message={error} /></div>}
        <div className="mt-4 flex justify-end"><Button variant="secondary" onClick={onClose}>Cerrar</Button></div>
      </section>
    </div>
  );
}
