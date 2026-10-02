import { handleRoute, methodNotAllowed, readJsonBody, ok, ApiError } from '../../src/server/http.js';
import { createSession, closeSession } from '../../src/server/auth.js';

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

// POST   /api/auth/session { email, password } → 200 { user }
// DELETE /api/auth/session → 204
export default handleRoute(
  async (req, res) => {
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
  },
  { public: true },
);
