// =============================================================================
// El rol autenticado viaja por la ruta de sesión EXISTENTE.
//
// `POST /api/auth/refresh` devolvía `{ ok: true }` y nada más: el backend sabía
// el rol (lo lee de `app_memberships`) y la SPA no. Estos tests fijan que el
// rol salga del servidor por ahí, sin endpoint nuevo (HOBBY_FUNCTION_BUDGET) y
// sin tocar el resto del contrato:
//
//   1. `{ ok: true }` se conserva: la respuesta es un superconjunto, no un
//      cambio incompatible.
//   2. El rol viaja con su identificador PERSISTIDO (`user`), no con la
//      etiqueta de presentación: la traducción vive en la UI.
//   3. Si el rol no resuelve, la ruta falla CERRADA (403/503) en vez de
//      devolver `ok: true` con el rol vacío.
//   4. No se filtra nada de la membresía: la respuesta son exactamente `ok` y
//      `role`.
//
// Son end-to-end sobre el handler real con dobles mínimos en los límites
// (SDK de InsForge y servidor SSR), no una reimplementación.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiRequest, ApiResponse } from '../src/server/http';
import { setTestEnv } from './helpers/env';

const ACCESS_COOKIE = 'insforge_access_token';
const REFRESH_COOKIE = 'insforge_refresh_token';
const APP_URL = 'https://app.example.com';

interface FakeResponse extends ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  setCookies: string[];
  body: string;
}

function makeResponse(): FakeResponse {
  const fake = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    setCookies: [] as string[],
    body: '',
    setHeader(name: string, value: unknown) {
      fake.headers[name] = String(value);
    },
    appendHeader(name: string, value: unknown) {
      fake.setCookies.push(String(value));
    },
    end: (chunk?: unknown) => {
      fake.body = typeof chunk === 'string' ? chunk : chunk instanceof Buffer ? chunk.toString('utf-8') : '';
    },
  };
  return fake as unknown as FakeResponse;
}

function makeRequest(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: 'POST',
    url: '/api/auth/refresh',
    headers: { origin: APP_URL, 'x-app-request': '1', cookie: `${ACCESS_COOKIE}=access-1` },
    query: { action: 'refresh' },
    ...overrides,
  } as unknown as ApiRequest;
}

interface Overrides {
  /** Lo que devuelve `updateSession` (rotación de cookie). */
  update?: { refreshed: boolean; accessToken: string | null; error: unknown };
  /** Lo que devuelve `getCurrentUser` contra InsForge. */
  currentUser?: { data: unknown; error: unknown };
  /** Lo que devuelve la consulta de `app_memberships`. */
  membership?: { data: unknown; error: unknown };
}

/** Monta la ruta de auth con el SDK de InsForge sustituido. */
async function mountAuth(overrides: Overrides = {}) {
  const update = overrides.update ?? { refreshed: false, accessToken: 'access-1', error: null };
  const currentUser = overrides.currentUser ?? {
    data: { user: { id: 'u1', email: 'alumno@utel.edu.mx' } },
    error: null,
  };
  const membership = overrides.membership ?? { data: { role: 'manager' }, error: null };

  vi.resetModules();
  vi.doMock('@insforge/sdk', () => ({
    createClient: () => ({ auth: { getCurrentUser: async () => currentUser } }),
    createAdminClient: () => ({}),
  }));
  vi.doMock('@insforge/sdk/ssr/middleware', () => ({
    DEFAULT_ACCESS_TOKEN_COOKIE: ACCESS_COOKIE,
    clearAuthCookies: (cookies: { delete(name: string): unknown }) => {
      cookies.delete(ACCESS_COOKIE);
      cookies.delete(REFRESH_COOKIE);
    },
    setAuthCookies: () => undefined,
    updateSession: async () => update,
  }));
  vi.doMock('../src/server/insforge', () => ({
    createServerClient: () => ({
      database: {
        from: () => {
          const chain = {
            select: () => chain,
            eq: () => chain,
            single: async () => membership,
          };
          return chain;
        },
      },
    }),
  }));

  try {
    const handler = (await import('../api/auth/[action]')).default as unknown as (
      req: ApiRequest,
      res: ApiResponse,
    ) => Promise<void>;
    const { refreshSession } = await import('../src/server/auth');
    return { handler, refreshSession };
  } finally {
    vi.doUnmock('@insforge/sdk');
    vi.doUnmock('@insforge/sdk/ssr/middleware');
    vi.doUnmock('../src/server/insforge');
    vi.resetModules();
  }
}

beforeEach(() => {
  setTestEnv();
  vi.stubEnv('APP_URL', APP_URL);
});

