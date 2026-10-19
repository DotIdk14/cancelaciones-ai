import { resolveEvidenceMime } from '../../../../src/shared/evidence-formats.js';
import { randomUUID } from 'node:crypto';
import {
  ApiError,
  created,
  formatBytes,
  handleRoute,
  methodNotAllowed,
  readRawBody,
  requiredUuid,
  idempotencyKey,
} from '../../../../src/server/http.js';
import { createServerClient } from '../../../../src/server/insforge.js';
import { assertCaseWriteCapability } from '../../../../src/server/auth.js';
import { getEnv } from '../../../../src/server/env.js';
import {
  assertCaseOwner,
  assertCaseNotFinalized,
  getScopedCaseOr404,
  insertEvidence,
  updateCaseStatus,
  claimEvidencePreparationRetry,
  evidenceByRequestId,
} from '../../../../src/server/cases.js';
import { evidenceToDto } from '../../../../src/server/dto.js';
import {
  isAudio,
  normalizeMime,
  sanitizeFilename,
  sha256Hex,
  verifyFileSignature,
} from '../../../../src/server/evidence-prep.js';
import { prepareAudio } from '../../../../src/server/audio-preparation.js';
import { checkPaidQuota } from '../../../../src/server/quotas.js';
import { assertEvidenceMayBeAdded } from '../../../../src/server/review-locks.js';

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
  const requestId = idempotencyKey(req);
  const caseRow = await getScopedCaseOr404(client, caseId, req.auth!);
  // Capacidad ANTES que propiedad: el gerente no sube evidencia, ni propia.
  assertCaseWriteCapability(req.auth!);
  assertCaseOwner(caseRow, req.auth!);
  await assertCaseNotFinalized(client, caseId);
  await assertEvidenceMayBeAdded(client, caseId);

  const headerValue = (value: string | string[] | undefined): string =>
    typeof value === 'string' ? value : Array.isArray(value) ? (value[0] ?? '') : '';

  const rawName = headerValue(req.headers['x-file-name']);
  let decodedName = '';
  try { decodedName = rawName ? decodeURIComponent(rawName) : ''; }
  catch { throw new ApiError(400, 'UPLOAD_ERROR', 'El nombre del archivo no tiene una codificación válida'); }
  let filename = sanitizeFilename(decodedName);
  const buffer = await readRawBody(req);
  const mimeType = normalizeMime(resolveEvidenceMime(new Uint8Array(buffer.subarray(0, 16)), headerValue(req.headers['content-type']), filename) ?? '');

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
  // FIRMA real con el MIME efectivo: PNG/JPEG legítimos se corrigen sin tocar
  // el original; ejecutables y archivos dañados siguen rechazándose antes de guardar.
  const signature = verifyFileSignature(buffer, mimeType);
  if (!signature.ok) {
    const detail = signature.reason ?? 'El archivo no coincide con su tipo declarado';
    throw new ApiError(
      415,
      'UPLOAD_ERROR',
      `${detail}. Verifica que la extensión del archivo coincida con su contenido real y que el archivo no esté dañado.`,
    );
  }

  const hash = sha256Hex(buffer);
  const recover = async () => {
    if (!requestId) return null;
    const previous = await evidenceByRequestId(client, requestId);
    if (!previous) return null;
    if (previous.case_id !== caseId) throw new ApiError(404, 'NOT_FOUND', 'Evidencia no encontrada');
    if (previous.hash !== hash || previous.filename !== filename || previous.mime_type !== mimeType) {
      throw new ApiError(409, 'UPLOAD_ERROR', 'Esta solicitud ya guardó una evidencia distinta. No se sobrescribió el original.');
    }
    return previous;
  };
  const previous = await recover();
  if (previous) {
    if (previous.processing_status === 'ERROR' && isAudio(previous.mime_type)) {
      await checkPaidQuota(req.auth!.sub, `transcription:${caseId}:${hash}`);
      const claimed = await claimEvidencePreparationRetry(client, previous.id);
      const recovered = claimed ? await prepareAudio(client, claimed, buffer, req.correlationId) : await recover();
      if (recovered) await updateCaseStatus(client, caseId, recovered.processing_status === 'READY' ? 'READY' : 'DRAFT');
      created(res, { evidence: evidenceToDto(recovered ?? previous) });
      return;
    }
    created(res, { evidence: evidenceToDto(previous) });
    return;
  }

  // Audio: la transcripción es una operación PAGADA, así que la cuota se cobra
  // ANTES de subir el archivo y de insertar la fila: un 429 no deja ni bytes en
  // el almacenamiento ni evidencia a medias.
  if (isAudio(mimeType)) {
    await checkPaidQuota(req.auth!.sub, `transcription:${caseId}:${sha256Hex(buffer)}`);
  }

  const storagePath = `${caseId}/${requestId ?? randomUUID()}`;

  const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
  const { data: stored, error: storageError } = await client.storage
    .from(getEnv().INSFORGE_STORAGE_BUCKET)
    .upload(storagePath, blob);
  if (storageError || !stored) {
    const concurrent = await recover();
    if (concurrent) {
      created(res, { evidence: evidenceToDto(concurrent) });
      return;
    }
    // Una interrupción pudo guardar el original y no insertar la fila. Solo se
    // recupera el objeto de ESTA solicitud si su hash coincide exactamente.
    const recovered = requestId ? await client.storage.from(getEnv().INSFORGE_STORAGE_BUCKET).download(storagePath) : null;
    if (!recovered?.data || recovered.error || sha256Hex(Buffer.from(await recovered.data.arrayBuffer())) !== hash) {
      throw new ApiError(500, 'STORAGE_ERROR', 'No se pudo guardar la evidencia en el almacenamiento');
    }
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
  let evidence;
  try {
    evidence = await insertEvidence(client, {
    ...(requestId ? { id: requestId } : {}),
    case_id: caseId,
    filename,
    mime_type: mimeType,
    size_bytes: buffer.length,
    hash,
    storage_path: stored?.key ?? storagePath,
    processing_status: isAudio(mimeType) ? 'UPLOADED' : 'READY',
    ...(isAudio(mimeType) ? { transcript_json: { status: 'SUBMITTING', submissionDeadlineAt: new Date(Date.now() + 120_000).toISOString() } } : {}),
    });
  } catch (cause) {
    const concurrent = await recover();
    if (concurrent) {
      created(res, { evidence: evidenceToDto(concurrent) });
      return;
    }
    // Las solicitudes con identidad conservan su objeto recuperable. Para las
    // antiguas, compensamos una inserción fallida retirando el objeto huérfano.
    if (!requestId) {
      try {
        const removal = await client.storage.from(getEnv().INSFORGE_STORAGE_BUCKET).remove(storagePath);
        if (removal.error) console.warn('[upload] no se pudo compensar el objeto sin fila');
      } catch { console.warn('[upload] no se pudo compensar el objeto sin fila'); }
    }
    throw cause;
  }

  // Audio: lanzar transcripción inmediatamente (AssemblyAI). El fallo se persiste
  // como estado terminal recuperable: la evidencia nunca queda UPLOADED para
  // siempre con dinero ya pagado.
  if (isAudio(mimeType)) evidence = await prepareAudio(client, evidence, buffer, req.correlationId);

  // El estado del caso se actualiza con el estado REAL de la evidencia recién
  // creada. Si esa escritura falla se propaga el error: tragarlo dejaba el caso
  // en DRAFT/READY sin reflejar lo que acaba de pasar (y ocultaba el fallo).
  await updateCaseStatus(client, caseId, evidence.processing_status === 'READY' ? 'READY' : 'DRAFT');

  created(res, { evidence: evidenceToDto(evidence) });
});
