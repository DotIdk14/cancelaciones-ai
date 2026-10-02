// =============================================================================
// Autenticación y autorización de aplicación — frontera server-side.
//
// InsForge es SOLO server-side: el navegador nunca habla directamente con la
// plataforma. Las cookies httpOnly las gestiona el módulo SSR real del SDK,
// y la identidad se resuelve REMOTAMENTE contra InsForge (nunca decodificamos
// el JWT nosotros).
// =============================================================================

import { createClient, type InsForgeClient, type UserSchema, type PasswordSessionRequest } from '@insforge/sdk';
import {
  DEFAULT_ACCESS_TOKEN_COOKIE,
  clearAuthCookies,
  setAuthCookies,
  updateSession,
  type CookieOptions,
  type CookieStore,
} from '@insforge/sdk/ssr/middleware';
import { getEnv } from './env.js';
import { createServerClient } from './insforge.js';
import { ApiError, parseCookies } from './http.js';
import { checkLoginEmailQuota, checkLoginIpQuota } from './quotas.js';

export type AppRole = 'user' | 'coordinator';

export interface AuthContext {
  readonly sub: string;
  readonly email: string;
  readonly role: AppRole;
}

const ROLES: AppRole[] = ['user', 'coordinator'];

function createAuthClient(accessToken?: string): InsForgeClient {
  const env = getEnv();
  return createClient({
    baseUrl: env.INSFORGE_BASE_URL,
    anonKey: env.INSFORGE_ANON_KEY,
    isServerMode: true,
    ...(accessToken ? { accessToken } : {}),
  });
}

function cookieReader(req: { headers: { cookie?: string | string[] } }): CookieStore {
  const jar = parseCookies(req as import('./http.js').ApiRequest);
  return {
    get(name: string) {
      const value = jar[name];
      return value ?? null;
    },
    set() {
      // No-op: las cookies de petición son de solo lectura en Vercel Functions.
    },
    delete() {
      // No-op: la respuesta es la que limpia cookies.
    },
  };
}

