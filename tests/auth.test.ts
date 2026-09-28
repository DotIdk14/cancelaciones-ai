import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiRequest, ApiResponse } from '../src/server/http';
import { ACCESS_COOKIE, getSession, REFRESH_COOKIE } from '../src/server/auth';
import { setTestEnv } from './helpers/env';

const refreshSession = vi.fn();
const getCurrentUser = vi.fn();

vi.mock('../src/server/insforge', () => ({
  createUserClient: vi.fn(() => ({
    auth: { getCurrentUser, refreshSession },
  })),
}));

function response(): ApiResponse & { cookies: string[] } {
  const res = {
    cookies: [] as string[],
    appendHeader(name: string, value: unknown) {
      if (name.toLowerCase() === 'set-cookie') this.cookies.push(String(value));
    },
    setHeader() {},
    end() {},
  };
  return res as unknown as ApiResponse & { cookies: string[] };
}

function request(cookie: string): ApiRequest {
  return { headers: { cookie }, query: {} } as unknown as ApiRequest;
}

describe('getSession refresh', () => {
  beforeEach(() => {
    setTestEnv();
    getCurrentUser.mockReset();
    refreshSession.mockReset();
  });

  it('refresca sesión cuando falta access cookie pero refresh sigue válido', async () => {
    refreshSession.mockResolvedValue({
      data: { accessToken: 'access-new', refreshToken: 'refresh-new', user: { id: 'u1', email: 'u@test.com' } },
      error: null,
    });
    const res = response();

    const session = await getSession(request(`${REFRESH_COOKIE}=refresh-old`), res);

    expect(session?.accessToken).toBe('access-new');
    expect(res.cookies.some((cookie) => cookie.startsWith(`${ACCESS_COOKIE}=access-new`))).toBe(true);
    expect(res.cookies.some((cookie) => cookie.startsWith(`${REFRESH_COOKIE}=refresh-new`))).toBe(true);
  });

  it('limpia cookies cuando refresh es inválido', async () => {
    refreshSession.mockResolvedValue({ data: null, error: new Error('expired') });
    const res = response();

    const session = await getSession(request(`${REFRESH_COOKIE}=refresh-bad`), res);

    expect(session).toBeNull();
    expect(res.cookies).toContain(`${ACCESS_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
    expect(res.cookies).toContain(`${REFRESH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  });
});
