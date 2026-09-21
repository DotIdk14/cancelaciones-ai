import { describe, expect, it } from 'vitest';
import { canTransitionAuditStatus } from '@cancelaciones/domain';

describe('lifecycle tecnico de auditorias', () => {
  it('permite pasar una auditoria DRAFT a READY', () => {
    expect(canTransitionAuditStatus('DRAFT', 'READY')).toBe(true);
  });

  it('impide regresar una auditoria COMPLETED a PROCESSING', () => {
    expect(canTransitionAuditStatus('COMPLETED', 'PROCESSING')).toBe(false);
  });
});
