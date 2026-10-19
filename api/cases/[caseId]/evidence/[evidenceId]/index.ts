import { ApiError, handleRoute, ok, methodNotAllowed, requiredUuid } from '../../../../../src/server/http.js';
import { createServerClient } from '../../../../../src/server/insforge.js';
import { assertCaseWriteCapability } from '../../../../../src/server/auth.js';
import { getEnv } from '../../../../../src/server/env.js';
import {
  assertCaseOwner,
  assertCaseNotFinalized,
  deleteEvidenceRow,
  getEvidenceOr404,
  getScopedCaseOr404,
  listEvidenceRows,
  updateCaseStatus,
} from '../../../../../src/server/cases.js';

function isStorageObjectNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const storageError = error as { statusCode?: unknown; error?: unknown };
  return storageError.statusCode === 404 && storageError.error === 'STORAGE_NOT_FOUND';
}

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
  // Capacidad ANTES que propiedad: el gerente no borra evidencia, ni propia.
  assertCaseWriteCapability(req.auth!);
  assertCaseOwner(caseRow, req.auth!);
  await assertCaseNotFinalized(client, caseId);
  const evidence = await getEvidenceOr404(client, caseId, evidenceId);

  // Se intenta borrar el objeto del storage ANTES de borrar la fila. Si ya no
  // existe (404 STORAGE_NOT_FOUND), la eliminación es idempotente y se limpia
  // la fila huérfana. Cualquier otro error conserva la fila para no perder la
  // referencia a un objeto que podría seguir existiendo.
  const removal = await client.storage.from(getEnv().INSFORGE_STORAGE_BUCKET).remove(evidence.storage_path);
  if (removal?.error && !isStorageObjectNotFound(removal.error)) {
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
