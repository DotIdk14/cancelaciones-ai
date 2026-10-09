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
import { assertCaseOwner, getScopedCaseOr404, latestCompletedAudit } from '../../../../src/server/cases.js';
import { finalizeCaseReview, getCaseReview, listComparisonsForCase } from '../../../../src/server/reviews.js';
import { parseCoordinatorReviewInput, parseHumanReviewInput } from '../../../../src/skills/review/schema.js';
import {
  caseReviewToDto,
  comparisonToDto,
  deriveEffectiveResolution,
  deriveWorkflowState,
} from '../../../../src/server/dto.js';
import { healStaleComparison, submitCaseReview } from '../../../../src/server/comparison-service.js';

// GET  /api/cases/:caseId/review → 200 { review, comparison, workflowState, effectiveResolution }
// POST /api/cases/:caseId/review → 201 (asesor) | 200 (coordinador) | 400 | 403 | 404 | 409 | 502
//
// Flujo de DOS etapas. La etapa la RESUELVE el servidor a partir de las
// capacidades del rol (`capabilitiesForRole`) y del estado persistido
// (`deriveWorkflowState`); el cliente nunca la declara:
//   - Asesor (`canReviewOwnCases`, caso propio): registra `{ result, comment? }`
//     y crea la fila de `case_reviews` (solo en PENDING_ADVISOR; después, 409).
//   - Coordinador (`canFinalizeAnyCase`): finaliza `{ decision, resolution?, comment? }`
//     (solo en PENDING_COORDINATOR; después, 409).
//   - Gerente: sin capacidad de mutación → 403 (ya puede leer el caso, no filtra nada).
//
// El actor y la hora los deriva SIEMPRE el servidor de `req.auth`; un
// `reviewerName`/actor/rol del cliente se rechaza en el schema (strict) o se
// ignora. La comparación se dispara en la etapa de ASESOR y queda durable; un
// `CHANGE` posterior del coordinador no la vuelve a disparar.
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
    const review = await getCaseReview(client, caseId);
    const comparisons = await listComparisonsForCase(client, caseId);
    const latest = await latestCompletedAudit(client, caseId);

    ok(res, {
      review: review ? caseReviewToDto(review) : null,
      comparison: comparisons[0] ? comparisonToDto(comparisons[0]) : null,
      workflowState: deriveWorkflowState(review),
      effectiveResolution: deriveEffectiveResolution(review, latest),
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

    const review = await getCaseReview(client, caseId);
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
          'El caso ya tiene una revisión de asesor; la decisión del asesor es única e inmutable.',
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

    // Coordinador: finaliza cualquier caso.
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
    const finalized = await finalizeCaseReview(client, {
      caseId,
      decision: input.decision,
      resolution: input.resolution ?? null,
      comment: input.comment,
      coordinatorUserId: req.auth!.sub,
    });
    ok(res, {
      review: caseReviewToDto(finalized),
      workflowState: deriveWorkflowState(finalized),
    });
    return;
  }

  methodNotAllowed(req, res, 'GET, POST');
});
