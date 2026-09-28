import { randomUUID } from 'node:crypto';
import {
  ApiError,
  created,
  formatBytes,
  handleRoute,
  methodNotAllowed,
  readRawBody,
  requiredString,
} from '../../../../src/server/http.js';
import { requireUser } from '../../../../src/server/auth.js';
import { getEnv } from '../../../../src/server/env.js';
import { getCaseOr404, insertEvidence, updateCaseStatus, updateEvidenceStatus } from '../../../../src/server/cases.js';
import { evidenceToDto } from '../../../../src/server/dto.js';
import { isAudio, normalizeMime, sanitizeFilename, sha256Hex } from '../../../../src/server/evidence-prep.js';
import { submitTranscription } from '../../../../src/server/assemblyai.js';

// POST /api/cases/:caseId/evidence
// Body binario crudo; headers: content-type = MIME, x-file-name = nombre URL-encoded.
// → 201 { evidence } | 400/404/413/500 { error }
export default handleRoute(async (req, res) => {
  if (req.method !== 'POST') {
    methodNotAllowed(req, res);
    return;
  }
  const { client } = await requireUser(req, res);
  const caseId = requiredString(req.query, 'caseId');
  await getCaseOr404(client, caseId);

  const headerValue = (value: string | string[] | undefined): string =>
    typeof value === 'string' ? value : Array.isArray(value) ? (value[0] ?? '') : '';

  const rawName = headerValue(req.headers['x-file-name']);
  let filename = sanitizeFilename(rawName ? decodeURIComponent(rawName) : '');
  const mimeType = normalizeMime(headerValue(req.headers['content-type']));
  const buffer = await readRawBody(req);

  if (!mimeType) {
    throw new ApiError(400, 'UPLOAD_ERROR', 'Tipo de archivo no permitido (imágenes PNG/JPEG/WEBP/GIF, PDF, audio, texto)');
  }
  if (filename === 'evidencia' && rawName) {
    filename = sanitizeFilename(rawName); // nombre saneado preservado
  }
  if (buffer.length === 0) {
    throw new ApiError(400, 'UPLOAD_ERROR', 'El archivo está vacío');
  }
  const maxBytes = getEnv().MAX_EVIDENCE_BYTES;
  if (buffer.length > maxBytes) {
    throw new ApiError(
      413,
      'UPLOAD_ERROR',
      `El archivo excede el límite de ${formatBytes(maxBytes)} por evidencia (plataforma de hosting)`,
    );
  }

  const hash = sha256Hex(buffer);
  const storagePath = `${caseId}/${randomUUID()}`;

  const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
  const { data: stored, error: storageError } = await client.storage
    .from(getEnv().INSFORGE_STORAGE_BUCKET)
    .upload(storagePath, blob);
  if (storageError || !stored) {
    throw new ApiError(500, 'STORAGE_ERROR', 'No se pudo guardar la evidencia en el almacenamiento');
  }

  // El estado inicial depende de si hay un paso ASÍNCRONO de preparación:
  //  - AUDIO: la transcripción de AssemblyAI no está lista al subir, así que
  //    nace UPLOADED y el bloque de abajo la lanza (UPLOADED -> TRANSCRIBING).
  //  - NO-audio (PDF/imagen/TXT): no hay nada que esperar. El contenido ya está
  //    disponible para el modelo (la transformación de formato se hace en
  //    buildAuditInputs, al auditar), así que nace READY. Dejarlo en UPLOADED
  //    lo dejaba en un estado "en proceso" del que nadie lo saca: el único
  //    refresco de estados es el de transcripciones de audio, y terminaba en
  //    202 pendingEvidence para siempre.
  let evidence = await insertEvidence(client, {
    case_id: caseId,
    filename,
    mime_type: mimeType,
    size_bytes: buffer.length,
    hash,
    storage_path: stored.key,
    processing_status: isAudio(mimeType) ? 'UPLOADED' : 'READY',
  });

  // Audio: lanzar transcripción inmediatamente (AssemblyAI).
  if (isAudio(mimeType)) {
    try {
      const assemblyId = await submitTranscription(buffer);
      evidence = await updateEvidenceStatus(client, evidence.id, {
        processing_status: 'TRANSCRIBING',
        transcript_json: { assemblyId, status: 'TRANSCRIBING' },
      });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'No se pudo iniciar la transcripción';
      evidence = await updateEvidenceStatus(client, evidence.id, {
        processing_status: 'ERROR',
        transcript_json: { status: 'ERROR', error: message },
      });
      // No se lanza: la evidencia queda registrada en ERROR y la UI lo muestra.
    }
  }

  await updateCaseStatus(client, caseId, evidence.processing_status === 'READY' ? 'READY' : 'DRAFT').catch(() => undefined);

  created(res, { evidence: evidenceToDto(evidence) });
});
