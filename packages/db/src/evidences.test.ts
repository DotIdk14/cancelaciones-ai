import { beforeEach, describe, expect, it } from 'vitest';
import { createEvidenceRepository } from './evidences';
import { createFakeDatabase, type FakeDatabase } from './testing/fake-db';

let db: FakeDatabase;
let evidences: ReturnType<typeof createEvidenceRepository>;

beforeEach(() => {
  db = createFakeDatabase();
  evidences = createEvidenceRepository(db);
});

describe('createEvidenceRepository', () => {
  it('crea pendiente y busca por audit+sha256', async () => {
    const created = await evidences.createPending({
      id: 'ev_1', auditId: 'audit_1', originalFilename: 'Contrato.pdf', safeFilename: 'contrato.pdf', mimeType: 'application/pdf',
      detectedMimeType: 'application/pdf', kind: 'PDF', sizeBytes: 123, sha256: 'abc', storageBucket: 'bucket', storageKey: 'key', uploadedBy: 'user_1',
    });

    expect(created.status).toBe('PENDING');
    await expect(evidences.findByAuditAndSha256('audit_1', 'abc')).resolves.toMatchObject({ id: 'ev_1', safeFilename: 'contrato.pdf' });
  });

  it('marca content_status y cuenta por audit/status', async () => {
    await evidences.createPending({
      id: 'ev_1', auditId: 'audit_1', originalFilename: 'a.pdf', safeFilename: 'a.pdf', mimeType: 'application/pdf',
      detectedMimeType: 'application/pdf', kind: 'PDF', sizeBytes: 1, sha256: 'sha', storageBucket: 'bucket', storageKey: 'key', uploadedBy: 'user_1',
    });

    const failed = await evidences.markContentStatus('ev_1', 'FAILED', 'No se pudo leer');

    expect(failed.contentStatus).toBe('FAILED');
    expect(failed.contentError).toBe('No se pudo leer');
    await expect(evidences.countByAuditAndContentStatus('audit_1', 'FAILED')).resolves.toBe(1);
  });
});
