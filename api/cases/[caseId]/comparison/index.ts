import { handleRoute, methodNotAllowed, ok, requiredUuid } from '../../../../src/server/http.js';
import { createServerClient } from '../../../../src/server/insforge.js';
import { assertCaseWriteCapability } from '../../../../src/server/auth.js';
import { assertCaseOwner, getScopedCaseOr404 } from '../../../../src/server/cases.js';
import { retryComparison } from '../../../../src/server/comparison-service.js';

// POST /api/cases/:caseId/comparison → 200 { comparison } | 400 | 404 | 409 | 429 | 502
//
// Reintenta UNA comparación en ERROR o una RUNNING caducada. Nunca crea una
// segunda revisión ni una segunda comparación: reabre la fila existente, que es
// la única que puede existir por revisión (`case_review_id` es UNIQUE).
export const maxDuration = 300; // Vercel: hasta 300 s en planes compatibles

export default handleRoute(async (req, res) => {
  if (req.method !== 'POST') {
    methodNotAllowed(req, res, 'POST');
    return;
  }
  const client = createServerClient();
  const caseId = requiredUuid(req.query, 'caseId');
  const caseRow = await getScopedCaseOr404(client, caseId, req.auth!);
  // Reintentar la comparación ES una mutación: el gerente solo lee.
  assertCaseWriteCapability(req.auth!);
  assertCaseOwner(caseRow, req.auth!);

  const comparison = await retryComparison(client, caseId, { userId: req.auth!.sub });
  ok(res, { comparison });
});
