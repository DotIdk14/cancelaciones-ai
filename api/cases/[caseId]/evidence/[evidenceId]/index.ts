import { ApiError, handleRoute, ok, methodNotAllowed, requiredUuid } from '../../../../../src/server/http.js';
import { createServerClient } from '../../../../../src/server/insforge.js';
import { getEnv } from '../../../../../src/server/env.js';
import {
  assertCaseOwner,
  deleteEvidenceRow,
  getEvidenceOr404,
  getScopedCaseOr404,
  listEvidenceRows,
  updateCaseStatus,
} from '../../../../../src/server/cases.js';

// DELETE /api/cases/:caseId/evidence/:evidenceId → 200 { ok: true }
export default handleRoute(async (req, res) => {
  if (req.method !== 'DELETE') {
    methodNotAllowed(req, res, 'DELETE');
    return;
  }
  const client = createServerClient();
  const caseId = requiredUuid(req.query, 'caseId');
  const evidenceId = requiredUuid(req.query, 'evidenceId');

  const caseRow = await getScopedCaseOr404(client, caseId, req.auth!);
  assertCaseOwner(caseRow, req.auth!);
  const evidence = await getEvidenceOr404(client, caseId, evidenceId);

  // Se intenta borrar el objeto del storage ANTES de borrar la fila. Si el
  // objeto no se puede remover, se PROPAGA el error y la fila sobrevive: al revés
  // (borrar la fila y avisar después) el objeto queda huérfano sin forma de
  // localizarlo, porque `storage_path` solo vive en la fila.
  const removal = await client.storage.from(getEnv().INSFORGE_STORAGE_BUCKET).remove(evidence.storage_path);
  if (removal?.error) {
    console.error('[evidence] no se pudo remover el objeto; la fila se conserva', {
      evidenceId,
      category: 'STORAGE_ERROR',
      message: 'Error de almacenamiento',
    });
    throw new ApiError(500, 'STORAGE_ERROR', 'No se pudo eliminar el archivo del almacenamiento; inténtalo de nuevo');
  }

  await deleteEvidenceRow(client, evidenceId);
  const remaining = await listEvidenceRows(client, caseId);
  await updateCaseStatus(client, caseId, remaining.some((item) => item.processing_status === 'READY') ? 'READY' : 'DRAFT');
  ok(res, { ok: true });
});
