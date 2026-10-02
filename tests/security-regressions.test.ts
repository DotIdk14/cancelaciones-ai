// =============================================================================
// REGRESIONES OBLIGATORIAS de la frontera de seguridad.
//
// Cada test fija un comportamiento que, si se rompe, devuelve el sistema al
// estado anterior a la corrección (cero auth / IDOR). Son deliberadamente
// end-to-end sobre el handler real con dobles mínimos: no se reimplementa la
// lógica, se ejecuta el código de producción.
// =============================================================================

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ApiRequest, ApiResponse } from '../src/server/http';
import { setTestEnv } from './helpers/env';
import { fakeAuthContext, FAKE_USER_SUB } from './helpers/auth';

import casesHandler from '../api/cases/index';
import caseHandler from '../api/cases/[caseId]/index';
import auditHandler from '../api/cases/[caseId]/audit/index';
import comparisonHandler from '../api/cases/[caseId]/comparison/index';
import reviewHandler from '../api/cases/[caseId]/review/index';
import evidenceUploadHandler from '../api/cases/[caseId]/evidence/index';
import evidenceDeleteHandler from '../api/cases/[caseId]/evidence/[evidenceId]/index';
import downloadHandler from '../api/evidence/[evidenceId]/download';
import dashboardSummaryHandler from '../api/dashboard/summary';
import dashboardQualityHandler from '../api/dashboard/quality';
import dashboardAiCostsHandler from '../api/dashboard/ai-costs';
import dashboardOptionsHandler from '../api/dashboard/options';
import { getScopedCaseOr404, assertCaseOwner } from '../src/server/cases';
import type { InsForgeClient } from '../src/server/insforge';

/** Nombre real de la cookie de acceso que escribe el SDK SSR de InsForge. */
const ACCESS_COOKIE = 'insforge_access_token';

function makeApiResponse(): ApiResponse & { statusCode: number; headers: Record<string, string>; body: string } {
  const fake = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
    setHeader: (name: string, value: unknown) => {
      fake.headers[name] = String(value);
    },
    appendHeader: (name: string, value: unknown) => {
      fake.headers[name] = String(value);
    },
    end: (chunk?: unknown) => {
      fake.body = typeof chunk === 'string' ? chunk : chunk instanceof Buffer ? chunk.toString('utf-8') : '';
    },
  };
  return fake as unknown as ApiResponse & { statusCode: number; headers: Record<string, string>; body: string };
}

function makeApiRequest(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: 'GET',
    url: '/',
    headers: {},
    query: {},
    ...overrides,
  } as unknown as ApiRequest;
}

/** Cliente InsForge que devuelve siempre una lista vacía: "el caso no es mío". */
function emptyClient(): InsForgeClient {
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: () => Promise.resolve({ data: null, error: null }),
  };
  return { database: { from: () => chain } } as unknown as InsForgeClient;
}

beforeEach(() => {
  setTestEnv();
});

describe('R1 · sin sesion, TODA ruta protegida responde 401 (fail-closed)', () => {
  const handlers: Array<[string, (req: ApiRequest, res: ApiResponse) => unknown, Record<string, string>]> = [
    ['GET /api/cases', casesHandler, {}],
    ['GET /api/cases/:id', caseHandler, { caseId: 'c' }],
    ['GET /api/cases/:id/audit', auditHandler, { caseId: 'c' }],
    ['POST /api/cases/:id/comparison', comparisonHandler, { caseId: 'c' }],
    ['GET /api/cases/:id/review', reviewHandler, { caseId: 'c' }],
    ['POST /api/cases/:id/evidence', evidenceUploadHandler, { caseId: 'c' }],
    ['DELETE /api/cases/:id/evidence/:eid', evidenceDeleteHandler, { caseId: 'c', evidenceId: 'e' }],
    ['GET /api/evidence/:eid/download', downloadHandler, { evidenceId: 'e' }],
    ['GET /api/dashboard/summary', dashboardSummaryHandler, { from: '2026-09-01', to: '2026-09-30' }],
    ['GET /api/dashboard/quality', dashboardQualityHandler, { from: '2026-09-01', to: '2026-09-30' }],
    ['GET /api/dashboard/ai-costs', dashboardAiCostsHandler, { from: '2026-09-01', to: '2026-09-30' }],
    ['GET /api/dashboard/options', dashboardOptionsHandler, {}],
  ];

  for (const [name, handler, query] of handlers) {
    it(`${name} responde 401 sin cookie de sesion`, async () => {
      const res = makeApiResponse();
      // Sin `req.auth` (el bypass de tests) y SIN cookie: `requireAuth` no
      // necesita red para concluir que no hay identidad.
      await handler(makeApiRequest({ method: 'GET', query, headers: {} }), res);
      expect(res.statusCode).toBe(401);
      const payload = JSON.parse(res.body) as { error: { category: string } };
      expect(payload.error.category).toBe('UNAUTHENTICATED');
    });
  }

  it('una cookie corrupta tampoco abre la puerta (nunca 200 ni fuga de datos)', async () => {
    const res = makeApiResponse();
    await casesHandler(
      makeApiRequest({ method: 'GET', headers: { cookie: `${ACCESS_COOKIE}=no-es-un-token` } }),
      res,
    );
    // El token llega a InsForge en este caso (sin red en tests el resultado
    // legitimo es 401 o 503): lo inaceptable seria 200 con datos.
    expect([401, 503]).toContain(res.statusCode);
  });
});

