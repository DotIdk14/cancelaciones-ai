import type { EvidenceContentStatus, EvidenceKind, EvidenceStatus } from '@cancelaciones/shared';
import type { DatabaseClient } from './client';
import { NotFoundError } from './errors';
import { asCount, asText } from './rows';

const TABLE = 'evidences';
const COLUMNS = 'id,audit_id,nombre_archivo,tipo,kind,storage_bucket,storage_key,storage_url,mime_type,detected_mime_type,size_bytes,sha256,original_filename,safe_filename,status,content_status,content_error,uploaded_by,created_at,updated_at';

interface Row { id: string; audit_id: string; nombre_archivo: string; tipo: string; kind: EvidenceKind; storage_bucket: string; storage_key?: string | null; storage_url?: string | null; mime_type?: string | null; detected_mime_type?: string | null; size_bytes?: number | null; sha256?: string | null; original_filename?: string | null; safe_filename?: string | null; status: EvidenceStatus; content_status: EvidenceContentStatus; content_error?: string | null; uploaded_by?: string | null; created_at: string; updated_at: string; }
export interface EvidenceRecord { id: string; auditId: string; filename: string; type: string; kind: EvidenceKind; storageBucket: string; storageKey: string | null; storageUrl: string | null; mimeType: string | null; detectedMimeType: string | null; sizeBytes: number; sha256: string | null; originalFilename: string | null; safeFilename: string | null; status: EvidenceStatus; contentStatus: EvidenceContentStatus; contentError: string | null; uploadedBy: string | null; createdAt: string; updatedAt: string; }
export interface CreatePendingEvidenceInput { id?: string; auditId: string; originalFilename: string; safeFilename: string; mimeType?: string | null; detectedMimeType?: string | null; kind: EvidenceKind; sizeBytes?: number | null; sha256?: string | null; storageBucket: string; storageKey?: string | null; storageUrl?: string | null; uploadedBy?: string | null; }

function toRecord(row: Row): EvidenceRecord {
  return { id: row.id, auditId: row.audit_id, filename: row.nombre_archivo, type: row.tipo, kind: row.kind, storageBucket: row.storage_bucket, storageKey: asText(row.storage_key), storageUrl: asText(row.storage_url), mimeType: asText(row.mime_type), detectedMimeType: asText(row.detected_mime_type), sizeBytes: asCount(row.size_bytes), sha256: asText(row.sha256), originalFilename: asText(row.original_filename), safeFilename: asText(row.safe_filename), status: row.status, contentStatus: row.content_status, contentError: asText(row.content_error), uploadedBy: asText(row.uploaded_by), createdAt: row.created_at, updatedAt: row.updated_at };
}

export function createEvidenceRepository(database: DatabaseClient) {
  async function update(id: string, patch: Record<string, unknown>): Promise<EvidenceRecord> {
    const { data, error } = await database.from(TABLE).update(patch).eq('id', id).select(COLUMNS).single();
    if (error) throw new Error(error.message ?? `No se pudo actualizar la evidencia ${id}.`);
    if (!data) throw new NotFoundError('evidence', id);
    return toRecord(data as Row);
  }
  async function rowsBy(column: string, value: string): Promise<Row[]> {
    const { data, error } = await database.from(TABLE).select(COLUMNS).eq(column, value).order('created_at', { ascending: false });
    if (error) throw new Error(error.message ?? 'No se pudieron leer evidencias.');
    return (data ?? []) as Row[];
  }
  return {
    async listByAudit(auditId: string) { return (await rowsBy('audit_id', auditId)).map(toRecord); },
    async findById(id: string) { const rows = await rowsBy('id', id); return rows[0] ? toRecord(rows[0]) : null; },
    async findStoredById(id: string) { const rows = (await rowsBy('id', id)).filter((row) => row.status === 'STORED'); return rows[0] ? toRecord(rows[0]) : null; },
    async findByAuditAndSha256(auditId: string, sha256: string) { const { data, error } = await database.from(TABLE).select(COLUMNS).eq('audit_id', auditId).eq('sha256', sha256).limit(1); if (error) throw new Error(error.message ?? 'No se pudo buscar evidencia por hash.'); const rows = (data ?? []) as Row[]; return rows[0] ? toRecord(rows[0]) : null; },
    async createPending(input: CreatePendingEvidenceInput) { const row: Record<string, unknown> = { id: input.id, audit_id: input.auditId, nombre_archivo: input.safeFilename, tipo: input.mimeType ?? input.detectedMimeType ?? '', kind: input.kind, storage_bucket: input.storageBucket, storage_key: input.storageKey ?? null, storage_url: input.storageUrl ?? null, mime_type: input.mimeType ?? null, detected_mime_type: input.detectedMimeType ?? null, size_bytes: input.sizeBytes ?? null, sha256: input.sha256 ?? null, original_filename: input.originalFilename, safe_filename: input.safeFilename, status: 'PENDING', content_status: 'PENDING', uploaded_by: input.uploadedBy ?? null }; const { data, error } = await database.from(TABLE).insert([row]).select(COLUMNS).single(); if (error) throw new Error(error.message ?? 'No se pudo crear la evidencia.'); if (!data) throw new Error('La base no devolvio la evidencia recien creada.'); return toRecord(data as Row); },
    markStored(id: string, patch: { storageKey?: string | null; storageUrl?: string | null } = {}) { return update(id, { status: 'STORED', storage_key: patch.storageKey ?? undefined, storage_url: patch.storageUrl ?? undefined }); },
    markFailed(id: string, contentError?: string | null) { return update(id, { status: 'FAILED', content_status: 'FAILED', content_error: contentError ?? null }); },
    markContentStatus(id: string, status: EvidenceContentStatus, contentError?: string | null) { return update(id, { content_status: status, content_error: contentError ?? null }); },
    async countByAuditAndContentStatus(auditId: string, status: EvidenceContentStatus) { const { data, error } = await database.from(TABLE).select('id').eq('audit_id', auditId).eq('content_status', status); if (error) throw new Error(error.message ?? 'No se pudo contar evidencias.'); return ((data ?? []) as Row[]).length; },
  };
}

export type EvidenceRepository = ReturnType<typeof createEvidenceRepository>;
