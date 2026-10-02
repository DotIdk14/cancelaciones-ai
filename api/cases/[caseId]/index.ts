import { handleRoute, ok, methodNotAllowed, requiredUuid } from '../../../src/server/http.js';
import { createServerClient } from '../../../src/server/insforge.js';
import {
  getScopedCaseOr404,
  latestAudit,
  latestCompletedAudit,
  listAuditsByCase,
  listEvidenceRows,
} from '../../../src/server/cases.js';
import { getCaseReview, listComparisonsForCase } from '../../../src/server/reviews.js';
import {
  auditHistoryItemToDto,
  auditToDto,
  caseReviewToDto,
  caseToDetail,
  comparisonToDto,
  deriveEffectiveResolution,
  evidenceToDto,
} from '../../../src/server/dto.js';
import { refreshTranscriptions } from '../../../src/server/audit-service.js';
import { healStaleComparison } from '../../../src/server/comparison-service.js';

// GET /api/cases/:caseId → { case, evidences, audit, audits, review, comparison, effectiveResolution }
export default handleRoute(async (req, res) => {
  if (req.method !== 'GET') {
    methodNotAllowed(req, res);
    return;
  }
  const caseId = requiredUuid(req.query, 'caseId');
  const client = createServerClient();

  const caseRow = await getScopedCaseOr404(client, caseId, req.auth!);
  // Refresco acotado de transcripciones para que la UI vea TRANSCRIBING → READY.
  await refreshTranscriptions(client, caseId, 6_000);
  const evidences = await listEvidenceRows(client, caseId);
  const audit = await latestAudit(client, caseId);
  const audits = await listAuditsByCase(client, caseId);

  // Revisión humana y su comparación. La resolución efectiva se DERIVA aquí, en
  // lectura: si hay revisión manda la persona; si no, el resultado de la
  // auditoría COMPLETED vigente. La auditoría original no se modifica jamás.
  await healStaleComparison(client, caseId);
  const review = await getCaseReview(client, caseId);
  const comparisons = await listComparisonsForCase(client, caseId);
  const completedAudit = await latestCompletedAudit(client, caseId);

  ok(res, {
    case: caseToDetail(caseRow),
    evidences: evidences.map(evidenceToDto),
    audit: audit ? auditToDto(audit) : null,
    audits: audits.map(auditHistoryItemToDto),
    review: review ? caseReviewToDto(review) : null,
    comparison: comparisons[0] ? comparisonToDto(comparisons[0]) : null,
    effectiveResolution: deriveEffectiveResolution(review, completedAudit),
  });
});
