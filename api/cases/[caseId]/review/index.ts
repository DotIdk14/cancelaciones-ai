import {
  created,
  handleRoute,
  methodNotAllowed,
  ok,
  readJsonBody,
  requiredString,
} from '../../../../src/server/http.js';
import { createServerClient } from '../../../../src/server/insforge.js';
import { getCaseOr404, latestCompletedAudit } from '../../../../src/server/cases.js';
import { getCaseReview, listComparisonsForCase } from '../../../../src/server/reviews.js';
import { parseHumanReviewInput } from '../../../../src/skills/review/schema.js';
import { caseReviewToDto, comparisonToDto, deriveEffectiveResolution } from '../../../../src/server/dto.js';
import { healStaleComparison, submitCaseReview } from '../../../../src/server/comparison-service.js';

// GET  /api/cases/:caseId/review → 200 { review, comparison, effectiveResolution }
// POST /api/cases/:caseId/review → 201 { review, comparison } | 400 | 404 | 409 | 502
// Sin lógica de negocio: valida el body con Zod, delega y traduce errores.
// La comparación es durable: su fila se crea ANTES de llamar al modelo, así que
// si la ejecución muere la fila queda RUNNING; GET /review la sana como ERROR
// y POST /cases/:caseId/comparison la retoma sobre la misma fila.
export const maxDuration = 300; // Vercel: hasta 300 s en planes compatibles

export default handleRoute(async (req, res) => {
  if (req.method === 'GET') {
    const client = createServerClient();
    const caseId = requiredString(req.query, 'caseId');

    await getCaseOr404(client, caseId);
    // Sana comparaciones RUNNING abandonadas antes de devolver el estado; si la
    // función de Vercel murió a mitad, el cliente verá ERROR en vez de un
    // RUNNING eterno (NO_PROCESS_LOCAL_DURABILITY).
    await healStaleComparison(client, caseId);
    const review = await getCaseReview(client, caseId);
    const comparisons = await listComparisonsForCase(client, caseId);
    // La revisión y su comparación se leen juntas para que la UI pueda pintar el
    // estado vigente sin dos peticiones que puedan desincronizarse.
    const latest = await latestCompletedAudit(client, caseId);

    ok(res, {
      review: review ? caseReviewToDto(review) : null,
      comparison: comparisons[0] ? comparisonToDto(comparisons[0]) : null,
      effectiveResolution: deriveEffectiveResolution(review, latest),
    });
    return;
  }

  if (req.method === 'POST') {
    const client = createServerClient();
    const caseId = requiredString(req.query, 'caseId');
    // Validación SIEMPRE en servidor: el comentario es la justificación humana y
    // la resolución tiene que pertenecer al vocabulario cerrado del Skill.
    const input = parseHumanReviewInput(await readJsonBody(req));

    const outcome = await submitCaseReview(client, caseId, { ...input, userId: null });
    created(res, outcome);
    return;
  }

  methodNotAllowed(req, res, 'GET, POST');
});