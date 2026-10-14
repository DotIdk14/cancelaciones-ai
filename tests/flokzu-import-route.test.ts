import { beforeEach, describe, expect, it, vi } from 'vitest';
import casesHandler from '../api/cases/index.js';
import type { ApiRequest, ApiResponse } from '../src/server/http.js';
import { fakeAuthContext } from './helpers/auth.js';
import { setTestEnv } from './helpers/env.js';

const { createServerClient } = vi.hoisted(() => ({ createServerClient: vi.fn() }));
vi.mock('../src/server/insforge.js', () => ({ createServerClient }));

function response(): ApiResponse & { body: string } {
  const fake = {
    statusCode: 200,
    body: '',
    headers: {} as Record<string, string>,
    setHeader(name: string, value: unknown) { fake.headers[name] = String(value); },
    appendHeader(name: string, value: unknown) { fake.headers[name] = String(value); },
    end(value?: unknown) { fake.body = typeof value === 'string' ? value : ''; },
  };
  return fake as unknown as ApiResponse & { body: string };
}

function request(method: string, role: 'user' | 'manager', contentType?: string): ApiRequest {
  return {
    method,
    headers: contentType ? { 'content-type': contentType } : {},
    query: method === 'GET' ? { view: 'imports' } : {},
    auth: fakeAuthContext(role),
  } as unknown as ApiRequest;
}

describe('endpoint de importación Flokzu', () => {
  beforeEach(() => {
    setTestEnv();
    createServerClient.mockReset();
  });

  it('la búsqueda por matrícula falla cerrada ante un rol desconocido', async () => {
    const req = request('GET', 'user');
    req.query = { view: 'student-options', studentIdentifier: 'SINTETICA-1' };
    req.auth = { ...fakeAuthContext('user'), role: 'desconocido' as never };
    const res = response();
    await casesHandler(req, res);
    expect(res.statusCode).toBe(403);
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it.each(['user', 'manager'] as const)('%s recibe 403 al consultar historial directamente', async (role) => {
    const res = response();
    await casesHandler(request('GET', role), res);
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.category).toBe('AUTH_ERROR');
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it.each(['user', 'manager'] as const)('%s recibe 403 al enviar el Excel directamente', async (role) => {
    const res = response();
    await casesHandler(request('POST', role, 'multipart/form-data; boundary=test'), res);
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.category).toBe('AUTH_ERROR');
    expect(createServerClient).not.toHaveBeenCalled();
  });
});
