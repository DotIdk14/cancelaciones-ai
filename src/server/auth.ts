// =============================================================================
// Autenticación — cookies httpOnly (secciones 5 y 12 del encargo).
// =============================================================================
// El navegador guarda únicamente cookies httpOnly; los tokens JWT nunca
// llegan al cliente. `insforge_access_token` (1 h) + `insforge_refresh_token`
// (30 d) con SameSite=Lax, Secure en producción.
// =============================================================================

import type { InsForgeClient } from './insforge.js';
import { createUserClient } from './insforge.js';
import { getEnv } from './env.js';
import {
  ApiError,
  clearCookie,
  mapProviderError,
  parseCookies,
  readJsonBody,
  setCookie,
  type ApiRequest,
  type ApiResponse,
} from './http.js';

export const ACCESS_COOKIE = 'insforge_access_token';
export const REFRESH_COOKIE = 'insforge_refresh_token';

const ACCESS_TTL_SECONDS = 60 * 60; // 1 h
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 d

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

export interface AuthSession {
  user: SessionUser;
  accessToken: string;
}

function cookiesSecure(): boolean {
  return getEnv().APP_URL.startsWith('https://');
}

function toPublicUser(user: { id: string; email: string; profile?: { name?: string } | null }): SessionUser {
  return { id: user.id, email: user.email, name: user.profile?.name ?? null };
}

export function attachSessionCookies(
  res: ApiResponse,
  accessToken: string,
  refreshToken: string | undefined,
): void {
  const secure = cookiesSecure();
  setCookie(res, ACCESS_COOKIE, accessToken, { maxAgeSeconds: ACCESS_TTL_SECONDS, secure });
  if (refreshToken) {
    setCookie(res, REFRESH_COOKIE, refreshToken, { maxAgeSeconds: REFRESH_TTL_SECONDS, secure });
  }
}

function clearSessionCookies(res: ApiResponse): void {
  clearCookie(res, ACCESS_COOKIE);
  clearCookie(res, REFRESH_COOKIE);
}

/** Valida el access token; si expiró, intenta refrescar con el refresh token. */
export async function getSession(req: ApiRequest, res: ApiResponse): Promise<AuthSession | null> {
  const cookies = parseCookies(req);
  const accessToken = cookies[ACCESS_COOKIE];
  if (accessToken) {
    const anonymousClient = createUserClient(accessToken);
    const { data, error } = await anonymousClient.auth.getCurrentUser();
    if (!error && data?.user) {
      return { user: toPublicUser(data.user), accessToken };
    }
  }

  // Access token ausente/inválido/expirado → intenta refresh.
  const refreshToken = cookies[REFRESH_COOKIE];
  if (refreshToken) {
    const anonymousClient = createUserClient(accessToken ?? null);
    const refreshed = await anonymousClient.auth.refreshSession({ refreshToken });
    if (!refreshed.error && refreshed.data?.accessToken && refreshed.data.user) {
      attachSessionCookies(res, refreshed.data.accessToken, refreshed.data.refreshToken ?? refreshToken);
      return { user: toPublicUser(refreshed.data.user), accessToken: refreshed.data.accessToken };
    }
  }
  clearSessionCookies(res);
  return null;
}

export interface AuthedContext {
  user: SessionUser;
  client: InsForgeClient;
}

/** Exige sesión. Lanza 401 y el cliente NO recibe datos de casos ajenos. */
export async function requireUser(req: ApiRequest, res: ApiResponse): Promise<AuthedContext> {
  const session = await getSession(req, res);
  if (!session) {
    throw new ApiError(401, 'AUTH_ERROR', 'Sesión requerida o expirada');
  }
  return { user: session.user, client: createUserClient(session.accessToken) };
}

export interface SignInResult {
  user: SessionUser;
  accessToken: string;
  refreshToken?: string;
}

async function readBodyObject(req: ApiRequest): Promise<Record<string, unknown>> {
  // El body puede ser null o no-objeto (ej. "null" parseado): nunca explotar.
  const raw = await readJsonBody(req);
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

export async function signIn(req: ApiRequest): Promise<SignInResult> {
  const body = await readBodyObject(req);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!email || !password) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'email y password son requeridos');
  }
  if (password.length < 8) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'La contraseña debe tener al menos 8 caracteres');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'El email no es válido');
  }

  const client = createUserClient(null);
  const { data, error } = await client.auth.signInWithPassword({
    method: 'password',
    email,
    password,
  });
  if (error || !data?.accessToken || !data.user) {
    throw new ApiError(401, 'AUTH_ERROR', 'Credenciales inválidas');
  }

  return { user: toPublicUser(data.user), accessToken: data.accessToken, ...(data.refreshToken ? { refreshToken: data.refreshToken } : {}) };
}

export interface SignUpResult {
  user: SessionUser | null;
  requireEmailVerification: boolean;
  /** Sesión activa cuando la cuenta queda verificada automáticamente. */
  accessToken?: string;
  refreshToken?: string;
}

export async function signUp(req: ApiRequest): Promise<SignUpResult> {
  const body = await readBodyObject(req);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : undefined;

  if (!email || !password) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'email y password son requeridos');
  }
  if (password.length < 8) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'La contraseña debe tener al menos 8 caracteres');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'El email no es válido');
  }

  const client = createUserClient(null);
  const { data, error } = await client.auth.signUp({ email, password, ...(name ? { name } : {}) });
  if (error) {
    throw mapProviderError(error, 'AUTH_ERROR');
  }
  if (!data) {
    throw new ApiError(500, 'AUTH_ERROR', 'No se pudo crear la cuenta');
  }

  const result: SignUpResult = {
    user: data.user ? toPublicUser(data.user) : null,
    requireEmailVerification: data.requireEmailVerification === true,
  };
  if (data.user && data.accessToken) {
    result.accessToken = data.accessToken;
    if (data.refreshToken) result.refreshToken = data.refreshToken;
  }
  return result;
}

export async function signOut(req: ApiRequest, res: ApiResponse): Promise<void> {
  const cookies = parseCookies(req);
  const accessToken = cookies[ACCESS_COOKIE];
  if (accessToken) {
    const client = createUserClient(accessToken);
    await client.auth.signOut().catch(() => undefined);
  }
  clearSessionCookies(res);
}
