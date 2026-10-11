import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { getIncidents, toErrorState, updateIncident } from '../lib/api';
import type { IncidentStatus, IncidentTicketDto, SanitizedErrorDto } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { Button, ErrorCard, Panel, Spinner } from './ui';

const STATUS_LABEL: Record<IncidentStatus, string> = { OPEN: 'Abierto', IN_PROGRESS: 'En seguimiento', RESOLVED: 'Resuelto' };

export function IncidentsPage({ previewOnly = false }: { previewOnly?: boolean }): ReactNode {
  const [tickets, setTickets] = useState<IncidentTicketDto[]>([]);
  const [errors, setErrors] = useState<SanitizedErrorDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const result = await getIncidents();
      setTickets(result.tickets);
      setErrors(result.errors);
      setLoadError(null);
    } catch (error) {
      setLoadError(toErrorState(error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { if (!previewOnly) void load(); }, [load, previewOnly]);

  if (previewOnly) {
    return (
      <div className="flex flex-col gap-5">
        <header><p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">Administración</p><h1 className="mt-1 text-2xl font-semibold text-ink">Incidencias</h1><p className="mt-1 text-sm text-muted">Ejemplo local con datos ficticios; esta vista no consulta la API.</p></header>
        <Panel title="Tickets de ejemplo" description="En la sesión autenticada, los usuarios ven sus reportes y el Gerente administra todos.">
          <article className="rounded-xl border border-line bg-surface-2/60 p-4"><div className="flex flex-wrap justify-between gap-2"><strong className="text-sm text-ink">INC-DEMO-001 · Expedientes</strong><span className="text-xs text-muted">En seguimiento · 11 oct 2026</span></div><p className="mt-2 text-sm text-ink">Ejemplo ficticio: no se puede abrir la vista previa de un expediente.</p><p className="mt-3 border-l border-line pl-3 text-xs text-muted">Reporte recibido · Ejemplo de seguimiento</p></article>
        </Panel>
        <Panel title="Registro de errores de ejemplo" description="Solo se almacenan metadatos saneados en la aplicación autenticada."><p className="text-sm text-muted">Ejemplo: BACKEND · Expedientes · DATABASE_ERROR · correlación local</p></Panel>
      </div>
    );
  }

  const update = async (ticket: IncidentTicketDto, status: IncidentStatus): Promise<void> => {
    setBusyId(ticket.id);
    try {
      await updateIncident({ ticketId: ticket.id, status, comment: comments[ticket.id] ?? '' });
      setComments((current) => ({ ...current, [ticket.id]: '' }));
      await load();
    } catch (error) {
      setLoadError(toErrorState(error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">Administración</p><h1 className="mt-1 text-2xl font-semibold text-ink">Incidencias</h1><p className="mt-1 text-sm text-muted">Tickets de usuarios y errores operativos saneados.</p></div><Button variant="secondary" onClick={() => void load()} disabled={loading}>Actualizar</Button></header>
      {loadError && <ErrorCard title="No se pudo cargar la información" message={loadError} />}
      <Panel title={`Tickets${tickets.length ? ` · ${tickets.length}` : ''}`} description="Cada actualización conserva su historial y la fecha de seguimiento.">
        {loading ? <div className="flex min-h-32 items-center justify-center"><Spinner label="Cargando tickets" /></div> : tickets.length === 0 ? <p className="py-6 text-sm text-muted">No hay tickets registrados.</p> : (
          <div className="flex flex-col divide-y divide-line">
            {tickets.map((ticket) => (
              <article key={ticket.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><h2 className="font-semibold text-ink">INC-{ticket.id.slice(0, 8).toUpperCase()} · {ticket.module}</h2><p className="mt-1 text-xs text-muted">{ticket.reporter_email} · {formatDateTime(ticket.created_at)} · {STATUS_LABEL[ticket.status]}</p></div>
                  <label className="flex items-center gap-2 text-xs text-muted">Estado<select aria-label={`Estado del ticket ${ticket.id.slice(0, 8)}`} value={ticket.status} onChange={(event) => void update(ticket, event.target.value as IncidentStatus)} disabled={busyId === ticket.id} className="rounded-lg border border-line bg-surface-2 px-2 py-1 text-ink">{Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm text-ink">{ticket.description}</p>
                {ticket.context.route && <p className="mt-2 text-xs text-muted">Vista: {ticket.context.route}{ticket.context.correlationId ? ` · correlación ${ticket.context.correlationId}` : ''}</p>}
                {ticket.events.length > 0 && <ol className="mt-3 flex flex-col gap-2 border-l border-line pl-3">{ticket.events.map((event) => <li key={event.id} className="text-xs text-muted"><time>{formatDateTime(event.created_at)}</time><span> · {event.body}</span></li>)}</ol>}
                <div className="mt-3 flex flex-wrap gap-2"><input aria-label={`Comentario para el ticket ${ticket.id.slice(0, 8)}`} maxLength={5000} value={comments[ticket.id] ?? ''} onChange={(event) => setComments((current) => ({ ...current, [ticket.id]: event.target.value }))} placeholder="Agregar seguimiento" className="min-w-48 flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink" /><Button variant="secondary" onClick={() => void update(ticket, ticket.status)} disabled={busyId === ticket.id || !(comments[ticket.id] ?? '').trim()} loading={busyId === ticket.id}>Agregar comentario</Button></div>
              </article>
            ))}
          </div>
        )}
      </Panel>
      <Panel title={`Errores de aplicación${errors.length ? ` · ${errors.length}` : ''}`} description="Solo metadatos saneados; no se guardan stacks, mensajes crudos, cuerpos, tokens ni secretos.">
        {loading ? <div className="flex min-h-24 items-center justify-center"><Spinner label="Cargando errores" /></div> : errors.length === 0 ? <p className="py-5 text-sm text-muted">No hay errores técnicos reportados.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead><tr className="border-b border-line text-xs text-muted"><th className="py-2 pr-3">Fecha</th><th className="py-2 pr-3">Origen</th><th className="py-2 pr-3">Módulo / ruta</th><th className="py-2 pr-3">Categoría</th><th className="py-2">Correlación</th></tr></thead><tbody>{errors.map((item, index) => <tr key={`${item.correlation_id}-${index}`} className="border-b border-line/60"><td className="py-2 pr-3 text-muted">{formatDateTime(item.created_at)}</td><td className="py-2 pr-3">{item.source}</td><td className="py-2 pr-3"><span>{item.module}</span><small className="block text-muted">{item.route}</small></td><td className="py-2 pr-3">{item.category}</td><td className="py-2 font-mono text-xs">{item.correlation_id}</td></tr>)}</tbody></table></div>
        )}
      </Panel>
    </div>
  );
}
