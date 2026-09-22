import { describe, expect, it } from 'vitest';
import { createAuditManualCommentsRepository, createAuditRepository, createEvidenceRepository } from './index';

describe('createAuditRepository', () => {
  it('crea y lee una auditoria usando un cliente compatible', async () => {
    const rows: any[] = [];
    const selectBuilder = {
      order: () => selectBuilder,
      limit: async () => ({ data: rows, error: null }),
    };
    const database = {
      from: () => ({
        select: () => selectBuilder,
        insert: (input: any[]) => {
          rows.push({
            id: 'audit_1',
            display_name: input[0].display_name,
            status: 'DRAFT',
            external_case_id: input[0].external_case_id,
            created_by: input[0].created_by,
            created_at: '2026-09-21T00:00:00.000Z',
            updated_at: '2026-09-21T00:00:00.000Z',
          });
          return {
            select: () => ({ single: async () => ({ data: rows[0], error: null }) }),
          };
        },
      }),
    };

    const repo = createAuditRepository(database);
    const created = await repo.create({ createdBy: 'user_1', displayName: 'Auditoria sintetica', externalCaseId: 'CaVe-SINTETICO' });
    const list = await repo.listRecent();

    expect(created.status).toBe('DRAFT');
    expect(list).toHaveLength(1);
    expect(list[0].externalCaseId).toBe('CaVe-SINTETICO');
  });
});

describe('createEvidenceRepository', () => {
  it('mapea metadata de evidencia', async () => {
    const rows: any[] = [{
      id: 'ev_1',
      audit_id: 'audit_1',
      original_filename: 'original.pdf',
      safe_filename: 'original.pdf',
      nombre_archivo: 'original.pdf',
      mime_type: 'application/pdf',
      detected_mime_type: 'application/pdf',
      size_bytes: 5,
      sha256: 'abc',
      storage_bucket: 'dictamen-evidencias',
      storage_key: 'audits/audit_1/originals/ev_1/original.pdf',
      status: 'STORED',
      uploaded_by: 'user_1',
      created_at: '2026-09-21T00:00:00.000Z',
      updated_at: '2026-09-21T00:00:00.000Z',
    }];
    const selectBuilder = {
      eq: () => selectBuilder,
      order: () => selectBuilder,
      limit: async () => ({ data: rows, error: null }),
    };
    const database = { from: () => ({ select: () => selectBuilder }) };
    const repo = createEvidenceRepository(database);
    const list = await repo.listByAudit('audit_1');
    expect(list[0].storageKey).toBe('audits/audit_1/originals/ev_1/original.pdf');
  });
});

describe('createAuditManualCommentsRepository', () => {
  it('inserta y recupera comentarios con mapeo de columnas', async () => {
    const rows: any[] = [];
    const database = {
      from: () => ({
        select: () => ({
          eq: () => ({
            limit: async () => ({ data: rows, error: null }),
          }),
        }),
        insert: (input: any[]) => ({
          select: () => ({
            single: async () => ({ data: { ...input[0], id: 'comment_1', created_at: '2026-09-21T00:00:00.000Z', updated_at: '2026-09-21T00:00:00.000Z' }, error: null }),
          }),
        }),
        update: (input: any) => ({
          eq: () => ({
            select: () => ({
              single: async () => ({ data: { id: 'comment_1', audit_id: 'audit_1', ...input, created_at: '2026-09-21T00:00:00.000Z', updated_at: '2026-09-21T00:00:00.000Z' }, error: null }),
            }),
          }),
        }),
      }),
    };

    const repo = createAuditManualCommentsRepository(database);
    const saved = await repo.upsert({
      auditId: 'audit_1',
      actorId: 'user_1',
      comments: {
        backOfficeComment: 'Comentario BO',
        helpdeskComment: 'Comentario HelpDesk',
        schoolServicesComment: 'Comentario SER',
        financeComment: 'Comentario Finanzas',
        additionalComment: 'Comentario adicional',
      },
    });

    expect(saved.backOfficeComment).toBe('Comentario BO');
    expect(saved.helpdeskComment).toBe('Comentario HelpDesk');
  });
});
