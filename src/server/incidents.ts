import type { InsForgeClient } from './insforge.js';
import type { AuthContext } from './auth.js';
import { ApiError, mapProviderError } from './errors.js';

export const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const INCIDENT_MODULES = ['Resumen', 'Calidad', 'IA y Costos', 'Expedientes', 'Nueva auditoría', 'Incidencias', 'Otro'] as const;
export type IncidentModule = (typeof INCIDENT_MODULES)[number];

export interface TicketRow {
  id: string;
  reporter_user_id: string;
  reporter_email: string;
  module: IncidentModule;
  description: string;
  status: TicketStatus;
  context: { route?: string; correlationId?: string };
  created_at: string;
  updated_at: string;
}

export interface TicketEventRow {
  id: string;
  ticket_id: string;
  author_user_id: string;
  event_type: 'CREATED' | 'COMMENT' | 'STATUS_CHANGED';
  body: string;
  previous_status: TicketStatus | null;
  next_status: TicketStatus | null;
  created_at: string;
}

export interface SanitizedErrorEvent {
  correlation_id: string;
  source: 'FRONTEND' | 'BACKEND' | 'ASYNC';
  category: string;
  module: string;
  route: string;
  created_at: string;
}

function dbFailure(error: unknown): never {
  throw mapProviderError(error, 'DATABASE_ERROR');
}

