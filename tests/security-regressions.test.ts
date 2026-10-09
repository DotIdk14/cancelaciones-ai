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
import areaCommentsHandler from '../api/cases/[caseId]/area-comments/index';
import evidenceUploadHandler from '../api/cases/[caseId]/evidence/index';
import evidenceDeleteHandler from '../api/cases/[caseId]/evidence/[evidenceId]/index';
import downloadHandler from '../api/evidence/[evidenceId]/download';
import dashboardHandler from '../api/dashboard/[view]';
import { getScopedCaseOr404, assertCaseOwner } from '../src/server/cases';
import { assertCaseWriteCapability } from '../src/server/auth';
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
    ['GET /api/cases/:id/area-comments', areaCommentsHandler, { caseId: 'c' }],
    ['POST /api/cases/:id/area-comments', areaCommentsHandler, { caseId: 'c' }],
    ['POST /api/cases/:id/evidence', evidenceUploadHandler, { caseId: 'c' }],
    ['DELETE /api/cases/:id/evidence/:eid', evidenceDeleteHandler, { caseId: 'c', evidenceId: 'e' }],
    ['GET /api/evidence/:eid/download', downloadHandler, { evidenceId: 'e' }],
    ['GET /api/dashboard/summary', dashboardHandler, { view: 'summary', from: '2026-09-01', to: '2026-09-30' }],
    ['GET /api/dashboard/quality', dashboardHandler, { view: 'quality', from: '2026-09-01', to: '2026-09-30' }],
    ['GET /api/dashboard/ai-costs', dashboardHandler, { view: 'ai-costs', from: '2026-09-01', to: '2026-09-30' }],
    ['GET /api/dashboard/options', dashboardHandler, { view: 'options' }],
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
    // Timeout propio y no global: este test hace la unica llamada de red real
    // de la suite (~3.8s de espera al timeout del proveedor). Con el default de
    // 5s y 51 archivos en paralelo se pasaba del limite y fallaba por contencion
    // de CPU, no por comportamiento. Mantener el default en el resto preserva la
    // deteccion de cuelgues (ciclos de imports) que este repo usa a proposito.
  }, 15_000);
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

  it('escribir comentarios de area tambien exige CSRF: sin Origin responde 403', async () => {
    // El comentario de un area es texto libre de una persona que queda
    // persistido. Aceptarlo sin CSRF permitiria que otra pagina escribiera en
    // nombre del operador con su sesion.
    const res = makeApiResponse();
    await areaCommentsHandler(
      makeApiRequest({
        method: 'POST',
        query: { caseId: 'c' },
        body: { area: 'BACK_OFFICE', comment: 'inyectado' },
        headers: {},
      }),
      res,
    );
    expect(res.statusCode).toBe(403);
    expect((JSON.parse(res.body) as { error: { category: string } }).error.category).toBe('AUTH_ERROR');
  });

  it('el PATCH del caso tambien exige CSRF: sin Origin responde 403', async () => {
    // El PATCH de `/api/cases/:id` escribe la fecha de inicio de clases con la
    // sesion del operador. Es una mutacion mas y tiene que pasar por la misma
    // puerta: sin ella, otra pagina podria escribir en nombre del operador.
    const res = makeApiResponse();
    await caseHandler(
      makeApiRequest({ method: 'PATCH', query: { caseId: 'c' }, body: {}, headers: {} }),
      res,
    );
    expect(res.statusCode).toBe(403);
    expect((JSON.parse(res.body) as { error: { category: string } }).error.category).toBe('AUTH_ERROR');
  });
});

