import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { prepareEvidenceFile } from './upload';

describe('prepareEvidenceFile', () => {
  it('calcula SHA-256 conocido y storage key seguro', async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const file = new File([bytes], '../prueba.pdf', { type: 'application/pdf' });
    const prepared = await prepareEvidenceFile('audit-1', file);

    expect(prepared.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(prepared.safeFilename).toBe('prueba.pdf');
    expect(prepared.storageKey).toContain('/originals/');
    expect(prepared.storageKey.endsWith('/prueba.pdf')).toBe(true);
  });
});
