import { handleRoute, ok, methodNotAllowed, requiredString } from '../../../src/server/http.js';
import { createServerClient } from '../../../src/server/insforge.js';
import { getCaseOr404, latestAudit, listAuditsByCase, listEvidenceRows } from '../../../src/server/cases.js';
import { auditHistoryItemToDto, auditToDto, caseToDetail, evidenceToDto } from '../../../src/server/dto.js';
import { refreshTranscriptions } from '../../../src/server/audit-service.js';

// GET /api/cases/:caseId → { case, evidences, audit }
export default handleRoute(async (req, res) => {
  if (req.method !== 'GET') {
    methodNotAllowed(req, res);
    return;
  }
  const caseId = requiredString(req.query, 'caseId');
  const client = createServerClient();

  const caseRow = await getCaseOr404(client, caseId);
  // Refresco acotado de transcripciones para que la UI vea TRANSCRIBING → READY.
  await refreshTranscriptions(client, caseId, 6_000);
  const evidences = await listEvidenceRows(client, caseId);
  const audit = await latestAudit(client, caseId);
  const audits = await listAuditsByCase(client, caseId);

  ok(res, {
    case: caseToDetail(caseRow),
    evidences: evidences.map(evidenceToDto),
    audit: audit ? auditToDto(audit) : null,
    audits: audits.map(auditHistoryItemToDto),
  });
});