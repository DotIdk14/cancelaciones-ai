import { describe, expect, it, vi } from 'vitest';
import { classifyFlokzu, resolveFlokzuEligibility, type AdministrativeData } from '../src/shared/flokzu-review';
import { FlokzuDecisionSchema, decideFlokzuTicket, listFlokzuReview, getFlokzuTicket } from '../src/server/flokzu-review';
import { fakeAuthContext } from './helpers/auth';
import type { InsForgeClient } from '../src/server/insforge';

const id = '10000000-0000-4000-8000-000000000001';
const data = (status: string | null, final: string | null, task = '[BACKOFFICE] [REVISION BO] [CV]'): AdministrativeData => ({
  operations: { statusReported: status, finalizedReported: final, currentTask: task }, procedure: { motive: null, description: null },
});
describe('conciliación administrativa Flokzu', () => {
  it.each([
    ['RECHAZADA', 'No', undefined, 'REJECTED'], ['FINALIZADO', 'Sí', undefined, 'FINALIZED'],
    ['REVISIÓN', 'No', undefined, 'ACTIVE'], ['REVISIÓN', 'Sí', undefined, 'VERIFY'],
    ['FINALIZADO', 'No', undefined, 'VERIFY'], ['REVISIÓN', 'No', '[HD] [REVISION REPLICA] [CV]', 'OTHER_STAGE'],
    [null, null, '', 'VERIFY'], ['desconocido', 'No', undefined, 'VERIFY'], ['REVISIÓN', 'algo', undefined, 'VERIFY'],
  ])('Estado %s y Finalizado %s en %s → %s', (status, final, task, expected) => {
    expect(classifyFlokzu(data(status, final, task)).classification).toBe(expected);
  });
  it('el contexto administrativo puede exigir verificación, sin crear un dictamen', () => {
    const source = { ...data('REVISIÓN', 'No'), administrativeComments: [{ label: 'Observación', value: 'Solicitud rechazada por error administrativo' }] };
    expect(classifyFlokzu(source)).toMatchObject({ classification: 'VERIFY', discrepancy: true });
    expect(source.operations.statusReported).toBe('REVISIÓN');
  });
  it.each([
    ['RECHAZADA', 'CANCELADO POR HELPDESK', 'CANCELADO POR HELPDESK', 'REJECTED'],
    ['APLICA', null, '[SER] [APLICACION] [CV]', 'OTHER_STAGE'],
    ['DICTAMINAR', null, '[DICTAMINADOR] [DICTAMINAR] [CV]', 'OTHER_STAGE'],
    ['REVISIÓN', 'RETENCION POR AJUSTE', 'RETENCION POR AJUSTE', 'VERIFY'],
    ['REVISIÓN', 'CANCELADO POR HELPDESK', 'CANCELADO POR HELPDESK', 'VERIFY'],
    ['APLICA', null, '[BACKOFFICE] [REVISION BO] [CV]', 'VERIFY'],
  ])('reconoce el estado %s en su etapa y conserva contradicciones', (status, final, task, expected) => {
    const result = classifyFlokzu(data(status, final, task));
    expect(result.classification).toBe(expected);
    expect(result.reason).toContain(task);
    expect(result.nextStep).toBeTruthy();
  });
  it('explica el campo y valor contradictorio y la acción para verificarlo', () => {
    const result = classifyFlokzu(data('REVISIÓN', 'Sí'));
    expect(result.reason).toContain('Estado = “REVISIÓN”');
    expect(result.reason).toContain('Finalizado = “Sí”');
    expect(result.nextStep).toContain('Flokzu');
    const context = classifyFlokzu({ ...data('REVISIÓN', null), administrativeComments: [{ label: 'Comentarios HelpDesk', value: 'Ticket cerrado' }] });
    expect(context.reason).toContain('Comentarios HelpDesk');
    expect(classifyFlokzu(data('REVISIÓN', 'valor no reconocido')).reason).toContain('Finalizado = “valor no reconocido”');
  });
  it('muestra diagnósticos claros y canal reportado de tickets existentes sin escribir ni reclasificar su estado durable', async () => {
    const row = { id, external_case_id: 'CaVe-123', student_identifier: 'TEST', student_name: 'Estudiante sintético',
      flokzu_classification: 'VERIFY', flokzu_review_state: 'PENDING', flokzu_audit_eligible: false, flokzu_discrepancy: true,
      flokzu_reason: 'Mensaje anterior ambiguo', flokzu_revision: 4, assigned_to: id, updated_at: '2026-10-14T12:00:00Z',
      flokzu_data: { ...data('APLICA', null, '[SER] [APLICACION] [CV]'), academic: {}, operations: { ...data('APLICA', null, '[SER] [APLICACION] [CV]').operations, salesChannelReported: 'INC_INCONCERT' } } };
    const client = { database: { from: vi.fn((table: string) => {
      const q = { select: () => q, eq: () => q, order: () => q,
        limit: async () => ({ data: [row], error: null }), range: async () => ({ data: [], error: null }) };
      expect(['cases', 'flokzu_admin_events']).toContain(table);
      return q;
    }), rpc: vi.fn() } };
    const result = await getFlokzuTicket(client as unknown as InsForgeClient, fakeAuthContext('coordinator'), id) as { ticket: Record<string, unknown> };
    expect(result.ticket).toMatchObject({ classification: 'VERIFY', reviewState: 'PENDING', revision: 4, assignedTo: id, salesChannelReported: 'INC_INCONCERT', currentTask: '[SER] [APLICACION] [CV]' });
    expect(result.ticket.reason).toContain('[SER] [APLICACION] [CV]');
    expect(client.database.rpc).not.toHaveBeenCalled();
  });
  it('una nueva exportación no anula reactivaciones, cierres ni pendientes manuales', () => {
    expect(resolveFlokzuEligibility('REJECTED', 'REACTIVATED')).toBe(true);
    expect(resolveFlokzuEligibility('ACTIVE', 'CLOSED')).toBe(false);
    expect(resolveFlokzuEligibility('ACTIVE', 'PENDING')).toBe(false);
    expect(resolveFlokzuEligibility('REJECTED', 'OPEN')).toBe(false);
  });
  it('exige confirmación para cerrar y motivo y Asesor para reactivar', () => {
    expect(FlokzuDecisionSchema.safeParse({ caseId: id, revision: 0, action: 'CLOSE' }).success).toBe(false);
    expect(FlokzuDecisionSchema.safeParse({ caseId: id, revision: 0, action: 'CLOSE', confirmed: true }).success).toBe(true);
    expect(FlokzuDecisionSchema.safeParse({ caseId: id, revision: 0, action: 'REACTIVATE', reason: 'Corregir etapa' }).success).toBe(false);
    expect(FlokzuDecisionSchema.safeParse({ caseId: id, revision: 0, action: 'REACTIVATE', reason: 'Corregir etapa', assignedTo: id }).success).toBe(true);
  });
  it('rechaza atribución falsificada y cuerpos con campos extra', () => {
    expect(FlokzuDecisionSchema.safeParse({ caseId: id, revision: 0, action: 'PENDING', actor: id }).success).toBe(false);
  });
  it.each(['user', 'manager'] as const)('%s no consulta ni decide mediante el servicio', async role => {
    const rpc = vi.fn(); const from = vi.fn();
    const client = { database: { rpc, from } } as unknown as InsForgeClient;
    await expect(decideFlokzuTicket(client, fakeAuthContext(role), { caseId: id, revision: 0, action: 'PENDING' })).rejects.toMatchObject({ status: 403 });
    await expect(listFlokzuReview(client, fakeAuthContext(role), {})).rejects.toMatchObject({ status: 403 });
    expect(rpc).not.toHaveBeenCalled(); expect(from).not.toHaveBeenCalled();
  });
  it('el servidor atribuye la decisión al actor verificado y reutiliza el CaVe existente', async () => {
    const actor = fakeAuthContext('coordinator');
    const rpc = vi.fn().mockResolvedValue({ data: { externalCaseId: 'CaVe-123', reviewState: 'REACTIVATED' }, error: null });
    const client = { database: { rpc } } as unknown as InsForgeClient;
    const input = { caseId: id, revision: 2, action: 'REACTIVATE' as const, reason: 'Etapa incorrecta', assignedTo: id };
    await expect(decideFlokzuTicket(client, actor, input)).resolves.toMatchObject({ externalCaseId: 'CaVe-123' });
    expect(rpc).toHaveBeenCalledWith('decide_flokzu_ticket', { p_actor: actor.sub, p_input: input });
  });
  it('un conflicto concurrente devuelve 409 en vez de sobrescribir la decisión', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: '40001' } });
    await expect(decideFlokzuTicket({ database: { rpc } } as unknown as InsForgeClient, fakeAuthContext('coordinator'), { caseId: id, revision: 1, action: 'PENDING' })).rejects.toMatchObject({ status: 409 });
  });
});
