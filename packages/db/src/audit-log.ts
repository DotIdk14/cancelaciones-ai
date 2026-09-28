import type { DatabaseClient } from './client';
import { asText } from './rows';

const COLUMNS = 'id,audit_id,event_type,actor_id,metadata,occurred_at';
interface Row { id: string; audit_id?: string | null; event_type: string; actor_id?: string | null; metadata: unknown; occurred_at: string; }
export interface AuditLogRecord { id: string; auditId: string | null; eventType: string; actorId: string | null; metadata: unknown; occurredAt: string; }
export interface RecordAuditLogInput { auditId?: string | null; eventType: string; actorId?: string | null; metadata?: unknown; }

function toRecord(row: Row): AuditLogRecord { return { id: row.id, auditId: asText(row.audit_id), eventType: row.event_type, actorId: asText(row.actor_id), metadata: row.metadata ?? {}, occurredAt: row.occurred_at }; }

export function createAuditLogRepository(database: DatabaseClient) {
  return {
    async record(input: RecordAuditLogInput): Promise<AuditLogRecord> { const { data, error } = await database.from('audit_log').insert([{ audit_id: input.auditId ?? null, event_type: input.eventType, actor_id: input.actorId ?? null, metadata: input.metadata ?? {} }]).select(COLUMNS).single(); if (error) throw new Error(error.message ?? 'No se pudo registrar bitacora.'); if (!data) throw new Error('La base no devolvio la entrada de bitacora.'); return toRecord(data as Row); },
    async listByAudit(auditId: string): Promise<AuditLogRecord[]> { const { data, error } = await database.from('audit_log').select(COLUMNS).eq('audit_id', auditId).order('occurred_at', { ascending: false }); if (error) throw new Error(error.message ?? `No se pudo listar bitacora de ${auditId}.`); return ((data ?? []) as Row[]).map(toRecord); },
  };
}

export type AuditLogRepository = ReturnType<typeof createAuditLogRepository>;