describe('POST /api/auth/refresh expone el rol resuelto en el servidor', () => {
  it('devuelve el rol de la membresía junto a `ok: true`', async () => {
    const { handler } = await mountAuth({ membership: { data: { role: 'manager' }, error: null } });
    const res = makeResponse();

    await handler(makeRequest(), res);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, role: 'manager' });
  });

  it('conserva la forma anterior de la respuesta: `ok: true` sigue ahí', async () => {
    const { handler } = await mountAuth();
    const res = makeResponse();

    await handler(makeRequest(), res);

    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body.ok).toBe(true);
  });

  it('el rol viaja con su identificador persistido, no con la etiqueta de UI', async () => {
    const { handler } = await mountAuth({ membership: { data: { role: 'user' }, error: null } });
    const res = makeResponse();

    await handler(makeRequest(), res);

    expect(JSON.parse(res.body)).toEqual({ ok: true, role: 'user' });
  });

  it('no filtra datos de la membresía: la respuesta son exactamente `ok` y `role`', async () => {
    const { handler } = await mountAuth();
    const res = makeResponse();

    await handler(makeRequest(), res);

    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['ok', 'role']);
    expect(JSON.stringify(body)).not.toContain('alumno@utel.edu.mx');
    expect(JSON.stringify(body)).not.toContain('u1');
  });

  it('la respuesta de rol sigue siendo private, no-store', async () => {
    const { handler } = await mountAuth();
    const res = makeResponse();

    await handler(makeRequest(), res);

    expect(res.headers['Cache-Control']).toBe('private, no-store');
  });
});

describe('refresh falla cerrado cuando el rol no resuelve', () => {
  it('membership con rol fuera del vocabulario: 403 y ningún rol en el cuerpo', async () => {
    const { handler } = await mountAuth({ membership: { data: { role: 'admin' }, error: null } });
    const res = makeResponse();

    await handler(makeRequest(), res);

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { error: { category: string }; role?: string };
    expect(body.error.category).toBe('AUTH_ERROR');
    expect(body.role).toBeUndefined();
  });

  it('proveedor de membresía caído: 503, nunca un 403 disfrazado de sin permiso', async () => {
    const { handler } = await mountAuth({
      membership: { data: null, error: { statusCode: 503, message: 'caido' } },
    });
    const res = makeResponse();

    await handler(makeRequest(), res);

    expect(res.statusCode).toBe(503);
    expect((JSON.parse(res.body) as { error: { category: string } }).error.category).toBe(
      'PROVIDER_UNAVAILABLE',
    );
  });

  it('identidad no verificable tras rotar: 401 y cookies de sesión limpiadas', async () => {
    const { handler } = await mountAuth({
      update: { refreshed: true, accessToken: 'access-nuevo', error: null },
      currentUser: { data: null, error: { message: 'token rechazado' } },
    });
    const res = makeResponse();

    await handler(makeRequest(), res);

    expect(res.statusCode).toBe(401);
    expect(res.setCookies.join('\n')).toMatch(/insforge_access_token=;[^]*Max-Age=0/);
  });
});

describe('el rol no se filtra por un método que no rota', () => {
  it('GET action=refresh responde 405 y no devuelve cuerpo con rol', async () => {
    const { handler } = await mountAuth();
    const res = makeResponse();

    await handler(makeRequest({ method: 'GET' }), res);

    expect(res.statusCode).toBe(405);
    // `methodNotAllowed` responde con el cuerpo JSON de error estándar del repo;
    // lo que NO debe aparecer es el rol (ni ningún dato de la membresía).
    const body = JSON.parse(res.body) as { error?: { category?: string }; role?: string };
    expect(body.error?.category).toBe('VALIDATION_ERROR');
    expect(body.role).toBeUndefined();
    expect(res.body).not.toContain('role');
  });
});

describe('refreshSession resuelve identidad y rol con el token ya vigente', () => {
  it('usa el access token que devuelve la rotación, no el de la petición', async () => {
    const seen: Array<string | undefined> = [];
    vi.resetModules();
    vi.doMock('@insforge/sdk', () => ({
      createClient: (config: { accessToken?: string }) => ({
        auth: {
          getCurrentUser: async () => {
            seen.push(config.accessToken);
            return { data: { user: { id: 'u1', email: 'alumno@utel.edu.mx' } }, error: null };
          },
        },
      }),
      createAdminClient: () => ({}),
    }));
    vi.doMock('@insforge/sdk/ssr/middleware', () => ({
      DEFAULT_ACCESS_TOKEN_COOKIE: ACCESS_COOKIE,
      clearAuthCookies: () => undefined,
      setAuthCookies: () => undefined,
      updateSession: async () => ({ refreshed: true, accessToken: 'access-rotado', error: null }),
    }));
    vi.doMock('../src/server/insforge', () => ({
      createServerClient: () => ({
        database: {
          from: () => {
            const chain = {
              select: () => chain,
              eq: () => chain,
              single: async () => ({ data: { role: 'coordinator' }, error: null }),
            };
            return chain;
          },
        },
      }),
    }));

    try {
      const { refreshSession } = await import('../src/server/auth');
      const result = await refreshSession(makeRequest(), makeResponse());

      expect(result).toEqual({ role: 'coordinator' });
      expect(seen).toContain('access-rotado');
    } finally {
      vi.doUnmock('@insforge/sdk');
      vi.doUnmock('@insforge/sdk/ssr/middleware');
      vi.doUnmock('../src/server/insforge');
      vi.resetModules();
    }
  });
});