describe('R2/R3/R4 · CSRF en mutaciones (fail-closed antes de tocar auth)', () => {
  it('POST sin header Origin responde 403', async () => {
    const res = makeApiResponse();
    await casesHandler(makeApiRequest({ method: 'POST', body: {}, headers: {} }), res);
    expect(res.statusCode).toBe(403);
    expect((JSON.parse(res.body) as { error: { category: string } }).error.category).toBe('AUTH_ERROR');
  });

  it('POST con Origin ajeno responde 403', async () => {
    const res = makeApiResponse();
    await casesHandler(
      makeApiRequest({ method: 'POST', body: {}, headers: { origin: 'https://sitio-malicioso.example' } }),
      res,
    );
    expect(res.statusCode).toBe(403);
    expect((JSON.parse(res.body) as { error: { message: string } }).error.message).toContain('Origen');
  });

  it('POST con Origin propio pero sin X-App-Request responde 403', async () => {
    const res = makeApiResponse();
    await casesHandler(
      makeApiRequest({ method: 'POST', body: {}, headers: { origin: 'http://localhost:5173' } }),
      res,
    );
    expect(res.statusCode).toBe(403);
    expect((JSON.parse(res.body) as { error: { message: string } }).error.message).toContain('X-App-Request');
  });

  it('DELETE tambien exige CSRF: sin Origin responde 403 y no llega al 404 de negocio', async () => {
    const res = makeApiResponse();
    await evidenceDeleteHandler(
      makeApiRequest({ method: 'DELETE', query: { caseId: 'c', evidenceId: 'e' }, headers: {} }),
      res,
    );
    expect(res.statusCode).toBe(403);
  });

  it('las respuestas JSON no se cachean en proxy (private, no-store)', async () => {
    const res = makeApiResponse();
    await casesHandler(makeApiRequest({ method: 'GET', headers: {} }), res);
    expect(res.headers['Cache-Control']).toBe('private, no-store');
  });
});

describe('R6/R7 · ownership: un caso ajeno no existe para el usuario', () => {
  it('rol user sobre un caso de otro responde 404 (no 403: no se enumera existencia)', async () => {
    await expect(getScopedCaseOr404(emptyClient(), 'c-ajeno', fakeAuthContext('user'))).rejects.toMatchObject({
      status: 404,
    });
  });

  it('rol coordinator SI lee un caso ajeno (visibilidad global de auditoria)', async () => {
    const row = { id: 'c-ajeno', created_by: 'otro-usuario' };
    const chain = {
      select: () => chain,
      eq: () => chain,
      single: () => Promise.resolve({ data: row, error: null }),
    };
    const client = { database: { from: () => chain } } as unknown as InsForgeClient;
    await expect(getScopedCaseOr404(client, 'c-ajeno', fakeAuthContext('coordinator'))).resolves.toBe(row);
  });

  it('rol coordinator NO puede mutar un caso ajeno: 404, no 403', () => {
    // 403 confirmaria que el caso existe. "No es tuyo" y "no existe" se
    // responden igual a proposito (no enumeracion de existencia).
    const row = { id: 'c-ajeno', created_by: 'otro-usuario' } as never;
    let status: number | undefined;
    try {
      assertCaseOwner(row, fakeAuthContext('coordinator'));
    } catch (error) {
      status = (error as { status?: number }).status;
    }
    expect(status).toBe(404);
  });

  it('rol user si muta su propio caso', () => {
    const row = { id: 'c', created_by: FAKE_USER_SUB } as never;
    expect(() => assertCaseOwner(row, fakeAuthContext('user'))).not.toThrow();
  });
});

describe('R5 · membership: sin rol no hay acceso, y proveedor caido tampoco', () => {
  /** Monta `requireAuth` con el proveedor de identidad simulado. */
  async function requireAuthWithMembership(membership: {
    row: unknown;
    error: { statusCode: number; message: string } | null;
  }) {
    vi.resetModules();
    vi.doMock('@insforge/sdk', () => ({
      createClient: () => ({
        auth: {
          getCurrentUser: async () => ({
            data: { user: { id: FAKE_USER_SUB, email: 'u@example.com' } },
            error: null,
          }),
        },
      }),
      createAdminClient: () => ({}),
    }));
    vi.doMock('../src/server/insforge', () => ({
      createServerClient: () => ({
        database: {
          from: () => {
            const chain = {
              select: () => chain,
              eq: () => chain,
              single: () => Promise.resolve({ data: membership.row, error: membership.error }),
            };
            return chain;
          },
        },
      }),
    }));
    const { requireAuth } = await import('../src/server/auth');
    try {
      return { ok: true as const, context: await requireAuth({ headers: { cookie: `${ACCESS_COOKIE}=token` } }) };
    } catch (error) {
      return { ok: false as const, status: (error as { status?: number }).status };
    } finally {
      vi.doUnmock('@insforge/sdk');
      vi.doUnmock('../src/server/insforge');
      vi.resetModules();
    }
  }

  it('proveedor de autorizacion caido responde 503 (nunca anónimo)', async () => {
    const result = await requireAuthWithMembership({ row: null, error: { statusCode: 503, message: 'caido' } });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ status: 503 });
  });

  it('usuario autenticado SIN membership responde 403', async () => {
    const result = await requireAuthWithMembership({ row: null, error: { statusCode: 404, message: 'no rows' } });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ status: 403 });
  });

  it('rol desconocido en la base responde 403 (no se escala privilegios por contenido)', async () => {
    const result = await requireAuthWithMembership({ row: { role: 'admin' }, error: null });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ status: 403 });
  });

  it('membership valida entrega el rol (user y coordinator)', async () => {
    const asUser = await requireAuthWithMembership({ row: { role: 'user' }, error: null });
    expect(asUser).toMatchObject({ ok: true });
    const asCoordinator = await requireAuthWithMembership({ row: { role: 'coordinator' }, error: null });
    expect(asCoordinator).toMatchObject({ ok: true });
  });
});