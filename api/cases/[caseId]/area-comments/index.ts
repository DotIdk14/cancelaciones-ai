import {
  handleRoute,
  methodNotAllowed,
  ok,
  readJsonBody,
  requiredUuid,
} from '../../../../src/server/http.js';
import { createServerClient } from '../../../../src/server/insforge.js';
import { assertCaseOwner, getScopedCaseOr404 } from '../../../../src/server/cases.js';
import {
  listAreaComments,
  parseAreaCommentInput,
  upsertAreaComment,
} from '../../../../src/server/area-comments.js';
import { areaCommentToDto } from '../../../../src/server/dto.js';

// GET  /api/cases/:caseId/area-comments → 200 { comments }
// POST /api/cases/:caseId/area-comments → 200 { comment } | 400 | 404
// Sin lógica de negocio: valida el body con Zod, delega y traduce errores.
//
// Por qué el alcance se resuelve AQUÍ y no en una política de la base: la RLS de
// `case_area_comments` limita por `created_by`, que es quién escribió el
// comentario, no quién escribió el caso. Sin `getScopedCaseOr404` +
// `assertCaseOwner` en el endpoint, un `project_admin` que controlara el
// cliente del servidor podría escribir un comentario en un caso ajeno — el
// 404 y el 403 los decide el servidor, nunca el cliente (NO_RESOURCE_EXISTENCE_LEAK).
export default handleRoute(async (req, res) => {
  const client = createServerClient();
  const caseId = requiredUuid(req.query, 'caseId');

  if (req.method === 'GET') {
    await getScopedCaseOr404(client, caseId, req.auth!);
    const comments = await listAreaComments(client, caseId);
    ok(res, { comments: comments.map(areaCommentToDto) });
    return;
  }

  if (req.method === 'POST') {
    const caseRow = await getScopedCaseOr404(client, caseId, req.auth!);
    assertCaseOwner(caseRow, req.auth!);
    // Validación SIEMPRE en servidor: el comentario es texto libre de una
    // persona y el área es vocabulario cerrado. Nunca se confía en el cliente.
    const input = parseAreaCommentInput(await readJsonBody(req));

    const saved = await upsertAreaComment(client, {
      caseId,
      area: input.area,
      comment: input.comment,
      userId: req.auth!.sub,
    });
    // 200 y no 201: es un UPSERT, el recurso ya existía la primera vez que se
    // guardó. Devolver 201 en el camino de actualización sería mentir.
    ok(res, { comment: areaCommentToDto(saved) });
    return;
  }

  methodNotAllowed(req, res, 'GET, POST');
});