import {
  created,
  handleRoute,
  methodNotAllowed,
  ok,
  readJsonBody,
  requiredUuid,
  ApiError,
} from '../../../../src/server/http.js';
import { createServerClient } from '../../../../src/server/insforge.js';
import { capabilitiesForRole } from '../../../../src/server/auth.js';
import { assertCaseOwner, getCaseOr404, getScopedCaseOr404, latestCompletedAudit, listEvidenceRows, updateCaseDimensions } from '../../../../src/server/cases.js';
import { DUPLICATE_FINALIZATION_MESSAGE, finalizeCaseReview, getCaseReviewForAudit, listComparisonsForReview } from '../../../../src/server/reviews.js';
import { fingerprintForAuditVersion, getActiveAuditVersion } from '../../../../src/server/audit-versions.js';
import { listAreaComments } from '../../../../src/server/area-comments.js';
import { parseCoordinatorReviewInput, parseHumanReviewInput } from '../../../../src/skills/review/schema.js';
import {
  caseReviewToDto,
  comparisonToDto,
  deriveEffectiveResolution,
  deriveWorkflowState,
} from '../../../../src/server/dto.js';
import { healStaleComparison, startComparison, submitCaseReview } from '../../../../src/server/comparison-service.js';

// GET  /api/cases/:caseId/review → 200 { review, comparison, workflowState, effectiveResolution }
// POST /api/cases/:caseId/review → 201 (asesor) | 200 (coordinador) | 400 | 403 | 404 | 409 | 502
//
// Flujo de DOS etapas. La etapa la RESUELVE el servidor a partir de las
// capacidades del rol (`capabilitiesForRole`) y del estado persistido
// (`deriveWorkflowState`); el cliente nunca la declara:
//   - Asesor (`canReviewOwnCases`, caso propio): registra `{ result, comment? }`
//     y crea la fila de `case_reviews` (solo en PENDING_ADVISOR; después, 409).
//   - Coordinador (`canFinalizeAnyCase`): finaliza `{ decision, resolution?, comment? }`
//     (solo en PENDING_COORDINATOR; después, 409). Puede cambiar la resolución
//     final y comentar tanto en casos propios como ajenos.
//   - Gerente: sin capacidad de mutación → 403 (ya puede leer el caso, no filtra nada).
//
// El actor y la hora los deriva SIEMPRE el servidor de `req.auth`; un
// `reviewerName`/actor/rol del cliente se rechaza en el schema (strict) o se
// ignora. La comparación solo se inicia tras la decisión final del Coordinador.
export const maxDuration = 300; // Vercel: hasta 300 s en planes compatibles

