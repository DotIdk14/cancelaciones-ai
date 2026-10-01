import { handleRoute, methodNotAllowed, ok, requiredString } from '../../../../src/server/http.js';
import { createServerClient } from '../../../../src/server/insforge.js';
import { retryComparison } from '../../../../src/server/comparison-service.js';

// POST /api/cases/:caseId/comparison → 200 { comparison } | 400 | 404 | 409 | 429 | 502
//
// Reintenta UNA comparación en ERROR o una RUNNING caducada. Nunca crea una
// segunda revisión ni una segunda comparación: reabre la fila existente, que es
// la única que puede existir por revisión (`case_review_id` es UNIQUE).
export const maxDuration = 300; // Vercel: hasta 300 s en planes compatibles

export default handleRoute(async (req, res) => {
  if (req.method === 'POST') {
    const client = createServerClient();
    const caseId = requiredString(req.query, 'caseId');

    const comparison = await retryComparison(client, caseId);
    ok(res, { comparison });
    return;
  }

  methodNotAllowed(req, res, 'POST');
});