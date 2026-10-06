// =============================================================================
// Login por Google OAuth: dominio @utel.edu.mx, PKCE y autorización.
//
// Fijan las tres decisiones que gobiernan el acceso:
//   1. El login es SOLO Google (no queda login por contraseña).
//   2. El correo debe ser del dominio institucional.
//   3. El dominio NO es la autorización: sin fila en `app_memberships` el login
//      se rechaza igual (NO_SIGNUP).
//
// Son end-to-end sobre el handler real de `api/auth/[action].ts`: no se
// reimplementa la lógica, se ejecuta el código de producción con el cliente de
// InsForge sustituido por un doble mínimo.
// =============================================================================

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ApiRequest, ApiResponse } from '../src/server/http';
import { setTestEnv } from './helpers/env';
import authHandler from '../api/auth/[action]';

const VERIFIER_COOKIE = 'insforge_oauth_verifier';
const ACCESS_COOKIE = 'insforge_access_token';
const APP_URL = 'https://app.example.com';

interface FakeResponse extends ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  /** Todos los `Set-Cookie` escritos, en orden (Vercel admite varios). */
  setCookies: string[];
  body: string;
  writtenHead: Record<string, string> | null;
}

function makeResponse(): FakeResponse {
  const fake = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    setCookies: [] as string[],
    body: '',
    writtenHead: null as Record<string, string> | null,
    setHeader(name: string, value: unknown) {
      fake.headers[name] = String(value);
    },
    appendHeader(name: string, value: unknown) {
      // `setAuthCookies` escribe acceso y refresco por separado: sobrescribir
      // el último ocultaría la cookie de acceso, que es la que importa.
      if (name.toLowerCase() === 'set-cookie') {
        fake.setCookies.push(String(value));
      }
      fake.headers[name] = String(value);
    },
    writeHead(status: number, headers: Record<string, string>) {
      fake.statusCode = status;
      fake.writtenHead = headers;
    },
    end(chunk?: unknown) {
      fake.body = typeof chunk === 'string' ? chunk : '';
    },
  };
  return fake as unknown as FakeResponse;
}

/** Todas las cookies escritas, unidas, para poder buscar dentro. */
function setCookieHeader(res: FakeResponse): string {
  return res.setCookies.join('\n');
}

function makeRequest(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: 'GET',
    url: '/',
    headers: {},
    query: {},
    ...overrides,
  } as unknown as ApiRequest;
}

/** Todos los destinos `Location` que escribió la respuesta. */
function locations(res: FakeResponse): string[] {
  return [res.writtenHead?.Location, res.headers.Location].filter((v): v is string => typeof v === 'string');
}

/** Petición de callback con el verifier presente, como la haría el navegador. */
function callbackRequest(code?: string | string[], extraHeaders: Record<string, string> = {}): ApiRequest {
  const query: Record<string, string | string[]> = { action: 'google-callback' };
  if (code !== undefined) query.insforge_code = code;
  return makeRequest({
    query,
    headers: { cookie: `${VERIFIER_COOKIE}=verifier-1`, ...extraHeaders },
  });
}

interface ExchangeResult {
  data: unknown;
  error: unknown;
}

interface MembershipResult {
  data: unknown;
  error: unknown;
}

const ALLOWED_USER = {
  id: 'u1',
  email: 'alumno@utel.edu.mx',
  emailVerified: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  metadata: null,
  profile: null,
};

const OAUTH_URL = 'https://accounts.google.com/o/oauth2/auth?x=1';

/**
 * Monta `api/auth/[action].ts` con el cliente de InsForge sustituido.
 *
 * `vi.resetModules()` + import dinámico es lo que hace que el doble entre en
 * vigor: `auth.ts` resuelve `createClient` en el momento de la llamada, no al
 * importar el módulo.
 */
