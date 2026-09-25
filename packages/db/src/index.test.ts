import { describe, expect, it } from 'vitest';
import { createAuditManualCommentsRepository, createAuditRepository, createEvidenceRepository, createRuleGovernanceRepository } from './index';

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

  it('elimina una auditoria via rpc delete_audit con motivo opcional', async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const database = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return {
          data: [{ audit_id: 'audit_9', status: 'FROZEN', deleted_by: 'user_1' }],
          error: null,
        };
      },
    };

    const repo = createAuditRepository(database as any);
    const deleted = await repo.deleteAudit('audit_9', 'Duplicado capturado por error');

    expect(calls).toEqual([
      { fn: 'delete_audit', args: { p_audit_id: 'audit_9', p_reason: 'Duplicado capturado por error' } },
    ]);
    expect(deleted).toEqual({ audit_id: 'audit_9', status: 'FROZEN', deleted_by: 'user_1' });
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

describe('createRuleGovernanceRepository', () => {
  it('crea y lista evidence requirements con orden determinista', async () => {
    const requirements: any[] = [];
    const selectRequirement = {
      eq: () => selectRequirement,
      order: () => selectRequirement,
      then: (resolve: any) => resolve({ data: requirements, error: null }),
    };
    const database = {
      from: (table: string) => ({
        insert: (input: any[]) => ({
          select: () => ({
            single: async () => {
              const row = { id: 'req_1', created_at: '2026-09-24T00:00:00.000Z', updated_at: '2026-09-24T00:00:00.000Z', ...input[0] };
              requirements.push(row);
              return { data: row, error: null };
            },
          }),
        }),
        select: () => table === 'evidence_requirements' ? selectRequirement : { single: async () => ({ data: null, error: null }) },
      }),
    };

    const repo = createRuleGovernanceRepository(database as any);
    const created = await repo.createEvidenceRequirement({ ruleId: 'rule_1', requirementKey: 'synthetic_evidence', evidenceType: 'TEXT', documentRole: 'EVIDENCE', required: true, minCount: 1, orderIndex: 2 });
    const list = await repo.listEvidenceRequirements('rule_1');

    expect(created.requirementKey).toBe('synthetic_evidence');
    expect(created.documentRole).toBe('EVIDENCE');
    expect(list).toHaveLength(1);
  });

  it('rechaza evidence requirements invalidos antes de llegar a DB', async () => {
    const repo = createRuleGovernanceRepository({ from: () => { throw new Error('DB_SHOULD_NOT_BE_CALLED'); } } as any);
    await expect(repo.createEvidenceRequirement({ ruleId: 'rule_1', requirementKey: '', evidenceType: 'TEXT' })).rejects.toThrow('INVALID_REQUIREMENT_KEY');
    await expect(repo.createEvidenceRequirement({ ruleId: 'rule_1', requirementKey: 'x', evidenceType: 'UNKNOWN' as never })).rejects.toThrow('INVALID_EVIDENCE_TYPE');
    await expect(repo.createEvidenceRequirement({ ruleId: 'rule_1', requirementKey: 'x', evidenceType: 'TEXT', minCount: -1 })).rejects.toThrow('INVALID_MIN_COUNT');
    await expect(repo.createEvidenceRequirement({ ruleId: 'rule_1', requirementKey: 'x', evidenceType: 'TEXT', minCount: 2, maxCount: 1 })).rejects.toThrow('INVALID_COUNT_RANGE');
    await expect(repo.createEvidenceRequirement({ ruleId: 'rule_1', requirementKey: 'x', evidenceType: 'TEXT', required: true, minCount: 0 })).rejects.toThrow('REQUIRED_MIN_COUNT_MUST_BE_POSITIVE');
  });

  it('lista rules con filtros y paginacion', async () => {
    const calls: string[] = [];
    const selectBuilder = {
      eq: (col: string) => { calls.push(`eq:${col}`); return selectBuilder; },
      order: (col: string) => { calls.push(`order:${col}`); return selectBuilder; },
      limit: (n: number) => { calls.push(`limit:${n}`); return selectBuilder; },
      range: (start: number, end: number) => { calls.push(`range:${start}:${end}`); return selectBuilder; },
      then: (resolve: any) => resolve({ data: [], error: null }),
    };
    const database = { from: (table: string) => ({ select: () => table === 'rules' ? selectBuilder : { single: async () => ({ data: null, error: null }) } }) };
    const repo = createRuleGovernanceRepository(database as any);
    const list = await repo.listRules({ ruleKey: 'R-1', status: 'DRAFT', limit: 5, offset: 10 });
    expect(list).toEqual([]);
    expect(calls).toEqual(['eq:rule_key', 'eq:status', 'limit:5', 'range:10:14', 'order:created_at']);
  });

  it('encuentra una rule por id sin golpear otras tablas', async () => {
    const database = {
      from: (table: string) => ({
        select: () => table === 'rules' ? {
          eq: () => ({ limit: async () => ({ data: [{ id: 'rule_1', rule_key: 'R-1', version: '1', name: 'Regla', status: 'DRAFT', created_at: '2026-09-24T00:00:00.000Z' }], error: null }) }),
        } : { limit: async () => ({ data: [], error: null }) },
      }),
    };
    const repo = createRuleGovernanceRepository(database as any);
    const found = await repo.findRuleById('rule_1');
    expect(found?.ruleKey).toBe('R-1');
    expect(found?.status).toBe('DRAFT');
  });
});
