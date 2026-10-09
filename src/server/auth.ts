// =============================================================================
// Autenticación y autorización de aplicación — frontera server-side.
//
// InsForge es SOLO server-side: el navegador nunca habla directamente con la
// plataforma. Las cookies httpOnly las gestiona el módulo SSR real del SDK,
// y la identidad se resuelve REMOTAMENTE contra InsForge (nunca decodificamos
// el JWT nosotros).
//
// El login es EXCLUSIVAMENTE Google OAuth con PKCE, iniciado y canjeado aquí:
// `signInWithOAuth` corre en el servidor y devuelve la URL de Google, el
// `codeVerifier` viaja en una cookie httpOnly propia, y `exchangeOAuthCode`
// lo cambia por tokens que solo viven en cookies httpOnly. El navegador nunca
// ve un token de InsForge ni habla con el proveedor.
// =============================================================================

import { createClient, type InsForgeClient, type UserSchema } from '@insforge/sdk';
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
import { checkLoginIpQuota } from './quotas.js';
import { capabilitiesForRole } from './capabilities.js';
import type { AppRole } from './capabilities.js';

// El vocabulario de roles y sus capacidades viven en `capabilities.ts`, un módulo
// HOJA sin imports de servidor, para que los dobles en memoria de los tests puedan
// derivar capacidades sin arrastrar el SDK de InsForge (y con él, un ciclo de
// módulos que cuelga la suite antes del primer test). Se reexporta aquí porque
// `auth.ts` es, para el código de producción, la puerta de entrada a la
// autorización.
export { capabilitiesForRole, DENY_ALL_CAPABILITIES, isAppRole } from './capabilities.js';
export type { AppRole, AuthCapabilities } from './capabilities.js';

export interface AuthContext {
  readonly sub: string;
  readonly email: string;
  readonly role: AppRole;
}

const ROLES: AppRole[] = ['user', 'coordinator', 'manager'];

// -----------------------------------------------------------------------------
// Capacidades derivadas del rol (única fuente para los guards de casos)
//
// `user` es el identificador PERSISTIDO en `app_memberships` y se presenta como
// "Asesor". El rol se resuelve una sola vez en el servidor y de él se derivan
// las cuatro capacidades del contrato (`capabilitiesForRole`); ningún endpoint
// decide con un `if (role === ...)` repartido. Un rol que no resuelve se trata
// como DENEGADO, nunca como un rol con más privilegios.
// -----------------------------------------------------------------------------

/**
 * Guard de MUTACIÓN de un caso, para los endpoints que no son el de revisión.
 *
 * El gerente es SOLO LECTURA global: `canWriteOwnedCases` en false significa que
 * no muta NINGÚN caso, ni siquiera uno propio. Sin este guard, `assertCaseOwner`
 * (que sólo mira `created_by`) le abriría la escritura de los casos que él mismo
 * certificó, que es una capacidad que el contrato no le concede.
 *
 * Va ANTES de `assertCaseOwner` a propósito, y el orden es el que fija el código
 * de respuesta:
 *   - sin capacidad de escritura → 403, porque el caso está en alcance (los roles
 *     de lectura global lo ven) y lo que falta es permiso. No confirma nada que
 *     ese rol no pudiera leer ya.
 *   - con capacidad pero caso ajeno → 404, porque "no es tuyo" y "no existe" se
 *     responden igual (NO_RESOURCE_EXISTENCE_LEAK).
 */
export function assertCaseWriteCapability(auth: AuthContext): void {
  if (!capabilitiesForRole(auth.role).canWriteOwnedCases) {
    throw new ApiError(403, 'AUTH_ERROR', 'No tienes permiso para modificar este caso.');
  }
}

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

/**
 * `cookieWriter` SIEMPRE implementa `set` y `delete`. El tipo del SDK los
 * declara opcionales porque un writer de solo lectura es válido en general, así
 * que sin este cruce cada llamada a `.set(...)` sería "posiblemente indefinida".
 */
export type ResponseCookieStore = CookieStore & {
  set(name: string, value: string, options?: CookieOptions): unknown;
  delete(name: string): unknown;
};

