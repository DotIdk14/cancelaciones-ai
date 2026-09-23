// Test de authz compartida de Phase 7: sesión, pertenencia y cross-audit.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';
import type { AuthorizedResult } from './authz';

const mockDatabase = vi.hoisted(() => {
  const handlers: Record<string, { data: unknown; error?: { message: string } | null }> = {};
  return { handlers };
});

vi.mock('@/server/auth/session', () => ({
  getCurrentUser: vi.fn(async () => (mockUser.value ?? null)),
}));

vi.mock('@/server/insforge/server', () => ({
  createInsForgeServerClient: vi.fn(async () => ({
    database: {
      from(table: string) {
        const query = {
          select() { return query; },
          eq() { return query; },
          order() { return query; },
          limit() { return query; },
          single() { return query; },
          insert() { return query; },
          update() { return query; },
          delete() { return query; },
          get data() { return mockDatabase.handlers[table]?.data ?? []; },
          get error() { return mockDatabase.handlers[table]?.error ?? null; },
        };
        return query;
      },
    },
    storage: { from: () => ({ upload: async () => ({ data: {}, error: null }), download: async () => ({ data: new Uint8Array(0), error: null }) }) },
  })),
}));

const mockUser = vi.hoisted(() => ({ value: { id: 'user-1' } as { id: string } | null }));

// Los mocks usan `mockUser` antes de declararlo; se re-exporta via objeto global de compatibilidad.
(globalThis as unknown as { __mockUser?: typeof mockUser }).__mockUser = mockUser;

describe('authorizeAuditOperation', () => {
  beforeEach(() => {
    mockDatabase.handlers = {};
  });

  it('rechaza sin sesión (401)', async () => {
    const authz = await import('./authz');
    mockUser.value = null;
    const request = new Request('http://localhost/api/audits/audit-1/report-snapshot') as NextRequest;
    const result = (await authz.authorizeAuditOperation(request, 'audit-1')) as AuthorizedResult & { ok: false };
    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(401);
  });

  it('rechaza una auditoria que no existe (404)', async () => {
    const authz = await import('./authz');
    mockUser.value = { id: 'user-1' };
    mockDatabase.handlers.audits = { data: [] };
    const request = new Request('http://localhost/api/audits/nope/report-snapshot') as NextRequest;
    const result = (await authz.authorizeAuditOperation(request, 'nope')) as AuthorizedResult & { ok: false };
    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(404);
  });

  it('rechaza operar una auditoria ajena (403 cross-audit)', async () => {
    const authz = await import('./authz');
    mockUser.value = { id: 'user-1' };
    mockDatabase.handlers.audits = {
      data: [{ id: 'audit-ajena', display_name: 'De otro creador', status: 'READY', external_case_id: null, created_by: 'owner-otro', created_at: '2026-09-23T09:00:00.000Z', updated_at: '2026-09-23T09:00:00.000Z' }],
    };
    const request = new Request('http://localhost/api/audits/audit-ajena/report-snapshot') as NextRequest;
    const result = (await authz.authorizeAuditOperation(request, 'audit-ajena')) as AuthorizedResult & { ok: false };
    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(403);
  });

  it('permite al creador de la auditoria (autorizado)', async () => {
    const authz = await import('./authz');
    mockUser.value = { id: 'user-1' };
    mockDatabase.handlers.audits = {
      data: [{ id: 'audit-1', display_name: 'Mi expediente', status: 'READY', external_case_id: null, created_by: 'user-1', created_at: '2026-09-23T09:00:00.000Z', updated_at: '2026-09-23T09:00:00.000Z' }],
    };
    const request = new Request('http://localhost/api/audits/audit-1/report-snapshot') as NextRequest;
    const result = (await authz.authorizeAuditOperation(request, 'audit-1')) as AuthorizedResult & { ok: true };
    expect(result.ok).toBe(true);
    expect(result.auth.auditId).toBe('audit-1');
    expect(result.auth.user.id).toBe('user-1');
  });
});

// Neutraliza el import de NextResponse para que el test no exija el runtime edge.
void NextResponse;