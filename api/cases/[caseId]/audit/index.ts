import { handleRoute, json, methodNotAllowed, ok, requiredUuid } from '../../../../src/server/http.js';
import { createServerClient } from '../../../../src/server/insforge.js';
import { assertCaseOwner, getScopedCaseOr404 } from '../../../../src/server/cases.js';
import { getAuditForPolling, runAudit } from '../../../../src/server/audit-service.js';

// GET  /api/cases/:caseId/audit → { audit: AuditDetail|null } (polling + refresco de transcripción)
// POST /api/cases/:caseId/audit → 200 { audit } | 202 { audit: null, pendingEvidence } | 400 { error }
// La ejecución de la IA es durable: la fila audits se crea antes de llamar al modelo.
export const maxDuration = 300; // Vercel: hasta 300 s en planes compatibles

export default handleRoute(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    methodNotAllowed(req, res, 'GET, POST');
    return;
  }

  const client = createServerClient();
  const caseId = requiredUuid(req.query, 'caseId');

  if (req.method === 'GET') {
    await getScopedCaseOr404(client, caseId, req.auth!);
    const result = await getAuditForPolling(client, caseId);
    ok(res, result);
    return;
  }

  const caseRow = await getScopedCaseOr404(client, caseId, req.auth!);
  assertCaseOwner(caseRow, req.auth!);
  const outcome = await runAudit(client, caseId, { userId: req.auth!.sub });
  if (outcome.phase === 'pending') {
    json(res, 202, { audit: null, pendingEvidence: outcome.pendingEvidence });
    return;
  }
  ok(res, { audit: outcome.audit });
});
