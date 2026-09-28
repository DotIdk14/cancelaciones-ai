import {
  ApiError,
  handleRoute,
  methodNotAllowed,
  optionalString,
  requiredString,
  sendBinary,
} from '../../../src/server/http.js';
import { createServerClient } from '../../../src/server/insforge.js';
import { getEnv } from '../../../src/server/env.js';
import type { InsForgeClient } from '../../../src/server/insforge.js';

// GET /api/evidence/:evidenceId/download?preview=1 → bytes del archivo
// preview=1 → Content-Disposition inline (para <img>); sin preview → attachment.
export default handleRoute(async (req, res) => {
  if (req.method !== 'GET') {
    methodNotAllowed(req, res);
    return;
  }
  const client = createServerClient();
  const evidenceId = requiredString(req.query, 'evidenceId');

  // RLS restringe la fila al dueño del caso: un evidenceId ajeno → 404.
  const evidence = await findEvidenceById(client, evidenceId);

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

interface EvidenceFileRef {
  id: string;
  storage_path: string;
  mime_type: string;
  filename: string;
}

async function findEvidenceById(client: InsForgeClient, evidenceId: string): Promise<EvidenceFileRef> {
  const { data, error } = await client.database
    .from('evidence')
    .select('id,storage_path,mime_type,filename')
    .eq('id', evidenceId)
    .single();
  if (error || !data) {
    throw new ApiError(404, 'NOT_FOUND', 'Evidencia no encontrada');
  }
  return data as EvidenceFileRef;
}