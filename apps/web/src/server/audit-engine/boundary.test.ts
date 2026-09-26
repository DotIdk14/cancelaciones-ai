import { describe, expect, it } from 'vitest';

import {
  AUDIT_ENGINE_NOT_IMPLEMENTED,
  AUDIT_ENGINE_CAPABILITIES,
  AuditEngineNotImplementedError,
  NORMATIVE_SOURCE_CODE,
  assertAuditEngineOperational,
  isAuditEngineNotImplemented,
} from './boundary';

describe('frontera del motor de auditoria', () => {
  it('expone el codigo de error normative correcto', () => {
    expect(AUDIT_ENGINE_NOT_IMPLEMENTED).toBe('AUDIT_ENGINE_NOT_IMPLEMENTED');
    expect(AUDIT_ENGINE_NOT_IMPLEMENTED).toBe('AUDIT_ENGINE_NOT_IMPLEMENTED');
  });

  it('apunta a la fuente normativa del propietario', () => {
    expect(NORMATIVE_SOURCE_CODE).toBe('GDM_GAM_PRD_MLG_003');
  });

  it('declara las capacidades que requeriran el motor en la V2', () => {
    expect(AUDIT_ENGINE_CAPABILITIES).toContain('normative-evaluation');
    expect(AUDIT_ENGINE_CAPABILITIES).toContain('dictamen-generation');
    expect(AUDIT_ENGINE_CAPABILITIES).toContain('report-snapshot');
  });

  it('lanza siempre, sin ruta alternativa', () => {
    for (const capability of AUDIT_ENGINE_CAPABILITIES) {
      expect(() => assertAuditEngineOperational(capability)).toThrowError(
        AuditEngineNotImplementedError,
      );
    }
  });

  it('no degrada a false ni a resultado vacio', () => {
    let caught: unknown;
    try {
      assertAuditEngineOperational('normative-evaluation');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AuditEngineNotImplementedError);
    const error = caught as AuditEngineNotImplementedError;
    expect(error.code).toBe('AUDIT_ENGINE_NOT_IMPLEMENTED');
    expect(error.status).toBe(501);
    expect(error.capability).toBe('normative-evaluation');
    expect(error.normativeSource).toBe('GDM_GAM_PRD_MLG_003');
    // No puede interpretarse como una condicion normativa falsa.
    expect(error).not.toHaveProperty('outcome');
    expect(error).not.toHaveProperty('decisionStatus');
    expect(error).not.toHaveProperty('suggestedOutcome');
  });

  it('identifica sus propios errores y no los ajenos', () => {
    expect(isAuditEngineNotImplemented(new AuditEngineNotImplementedError('dictamen-generation'))).toBe(true);
    expect(isAuditEngineNotImplemented(new Error('fallo de red'))).toBe(false);
    expect(isAuditEngineNotImplemented(undefined)).toBe(false);
  });
});
