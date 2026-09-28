import { handleRoute, methodNotAllowed, ok } from '../../../src/server/http';
import { signOut } from '../../../src/server/auth';

// POST /api/auth/sign-out → 200 { ok: true }
export default handleRoute(async (req, res) => {
  if (req.method !== 'POST') return methodNotAllowed(req, res, 'POST');
  await signOut(req, res);
  ok(res, { ok: true });
});
