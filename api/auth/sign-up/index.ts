import { handleRoute, methodNotAllowed, ok } from '../../../src/server/http';
import { attachSessionCookies, signUp } from '../../../src/server/auth';

// POST /api/auth/sign-up { email, password, name? } → 200 { user, requireEmailVerification }
export default handleRoute(async (req, res) => {
  if (req.method !== 'POST') return methodNotAllowed(req, res, 'POST');
  const result = await signUp(req);
  if (result.accessToken) {
    attachSessionCookies(res, result.accessToken, result.refreshToken);
  }
  ok(res, { user: result.user, requireEmailVerification: result.requireEmailVerification });
});
