import { handleRoute, ok, methodNotAllowed, requiredString } from '../../../../../src/server/http.js';
import { createServerClient } from '../../../../../src/server/insforge.js';
import { getEnv } from '../../../../../src/server/env.js';
import { deleteEvidenceRow, getEvidenceOr404, listEvidenceRows, updateCaseStatus } from '../../../../../src/server/cases.js';

// DELETE /api/cases/:caseId/evidence/:evidenceId → 200 { ok: true }
export default handleRoute(async (req, res) => {
  if (req.method !== 'DELETE') {
    methodNotAllowed(req, res, 'DELETE');
    return;
  }
  const client = createServerClient();
  const caseId = requiredString(req.query, 'caseId');
  const evidenceId = requiredString(req.query, 'evidenceId');

  const evidence = await getEvidenceOr404(client, caseId, evidenceId);

  // Se intenta borrar el objeto del storage; si falla solo se loguea
  // (un objeto huérfano no rompe el flujo; la fila es la fuente de verdad).
  await client.storage
    .from(getEnv().INSFORGE_STORAGE_BUCKET)
    .remove(evidence.storage_path)
    .then(({ error }) => {
      if (error) console.error('[evidence] no se pudo remover el objeto', { evidenceId, category: 'STORAGE_ERROR', message: 'Error de almacenamiento' });
    });

  await deleteEvidenceRow(client, evidenceId);
  const remaining = await listEvidenceRows(client, caseId);
  await updateCaseStatus(client, caseId, remaining.some((item) => item.processing_status === 'READY') ? 'READY' : 'DRAFT').catch(() => undefined);
  ok(res, { ok: true });
});