function safeRoute(value: string): string {
  const path = value.split(/[?#]/, 1)[0]?.slice(0, 160) ?? '';
  if (!/^#\/[a-z0-9/-]{0,100}$/i.test(path)) return '#/';
  return path.replace(/(\/casos)\/[a-f0-9-]{8,64}(?=\/|$)/i, '$1/:id');
}

function contextForTicket(context: unknown): TicketRow['context'] {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return {};
  const value = context as Record<string, unknown>;
  const route = typeof value.route === 'string' ? safeRoute(value.route) : undefined;
  const correlationId = typeof value.correlationId === 'string' && /^[0-9a-f-]{36}$/i.test(value.correlationId) ? value.correlationId : undefined;
  return { ...(route ? { route } : {}), ...(correlationId ? { correlationId } : {}) };
}

export async function createTicket(
  client: InsForgeClient,
  auth: AuthContext,
  input: { module: IncidentModule; description: string; context?: unknown },
): Promise<TicketRow> {
  const description = input.description.trim();
  if (description.length < 10 || description.length > 5000) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Describe el problema con entre 10 y 5,000 caracteres.');
  }
  const context = contextForTicket(input.context);
  const { data, error } = await client.database.from('app_tickets').insert([{
    reporter_user_id: auth.sub,
    reporter_email: auth.email,
    module: input.module,
    description,
    status: 'OPEN',
    context,
  }]).select('*').single();
  if (error || !data) dbFailure(error);
  const ticket = data as TicketRow;
  const { error: eventError } = await client.database.from('app_ticket_events').insert([{
    ticket_id: ticket.id,
    author_user_id: auth.sub,
    event_type: 'CREATED',
    body: 'Incidencia recibida.',
    previous_status: null,
    next_status: 'OPEN',
  }]);
  if (eventError) dbFailure(eventError);
  return ticket;
}

export async function listTickets(client: InsForgeClient, auth: AuthContext, canManage: boolean): Promise<Array<TicketRow & { events: TicketEventRow[] }>> {
  let query = client.database.from('app_tickets').select('*').order('created_at', { ascending: false }).limit(200);
  if (!canManage) query = query.eq('reporter_user_id', auth.sub);
  const { data, error } = await query;
  if (error || !data) dbFailure(error);
  const tickets = data as TicketRow[];
  if (tickets.length === 0) return [];
  const { data: eventsData, error: eventsError } = await client.database
    .from('app_ticket_events').select('*').in('ticket_id', tickets.map((ticket) => ticket.id)).order('created_at', { ascending: true });
  if (eventsError || !eventsData) dbFailure(eventsError);
  const eventsByTicket = new Map<string, TicketEventRow[]>();
  for (const event of eventsData as TicketEventRow[]) {
    const rows = eventsByTicket.get(event.ticket_id) ?? [];
    rows.push(event);
    eventsByTicket.set(event.ticket_id, rows);
  }
  return tickets.map((ticket) => ({ ...ticket, events: eventsByTicket.get(ticket.id) ?? [] }));
}

export async function updateTicket(
  client: InsForgeClient,
  auth: AuthContext,
  input: { ticketId: string; status: TicketStatus; comment: string },
): Promise<TicketRow> {
  const { data: existingData, error: existingError } = await client.database
    .from('app_tickets').select('*').eq('id', input.ticketId).single();
  if (existingError || !existingData) dbFailure(existingError);
  const existing = existingData as TicketRow;
  const comment = input.comment.trim();
  if (comment.length > 5000) throw new ApiError(400, 'VALIDATION_ERROR', 'El comentario no puede superar 5,000 caracteres.');
  const { data, error } = await client.database.from('app_tickets').update({ status: input.status, updated_at: new Date().toISOString() })
    .eq('id', input.ticketId).select('*').single();
  if (error || !data) dbFailure(error);
  if (comment || existing.status !== input.status) {
    const { error: eventError } = await client.database.from('app_ticket_events').insert([{
      ticket_id: input.ticketId,
      author_user_id: auth.sub,
      event_type: existing.status !== input.status ? 'STATUS_CHANGED' : 'COMMENT',
      body: comment || `Estado actualizado a ${input.status}.`,
      previous_status: existing.status,
      next_status: input.status,
    }]);
    if (eventError) dbFailure(eventError);
  }
  return data as TicketRow;
}

export async function addTicketComment(
  client: InsForgeClient,
  auth: AuthContext,
  input: { ticketId: string; comment: string; canManage: boolean },
): Promise<void> {
  const { data, error } = await client.database.from('app_tickets').select('id,reporter_user_id,status').eq('id', input.ticketId).single();
  if (error || !data) dbFailure(error);
  const ticket = data as { id: string; reporter_user_id: string; status: TicketStatus };
  if (!input.canManage && ticket.reporter_user_id !== auth.sub) {
    throw new ApiError(404, 'NOT_FOUND', 'Ticket no encontrado.');
  }
  const comment = input.comment.trim();
  if (comment.length < 1 || comment.length > 5000) throw new ApiError(400, 'VALIDATION_ERROR', 'El comentario debe tener entre 1 y 5,000 caracteres.');
  const { error: eventError } = await client.database.from('app_ticket_events').insert([{
    ticket_id: input.ticketId,
    author_user_id: auth.sub,
    event_type: 'COMMENT',
    body: comment,
    previous_status: ticket.status,
    next_status: ticket.status,
  }]);
  if (eventError) dbFailure(eventError);
  const { error: updateError } = await client.database.from('app_tickets').update({ updated_at: new Date().toISOString() }).eq('id', input.ticketId);
  if (updateError) dbFailure(updateError);
}

/** Store only enumerated diagnostic metadata; never raw error messages or stacks. */
export async function recordSanitizedError(client: InsForgeClient, event: Omit<SanitizedErrorEvent, 'created_at'>): Promise<void> {
  const allowedModules = new Set<string>(INCIDENT_MODULES);
  const { error } = await client.database.from('app_error_events').insert([{
    correlation_id: event.correlation_id,
    source: event.source,
    category: event.category.slice(0, 80),
    module: allowedModules.has(event.module) ? event.module : 'Otro',
    route: safeRoute(event.route),
  }]);
  if (error) dbFailure(error);
}

export async function listSanitizedErrors(client: InsForgeClient): Promise<SanitizedErrorEvent[]> {
  const { data, error } = await client.database.from('app_error_events').select('*').order('created_at', { ascending: false }).limit(500);
  if (error || !data) dbFailure(error);
  return data as SanitizedErrorEvent[];
}
