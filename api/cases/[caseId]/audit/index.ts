import { handleRoute, json, methodNotAllowed, ok, requiredString } from '../../../../src/server/http';
import { requireUser } from '../../../../src/server/auth';
import { getAuditForPolling, runAudit } from '../../../../src/server/audit-service';

// GET  /api/cases/:caseId/audit → { audit: AuditDetail|null } (polling + refresco de transcripción)
// POST /api/cases/:caseId/audit → 200 { audit } | 202 { audit: null, pendingEvidence } | 400 { error }
// La ejecución de la IA es durable: la fila audits se crea antes de llamar al modelo.
export const maxDuration = 300; // Vercel: hasta 300 s en planes compatibles

export default handleRoute(async (req, res) => {
  const { client } = await requireUser(req, res);
  const caseId = requiredString(req.query, 'caseId');

  if (req.method === 'GET') {
    const result = await getAuditForPolling(client, caseId);
    ok(res, result);
    return;
  }

  if (req.method === 'POST') {
    const outcome = await runAudit(client, caseId);
    if (outcome.phase === 'pending') {
      json(res, 202, { audit: null, pendingEvidence: outcome.pendingEvidence });
      return;
    }
    ok(res, { audit: outcome.audit });
    return;
  }

  methodNotAllowed(req, res);
});