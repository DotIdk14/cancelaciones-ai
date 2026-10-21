import { ApiError, handleRoute, json, methodNotAllowed, ok, requiredUuid } from '../../../../src/server/http.js';
import { createServerClient } from '../../../../src/server/insforge.js';
import { assertCaseWriteCapability, capabilitiesForRole } from '../../../../src/server/auth.js';
import { assertCaseOwner, assertCaseNotFinalized, getScopedCaseOr404, latestAudit } from '../../../../src/server/cases.js';
import { getAuditForPolling, runAudit } from '../../../../src/server/audit-service.js';
import { assertAuditMayRun } from '../../../../src/server/review-locks.js';

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
  // Lanzar la auditoría ES una mutación: el gerente solo lee.
  if (capabilitiesForRole(req.auth!.role).canRetryFailedAudits) {
    const previous = await latestAudit(client, caseId);
    if (previous?.status !== 'ERROR') {
      throw new ApiError(409, 'VALIDATION_ERROR', 'El Coordinador solo puede reintentar una auditoría que terminó con error.');
    }
  } else {
    assertCaseWriteCapability(req.auth!);
    assertCaseOwner(caseRow, req.auth!);
  }
  await assertCaseNotFinalized(client, caseId);
  await assertAuditMayRun(client, caseId);
  const outcome = await runAudit(client, caseId, { userId: req.auth!.sub, correlationId: req.correlationId });
  if (outcome.phase === 'pending') {
    json(res, 202, { audit: null, pendingEvidence: outcome.pendingEvidence });
    return;
  }
  ok(res, { audit: outcome.audit });
});
