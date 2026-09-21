import { describe, expect, it } from 'vitest';
import { MAX_EVIDENCE_FILE_BYTES, buildEvidenceStorageKey, canTransitionJobStatus, detectMimeType, sanitizeFilename, stableFingerprint, validateEvidenceFile, canTransitionAuditStatus } from './index';

describe('canTransitionAuditStatus', () => {
  it('modela transiciones tecnicas minimas sin estados normativos', () => {
    expect(canTransitionAuditStatus('DRAFT', 'READY')).toBe(true);
    expect(canTransitionAuditStatus('READY', 'COMPLETED')).toBe(false);
  });
});

describe('jobs', () => {
  it('rechaza transiciones invalidas desde SUCCEEDED', () => {
    expect(canTransitionJobStatus('SUCCEEDED', 'RUNNING')).toBe(false);
  });

  it('crea fingerprints deterministas con orden estable', () => {
    expect(stableFingerprint({ b: 2, a: 1 })).toBe(stableFingerprint({ a: 1, b: 2 }));
  });
});

describe('evidence validation', () => {
  it('sanitiza nombres peligrosos', () => {
    expect(sanitizeFilename('../mi evidencia ñ.pdf')).toBe('mi_evidencia_n.pdf');
  });

  it('valida limites de tamano', () => {
    const firstBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    expect(validateEvidenceFile({ filename: 'a.pdf', declaredMimeType: 'application/pdf', sizeBytes: 0, firstBytes }).ok).toBe(false);
    expect(validateEvidenceFile({ filename: 'a.pdf', declaredMimeType: 'application/pdf', sizeBytes: MAX_EVIDENCE_FILE_BYTES, firstBytes }).ok).toBe(true);
    expect(validateEvidenceFile({ filename: 'a.pdf', declaredMimeType: 'application/pdf', sizeBytes: MAX_EVIDENCE_FILE_BYTES + 1, firstBytes }).ok).toBe(false);
  });

  it('detecta mismatch de firma', () => {
    expect(detectMimeType('a.pdf', 'application/pdf', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });

  it('genera storage key seguro', () => {
    expect(buildEvidenceStorageKey({ auditId: 'audit', evidenceId: 'ev', safeFilename: '../a.pdf' })).toBe('audits/audit/originals/ev/a.pdf');
  });
});
