import { handleRoute, ok, methodNotAllowed, requiredString } from '../../../../../src/server/http';
import { requireUser } from '../../../../../src/server/auth';
import { getEnv } from '../../../../../src/server/env';
import { deleteEvidenceRow, getEvidenceOr404 } from '../../../../../src/server/cases';

// DELETE /api/cases/:caseId/evidence/:evidenceId → 200 { ok: true }
export default handleRoute(async (req, res) => {
  if (req.method !== 'DELETE') {
    methodNotAllowed(req, res);
    return;
  }
  const { client } = await requireUser(req, res);
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
  ok(res, { ok: true });
});