async function mountAuth(
  overrides: { exchange?: ExchangeResult; membership?: MembershipResult } = {},
) {
  const calls = { exchange: [] as string[], signOut: 0, signInWithOAuth: 0 };
  const exchange = overrides.exchange ?? {
    data: { accessToken: 'access-1', refreshToken: 'refresh-1', user: ALLOWED_USER },
    error: null,
  };
  const membership = overrides.membership ?? { data: { role: 'user' }, error: null };

  vi.resetModules();
  vi.doMock('@insforge/sdk', () => ({
    createClient: () => ({
      auth: {
        signInWithOAuth: async () => {
          calls.signInWithOAuth += 1;
          return {
            data: { url: OAUTH_URL, provider: 'google', codeVerifier: 'verifier-1' },
            error: null,
          };
        },
        exchangeOAuthCode: async (code: string) => {
          calls.exchange.push(code);
          return exchange;
        },
        signOut: async () => {
          calls.signOut += 1;
          return { error: null };
        },
        getCurrentUser: async () => ({ data: null, error: null }),
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
            single: async () => membership,
          };
          return chain;
        },
      },
    }),
  }));

  const module = await import('../api/auth/[action]');
  const handler = module.default as unknown as (req: ApiRequest, res: ApiResponse) => Promise<void>;

  return {
    handler,
    calls,
    cleanup() {
      vi.doUnmock('@insforge/sdk');
      vi.doUnmock('../src/server/insforge');
      vi.resetModules();
    },
  };
}

/** Login completo (canje) con un correo y una respuesta de membership dadas. */
async function attemptLogin(
  email: string,
  membership?: MembershipResult,
): Promise<{ res: FakeResponse; calls: { signOut: number; exchange: string[] } }> {
  const { handler, calls, cleanup } = await mountAuth({
    exchange: {
      data: { accessToken: 'access-1', refreshToken: 'refresh-1', user: { ...ALLOWED_USER, email } },
      error: null,
    },
    ...(membership ? { membership } : {}),
  });
  const res = makeResponse();
  await handler(callbackRequest('code-1'), res);
  cleanup();
  return { res, calls };
}

beforeEach(() => {
  setTestEnv();
  vi.stubEnv('APP_URL', APP_URL);
});

describe('G1 · el login es SOLO Google: no queda entrada por contraseña', () => {
  it('POST /api/auth/session responde 405 y solo admite DELETE', async () => {
    const { handler, cleanup } = await mountAuth();
    const res = makeResponse();

    await handler(
      makeRequest({
        method: 'POST',
        query: { action: 'session' },
        body: { email: 'alumno@utel.edu.mx', password: 'cualquiera' },
        headers: { origin: APP_URL, 'x-app-request': '1' },
      }),
      res,
    );

    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('DELETE');
    cleanup();
  });

  it('una acción de auth desconocida sigue siendo 404, no un 200 por defecto', async () => {
    const { handler, cleanup } = await mountAuth();
    const res = makeResponse();

    await handler(makeRequest({ query: { action: 'microsoft' }, headers: {} }), res);

    expect(res.statusCode).toBe(404);
    cleanup();
  });
});

describe('G2 · PKCE: el verifier viaja en cookie httpOnly y se borra al canjear', () => {
  it('el inicio devuelve 302 a Google y NO expone el verifier en la URL', async () => {
    const { handler, calls, cleanup } = await mountAuth();
    const res = makeResponse();

    await handler(makeRequest({ query: { action: 'google' }, headers: {} }), res);

    expect(res.statusCode).toBe(302);
    expect(locations(res)).toContain(OAUTH_URL);
    expect(calls.signInWithOAuth).toBe(1);
    // El verifier sale en `Set-Cookie`, nunca en el destino del redirect.
    expect(setCookieHeader(res)).toContain(`${VERIFIER_COOKIE}=verifier-1`);
    expect(setCookieHeader(res)).toContain('HttpOnly');
    // `None` (no `Lax`) + `Secure`: el callback no vuelve directo de Google,
    // vuelve rebotado desde `api.insforge.dev`, otro sitio. En esa cadena
    // cross-site una cookie `Lax` no se entrega de forma fiable, y el callback
    // llegaba con código pero sin verifier ("el inicio de sesión expiró").
    expect(setCookieHeader(res)).toContain('SameSite=None');
    expect(setCookieHeader(res)).toContain('Secure');
    // 30 min y no 10: el usuario puede tener que autenticarse entero en Google
    // (contraseña + segundo factor + consentimiento) antes de volver.
    expect(setCookieHeader(res)).toContain('Max-Age=1800');
    cleanup();
  });

  it('un callback sin verifier NO canjea y vuelve al login con motivo (fail-closed)', async () => {
    const { handler, calls, cleanup } = await mountAuth();
    const res = makeResponse();

    await handler(makeRequest({ query: { action: 'google-callback', insforge_code: 'code-1' }, headers: {} }), res);

    // Redirección, nunca JSON: el callback promete devolver al usuario a la app
    // con un motivo. Antes respondía un 400 crudo y el usuario terminaba viendo
    // un error técnico en el navegador en vez de la pantalla de login.
    expect(res.statusCode).toBe(303);
    expect(locations(res)).toContain(`${APP_URL}/?authError=expirado`);
    // La frontera: sin verifier no se toca el proveedor de identidad.
    expect(calls.exchange).toEqual([]);
    cleanup();
  });

  it('el verifier se borra también en el camino feliz, para que no sea reutilizable', async () => {
    const { handler, cleanup } = await mountAuth();
    const res = makeResponse();

    await handler(callbackRequest('code-1'), res);

    expect(locations(res)).toContain(`${APP_URL}/`);
    expect(setCookieHeader(res)).toContain(`${VERIFIER_COOKIE}=;`);
    cleanup();
  });

  it('el canje envía el código recibido y el verifier de la cookie', async () => {
    const { handler, calls, cleanup } = await mountAuth();
    const res = makeResponse();

    await handler(callbackRequest('code-real'), res);

    expect(calls.exchange).toEqual(['code-real']);
    cleanup();
  });
});

