import { handleRoute, ok, methodNotAllowed, requiredString } from '../../../src/server/http';
import { requireUser } from '../../../src/server/auth';
import { getCaseOr404, latestAudit, listEvidenceRows } from '../../../src/server/cases';
import { auditToDto, caseToDetail, evidenceToDto } from '../../../src/server/dto';
import { refreshTranscriptions } from '../../../src/server/audit-service';

// GET /api/cases/:caseId → { case, evidences, audit }
export default handleRoute(async (req, res) => {
  if (req.method !== 'GET') {
    methodNotAllowed(req, res);
    return;
  }
  const { client } = await requireUser(req, res);
  const caseId = requiredString(req.query, 'caseId');

  const caseRow = await getCaseOr404(client, caseId);
  // Refresco acotado de transcripciones para que la UI vea TRANSCRIBING → READY.
  await refreshTranscriptions(client, caseId, 6_000);
  const evidences = await listEvidenceRows(client, caseId);
  const audit = await latestAudit(client, caseId);

  ok(res, {
    case: caseToDetail(caseRow),
    evidences: evidences.map(evidenceToDto),
    audit: audit ? auditToDto(audit) : null,
  });
});