import { describe, expect, it } from 'vitest';
import type { ApiRequest, ApiResponse } from '../src/server/http';
import signInHandler from '../api/auth/sign-in/index';
import signUpHandler from '../api/auth/sign-up/index';
import signOutHandler from '../api/auth/sign-out/index';
import meHandler from '../api/auth/me';
import auditHandler from '../api/cases/[caseId]/audit/index';
import evidenceDeleteHandler from '../api/cases/[caseId]/evidence/[evidenceId]/index';

/** Fake de ServerResponse: res ES el objeto observable (statusCode compartido). */
function makeApiResponse(): ApiResponse & { statusCode: number; body: string } {
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
      fake.body =
        typeof chunk === 'string'
          ? chunk
          : chunk instanceof Buffer
            ? chunk.toString('utf-8')
            : '';
    },
  };
  return fake as unknown as ApiResponse & { statusCode: number; body: string };
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

function parseErrorBody(res: { body: string }): { error?: { category?: string; message?: string } } {
  try {
    return JSON.parse(res.body) as { error?: { category?: string; message?: string } };
  } catch {
    return {};
  }
}

describe('rutas críticas (validación de entrada y acceso)', () => {
  it('POST /audit sin sesión → 401 AUTH_ERROR (nunca fuga de estado)', async () => {
    const res = makeApiResponse();
    const req = makeApiRequest({ method: 'POST' });

    await auditHandler(req, res);

    expect(res.statusCode).toBe(401);
    expect(parseErrorBody(res).error?.category).toBe('AUTH_ERROR');
  });

  it('DELETE /evidence sin sesión → 401', async () => {
    const res = makeApiResponse();
    const req = makeApiRequest({ method: 'DELETE', query: { caseId: 'c', evidenceId: 'e' } });

    await evidenceDeleteHandler(req, res);

    expect(res.statusCode).toBe(401);
    expect(parseErrorBody(res).error?.category).toBe('AUTH_ERROR');
  });

  it('POST /sign-in con email inválido → 400 VALIDATION_ERROR antes de tocar red', async () => {
    const res = makeApiResponse();
    const req = makeApiRequest({ method: 'POST', body: { email: 'no-es-email', password: '12345678' } });

    await signInHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(parseErrorBody(res).error?.category).toBe('VALIDATION_ERROR');
  });

  it.each([
    ['sign-in', signInHandler, 'GET', 'POST'],
    ['sign-up', signUpHandler, 'GET', 'POST'],
    ['sign-out', signOutHandler, 'GET', 'POST'],
    ['me', meHandler, 'POST', 'GET'],
  ])('auth %s rechaza método incorrecto con 405 y Allow', async (_name, handler, method, allow) => {
    const res = makeApiResponse();
    const req = makeApiRequest({ method });

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe(allow);
  });

  it('POST /sign-in con password corta → 400 VALIDATION_ERROR', async () => {
    const res = makeApiResponse();
    const req = makeApiRequest({ method: 'POST', body: { email: 'a@b.co', password: 'corta' } });

    await signInHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(parseErrorBody(res).error?.category).toBe('VALIDATION_ERROR');
  });

  it('POST /sign-up sin password → 400 VALIDATION_ERROR', async () => {
    const res = makeApiResponse();
    const req = makeApiRequest({ method: 'POST', body: { email: 'a@b.co' } });

    await signUpHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(parseErrorBody(res).error?.category).toBe('VALIDATION_ERROR');
  });

  it('body JSON null no revienta: → 400, cuerpo plano { error } sin stack traces', async () => {
    const res = makeApiResponse();
    const req = makeApiRequest({ method: 'POST', body: null });

    await signInHandler(req, res);

    expect(res.statusCode).toBe(400);
    const parsed = parseErrorBody(res);
    expect(Object.keys(parsed)).toEqual(['error']);
    expect(Object.keys(parsed.error ?? {})).toEqual(['category', 'message']);
    expect(res.body).not.toContain('at ');
    expect(res.body).not.toContain('node_modules');
    // El mensaje es genérico, no un detalle de la pila.
    expect(res.body).not.toContain('readBodyObject');
    expect(res.body).not.toContain('Cannot read properties');
  });
});
