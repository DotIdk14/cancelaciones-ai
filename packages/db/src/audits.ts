import { canTransitionAuditStatus, isTerminalAuditStatus, type AuditStatus } from '@cancelaciones/shared';
import type { DatabaseClient } from './client';
import { NotFoundError, TerminalStateError } from './errors';
import { asText } from './rows';

const TABLE = 'audits';
const COLUMNS = 'id,status,external_case_id,created_by,display_name,class_start_date,ticket_start_at,student_name,student_enrollment,created_at,updated_at';

interface Row { id: string; status: AuditStatus; external_case_id?: string | null; created_by: string; display_name?: string | null; class_start_date?: string | null; ticket_start_at?: string | null; student_name?: string | null; student_enrollment?: string | null; created_at: string; updated_at: string; }

export interface AuditRecord { id: string; status: AuditStatus; externalCaseId: string | null; createdBy: string; displayName: string | null; classStartDate: string | null; ticketStartAt: string | null; studentName: string | null; studentEnrollment: string | null; createdAt: string; updatedAt: string; }
export interface CreateAuditInput { createdBy: string; displayName?: string | null; externalCaseId?: string | null; classStartDate?: string | null; ticketStartAt?: string | null; studentName?: string | null; studentEnrollment?: string | null; }

function toRecord(row: Row): AuditRecord {
  return { id: row.id, status: row.status, externalCaseId: asText(row.external_case_id), createdBy: row.created_by, displayName: asText(row.display_name), classStartDate: asText(row.class_start_date), ticketStartAt: asText(row.ticket_start_at), studentName: asText(row.student_name), studentEnrollment: asText(row.student_enrollment), createdAt: row.created_at, updatedAt: row.updated_at };
}

export function createAuditRepository(database: DatabaseClient) {
  async function findRow(id: string): Promise<Row | null> {
    const { data, error } = await database.from(TABLE).select(COLUMNS).eq('id', id).limit(1);
    if (error) throw new Error(error.message ?? `No se pudo leer la auditoria ${id}.`);
    const rows = (data ?? []) as Row[];
    return rows[0] ?? null;
  }

  return {
    async listRecent(limit = 50): Promise<AuditRecord[]> {
      const { data, error } = await database.from(TABLE).select(COLUMNS).order('created_at', { ascending: false }).limit(limit);
      if (error) throw new Error(error.message ?? 'No se pudieron listar las auditorias.');
      return ((data ?? []) as Row[]).map(toRecord);
    },

    async create(input: CreateAuditInput): Promise<AuditRecord> {
      const { data, error } = await database.from(TABLE).insert([{ status: 'DRAFT', created_by: input.createdBy, display_name: input.displayName ?? null, external_case_id: input.externalCaseId ?? null, class_start_date: input.classStartDate ?? null, ticket_start_at: input.ticketStartAt ?? null, student_name: input.studentName ?? null, student_enrollment: input.studentEnrollment ?? null }]).select(COLUMNS).single();
      if (error) throw new Error(error.message ?? 'No se pudo crear la auditoria.');
      if (!data) throw new Error('La base no devolvio la auditoria recien creada.');
      return toRecord(data as Row);
    },

    async findById(id: string): Promise<AuditRecord | null> {
      const row = await findRow(id);
      return row ? toRecord(row) : null;
    },

    async updateStatus(id: string, status: AuditStatus): Promise<AuditRecord> {
      const current = await findRow(id);
      if (!current) throw new NotFoundError('audit', id);
      if (isTerminalAuditStatus(current.status)) throw new TerminalStateError(`La auditoria ${id} esta en estado terminal ${current.status}.`);
      if (!canTransitionAuditStatus(current.status, status)) throw new Error(`ILLEGAL_AUDIT_STATUS_TRANSITION: ${current.status} -> ${status}`);
      const { data, error } = await database.from(TABLE).update({ status }).eq('id', id).select(COLUMNS).single();
      if (error) throw new Error(error.message ?? `No se pudo actualizar la auditoria ${id}.`);
      if (!data) throw new NotFoundError('audit', id);
      return toRecord(data as Row);
    },

    async deleteAudit(id: string, reason?: string | null): Promise<unknown> {
      if (!database.rpc) throw new Error('La base no soporta RPC delete_audit.');
      const { data, error } = await database.rpc('delete_audit', { p_audit_id: id, p_reason: reason ?? null });
      if (error) throw new Error(error.message ?? `No se pudo borrar la auditoria ${id}.`);
      return data;
    },
  };
}

export type AuditRepository = ReturnType<typeof createAuditRepository>;