export function cookieWriter(res: {
  appendHeader(name: string, value: string): unknown;
}): CookieStore {
  return {
    get() {
      return null;
    },
    set(name: string, value: string, options?: CookieOptions) {
      const parts: string[] = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];
      if (options?.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
      if (options?.domain) parts.push(`Domain=${options.domain}`);
      if (options?.path) parts.push(`Path=${options.path}`);
      if (options?.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
      if (options?.httpOnly) parts.push('HttpOnly');
      if (options?.secure) parts.push('Secure');
      if (options?.sameSite) {
        const sameSite = options.sameSite.charAt(0).toUpperCase() + options.sameSite.slice(1);
        parts.push(`SameSite=${sameSite}`);
      }
      res.appendHeader('Set-Cookie', parts.join('; '));
    },
    delete(name: string) {
      res.appendHeader('Set-Cookie', `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
    },
  };
}

const COOKIE_SETTINGS = {
  options: {
    accessToken: { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/' },
    refreshToken: { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/' },
  },
};

function readAccessToken(req: { headers: { cookie?: string | string[] } }): string | null {
  const jar = parseCookies(req as import('./http.js').ApiRequest);
  return jar[DEFAULT_ACCESS_TOKEN_COOKIE] ?? null;
}

/**
 * Verifica un token de acceso REMOTAMENTE contra InsForge.
 * No decodifica el JWT localmente.
 */
export async function getCurrentUserFromCookies(
  req: { headers: { cookie?: string | string[] } },
  overrides?: { baseUrl?: string; anonKey?: string },
): Promise<UserSchema | null> {
  const accessToken = readAccessToken(req);
  if (!accessToken) return null;

  const baseUrl = overrides?.baseUrl ?? getEnv().INSFORGE_BASE_URL;
  const anonKey = overrides?.anonKey ?? getEnv().INSFORGE_ANON_KEY;
  const client = createClient({
    baseUrl,
    anonKey,
    isServerMode: true,
    accessToken,
  });

  const { data, error } = await client.auth.getCurrentUser();
  if (error || !data?.user) return null;
  return data.user;
}

async function loadMembershipRole(userId: string): Promise<AppRole | null> {
  const admin = createServerClient();
  const { data, error } = await admin.database
    .from('app_memberships')
    .select('role')
    .eq('user_id', userId)
    .single();
  if (error) {
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) {
      throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'El proveedor de autorización no está disponible');
    }
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const role = (data as Record<string, unknown>).role;
  return ROLES.includes(role as AppRole) ? (role as AppRole) : null;
}

/**
 * Resuelve el contexto de autenticación desde las cookies.
 *
 * - Sin cookie/inválida → 401 (fail-closed).
 * - Sin membership      → 403.
 * - Proveedor caído     → 503 (fail-closed, nunca anónimo).
 */
export async function requireAuth(
  req: { headers: { cookie?: string | string[] } },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _res?: unknown,
): Promise<AuthContext> {
  const user = await getCurrentUserFromCookies(req);
  if (!user) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Sesión no válida o expirada');
  }

  const role = await loadMembershipRole(user.id);
  if (!role) {
    throw new ApiError(403, 'AUTH_ERROR', 'No tienes permiso para acceder a esta aplicación');
  }

  return {
    sub: user.id,
    email: user.email,
    role,
  };
}

export interface SessionCredentials {
  email: string;
  password: string;
}

export interface SessionResult {
  user: { id: string; email: string };
}

export interface CreateSessionContext {
  /** IP del cliente para rate-limit por IP; nunca se almacena cruda. */
  ip?: string;
}

export async function createSession(
  credentials: SessionCredentials,
  res: { appendHeader(name: string, value: string): unknown },
  context?: CreateSessionContext,
): Promise<SessionResult> {
  const env = getEnv();
  const client = createClient({
    baseUrl: env.INSFORGE_BASE_URL,
    anonKey: env.INSFORGE_ANON_KEY,
    isServerMode: true,
  });

  // Rate-limit de login: fail-closed. Si el servicio de cuotas falla, no se
  // llega al proveedor de identidad.
  await checkLoginEmailQuota(credentials.email);
  if (context?.ip) {
    await checkLoginIpQuota(context.ip);
  }

  const payload: PasswordSessionRequest = {
    method: 'password',
    email: credentials.email,
    password: credentials.password,
  };

  const { data, error } = await client.auth.signInWithPassword(payload);
  if (error || !data?.accessToken || !data?.user) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Correo o contraseña incorrectos');
  }

  setAuthCookies(
    cookieWriter(res),
    { accessToken: data.accessToken, refreshToken: data.refreshToken ?? null },
    COOKIE_SETTINGS,
  );

  return { user: { id: data.user.id, email: data.user.email } };
}

export async function refreshSession(
  req: { headers: { cookie?: string | string[] } },
  res: { appendHeader(name: string, value: string): unknown },
): Promise<void> {
  const env = getEnv();
  const requestCookies = cookieReader(req);
  const responseCookies = cookieWriter(res);

  const result = await updateSession({
    baseUrl: env.INSFORGE_BASE_URL,
    anonKey: env.INSFORGE_ANON_KEY,
    requestCookies,
    responseCookies,
    ...COOKIE_SETTINGS,
  });

  if (result.error || !result.accessToken) {
    clearAuthCookies(responseCookies, COOKIE_SETTINGS);
    throw new ApiError(401, 'UNAUTHENTICATED', 'Sesión expirada; vuelve a iniciar sesión');
  }
}

export async function closeSession(
  req: { headers: { cookie?: string | string[] } },
  res: { appendHeader(name: string, value: string): unknown },
): Promise<void> {
  const accessToken = readAccessToken(req);
  if (accessToken) {
    const client = createAuthClient(accessToken);
    await client.auth.signOut().catch(() => undefined);
  }
  clearAuthCookies(cookieWriter(res), COOKIE_SETTINGS);
}
