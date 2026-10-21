import { describe, expect, it } from 'vitest';
import { auditFailureMessage } from '../src/lib/audit-failure';

describe('explicación operativa de fallos de auditoría', () => {
  it('distingue la incoherencia de 5.2 de un error de notas auxiliares', () => {
    expect(auditFailureMessage('SCHEMA_VALIDATION_ERROR', [{ failureCategory: 'SCHEMA_VALIDATION_ERROR', path: 'audit.result', detail: 'section 5.2 check NO_ACREDITADO' }], '')).toContain('contradice su propia evaluación');
    expect(auditFailureMessage('SCHEMA_VALIDATION_ERROR', [{ failureCategory: 'SCHEMA_VALIDATION_ERROR', path: 'audit.result', detail: null, failureReason: 'schema validation failed at audit.result: no se puede dictaminar mientras 5.2 esté incumplido' }], '')).toContain('sección 5.2');
    expect(auditFailureMessage('SCHEMA_VALIDATION_ERROR', [{ failureCategory: 'SCHEMA_VALIDATION_ERROR', path: 'audit.observations', detail: 'invalid_type' }], '')).toContain('observaciones en un formato incorrecto');
  });

  it('explica el último intento, conservando el rechazo del proveedor en el historial técnico', () => {
    const message = auditFailureMessage('SCHEMA_VALIDATION_ERROR', [
      { failureCategory: 'PROVIDER_BAD_REQUEST' },
      { failureCategory: 'SCHEMA_VALIDATION_ERROR', path: 'audit.observations' },
    ], '');
    expect(message).toContain('observaciones');
    expect(message).toContain('Puedes reintentar');
  });

  it('un diagnóstico viejo no sustituye un error nuevo de sesión', () => {
    expect(auditFailureMessage('AUTH_ERROR', [{ failureCategory: 'SCHEMA_VALIDATION_ERROR', path: 'audit.observations' }], 'Inicia sesión.')).toBe('Inicia sesión.');
  });
});
