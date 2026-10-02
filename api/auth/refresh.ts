import { handleRoute, methodNotAllowed, ok, ApiError } from '../../src/server/http.js';
import { refreshSession } from '../../src/server/auth.js';

// POST /api/auth/refresh → 200 { ok: true }
// Refresco EXPLÍCITO; nunca se rota token en GETs de polling o descargas.
export default handleRoute(
  async (req, res) => {
    if (req.method !== 'POST') {
      methodNotAllowed(req, res, 'POST');
      return;
    }
    await refreshSession(req, res);
    ok(res, { ok: true });
  },
  { public: true },
);

// Referencia para type-checking; ApiError ya se importa arriba.
void ApiError;
