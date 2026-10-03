import {
  handleRoute,
  methodNotAllowed,
  readJsonBody,
  ok,
  ApiError,
  type QueryValue,
  type ApiRequest,
  type ApiResponse,
} from '../../src/server/http.js';
import { createSession, closeSession, refreshSession } from '../../src/server/auth.js';

// Vercel Hobby admite 12 Functions por deployment y, en un proyecto sin
// framework, cada archivo de `api/` es una Function. Login, logout y rotación
// comparten UNA sola función con el segmento dinámico `[action]`, de modo que las
// URLs públicas no cambian y el cliente no se entera:
//   POST   /api/auth/session { email, password } → 200 { user }
//   DELETE /api/auth/session                    → 204
//   POST   /api/auth/refresh                    → 200 { ok: true }
const ACTIONS = ['session', 'refresh'] as const;
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
 * HMAC antes de escribirla. Se devuelve undefined si no hay ninguno (la cuota por
 * correo sigue aplicando).
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

/** POST login · DELETE logout de `/api/auth/session`. */
async function handleSession(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method === 'POST') {
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!email || !password) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Correo y contraseña son requeridos');
    }
    const result = await createSession({ email, password }, res, { ip: clientIp(req.headers) });
    ok(res, result);
    return;
  }

  if (req.method === 'DELETE') {
    await closeSession(req, res);
    res.statusCode = 204;
    res.end();
    return;
  }

  methodNotAllowed(req, res, 'POST, DELETE');
}

/**
 * POST /api/auth/refresh → 200 { ok: true }
 * Refresco EXPLÍCITO; nunca se rota token en GETs de polling o descargas.
 */
async function handleRefresh(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    methodNotAllowed(req, res, 'POST');
    return;
  }
  await refreshSession(req, res);
  ok(res, { ok: true });
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
    await handleSession(req, res);
  },
  { public: true },
);