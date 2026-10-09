import { randomUUID } from 'node:crypto';
import {
  ApiError,
  created,
  formatBytes,
  handleRoute,
  methodNotAllowed,
  readRawBody,
  requiredUuid,
} from '../../../../src/server/http.js';
import { createServerClient } from '../../../../src/server/insforge.js';
import { assertCaseWriteCapability } from '../../../../src/server/auth.js';
import { getEnv } from '../../../../src/server/env.js';
import {
  assertCaseOwner,
  getScopedCaseOr404,
  insertEvidence,
  updateCaseStatus,
  updateEvidenceStatus,
} from '../../../../src/server/cases.js';
import { evidenceToDto } from '../../../../src/server/dto.js';
import {
  isAudio,
  normalizeMime,
  sanitizeFilename,
  sha256Hex,
  verifyFileSignature,
} from '../../../../src/server/evidence-prep.js';
import { submitTranscription } from '../../../../src/server/assemblyai.js';
import { checkPaidQuota } from '../../../../src/server/quotas.js';

// POST /api/cases/:caseId/evidence
// Body binario crudo; headers: content-type = MIME, x-file-name = nombre URL-encoded.
// → 201 { evidence } | 400/404/413/500 { error }
export default handleRoute(async (req, res) => {
  if (req.method !== 'POST') {
    methodNotAllowed(req, res);
    return;
  }
  const client = createServerClient();
  const caseId = requiredUuid(req.query, 'caseId');
  const caseRow = await getScopedCaseOr404(client, caseId, req.auth!);
  // Capacidad ANTES que propiedad: el gerente no sube evidencia, ni propia.
  assertCaseWriteCapability(req.auth!);
  assertCaseOwner(caseRow, req.auth!);

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

  // El `Content-Type` lo declara el cliente: no prueba nada. Se compara la
  // FIRMA real del buffer con el tipo declarado y se rechaza con 415 si no
  // coinciden (un .exe renombrado a .png, un HTML con image/png, etc.).
  const signature = verifyFileSignature(buffer, mimeType);
  if (!signature.ok) {
    throw new ApiError(415, 'UPLOAD_ERROR', signature.reason ?? 'El archivo no coincide con su tipo declarado');
  }

  // Audio: la transcripción es una operación PAGADA, así que la cuota se cobra
  // ANTES de subir el archivo y de insertar la fila: un 429 no deja ni bytes en
  // el almacenamiento ni evidencia a medias.
  if (isAudio(mimeType)) {
    await checkPaidQuota(req.auth!.sub, `transcription:${caseId}:${sha256Hex(buffer)}`);
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

  // Audio: lanzar transcripción inmediatamente (AssemblyAI). El fallo se persiste
  // como estado terminal recuperable: la evidencia nunca queda UPLOADED para
  // siempre con dinero ya pagado.
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

  // El estado del caso se actualiza con el estado REAL de la evidencia recién
  // creada. Si esa escritura falla se propaga el error: tragarlo dejaba el caso
  // en DRAFT/READY sin reflejar lo que acaba de pasar (y ocultaba el fallo).
  await updateCaseStatus(client, caseId, evidence.processing_status === 'READY' ? 'READY' : 'DRAFT');

  created(res, { evidence: evidenceToDto(evidence) });
});
