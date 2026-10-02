import {
  ApiError,
  handleRoute,
  methodNotAllowed,
  optionalString,
  requiredUuid,
  sendBinary,
} from '../../../src/server/http.js';
import { createServerClient } from '../../../src/server/insforge.js';
import { getEnv } from '../../../src/server/env.js';
import { getEvidenceByIdOr404, getScopedCaseOr404 } from '../../../src/server/cases.js';

// GET /api/evidence/:evidenceId/download?preview=1 → bytes del archivo
// preview=1 → Content-Disposition inline (para <img>); sin preview → attachment.
// El alcance se resuelve server-side: evidenceId → caso padre → identidad.
export default handleRoute(async (req, res) => {
  if (req.method !== 'GET') {
    methodNotAllowed(req, res);
    return;
  }
  const client = createServerClient();
  const evidenceId = requiredUuid(req.query, 'evidenceId');

  const evidence = await getEvidenceByIdOr404(client, evidenceId);
  await getScopedCaseOr404(client, evidence.case_id, req.auth!);

  const { data, error } = await client.storage
    .from(getEnv().INSFORGE_STORAGE_BUCKET)
    .download(evidence.storage_path);
  if (error || !data) {
    throw new ApiError(500, 'STORAGE_ERROR', 'No se pudo descargar el archivo del almacenamiento');
  }
  const buffer = Buffer.from(await data.arrayBuffer());

  const preview = optionalString(req.query, 'preview') === '1';
  sendBinary(res, buffer, evidence.mime_type, { inline: preview, filename: evidence.filename });
});
