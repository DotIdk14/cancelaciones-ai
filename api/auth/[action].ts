import {
  handleRoute,
  methodNotAllowed,
  optionalString,
  redirect,
  ApiError,
  type QueryValue,
  type ApiRequest,
  type ApiResponse,
} from '../../src/server/http.js';
import {
  closeSession,
  completeGoogleOAuth,
  refreshSession,
  startGoogleOAuth,
  type OAuthRejection,
} from '../../src/server/auth.js';
import { getEnv } from '../../src/server/env.js';

// Vercel Hobby admite 12 Functions por deployment y, en un proyecto sin
// framework, cada archivo de `api/` es una Function. Login, logout, rotación y
// el ciclo completo de Google OAuth comparten UNA sola función con el segmento
// dinámico `[action]`, de modo que las URLs públicas no cambian, el cliente no
// se entera y el presupuesto de Functions no crece:
//   DELETE /api/auth/session                    → 204
//   POST   /api/auth/refresh                    → 200 { ok: true, role }
//   GET    /api/auth/google                     → 302 a Google
//   GET    /api/auth/google-callback            → 303 a la app
// `POST /api/auth/session` no existe: el login es solo Google (GOOGLE_ONLY_LOGIN).
const ACTIONS = ['session', 'refresh', 'google', 'google-callback'] as const;
type AuthAction = (typeof ACTIONS)[number];

/**
 * Acción de autenticación de vocabulario cerrado. Una acción desconocida es 404:
 * no se responde 200 ni se ejecuta nada por defecto.
 */
function requiredAction(query: Record<string, QueryValue>): AuthAction {
  const value = query.action;
  if (typeof value !== 'string' || !ACTIONS.includes(value as AuthAction)) {
    throw new ApiError(404, 'NOT_FOUND', 'Ruta de autenticación no encontrada');
  }
  return value as AuthAction;
}

/**
 * IP del cliente para el rate-limit de login. Se toma del header que pone el
 * proxy/CDN de Vercel y NUNCA se persiste en crudo: `quotas.ts` la hashea con
 * HMAC antes de escribirla. Se devuelve undefined si no hay ninguno (el login
 * por Google sigue admitiendo, solo queda sin la capa de cuota por IP).
 */
function clientIp(headers: Record<string, string | string[] | undefined>): string | undefined {
  const first = (value: string | string[] | undefined): string | undefined => {
    if (typeof value === 'string') return value.split(',')[0]?.trim() || undefined;
    if (Array.isArray(value)) return value[0]?.split(',')[0]?.trim() || undefined;
    return undefined;
  };
  const candidate =
    first(headers['x-real-ip']) ??
    first(headers['x-forwarded-for']) ??
    first(headers['x-vercel-forwarded-for']);
  if (!candidate) return undefined;
  // Sólo IPv4/IPv6 literal: no se acepta texto arbitrario del header.
  return /^[0-9a-f:.]{3,45}$/i.test(candidate) ? candidate : undefined;
}

/** POST logout de `/api/auth/session`. */
async function handleSession(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'DELETE') {
    methodNotAllowed(req, res, 'DELETE');
    return;
  }
  await closeSession(req, res);
  res.statusCode = 204;
  res.end();
}

/**
 * POST /api/auth/refresh → 200 { ok: true, role }
 * Refresco EXPLÍCITO; nunca se rota token en GETs de polling o descargas.
 * `role` es el identificador persistido (presentación: `user` = Asesor) y viaja
 * solo para que la SPA decida qué pintar; la autorización real sigue en el
 * servidor (`req.auth`). La respuesta es un superconjunto: `ok: true` se
 * conserva para los llamadores que aún no leen `role`.
 */
async function handleRefresh(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    methodNotAllowed(req, res, 'POST');
    return;
  }
  const { role } = await refreshSession(req, res);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(JSON.stringify({ ok: true, role }));
}

/**
 * `GET /api/auth/google` → 302 a la pantalla de consentimiento de Google.
 *
 * Es una navegación de nivel superior, no un fetch: por eso va en GET y no
 * pasa por `assertMutatingCsrf` (que solo cubre POST/PATCH/DELETE). El
 * `codeVerifier` de PKCE sale del servidor en una cookie httpOnly, así que el
 * redirect por sí solo no permite canjear nada.
 */
async function handleGoogleStart(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    methodNotAllowed(req, res, 'GET');
    return;
  }
  const url = await startGoogleOAuth(res, { ip: clientIp(req.headers) });
  redirect(res, url);
}

/** Motivo de rechazo → clave corta para la URL. El texto vive en el cliente. */
const REJECTION_PARAM: Record<OAuthRejection, string> = {
  dominio: 'dominio',
  no_verificado: 'no_verificado',
  sin_acceso: 'sin_acceso',
  // El callback llegó con código pero sin el verifier de PKCE. Clave corta y
  // opaca: el texto que lee el usuario vive en `src/lib/useSession.ts`.
  sin_verifier: 'expirado',
};

/** Destino del callback. Compuesto con APP_URL, nunca con el header Host. */
function callbackRedirect(res: ApiResponse, query: '' | `?authError=${string}`): void {
  const appUrl = getEnv().APP_URL.replace(/\/$/, '');
  redirect(res, `${appUrl}/${query}`, 303);
}

/**
 * `GET /api/auth/google-callback` → canjea el código y 302/303 a la app.
 *
 * La respuesta es SIEMPRE una redirección, nunca JSON ni un token: incluso el
 * rechazo es un redirect con un motivo opaco en la query, para que el login
 * quede entero en el servidor. Los motivos se leen en `LoginScreen`.
 */
async function handleGoogleCallback(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    methodNotAllowed(req, res, 'GET');
    return;
  }

  // InsForge devuelve el código como `insforge_code`. `optionalString` rechaza
  // un parámetro repetido (llega como array) y el vacío, así que ni un
  // `?insforge_code=A&insforge_code=B` ni un `?insforge_code=` llegan al canje.
  const code = optionalString(req.query, 'insforge_code');

  // Sin código no hay nada que canjear: puede ser el `error` de un denegado en
  // la pantalla de Google o un callback suelto. Se responde igual de rápido que
  // un rechazo, sin revelar cuál de los dos fue.
  if (!code) {
    callbackRedirect(res, '?authError=fallo');
    return;
  }

  const result = await completeGoogleOAuth(req, res, code);
  callbackRedirect(res, result.ok ? '' : `?authError=${REJECTION_PARAM[result.reason]}`);
}

// Ambas acciones son públicas por diseño (login y rotación), pero las mutaciones
// siguen exigiendo CSRF dentro de `handleRoute`: fail-closed también aquí.
export default handleRoute(
  async (req, res) => {
    const action = requiredAction(req.query);
    if (action === 'refresh') {
      await handleRefresh(req, res);
      return;
    }
    if (action === 'google') {
      await handleGoogleStart(req, res);
      return;
    }
    if (action === 'google-callback') {
      await handleGoogleCallback(req, res);
      return;
    }
    await handleSession(req, res);
  },
  { public: true },
);
