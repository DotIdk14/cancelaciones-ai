import { handleRoute, methodNotAllowed, ok } from '../../src/server/http.js';
import { getSession } from '../../src/server/auth.js';

// GET /api/auth/me → { user: { id, email, name } | null }
export default handleRoute(async (req, res) => {
  if (req.method !== 'GET') return methodNotAllowed(req, res, 'GET');
  const session = await getSession(req, res);
  ok(res, { user: session?.user ?? null });
});
