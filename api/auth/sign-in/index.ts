import { handleRoute, methodNotAllowed, ok } from '../../../src/server/http.js';
import { attachSessionCookies, signIn } from '../../../src/server/auth.js';

export const config = { api: { bodyParser: false } };

// POST /api/auth/sign-in { email, password } → 200 { user } | 401 { error }
export default handleRoute(async (req, res) => {
  if (req.method !== 'POST') return methodNotAllowed(req, res, 'POST');
  const result = await signIn(req);
  attachSessionCookies(res, result.accessToken, result.refreshToken);
  ok(res, { user: result.user });
});
