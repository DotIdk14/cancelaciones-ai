import { z } from 'zod';
import { ApiError, handleRoute, ok, methodNotAllowed, readJsonBody, requiredUuid } from '../../../src/server/http.js';
import { createServerClient } from '../../../src/server/insforge.js';
import { assertCaseWriteCapability } from '../../../src/server/auth.js';
import {
  assertCaseOwner,
  getCaseOr404,
  getScopedCaseOr404,
  latestAudit,
  latestCompletedAudit,
  listAuditsByCase,
  listEvidenceRows,
  parseCaseCycleStartDateInput,
  setCaseCycleStartDate,
  setCaseTestFlag,
  deleteUnusedDraftCase,
  deleteUnreviewedAudit,
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
import { capabilitiesForRole } from '../../../src/server/capabilities.js';
import { computeEvidenceFingerprint } from '../../../src/server/audit-fingerprint.js';

// GET   /api/cases/:caseId → { case, evidences, audit, audits, review, comparison, effectiveResolution }
// PATCH /api/cases/:caseId → 200 { case } | 400 | 404
// DELETE /api/cases/:caseId { target: 'draft' | 'audit', auditId? } → 200
//
// POR QUÉ UN MÉTODO Y NO UN ARCHIVO NUEVO: Vercel Hobby admite 12 Functions y el
// proyecto está en 12/12. Este PATCH es el que guarda la fecha de inicio de
// clases que aporta una persona cuando el dictamen no pudo acreditarla; como
// método de una ruta que ya existe, no gasta una Function (HOBBY_FUNCTION_BUDGET).
//
// Sin lógica de negocio: valida el body con Zod, delega y traduce errores. El
// alcance del caso lo resuelve el SERVIDOR (`getScopedCaseOr404` +
// `assertCaseOwner`), no la RLS: el cliente de la base es superusuario y para él
// las políticas no aplican. Un caso ajeno responde 404, nunca 403
// (NO_RESOURCE_EXISTENCE_LEAK), y el alcance se resuelve ANTES de validar el
// cuerpo: un 400 en un caso ajeno confirmaría que el caso existe.
export default handleRoute(async (req, res) => {
  if (req.method === 'PATCH') {
    const client = createServerClient();
    const caseId = requiredUuid(req.query, 'caseId');
    // Un coordinador puede LEER cualquier caso (visibilidad global de auditoría),
    // así que el alcance de escritura no se resuelve solo al leer.
    const caseRow = await getScopedCaseOr404(client, caseId, req.auth!);
    const body = await readJsonBody(req);
    if (body !== null && typeof body === 'object' && !Array.isArray(body) && 'isTest' in body) {
      if (!capabilitiesForRole(req.auth!.role).canManageCases) {
        throw new ApiError(403, 'AUTH_ERROR', 'No tienes permiso para clasificar casos');
      }
      const parsed = z.object({ isTest: z.boolean() }).strict().safeParse(body);
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'isTest debe ser booleano');
      await setCaseTestFlag(client, caseId, parsed.data.isTest);
      ok(res, { case: caseToDetail(await getCaseOr404(client, caseId), false, true) });
      return;
    }
    // Capacidad ANTES que propiedad: el gerente no muta NINGÚN caso, ni propio.
    assertCaseWriteCapability(req.auth!);
    assertCaseOwner(caseRow, req.auth!);

    const input = parseCaseCycleStartDateInput(body);
    await setCaseCycleStartDate(client, caseId, {
      date: input.cycleStartDate,
      byUserId: req.auth!.sub,
      byName: input.cycleStartDateByName,
    });

    // Relectura para devolver el caso como quedó: `setCaseCycleStartDate` no
    // devuelve la fila (misma firma que el resto de escrituras de `cases`) y
    // responder con lo que el cliente ya tenía sería mentir sobre el guardado.
    // El alcance ya está resuelto sobre este mismo id, así que no se repite.
    ok(res, { case: caseToDetail(await getCaseOr404(client, caseId), true, false) });
    return;
  }

  if (req.method === 'DELETE') {
    if (!capabilitiesForRole(req.auth!.role).canManageCases) {
      throw new ApiError(403, 'AUTH_ERROR', 'No tienes permiso para borrar casos o dictámenes');
    }
    const client = createServerClient();
    const caseId = requiredUuid(req.query, 'caseId');
    const caseRow = await getScopedCaseOr404(client, caseId, req.auth!);
    const parsed = z.object({ target: z.enum(['draft', 'audit']), auditId: z.string().uuid().optional() }).strict().safeParse(await readJsonBody(req));
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Solicitud de borrado inválida');
    if (parsed.data.target === 'draft') {
      if (caseRow.status !== 'DRAFT') throw new ApiError(409, 'VALIDATION_ERROR', 'Solo se puede borrar un caso en estado borrador');
      await deleteUnusedDraftCase(client, caseId);
    } else {
      if (!parsed.data.auditId) throw new ApiError(400, 'VALIDATION_ERROR', 'Falta el identificador del dictamen');
      await deleteUnreviewedAudit(client, caseId, parsed.data.auditId);
    }
    ok(res, { deleted: true });
    return;
  }

  if (req.method !== 'GET') {
    methodNotAllowed(req, res, 'GET, PATCH, DELETE');
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
  const auditIsCurrent = completedAudit === null
    ? null
    : completedAudit.evidence_fingerprint === computeEvidenceFingerprint(evidences, caseRow.cycle_start_date ?? null);

  ok(res, {
    case: caseToDetail(
      caseRow,
      capabilitiesForRole(req.auth!.role).canWriteOwnedCases && caseRow.created_by === req.auth!.sub,
      capabilitiesForRole(req.auth!.role).canManageCases,
    ),
    evidences: evidences.map(evidenceToDto),
    audit: audit ? auditToDto(audit) : null,
    audits: audits.map(auditHistoryItemToDto),
    review: review ? caseReviewToDto(review) : null,
    comparison: comparisons[0] ? comparisonToDto(comparisons[0]) : null,
    effectiveResolution: deriveEffectiveResolution(review, auditIsCurrent === false ? null : completedAudit),
    auditIsCurrent,
  });
});