describe('Comentarios de area · el alcance lo decide el servidor', () => {
  /**
   * Es una defensa que la RLS sola NO da. El servidor escribe con la API key de
   * administracion, que es superusuario: para ella las politicas no aplican y
   * `created_by` no restringe nada. Si el endpoint no resolviera el alcance del
   * caso, un `caseId` ajeno seria escribible por cualquiera con sesion.
   *
   * Se deja la logica de ownership REAL (`getScopedCaseOr404` y `assertCaseOwner`
   * no se sustituyen) y sólo se intercepta la escritura, para poder observar que
   * no ocurre: un 404 con la escritura happening seria un 404 cosmetico.
   */
  async function postToForeignCase(
    role: 'user' | 'coordinator',
  ): Promise<{ res: ReturnType<typeof makeApiResponse>; upsert: ReturnType<typeof vi.fn> }> {
    const upsert = vi.fn();
    const foreignCase = { id: 'c-ajeno', created_by: 'otro-usuario' };
    const chain = {
      select: () => chain,
      eq: () => chain,
      single: () => Promise.resolve({ data: foreignCase, error: null }),
    };

    vi.resetModules();
    vi.doMock('../src/server/insforge', () => ({
      createServerClient: () => ({ database: { from: () => chain } }),
    }));
    vi.doMock('../src/server/area-comments', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/server/area-comments')>();
      return { ...actual, upsertAreaComment: upsert };
    });

    try {
      const handler = (await import('../api/cases/[caseId]/area-comments/index')).default;
      const res = makeApiResponse();
      await handler(
        makeApiRequest({
          method: 'POST',
          query: { caseId: 'c-ajeno' },
          // El bypass de tests: se salta sesión y CSRF para aislar el alcance.
          auth: fakeAuthContext(role),
          body: { area: 'HELPDESK', comment: 'intento sobre caso ajeno' },
        }),
        res,
      );
      return { res, upsert };
    } finally {
      vi.doUnmock('../src/server/insforge');
      vi.doUnmock('../src/server/area-comments');
      vi.resetModules();
    }
  }

  it('un coordinador no escribe comentarios en un caso ajeno: 404 y nada escrito', async () => {
    // El coordinador PUEDE leer cualquier caso (visibilidad global de auditoría),
    // así que el alcance de escritura no se resuelve solo al leer: hace falta el
    // `assertCaseOwner` explicito del endpoint.
    const { res, upsert } = await postToForeignCase('coordinator');

    expect(res.statusCode).toBe(404);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('un rol user tampoco escribe en un caso ajeno', async () => {
    const { res, upsert } = await postToForeignCase('user');
    expect(res.statusCode).toBe(404);
    expect(upsert).not.toHaveBeenCalled();
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

  it('rol manager tambien lee un caso ajeno: la lectura global no es del coordinador', async () => {
    const row = { id: 'c-ajeno', created_by: 'otro-usuario' };
    const chain = {
      select: () => chain,
      eq: () => chain,
      single: () => Promise.resolve({ data: row, error: null }),
    };
    const client = { database: { from: () => chain } } as unknown as InsForgeClient;
    await expect(getScopedCaseOr404(client, 'c-ajeno', fakeAuthContext('manager'))).resolves.toBe(row);
  });

  it('rol coordinator no ESCRIBE un caso ajeno en las mutaciones de scope: 404, no 403', () => {
    // El coordinador PUEDE finalizar cualquier caso (su capacidad es `canFinalizeAnyCase`,
    // que NO pasa por `assertCaseOwner`). Lo que sigue siendo suyo es la escritura
    // ordinary del caso —evidencias, auditoría, comentarios—: esa sigue siendo
    // propiedad del dueño, y "no es tuyo" se responde 404 para no enumerar
    // existencia. Finalizar es un endpoint aparte (`/review`), no una escritura de
    // esta familia: ver `describe('matriz de capacidades sobre /review')` más abajo.
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

  it('gerente NO muta ni siquiera un caso PROPIO: la capacidad va antes que la propiedad', () => {
    // `assertCaseOwner` solo mira `created_by`, asi que por si solo le abriria al
    // gerente la escritura de los casos que el mismo certify. Lo cierra
    // `assertCaseWriteCapability`, que es la razon de existir.
    const row = { id: 'c', created_by: FAKE_USER_SUB } as never;
    expect(() => assertCaseOwner(row, fakeAuthContext('manager'))).not.toThrow();
    expect(() => assertCaseWriteCapability(fakeAuthContext('manager'))).toThrowError();
    // Y un asesor/coordinador con capacidad de escritura no lo dispara.
    expect(() => assertCaseWriteCapability(fakeAuthContext('user'))).not.toThrow();
    expect(() => assertCaseWriteCapability(fakeAuthContext('coordinator'))).not.toThrow();
  });
});

describe('matriz de capacidades sobre /review · el servidor resuelve la etapa', () => {
  /**
   * Cliente InsForge mínimo, POR TABLA, para poder observar qué se escribe sin
   * sustituir la lógica: `src/server/cases` y `src/server/reviews` se ejecutan de
   * verdad (solo se dobeja el transporte, igual que en el resto del archivo).
   */
  function reviewStore(options: { finalized?: Record<string, unknown> } = {}) {
    const state: Record<string, unknown>[] = [];
    const foreignCase = { id: 'c-ajeno', created_by: 'otro-usuario', status: 'DRAFT' };
    const advisorReview = {
      id: 'review-1',
      case_id: 'c-ajeno',
      audit_id: 'audit-1',
      result: 'BAJA',
      reviewer_name: 'asesor@utel.edu.mx',
      comment: 'Se acredita la baja.',
      created_at: '2026-02-02T09:00:00.000Z',
      created_by: 'otro-usuario',
      coordinator_decision: null,
      coordinator_resolution: null,
      coordinator_created_by: null,
      coordinator_created_at: null,
      coordinator_comment: null,
      ...(options.finalized ?? {}),
    };
    const tables: Record<string, unknown> = {
      cases: foreignCase,
      case_reviews: advisorReview,
      case_comparisons: null,
      audits: null,
    };
    Object.assign(state, []);

    const from = (table: string) => {
      const row = () => tables[table];
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.is = () => chain;
      chain.order = () => chain;
      chain.limit = () => chain;
      chain.update = (patch: Record<string, unknown>) => {
        Object.assign(advisorReview, patch);
        return chain;
      };
      chain.single = async () => ({ data: row(), error: null });
      chain.then = (onOk: (value: { data: unknown; error: null }) => unknown) =>
        Promise.resolve({ data: row() === null ? [] : [row()], error: null }).then(onOk);
      return chain;
    };
    return { client: { database: { from } }, advisorReview, writes: state };
  }

  async function callReview(
    role: 'user' | 'coordinator' | 'manager',
    method: 'GET' | 'POST',
    body?: unknown,
  ): Promise<{ res: ReturnType<typeof makeApiResponse>; store: ReturnType<typeof reviewStore> }> {
    const store = reviewStore();
    vi.resetModules();
    vi.doMock('../src/server/insforge', () => ({ createServerClient: () => store.client }));
    try {
      const handler = (await import('../api/cases/[caseId]/review/index')).default;
      const res = makeApiResponse();
      await handler(
        makeApiRequest({ method, query: { caseId: 'c-ajeno' }, body, auth: fakeAuthContext(role) }),
        res,
      );
      return { res, store };
    } finally {
      vi.doUnmock('../src/server/insforge');
      vi.resetModules();
    }
  }

  it('el coordinador FINALIZA el caso de un asesor: 200 y la fila queda con su actor', async () => {
    const { res, store } = await callReview('coordinator', 'POST', { decision: 'APPROVE' });

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body) as { workflowState: string; review: { coordinatorDecision: string } };
    expect(payload.workflowState).toBe('FINALIZED');
    expect(payload.review.coordinatorDecision).toBe('APPROVE');
    // `coordinator_created_by` es el uuid de la SESIÓN del coordinador, no un
    // campo del body (el body ni siquiera admite uno).
    expect(store.advisorReview.coordinator_created_by).toBe(FAKE_USER_SUB);
    // Y la decisión del asesor sigue intacta.
    expect(store.advisorReview.result).toBe('BAJA');
  });

  it('el gerente LEE el caso ajeno pero NO lo muta: GET 200, POST 403, nada escrito', async () => {
    const read = await callReview('manager', 'GET');
    expect(read.res.statusCode).toBe(200);

    for (const body of [{ decision: 'APPROVE' }, { result: 'BAJA' }]) {
      const { res, store } = await callReview('manager', 'POST', body);
      expect(res.statusCode).toBe(403);
      expect((JSON.parse(res.body) as { error: { category: string } }).error.category).toBe('AUTH_ERROR');
      expect(store.advisorReview.coordinator_decision).toBeNull();
      expect(store.advisorReview.coordinator_created_by).toBeNull();
    }
  });

  it('el asesor sobre el caso de OTRO responde 404 en POST y en GET: no se enumera existencia', async () => {
    const post = await callReview('user', 'POST', { result: 'BAJA' });
    expect(post.res.statusCode).toBe(404);
    expect(post.store.advisorReview.coordinator_created_by).toBeNull();

    const get = await callReview('user', 'GET');
    expect(get.res.statusCode).toBe(404);
    // Ni la resolución del asesor ni la etapa del flujo se filtran en el 404.
    expect(get.res.body).not.toContain('BAJA');
  });

  it('sin sesión / sin rol resuelto, /review nunca responde 200 con datos', async () => {
    const store = reviewStore();
    vi.resetModules();
    vi.doMock('../src/server/insforge', () => ({ createServerClient: () => store.client }));
    try {
      const handler = (await import('../api/cases/[caseId]/review/index')).default;
      const res = makeApiResponse();
      await handler(makeApiRequest({ method: 'GET', query: { caseId: 'c-ajeno' }, headers: {} }), res);
      expect([401, 403, 503]).toContain(res.statusCode);
      expect(res.body).not.toContain('BAJA');
    } finally {
      vi.doUnmock('../src/server/insforge');
      vi.resetModules();
    }
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