export function cookieWriter(res: {
  appendHeader(name: string, value: string): unknown;
}): ResponseCookieStore {
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
    // `PostgrestError` NUNCA trae `statusCode` (solo `code`, `message`,
    // `details`, `hint`), así que sin esta rama `?? 500` convertía PGRST116
    // —"0 filas" = sin membresía, el caso NORMAL de un usuario no dado de
    // alta— en un 503 falso de "proveedor caído". PGRST116 cubre también el
    // caso de filas duplicadas (no hay rol único fiable): ambos se niegan con
    // `null`, que la capa HTTP traduce a 403/sin_acceso. Cualquier otro error
    // sin `statusCode` sí es fallo del proveedor → 503 (fail-closed).
    if ((error as { code?: string }).code === 'PGRST116') return null;
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

export interface SessionResult {
  user: { id: string; email: string };
}

// -----------------------------------------------------------------------------
// Login por Google OAuth (PKCE, 100% server-side)
// -----------------------------------------------------------------------------

/**
 * Único dominio de correo admitido en el login por Google.
 *
 * El filtro se evalúa SIEMPRE contra el `user.email` que devuelve InsForge tras
 * canjear el código — es decir, el correo que Google afirma haber verificado —
 * nunca contra nada que envíe el navegador. Google no garantiza que un correo
 * sea institucional solo porque termina en el dominio, así que este filtro NO
 * reemplaza la autorización: un dominio válido sin fila en `app_memberships`
 * sigue recibiendo 403 (`NO_SIGNUP`).
 */
export const ALLOWED_EMAIL_DOMAIN = 'utel.edu.mx';

/**
 * `true` solo si el correo es exactamente `<cuenta>@utel.edu.mx`.
 *
 * No se usa `endsWith` a secas: aceptaría `utel.edu.mx` a secas (sin cuenta),
 * `alumno@utel.edu.mx.evil.com` y `notutel.edu.mx@evil.com`. Se exige
 * exactamente un `@`, una parte local no vacía y el dominio coincidente entero.
 */
export function isAllowedEmail(email: string): boolean {
  const parts = email.trim().toLowerCase().split('@');
  if (parts.length !== 2) return false;
  // Defaults explícitos: con `noUncheckedIndexedAccess` el destructuring de un
  // array devuelve `string | undefined` aunque el length ya esté comprobado.
  const [local = '', domain = ''] = parts;
  return local.length > 0 && domain === ALLOWED_EMAIL_DOMAIN;
}

/** Cookie propia que transporta el `codeVerifier` de PKCE entre el inicio y el callback. */
export const OAUTH_VERIFIER_COOKIE = 'insforge_oauth_verifier';

/**
 * Ventana de vida del verifier.
 *
 * No son "unos segundos": entre salir hacia Google y volver hay una
 * autenticación completa (contraseña, segundo factor, selector de cuenta y
 * pantalla de consentimiento). Un usuario que tiene que autenticarse desde cero
 * tarda minutos, y con la ventana anterior (10 min) el verifier caducaba a mitad
 * del flujo: el callback llegaba con código pero sin cookie, y el fallo se
 * reportaba como si el login nunca hubiera empezado.
 */
const OAUTH_VERIFIER_MAX_AGE_SECONDS = 1800;

/** Motivo por el que un login con Google válido no abre sesión. */
export type OAuthRejection = 'dominio' | 'no_verificado' | 'sin_acceso' | 'sin_verifier';

/**
 * Resultado del canje. Un rechazo NO es una excepción: es un resultado esperado
 * del camino de login y la capa HTTP lo traduce a una redirección con motivo.
 * Los rechazos son discriminados para que el motivo nunca se deduuzca de un
 * mensaje libre.
 */
export type GoogleOAuthResult =
  | ({ ok: true } & SessionResult)
  | { ok: false; reason: OAuthRejection };

export interface GoogleOAuthStartContext {
  /** IP del cliente para el rate-limit; nunca se almacena cruda. */
  ip?: string;
}

/** Callback OAuth server-side. Debe coincidir con `allowed_redirect_urls` de InsForge. */
export function oauthCallbackUrl(): string {
  return `${getEnv().APP_URL.replace(/\/$/, '')}/api/auth/google-callback`;
}

/**
 * Paso 1: pide a InsForge la URL de Google y guarda el `codeVerifier` en una
 * cookie httpOnly. El navegador solo recibe la URL: el verifier nunca sale del
 * servidor, así que un atacante que intercepte el redirect no puede canjear el
 * código.
 */
export async function startGoogleOAuth(
  res: { appendHeader(name: string, value: string): unknown },
  context?: GoogleOAuthStartContext,
): Promise<string> {
  // Rate-limit fail-closed. Si el servicio de cuotas cae no se llega al
  // proveedor: generar redirecciones ilimitadas es el único abuso posible aquí.
  if (context?.ip) {
    await checkLoginIpQuota(context.ip);
  }

  const { data, error } = await createAuthClient().auth.signInWithOAuth('google', {
    redirectTo: oauthCallbackUrl(),
    skipBrowserRedirect: true,
  });
  const url = data?.url;
  const codeVerifier = data?.codeVerifier;
  if (error || !url || !codeVerifier) {
    throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'No se pudo iniciar el inicio de sesión con Google');
  }

  cookieWriter(res).set(
    OAUTH_VERIFIER_COOKIE,
    codeVerifier,
    {
      maxAge: OAUTH_VERIFIER_MAX_AGE_SECONDS,
      httpOnly: true,
      secure: true,
      // `None` y NO `Lax`. El callback no vuelve directo de Google: vuelve
      // rebotado desde el callback compartido de InsForge (`api.insforge.dev`),
      // que es otro sitio. En esa cadena de redirects cross-site una cookie
      // `Lax` no se entrega de forma fiable, y el síntoma es exactamente el que
      // se veía: llega `insforge_code` pero no el verifier. `None` exige
      // `Secure` (ya está) y solo viaja por HTTPS.
      sameSite: 'none',
      path: '/',
    },
  );

  return url;
}

/**
 * Elimina la cookie del verifier. Se llama SIEMPRE, también en el camino feliz:
 * dejarlo puesto permitiría reintentar el canje con el mismo verifier.
 */