describe('G3 · solo entra el dominio @utel.edu.mx', () => {
  it.each([['alumno@utel.edu.mx'], ['Jefe@UTEL.EDU.MX'], ['coordinacion@utel.edu.mx']])(
    '%s abre sesión',
    async (email) => {
      const { res } = await attemptLogin(email);
      expect(res.statusCode).toBe(303);
      expect(locations(res)).toContain(`${APP_URL}/`);
      expect(setCookieHeader(res)).toContain(ACCESS_COOKIE);
    },
  );

  it.each([
    ['alumno@utel.edu.uy', 'mismo prefijo, dominio distinto'],
    ['alumno@utel.edu.mx.evil.com', 'sufijo agregado'],
    ['utel.edu.mx', 'el dominio solo, sin cuenta'],
    ['alumno@gmail.com', 'dominio personal'],
    ['notutel.edu.mx@evil.com', 'el dominio aparece en el local'],
    ['Jefe.UTEL.EDU.MX', 'sin @: no es un correo'],
    ['@utel.edu.mx', 'parte local vacía'],
  ])('%s NO abre sesión (%s)', async (email) => {
    const { res, calls } = await attemptLogin(email);

    expect(res.statusCode).toBe(303);
    expect(locations(res)).toContain(`${APP_URL}/?authError=dominio`);
    // Sin cookie de acceso: el rechazo no deja una sesión utilizable.
    expect(setCookieHeader(res)).not.toContain(ACCESS_COOKIE);
    // Y la sesión que InsForge abrió al canjar se cierra en el servidor.
    expect(calls.signOut).toBe(1);
  });

  it('el filtro no depende de las mayúsculas que devuelva el proveedor', async () => {
    const { res } = await attemptLogin('  ALUMNO@UTEL.EDU.MX  ');
    expect(locations(res)).toContain(`${APP_URL}/`);
  });

  it('un correo que Google no marcó como verificado también se rechaza', async () => {
    const { handler, calls, cleanup } = await mountAuth({
      exchange: {
        data: {
          accessToken: 'access-1',
          refreshToken: 'refresh-1',
          user: { ...ALLOWED_USER, emailVerified: false },
        },
        error: null,
      },
    });
    const res = makeResponse();

    await handler(callbackRequest('code-1'), res);

    expect(locations(res)).toContain(`${APP_URL}/?authError=no_verificado`);
    expect(setCookieHeader(res)).not.toContain(ACCESS_COOKIE);
    expect(calls.signOut).toBe(1);
    cleanup();
  });

  it('si el canje falla no se abre sesión ni se filtra el motivo del proveedor', async () => {
    const { handler, calls, cleanup } = await mountAuth({
      exchange: { data: null, error: { statusCode: 401, message: 'invalid_grant en secret-token-xyz' } },
    });
    const res = makeResponse();

    await handler(callbackRequest('code-1'), res);

    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain('secret-token-xyz');
    expect(calls.signOut).toBe(0);
    cleanup();
  });
});

