import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiRequest, ApiResponse } from '../src/server/http';
import handler from '../api/dashboard/[view]';
import { fakeAuthContext } from './helpers/auth';

const incidentsMocks = vi.hoisted(() => ({
  addTicketComment: vi.fn(async () => undefined),
  createTicket: vi.fn(async () => ({ id: 'ticket-1', reporter_user_id: 'user-1', reporter_email: 'user@example.com', module: 'Expedientes', description: 'No puedo abrir un caso.', status: 'OPEN', context: {}, created_at: '2026-10-11T00:00:00Z', updated_at: '2026-10-11T00:00:00Z' })),
  listSanitizedErrors: vi.fn(async () => [{ correlation_id: '00000000-0000-4000-8000-000000000001', source: 'BACKEND', category: 'DATABASE_ERROR', module: 'Expedientes', route: '/api/cases/:id', created_at: '2026-10-11T00:00:00Z' }]),
  listTickets: vi.fn(async (_client, _auth, _canManage) => []),
  recordSanitizedError: vi.fn(async () => undefined),
  updateTicket: vi.fn(async () => ({ id: 'ticket-1' })),
}));

vi.mock('../src/server/incidents.js', () => ({
  ...incidentsMocks,
  INCIDENT_MODULES: ['Resumen', 'Calidad', 'IA y Costos', 'Expedientes', 'Nueva auditoría', 'Incidencias', 'Otro'],
  TICKET_STATUSES: ['OPEN', 'IN_PROGRESS', 'RESOLVED'],
}));
vi.mock('../src/server/insforge.js', () => ({ createServerClient: () => ({}) }));

function response(): ApiResponse & { body: string } {
  const res = { statusCode: 0, headers: {} as Record<string, string>, body: '', setHeader(name: string, value: unknown) { this.headers[name] = String(value); }, end(body?: unknown) { this.body = typeof body === 'string' ? body : ''; } };
  return res as unknown as ApiResponse & { body: string };
}

async function call(method: string, role: 'user' | 'coordinator' | 'manager', body?: unknown) {
  const res = response();
  const req = { method, url: '/api/dashboard/incidents', headers: {}, query: { view: 'incidents' }, auth: fakeAuthContext(role), body } as unknown as ApiRequest;
  await handler(req, res);
  return res;
}

describe('incidencias · permisos y seguimiento', () => {
  beforeEach(() => vi.clearAllMocks());

  it('un usuario solo consulta sus tickets y no ve el registro de errores global', async () => {
    const res = await call('GET', 'coordinator');
    expect(res.statusCode).toBe(200);
    expect(incidentsMocks.listTickets).toHaveBeenCalledWith({}, expect.objectContaining({ role: 'coordinator' }), false);
    expect(incidentsMocks.listSanitizedErrors).not.toHaveBeenCalled();
    expect(JSON.parse(res.body).errors).toEqual([]);
  });

  it('el Gerente puede consultar todos los tickets y los errores saneados', async () => {
    const res = await call('GET', 'manager');
    expect(res.statusCode).toBe(200);
    expect(incidentsMocks.listTickets).toHaveBeenCalledWith({}, expect.objectContaining({ role: 'manager' }), true);
    expect(incidentsMocks.listSanitizedErrors).toHaveBeenCalledOnce();
  });

  it('un usuario puede crear ticket y agregar seguimiento mediante endpoints autenticados', async () => {
    const created = await call('POST', 'user', { kind: 'ticket', module: 'Expedientes', description: 'No puedo abrir un caso desde mi lista.' });
    expect(created.statusCode).toBe(201);
    expect(incidentsMocks.createTicket).toHaveBeenCalledOnce();
    const comment = await call('POST', 'user', { kind: 'ticket-comment', ticketId: '00000000-0000-4000-8000-000000000001', comment: 'Agrego un dato para el seguimiento.' });
    expect(comment.statusCode).toBe(200);
    expect(incidentsMocks.addTicketComment).toHaveBeenCalledWith({}, expect.anything(), expect.objectContaining({ canManage: false }));
  });

  it('solo el Gerente puede cambiar el estado administrativo de un ticket', async () => {
    const denied = await call('PATCH', 'coordinator', { ticketId: '00000000-0000-4000-8000-000000000001', status: 'RESOLVED' });
    expect(denied.statusCode).toBe(403);
    expect(incidentsMocks.updateTicket).not.toHaveBeenCalled();
    const allowed = await call('PATCH', 'manager', { ticketId: '00000000-0000-4000-8000-000000000001', status: 'RESOLVED' });
    expect(allowed.statusCode).toBe(200);
    expect(incidentsMocks.updateTicket).toHaveBeenCalledOnce();
  });
});
