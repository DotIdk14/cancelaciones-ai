import { z } from 'zod';
import type { InsForgeClient } from './insforge.js';
import type { AuthContext } from './auth.js';
import { capabilitiesForRole } from './capabilities.js';
import { ApiError, mapProviderError } from './errors.js';
import { FLOKZU_CLASSIFICATIONS, type FlokzuTicket, type FlokzuEvent, type FlokzuDecision } from '../shared/flokzu-review.js';

export function assertFlokzuCoordinator(actor: AuthContext): void {
  if (!capabilitiesForRole(actor.role).canImportCases) throw new ApiError(403, 'AUTH_ERROR', 'Solo un Coordinador puede administrar la revisión Flokzu.');
}
export const FlokzuDecisionSchema = z.object({
  caseId: z.string().uuid(), revision: z.number().int().min(0),
  action: z.enum(['CLOSE', 'REACTIVATE', 'REASSIGN', 'PENDING', 'DISCREPANCY']),
  reason: z.string().trim().max(2000).optional(), observation: z.string().trim().max(2000).optional(),
  assignedTo: z.string().uuid().nullable().optional(), confirmed: z.boolean().optional(),
}).strict().superRefine((v, ctx) => {
  const error = (path: string, message: string): void => ctx.addIssue({ code: 'custom', path: [path], message });
  if (v.action === 'CLOSE' && v.confirmed !== true) error('confirmed', 'Confirma el cierre administrativo.');
  if ((v.action === 'REACTIVATE' || v.action === 'DISCREPANCY') && !v.reason) error('reason', 'Escribe el motivo.');
  if (v.action === 'REACTIVATE' && !v.assignedTo) error('assignedTo', 'Selecciona un Asesor.');
  if (v.action === 'REASSIGN' && v.assignedTo === undefined) error('assignedTo', 'Selecciona el responsable o sin asignación.');
  if (v.assignedTo !== undefined && v.action !== 'REACTIVATE' && v.action !== 'REASSIGN') error('assignedTo', 'Esta acción no cambia la asignación.');
});
const Filters = z.object({
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
  classification: z.enum(FLOKZU_CLASSIFICATIONS).optional(),
  scope: z.enum(['pending', 'history', 'all', 'discrepancies']).default('pending'),
  search: z.string().trim().max(100).optional(), campus: z.string().max(200).optional(),
  policy: z.string().max(200).optional(), assignedTo: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();
type TicketRow = {
  id: string; external_case_id: string; student_identifier: string | null; student_name: string | null;
  flokzu_classification: FlokzuTicket['classification']; flokzu_review_state: FlokzuTicket['reviewState'];
  flokzu_audit_eligible: boolean; flokzu_discrepancy: boolean; flokzu_reason: string; flokzu_revision: number;
  assigned_to: string | null; updated_at: string; flokzu_data: {
    academic?: { campus?: string }; procedure?: { policyReported?: string; requestDate?: string };
  };
};
const columns = 'id,external_case_id,student_identifier,student_name,flokzu_classification,flokzu_review_state,flokzu_audit_eligible,flokzu_discrepancy,flokzu_reason,flokzu_revision,assigned_to,updated_at,flokzu_data';
function ticketDto(row: TicketRow): FlokzuTicket {
  return { id: row.id, externalCaseId: row.external_case_id, studentIdentifier: row.student_identifier,
    studentName: row.student_name, classification: row.flokzu_classification, reviewState: row.flokzu_review_state,
    eligible: row.flokzu_audit_eligible, discrepancy: row.flokzu_discrepancy, reason: row.flokzu_reason,
    revision: row.flokzu_revision, assignedTo: row.assigned_to, updatedAt: row.updated_at,
    campus: row.flokzu_data?.academic?.campus ?? null, policy: row.flokzu_data?.procedure?.policyReported ?? null,
    requestDate: row.flokzu_data?.procedure?.requestDate ?? null };
}
export async function listFlokzuReview(client: InsForgeClient, actor: AuthContext, input: unknown): Promise<unknown> {
  assertFlokzuCoordinator(actor);
  const parsed = Filters.safeParse(input);
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Los filtros de revisión Flokzu no son válidos.');
  const f = parsed.data;
  let query = client.database.from('cases').select(columns).eq('external_source', 'FLOKZU');
  if (f.scope === 'pending') query = query.eq('flokzu_audit_eligible', false).or('flokzu_review_state.neq.CLOSED,flokzu_discrepancy.eq.true');
  if (f.scope === 'history') query = query.eq('flokzu_review_state', 'CLOSED');
  if (f.scope === 'discrepancies') query = query.eq('flokzu_discrepancy', true);
  if (f.classification) query = query.eq('flokzu_classification', f.classification);
  if (f.campus) query = query.eq('flokzu_data->academic->>campus', f.campus);
  if (f.policy) query = query.eq('flokzu_data->procedure->>policyReported', f.policy);
  if (f.assignedTo) query = query.eq('assigned_to', f.assignedTo);
  if (f.from) query = query.gte('flokzu_data->procedure->>requestDate', f.from);
  if (f.to) query = query.lte('flokzu_data->procedure->>requestDate', f.to);
  if (f.search) {
    const search = f.search.replace(/[^\p{L}\p{N}\s-]/gu, ' ').trim();
    if (search) query = query.or(f.scope === 'pending'
      ? `and(or(flokzu_review_state.neq.CLOSED,flokzu_discrepancy.eq.true),or(external_case_id.ilike.%${search}%,student_identifier.ilike.%${search}%,student_name.ilike.%${search}%))`
      : `external_case_id.ilike.%${search}%,student_identifier.ilike.%${search}%,student_name.ilike.%${search}%`);
  }
  const { data, error } = await query.order('updated_at', { ascending: false }).order('id', { ascending: false }).range(f.offset, f.offset + 49);
  if (error) throw mapProviderError(error, 'DATABASE_ERROR');
  const count = async (kind: string): Promise<number> => {
    let q = client.database.from('cases').select('id', { head: true, count: 'exact' }).eq('external_source', 'FLOKZU');
    if (kind === 'pending') q = q.eq('flokzu_audit_eligible', false).or('flokzu_review_state.neq.CLOSED,flokzu_discrepancy.eq.true');
    else if (kind === 'discrepancies') q = q.eq('flokzu_discrepancy', true);
    else q = q.eq('flokzu_audit_eligible', false).eq('flokzu_classification', kind).neq('flokzu_review_state', 'CLOSED');
    const result = await q;
    if (result.error) throw mapProviderError(result.error, 'DATABASE_ERROR');
    return result.count ?? 0;
  };
  const counts = await Promise.all(['pending', 'REJECTED', 'FINALIZED', 'OTHER_STAGE', 'discrepancies'].map(count));
  return { tickets: ((data as TicketRow[] | null) ?? []).map(ticketDto), nextOffset: data?.length === 50 ? f.offset + 50 : null,
    counts: { pending: counts[0], rejected: counts[1], finalized: counts[2], otherStage: counts[3], discrepancies: counts[4] } };
}
export async function getFlokzuTicket(client: InsForgeClient, actor: AuthContext, caseId: string, offset = 0): Promise<unknown> {
  assertFlokzuCoordinator(actor);
  const { data, error } = await client.database.from('cases').select(columns).eq('id', caseId).eq('external_source', 'FLOKZU').limit(1);
  if (error) throw mapProviderError(error, 'DATABASE_ERROR');
  const row = data?.[0] as TicketRow | undefined;
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Ticket no encontrado.');
  const events = await client.database.from('flokzu_admin_events').select('id,action,actor,created_at,reason,before_snapshot,after_snapshot,batch_id')
    .eq('case_id', caseId).order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 49);
  if (events.error) throw mapProviderError(events.error, 'DATABASE_ERROR');
  const history = (events.data ?? []).map((event): FlokzuEvent => ({ id: event.id, action: event.action, actor: event.actor,
    createdAt: event.created_at, reason: event.reason, before: event.before_snapshot, after: event.after_snapshot, batchId: event.batch_id }));
  return { ticket: ticketDto(row), data: row.flokzu_data, history, historyNextOffset: history.length === 50 ? offset + 50 : null };
}
export async function decideFlokzuTicket(client: InsForgeClient, actor: AuthContext, input: FlokzuDecision): Promise<unknown> {
  assertFlokzuCoordinator(actor);
  const parsed = FlokzuDecisionSchema.safeParse(input);
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Decisión no válida.');
  const { data, error } = await client.database.rpc('decide_flokzu_ticket', { p_actor: actor.sub, p_input: parsed.data });
  if (error) {
    const code = typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (code === 'P0002') throw new ApiError(404, 'NOT_FOUND', 'Ticket no encontrado.');
    if (code === '40001') throw new ApiError(409, 'VALIDATION_ERROR', 'El ticket cambió. Actualiza el panel antes de decidir.');
    if (code === '22023') throw new ApiError(400, 'VALIDATION_ERROR', 'Revisa el motivo, responsable y observación de discrepancia.');
    if (code === '42501') throw new ApiError(403, 'AUTH_ERROR', 'Solo un Coordinador puede administrar Flokzu.');
    throw mapProviderError(error, 'DATABASE_ERROR');
  }
  return data;
}
