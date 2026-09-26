import { describe, expect, it, vi } from 'vitest';

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status }),
  },
}));

import { auditEngineNotImplemented, toAuditEngineErrorResponse } from './http';
import { AuditEngineNotImplementedError } from './boundary';

describe('adaptador HTTP de la frontera', () => {
  it('responde 501 con codigo, capacidad y fuente normativa', () => {
    const response = auditEngineNotImplemented('normative-evaluation') as unknown as { body: Record<string, unknown>; status: number };
    expect(response.status).toBe(501);
    expect(response.body.error).toBe('AUDIT_ENGINE_NOT_IMPLEMENTED');
    expect(response.body.capability).toBe('normative-evaluation');
    expect(response.body.normativeSource).toBe('GDM_GAM_PRD_MLG_003');
  });

  it('traduce el error de frontera a 501', () => {
    const response = toAuditEngineErrorResponse(new AuditEngineNotImplementedError('dictamen-generation')) as unknown as { status: number };
    expect(response.status).toBe(501);
  });

  it('no oculta otros errores: los vuelve a lanzar', () => {
    expect(() => toAuditEngineErrorResponse(new Error('db caida'))).toThrowError('db caida');
  });
});
