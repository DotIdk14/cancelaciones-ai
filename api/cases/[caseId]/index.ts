import { auditLifecycle } from '../../../src/lib/audit-lifecycle.js';
import { reconcileCases } from '../../../src/server/student-history.js';
import { healStaleAudit } from '../../../src/server/audit-service.js';
import { listAreaComments } from '../../../src/server/area-comments.js';
import { z } from 'zod';
import { ApiError, handleRoute, ok, methodNotAllowed, readJsonBody, requiredUuid } from '../../../src/server/http.js';
import { createServerClient } from '../../../src/server/insforge.js';
import { assertCaseWriteCapability } from '../../../src/server/auth.js';
import {
  assertCaseOwner,
  caseOwnedBy,
  assertCaseNotFinalized,
  getCaseOr404,
  getAuditById,
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
import { assignImportedCase } from '../../../src/server/flokzu-import.js';

// GET   /api/cases/:caseId → { case, evidences, audit, audits, review, comparison, effectiveResolution }
// PATCH /api/cases/:caseId → 200 { case } | 400 | 404
// DELETE /api/cases/:caseId { target: 'draft' | 'audit', auditId? } → 200
//
// POR QUÉ UN MÉTODO Y NO UN ARCHIVO NUEVO: Vercel Hobby admite 12 Functions y el
// proyecto está en 12/12. Este PATCH es el que guarda la fecha de inicio de
// clases que aporta una persona cuando el dictamen no pudo acreditarla; como
// método de una ruta que ya existe, no gasta una Function (HOBBY_FUNCTION_BUDGET).
//
// Sin lógica de negocio: valida el body con Zod, delega y traduce errores. La
// lectura global y escritura por propietario las resuelve el SERVIDOR
// (`getScopedCaseOr404` + `assertCaseOwner`), no la RLS: el cliente de la base
// es superusuario y para él las políticas no aplican. Las mutaciones ocultan
// casos ajenos con 404 antes de validar el cuerpo (NO_RESOURCE_EXISTENCE_LEAK).
export default handleRoute(async (req, res) => {
  if (req.method === 'PATCH') {
    const client = createServerClient();
    const caseId = requiredUuid(req.query, 'caseId');
    // Los roles autenticados pueden LEER cualquier caso, así que el alcance de
    // escritura no se resuelve solo al leer.
    const caseRow = await getScopedCaseOr404(client, caseId, req.auth!);
    const body = await readJsonBody(req);
    if (body !== null && typeof body === 'object' && !Array.isArray(body) && 'relation' in body) {
      const parsed = z.object({ relation: z.object({ otherId: z.string().uuid(), primaryId: z.string().uuid().nullable(), sameRequest: z.boolean(), note: z.string().trim().min(1).max(2000) }).strict() }).strict().safeParse(body);
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Conciliación inválida.');
      const r = parsed.data.relation;
      await reconcileCases(client, caseId, r.otherId, r.primaryId, r.sameRequest, r.note, req.auth!);
      ok(res, { ok: true }); return;
    }
    if (body !== null && typeof body === 'object' && !Array.isArray(body) && 'assignedTo' in body) {
      if (!capabilitiesForRole(req.auth!.role).canImportCases) {
        throw new ApiError(403, 'AUTH_ERROR', 'No tienes permiso para reasignar expedientes importados.');
      }
      if (caseRow.external_source !== 'FLOKZU') throw new ApiError(404, 'NOT_FOUND', 'Caso no encontrado');
      const parsed = z.object({ assignedTo: z.string().uuid().nullable() }).strict().safeParse(body);
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'El responsable indicado no es válido.');
      await assignImportedCase(client, caseId, parsed.data.assignedTo, req.auth!);
      ok(res, { ok: true });
      return;
    }
    if (body !== null && typeof body === 'object' && !Array.isArray(body) && 'isTest' in body) {
      if (!capabilitiesForRole(req.auth!.role).canManageCases) {
        throw new ApiError(403, 'AUTH_ERROR', 'No tienes permiso para clasificar casos');
      }
      const parsed = z.object({ isTest: z.boolean() }).strict().safeParse(body);
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'isTest debe ser booleano');
      await assertCaseNotFinalized(client, caseId);
      await setCaseTestFlag(client, caseId, parsed.data.isTest);
      ok(res, { case: caseToDetail(await getCaseOr404(client, caseId), false, true) });
      return;
    }
    // Capacidad ANTES que propiedad: el gerente no muta NINGÚN caso, ni propio.
    assertCaseWriteCapability(req.auth!);
    assertCaseOwner(caseRow, req.auth!);
    await assertCaseNotFinalized(client, caseId);

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
    await assertCaseNotFinalized(client, caseId);
    const parsed = z.object({ target: z.enum(['draft', 'audit']), auditId: z.string().uuid().optional() }).strict().safeParse(await readJsonBody(req));
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Solicitud de borrado inválida');
    if (parsed.data.target === 'draft') {
      if (caseRow.status !== 'DRAFT') throw new ApiError(409, 'VALIDATION_ERROR', 'Solo se puede borrar un caso en estado borrador');
      await deleteUnusedDraftCase(client, caseId);
    } else {
      if (!parsed.data.auditId) throw new ApiError(400, 'VALIDATION_ERROR', 'Falta el identificador del dictamen');
      await deleteUnreviewedAudit(client, caseId, parsed.data.auditId, req.auth!.sub);
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
  if (req.query.auditId !== undefined) {
    const version = await getAuditById(client, requiredUuid(req.query, 'auditId'));
    if (!version || version.case_id !== caseId) throw new ApiError(404, 'NOT_FOUND', 'Versión no encontrada.');
    ok(res, { audit: auditToDto(version) }); return;
  }
  // Refresco acotado de transcripciones para que la UI vea TRANSCRIBING → READY.
  await refreshTranscriptions(client, caseId, 6_000);
  await healStaleAudit(client, caseId);
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
  const areaRows = await listAreaComments(client, caseId).catch(() => null);
  const auditIsCurrent = completedAudit === null
    ? (audit?.status === 'COMPLETED' ? false : null)
    : areaRows !== null && completedAudit.evidence_fingerprint === computeEvidenceFingerprint(evidences, caseRow.cycle_start_date ?? null, areaRows, caseRow.flokzu_data);

  ok(res, {
    case: caseToDetail(
      audit?.status === 'COMPLETED' && auditIsCurrent === true && caseRow.status === 'AUDITING' ? { ...caseRow, status: 'COMPLETED' } : caseRow,
      capabilitiesForRole(req.auth!.role).canWriteOwnedCases && caseOwnedBy(caseRow, req.auth!.sub) && review?.coordinator_decision == null,
      capabilitiesForRole(req.auth!.role).canManageCases,
    ),
    evidences: evidences.map(evidenceToDto),
    audit: completedAudit && auditIsCurrent === true ? auditToDto(completedAudit) : audit ? auditToDto(audit) : null,
    audits: audits.map(auditHistoryItemToDto),
    review: review ? caseReviewToDto(review) : null,
    comparison: review?.coordinator_decision != null && review.coordinator_created_at && comparisons[0] &&
      Date.parse(comparisons[0].created_at) >= Date.parse(review.coordinator_created_at)
      ? comparisonToDto(comparisons[0])
      : null,
    effectiveResolution: deriveEffectiveResolution(review, auditIsCurrent === false ? null : completedAudit),
    auditIsCurrent,
    auditLifecycle: auditLifecycle(caseRow.status, completedAudit, auditIsCurrent, audit),
  });
});