function clearVerifierCookie(res: { appendHeader(name: string, value: string): unknown }): void {
  cookieWriter(res).delete(OAUTH_VERIFIER_COOKIE);
}

/**
 * Cierra la sesión en InsForge cuando el login se rechaza.
 *
 * El canje ya abrió una sesión real en el backend: sin esto quedaría una sesión
 * viva en InsForge sin cookie que la use. El `signOut` va sobre el MISMO cliente
 * que canjeó el código, porque es el único que tiene el token: `exchangeOAuthCode`
 * llama a `saveSessionFromResponse`, que hace `setAuthToken` incluso en server
 * mode, así que el POST de logout sale con el Bearer y la revocación es real.
 *
 * `signOut` traga sus propios errores de red y siempre devuelve `{ error: null }`:
 * el `.catch` es solo una red de seguridad y un fallo de revocación NO es
 * observable desde aquí. Su impacto está acotado porque un rechazo nunca escribe
 * cookie de sesión: el token queda solo en la memoria de este cliente, que muere
 * al terminar la petición.
 */
async function revokeAfterRejection(client: InsForgeClient): Promise<void> {
  await client.auth.signOut().catch(() => undefined);
}

/**
 * Paso 2: canjea el código de Google y decide si el login abre sesión.
 *
 * El orden es deliberado y fail-closed: primero el dominio (es la política que
 * se pidió), después el flag de verificación, después la autorización real
 * (`app_memberships`). Un rechazo cierra la sesión remota, borra el verifier y
 * NO escribe ninguna cookie de sesión.
 */
export async function completeGoogleOAuth(
  req: { headers: { cookie?: string | string[] } },
  res: { appendHeader(name: string, value: string): unknown },
  code: string,
): Promise<GoogleOAuthResult> {
  const codeVerifier = parseCookies(req as import('./http.js').ApiRequest)[OAUTH_VERIFIER_COOKIE];
  clearVerifierCookie(res);

  // Rechazo, no excepción. El contrato de este callback es responder SIEMPRE
  // con una redirección, nunca con JSON: lanzar aquí devolvía al navegador un
  // 400 crudo y dejaba al usuario mirando un error técnica en vez de la pantalla
  // de login con un motivo. El fail-closed no se pierde: sin verifier se sale
  // ANTES de tocar al proveedor de identidad, así que el canje nunca ocurre.
  if (!codeVerifier) {
    return { ok: false, reason: 'sin_verifier' };
  }

  const client = createAuthClient();
  const { data, error } = await client.auth.exchangeOAuthCode(code, codeVerifier);
  if (error || !data?.accessToken || !data?.user) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'No se pudo completar el inicio de sesión con Google');
  }

  const email = data.user.email.trim();
  if (!isAllowedEmail(email)) {
    await revokeAfterRejection(client);
    return { ok: false, reason: 'dominio' };
  }
  if (!data.user.emailVerified) {
    await revokeAfterRejection(client);
    return { ok: false, reason: 'no_verificado' };
  }

  // La fila en `app_memberships` es la autorización real (NO_SIGNUP). Un 5xx
  // del proveedor sale como 503 por `loadMembershipRole`: nunca como 403, para
  // que una caída de infraestructura no se disfraze de "sin permiso".
  const role = await loadMembershipRole(data.user.id);
  if (!role) {
    await revokeAfterRejection(client);
    return { ok: false, reason: 'sin_acceso' };
  }

  setAuthCookies(
    cookieWriter(res),
    { accessToken: data.accessToken, refreshToken: data.refreshToken ?? null },
    COOKIE_SETTINGS,
  );

  return { ok: true, user: { id: data.user.id, email: data.user.email } };
}

export async function refreshSession(
  req: { headers: { cookie?: string | string[] } },
  res: { appendHeader(name: string, value: string): unknown },
): Promise<{ role: AppRole }> {
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

  // Resuelve identidad y rol con el token ROTADO, no con el de la petición: el
  // token devuelto por `updateSession` es el único que queda vigente después de
  // la rotación. Un fallo aquí limpia cookies y sale 401, igual que un refresh
  // fallido; un rol que no resuelve sale 403 fail-closed (nunca `ok: true` con
  // rol vacío).
  const client = createAuthClient(result.accessToken);
  const { data, error } = await client.auth.getCurrentUser();
  if (error || !data?.user) {
    clearAuthCookies(responseCookies, COOKIE_SETTINGS);
    throw new ApiError(401, 'UNAUTHENTICATED', 'Sesión expirada; vuelve a iniciar sesión');
  }

  const role = await loadMembershipRole(data.user.id);
  if (!role) {
    // El refresh ya rotó y escribió cookies válidas antes de resolver el rol. Si
    // la autorización falla (sin fila en `app_memberships`), hay que borrar esas
    // cookies: un rechazo no puede dejar una sesión InsForge viva en el navegador.
    clearAuthCookies(responseCookies, COOKIE_SETTINGS);
    throw new ApiError(403, 'AUTH_ERROR', 'No tienes permiso para acceder a esta aplicación');
  }

  return { role };
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