describe('G4 · el dominio NO es autorización: sin membership sigue cerrado', () => {
  it('un @utel.edu.mx sin fila en app_memberships NO abre sesión', async () => {
    const { res, calls } = await attemptLogin('alumno@utel.edu.mx', {
      data: null,
      error: { statusCode: 404, message: 'no rows' },
    });

    expect(locations(res)).toContain(`${APP_URL}/?authError=sin_acceso`);
    expect(setCookieHeader(res)).not.toContain(ACCESS_COOKIE);
    expect(calls.signOut).toBe(1);
  });

  it('si la base de memberships está caída el login NO se concede (503, fail-closed)', async () => {
    const { handler, cleanup } = await mountAuth({
      membership: { data: null, error: { statusCode: 503, message: 'caido' } },
    });
    const res = makeResponse();

    await handler(callbackRequest('code-1'), res);

    // 503 y no un 403 de "sin permiso": una caída no se disfraza de rechazo.
    expect(res.statusCode).toBe(503);
    cleanup();
  });

  it('un rol desconocido en la base no escala privilegios: se rechaza', async () => {
    const { res } = await attemptLogin('alumno@utel.edu.mx', { data: { role: 'admin' }, error: null });

    expect(locations(res)).toContain(`${APP_URL}/?authError=sin_acceso`);
    expect(setCookieHeader(res)).not.toContain(ACCESS_COOKIE);
  });
});

describe('G5 · el callback nunca filtra el código ni acepta un destino de la request', () => {
  it('sin insforge_code responde 303 con motivo genérico, sin canjear', async () => {
    const { handler, calls, cleanup } = await mountAuth();
    const res = makeResponse();

    await handler(makeRequest({ query: { action: 'google-callback' }, headers: {} }), res);

    expect(res.statusCode).toBe(303);
    expect(locations(res)).toContain(`${APP_URL}/?authError=fallo`);
    expect(calls.exchange).toEqual([]);
    cleanup();
  });

  it('un insforge_code repetido (array) NO llega al canje', async () => {
    const { handler, calls, cleanup } = await mountAuth();
    const res = makeResponse();

    await handler(callbackRequest(['code-a', 'code-b']), res);

    expect(locations(res)).toContain(`${APP_URL}/?authError=fallo`);
    expect(calls.exchange).toEqual([]);
    cleanup();
  });

  it('un Host ajeno NO puede cambiar el destino del redirect (no es un redirect abierto)', async () => {
    const { handler, cleanup } = await mountAuth();
    const res = makeResponse();

    await handler(
      callbackRequest('code-1', {
        host: 'sitio-malicioso.example',
        'x-forwarded-host': 'sitio-malicioso.example',
      }),
      res);

    expect(locations(res).length).toBeGreaterThan(0);
    for (const location of locations(res)) {
      expect(location.startsWith(`${APP_URL}/`)).toBe(true);
      expect(location).not.toContain('sitio-malicioso.example');
    }
    cleanup();
  });

  it('un parámetro redirect en la query no altera el destino', async () => {
    const { handler, cleanup } = await mountAuth();
    const res = makeResponse();

    await handler(
      makeRequest({
        query: { action: 'google-callback', insforge_code: 'code-1', redirect: 'https://sitio-malicioso.example' },
        headers: { cookie: `${VERIFIER_COOKIE}=verifier-1` },
      }),
      res,
    );

    for (const location of locations(res)) {
      expect(location.startsWith(`${APP_URL}/`)).toBe(true);
    }
    cleanup();
  });

  it('el inicio y el callback de OAuth solo aceptan GET', async () => {
    const { handler, cleanup } = await mountAuth();
    const res = makeResponse();

    await handler(makeRequest({ method: 'POST', query: { action: 'google' }, headers: {} }), res);

    // Sin `Origin` la respuesta es 403: en una ruta pública la comprobación
    // CSRF corre ANTES que el despacho por método, así que ni siquiera llega a
    // decir "esto es un GET".
    expect(res.statusCode).toBe(403);
    cleanup();
  });

  it('con CSRF válido, un POST al inicio de OAuth sí cae en el 405 del método', async () => {
    const { handler, cleanup } = await mountAuth();
    const res = makeResponse();

    await handler(
      makeRequest({
        method: 'POST',
        query: { action: 'google' },
        headers: { origin: APP_URL, 'x-app-request': '1' },
      }),
      res,
    );

    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('GET');
    cleanup();
  });
});

describe('G6 · presupuesto de Functions de Vercel Hobby', () => {
  it('api/ sigue teniendo 12 archivos o menos: el OAuth no sumó Functions', () => {
    const root = join(process.cwd(), 'api');
    const count = readdirSync(root, { recursive: true, withFileTypes: true }).filter(
      (entry) => entry.isFile() && entry.name.endsWith('.ts'),
    ).length;

    // HOBBY_FUNCTION_BUDGET: cada archivo de `api/` es una Function y Hobby
    // admite 12. Por eso el flujo OAuth vive DENTRO de `api/auth/[action].ts`.
    expect(count).toBeLessThanOrEqual(12);
  });
});