export default handleRoute(async (req, res) => {
  const client = createServerClient();
  const caseId = requiredUuid(req.query, 'caseId');

  if (req.method === 'GET') {
    await getScopedCaseOr404(client, caseId, req.auth!);
    // Sana comparaciones RUNNING abandonadas antes de devolver el estado; si la
    // función de Vercel murió a mitad, el cliente verá ERROR en vez de un
    // RUNNING eterno (NO_PROCESS_LOCAL_DURABILITY).
    await healStaleComparison(client, caseId);
    const latest = await latestCompletedAudit(client, caseId);
    const current = latest && await auditMatchesCurrentCase(client, caseId, latest) ? latest : null;
    const review = current ? await getCaseReviewForAudit(client, current.id) : null;
    const comparisons = review ? await listComparisonsForReview(client, review.id) : [];

    ok(res, {
      review: review ? caseReviewToDto(review) : null,
      comparison: review?.coordinator_decision != null && review.coordinator_created_at && comparisons[0] &&
        Date.parse(comparisons[0].created_at) >= Date.parse(review.coordinator_created_at)
        ? comparisonToDto(comparisons[0])
        : null,
      workflowState: deriveWorkflowState(review),
      effectiveResolution: deriveEffectiveResolution(review, current),
    });
    return;
  }

  if (req.method === 'POST') {
    // Alcance primero: un Asesor sobre un caso ajeno responde 404, nunca 403
    // (NO_RESOURCE_EXISTENCE_LEAK). Coordinador y gerente leen todo el alcance.
    const row = await getScopedCaseOr404(client, caseId, req.auth!);
    const caps = capabilitiesForRole(req.auth!.role);

    if (!caps.canReviewOwnCases && !caps.canFinalizeAnyCase) {
      // Gerente (o un rol sin capacidad de mutación): lee, pero no revisa ni finaliza.
      throw new ApiError(403, 'AUTH_ERROR', 'No tienes permiso para revisar ni finalizar casos.');
    }

    const latest = await latestCompletedAudit(client, caseId);
    const current = latest && await auditMatchesCurrentCase(client, caseId, latest) ? latest : null;
    const review = current ? await getCaseReviewForAudit(client, current.id) : null;
    const workflowState = deriveWorkflowState(review);

    // Asesor: registra la decisión propia. El alcance ya garantizó que el caso
    // es propio (404 en caso contrario).
    if (caps.canReviewOwnCases) {
      // Ownership explícito, no implícito del alcance: un rol que revisa casos
      // propios (Asesor) solo puede crear la revisión sobre un caso del que es
      // dueño. El alcance ya respondió 404 a un caso ajeno; esta aserción
      // refuerza la frontera sin cambiar el 404 ni el 403 de gerente.
      assertCaseOwner(row, req.auth!);
      // El estado se comprueba ANTES de parsear el body a propósito: un segundo
      // envío es un CONFLICTO con lo ya persistido, no un error de forma. El
      // 409 es estable y no muta nada, vaya el body que vaya.
      if (workflowState !== 'PENDING_ADVISOR') {
        throw new ApiError(
          409,
          'VALIDATION_ERROR',
          'Esta auditoría ya tiene una revisión del Asesor; la decisión de esta versión es única e inmutable.',
        );
      }
      const input = parseHumanReviewInput(await readJsonBody(req));
      const outcome = await submitCaseReview(client, caseId, {
        result: input.result,
        comment: input.comment,
        userId: req.auth!.sub,
        reviewerEmail: req.auth!.email,
      });
      created(res, {
        review: outcome.review,
        comparison: outcome.comparison,
        workflowState: outcome.workflowState,
      });
      return;
    }

    // Coordinador: puede cerrar la segunda etapa de cualquier caso, cambiar la
    // resolución final y agregar un comentario. La decisión del Asesor queda
    // preservada por separado en `case_reviews.result`.
    //
    // PENDING_ADVISOR → 400: no hay nada que finalizar. FINALIZED NO se rechaza
    // aquí a propósito —se deja pasar hasta `finalizeCaseReview`— para que una
    // segunda finalización responda el 409 estable de la fila en vez de un 400
    // que el cliente no distinguiría de "body inválido".
    if (workflowState === 'PENDING_ADVISOR') {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'El caso no tiene revisión de asesor; no hay nada que finalizar.',
      );
    }
    const input = parseCoordinatorReviewInput(await readJsonBody(req));
    if (workflowState === 'FINALIZED') throw new ApiError(409, 'VALIDATION_ERROR', DUPLICATE_FINALIZATION_MESSAGE);
    const country = input.country ?? row.country ?? null;
    const channel = input.channel ?? row.channel ?? null;
    if (!country || !channel) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'El país y el canal son obligatorios para finalizar el dictamen.');
    }
    await updateCaseDimensions(client, caseId, { country, channel });
    const finalized = await finalizeCaseReview(client, {
      caseId,
      auditId: current!.id,
      decision: input.decision,
      resolution: input.resolution ?? null,
      comment: input.comment,
      coordinatorUserId: req.auth!.sub,
    });
    let comparison = null;
    // La finalización queda persistida aunque la comparación no pueda iniciarse
    // por una cuota o una incidencia del proveedor; el endpoint de comparación
    // existente permite iniciarla/reintentarla después.
    try {
      comparison = (await startComparison(client, caseId, { userId: req.auth!.sub })).comparison;
    } catch (error) {
      console.error('[review] no se pudo iniciar la comparación final:', error instanceof ApiError ? error.category : error instanceof Error ? error.name : typeof error);
    }
    ok(res, {
      review: caseReviewToDto(finalized),
      workflowState: deriveWorkflowState(finalized),
      comparison,
    });
    return;
  }

  methodNotAllowed(req, res, 'GET, POST');
});

async function auditMatchesCurrentCase(
  client: ReturnType<typeof createServerClient>,
  caseId: string,
  audit: { evidence_fingerprint: string | null },
): Promise<boolean> {
  const [caseRow, evidences, areaComments] = await Promise.all([
    getCaseOr404(client, caseId),
    listEvidenceRows(client, caseId),
    listAreaComments(client, caseId),
  ]);
  const activeVersion = await getActiveAuditVersion(client);
  return audit.evidence_fingerprint === fingerprintForAuditVersion(
    evidences,
    caseRow.cycle_start_date ?? null,
    areaComments,
    caseRow.flokzu_data,
    activeVersion,
  );
}
