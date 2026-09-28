import { beforeEach, describe, expect, it } from 'vitest';
import { createAuditRepository } from './audits';
import { createFakeDatabase, type FakeDatabase } from './testing/fake-db';

let db: FakeDatabase;
let audits: ReturnType<typeof createAuditRepository>;

beforeEach(() => {
  db = createFakeDatabase();
  audits = createAuditRepository(db);
});

describe('createAuditRepository', () => {
  it('crea, lista y busca auditorias', async () => {
    const created = await audits.create({ createdBy: 'user_1', displayName: 'Caso 1', externalCaseId: 'EXT-1' });

    expect(created.status).toBe('DRAFT');
    expect(created.displayName).toBe('Caso 1');
    await expect(audits.findById(created.id)).resolves.toMatchObject({ id: created.id, externalCaseId: 'EXT-1' });
    await expect(audits.listRecent()).resolves.toHaveLength(1);
  });

  it('actualiza estado si la transicion es valida y rechaza la invalida', async () => {
    const created = await audits.create({ createdBy: 'user_1', displayName: 'Caso 1' });

    await expect(audits.updateStatus(created.id, 'PROCESSING')).resolves.toMatchObject({ status: 'PROCESSING' });
    await expect(audits.updateStatus(created.id, 'DRAFT')).rejects.toThrow('ILLEGAL_AUDIT_STATUS_TRANSITION: PROCESSING -> DRAFT');
  });

  it('deleteAudit llama la RPC delete_audit', async () => {
    db.registerRpc('delete_audit', (args) => ({ called: true, ...args }));

    await expect(audits.deleteAudit('audit_1', 'duplicado')).resolves.toEqual({
      called: true,
      p_audit_id: 'audit_1',
      p_reason: 'duplicado',
    });
  });
});
