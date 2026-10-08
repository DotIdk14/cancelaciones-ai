// =============================================================================
// Servicio de auditoría — orquesta el flujo durable (secciones 13 y 14).
// =============================================================================
// La fila `audits` (status RUNNING) se inserta ANTES de llamar al modelo:
// si la función de Vercel muere a mitad de ejecución, el estado queda durable
// y GET /audit lo recupera (a) sigue RUNNING mientras el cliente pollea, o
// (b) se marca ERROR si es antiguo (self-healing). Sin colas de jobs.
// =============================================================================

import type { InsForgeClient } from './insforge.js';
import { createHash } from 'node:crypto';
import { getEnv } from './env.js';
import { auditSkill, PDF_MIN_TEXT_CHARS } from '../skills/audit/execute.js';
import { OpenRouterAuditError } from './openrouter.js';
import type { AuditSkillInput, ErrorCategory, EvidenceInputItem, AreaCommentContext, AreaCommentScope } from '../skills/audit/types.js';
import { AREA_COMMENT_SCOPES } from '../skills/audit/types.js';
import { wrapUntrusted } from '../skills/sanitize.js';
import { getTranscription } from './assemblyai.js';
import { extractPdfText } from './pdf.js';
import {
  detectKind,
  imageDataUrl,
  isAudio,
  readTranscriptFromJson,
  sleep,
} from './evidence-prep.js';
import { ApiError } from './http.js';
import { checkPaidQuota } from './quotas.js';
import { derivedExtractionOf } from './derived.js';
import { listAreaComments } from './area-comments.js';
import { buildAuditFailureLog } from './audit-observability.js';
import {
  getCaseOr404,
  insertAudit,
  countAuditsByFingerprint,
  persistDerivedExtraction,
  latestCompletedAuditByFingerprint,
  latestRunningAuditByFingerprint,
  latestAudit,
  listEvidenceRows,
  updateAuditResult,
  updateCaseDimensions,
  updateCaseStatus,
  updateEvidenceStatus,
  type CaseRow,
  type EvidenceRow,
} from './cases.js';
import { auditToDto, type AuditDetailDto } from './dto.js';

const POLL_INTERVAL_MS = 2_000;

export type RunAuditOutcome =
  | { phase: 'pending'; pendingEvidence: string[] }
  | { phase: 'running'; audit: AuditDetailDto }
  | { phase: 'done'; audit: AuditDetailDto };

/** Marca ERROR las auditorías RUNNING abandonadas (función interrumpida). */
async function healStaleAudit(client: InsForgeClient, caseId: string): Promise<void> {
  const audit = await latestAudit(client, caseId);
  if (!audit || audit.status !== 'RUNNING') return;
  const deadlineAt = audit.deadline_at ? new Date(audit.deadline_at).getTime() : new Date(audit.created_at).getTime() + getEnv().AUDIT_STALE_AFTER_MS;
  const ageMs = Date.now() - new Date(audit.created_at).getTime();
  if (Date.now() > deadlineAt) {
    await updateAuditResult(client, audit.id, {
      status: 'ERROR',
      result_json: null,
      error_category: 'AI_PROVIDER_ERROR',
      latency_ms: ageMs,
      provider_metadata: { stale: true, deadlineAt: new Date(deadlineAt).toISOString() },
    });
    await updateCaseStatus(client, caseId, 'ERROR').catch(() => undefined);
  }
}

/**
 * Refresca transcripciones pendientes (bounded).
 * - Evidencia AUDIO sin assemblyId: marca ERROR (no se inició la transcripción).
 * - Evidencia con assemblyId: consulta AssemblyAI hasta READY/ERROR o timeout.
 */
export async function refreshTranscriptions(
  client: InsForgeClient,
  caseId: string,
  maxMs: number,
): Promise<void> {
  const deadline = Date.now() + maxMs;
  const evidences = await listEvidenceRows(client, caseId);
  const audioPending = evidences.filter(
    (evidence) =>
      isAudio(evidence.mime_type) &&
      (evidence.processing_status === 'UPLOADED' || evidence.processing_status === 'TRANSCRIBING'),
  );
  if (audioPending.length === 0) return;

  for (const evidence of audioPending) {
    const assemblyId = readAssemblyId(evidence);
    if (!assemblyId) {
      await updateEvidenceStatus(client, evidence.id, {
        processing_status: 'ERROR',
        transcript_json: { status: 'ERROR', error: 'Transcripción no iniciada' },
      }).catch(() => undefined);
      continue;
    }
    // El presupuesto acota cuánto se ESPERA, no si se OBSERVA: el estado se
    // lee al menos una vez aunque la ventana ya haya vencido. Con el chequeo
    // antes de la lectura, un presupuesto vencido (0 ms, o 1 ms bajo carga)
    // hacía cero consultas, una transcripción en ERROR nunca se propagaba y el
    // caso quedaba en 202 para siempre, sin ruta de recuperación por UI ni API.
    for (;;) {
      const status = await getTranscription(assemblyId);
      if (status.state === 'READY') {
        await updateEvidenceStatus(client, evidence.id, {
          processing_status: 'READY',
          transcript_json: { assemblyId, status: 'READY', transcript: status.transcript },
        }).catch(() => undefined);
        break;
      }
      if (status.state === 'ERROR') {
        await updateEvidenceStatus(client, evidence.id, {
          processing_status: 'ERROR',
          transcript_json: { assemblyId, status: 'ERROR', error: status.error ?? 'Error de transcripción' },
        }).catch(() => undefined);
        break;
      }
      if (Date.now() >= deadline) break;
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

function readAssemblyId(evidence: EvidenceRow): string | null {
  if (!evidence.transcript_json || typeof evidence.transcript_json !== 'object') return null;
  const value = (evidence.transcript_json as Record<string, unknown>).assemblyId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

async function downloadEvidenceBuffer(client: InsForgeClient, evidence: EvidenceRow): Promise<Buffer> {
  const { data, error } = await client.storage.from(getEnv().INSFORGE_STORAGE_BUCKET).download(evidence.storage_path);
  if (error || !data) {
    throw new ApiError(500, 'STORAGE_ERROR', `No se pudo descargar la evidencia "${evidence.filename}" del almacenamiento`);
  }
  const buffer = Buffer.from(await data.arrayBuffer());
  if (buffer.length === 0) {
    throw new ApiError(500, 'STORAGE_ERROR', `La evidencia "${evidence.filename}" está vacía en almacenamiento`);
  }
  return buffer;
}

export async function buildAuditInputs(
  client: InsForgeClient,
  caseRow: CaseRow,
  evidences: EvidenceRow[],
): Promise<AuditSkillInput> {
  enforceEvidenceSetLimits(evidences);
  const items: EvidenceInputItem[] = [];
  let aggregateTextChars = 0;
  let aggregateMultimodalBytes = 0;
  for (const evidence of evidences) {
    const kind = detectKind(evidence.mime_type);
    const base: EvidenceInputItem = {
      evidenceId: evidence.id,
      filename: evidence.filename,
      mimeType: evidence.mime_type,
      kind,
      sizeBytes: evidence.size_bytes,
      sha256: evidence.hash,
      createdAt: evidence.created_at,
    };

    if (kind === 'IMAGE') {
      const buffer = await downloadEvidenceBuffer(client, evidence);
      aggregateMultimodalBytes += buffer.length;
      enforceMultimodalLimit(aggregateMultimodalBytes);
      items.push({ ...base, imageBase64: imageDataUrl(buffer, evidence.mime_type) });
    } else if (kind === 'PDF') {
      // Camino TEXTUAL sin descarga: si el derivado ya está cacheado con esta
      // versión de pipeline, no se vuelve a bajar el binario ni a parsear el PDF
      // (DO_NOT_REPROCESS_AI_UNNECESSARILY).
      const cachedText = derivedExtractionOf(evidence, EXTRACTION_PIPELINE_VERSION);
      if (cachedText !== null && cachedText.trim().length >= PDF_MIN_TEXT_CHARS) {
        const limited = limitEvidenceText(cachedText);
        aggregateTextChars += limited.text.length;
        items.push({ ...base, text: limited.text, truncated: limited.truncated, originalChars: limited.originalChars });
        enforceAggregateTextLimit(aggregateTextChars);
        continue;
      }
      const buffer = await downloadEvidenceBuffer(client, evidence);
      const text = cachedText ?? (await extractPdfText(buffer));
      if (cachedText === null) {
        await persistDerivedExtraction(client, evidence.id, text, EXTRACTION_PIPELINE_VERSION);
      }
      if (text.trim().length >= PDF_MIN_TEXT_CHARS) {
        const limited = limitEvidenceText(text);
        aggregateTextChars += limited.text.length;
        items.push({ ...base, text: limited.text, truncated: limited.truncated, originalChars: limited.originalChars });
      } else {
        // Escaneado: texto pobre → archivo nativo al modelo multimodal.
        aggregateTextChars += Math.min(text.length, 600);
        aggregateMultimodalBytes += buffer.length;
        enforceMultimodalLimit(aggregateMultimodalBytes);
        items.push({ ...base, text: text.slice(0, 600), pdfBase64: buffer.toString('base64') });
      }
    } else if (kind === 'AUDIO') {
      const transcript = readTranscriptFromJson(evidence.transcript_json);
      if (transcript && transcript.transcript.length > getEnv().MAX_AUDIT_TEXT_CHARS_PER_EVIDENCE) {
        const limited = limitEvidenceText(transcript.transcript);
        aggregateTextChars += limited.text.length;
        items.push({ ...base, transcript: { ...transcript, transcript: limited.text }, truncated: true, originalChars: transcript.transcript.length });
      } else {
        aggregateTextChars += transcript?.transcript.length ?? 0;
        items.push({ ...base, transcript });
      }
    } else {
      // TEXTO: la lectura del binario también es un derivado cacheable.
      let text = derivedExtractionOf(evidence, EXTRACTION_PIPELINE_VERSION);
      if (text === null) {
        const buffer = await downloadEvidenceBuffer(client, evidence);
        text = buffer.toString('utf-8');
        await persistDerivedExtraction(client, evidence.id, text, EXTRACTION_PIPELINE_VERSION);
      }
      const limited = limitEvidenceText(text);
      aggregateTextChars += limited.text.length;
      items.push({ ...base, text: limited.text, truncated: limited.truncated, originalChars: limited.originalChars });
    }
    enforceAggregateTextLimit(aggregateTextChars);
  }
  enforceAggregateTextLimit(aggregateTextChars);
  enforceMultimodalLimit(aggregateMultimodalBytes);

  // Contexto de áreas: SOLO Back Office y HelpDesk entran al expediente, y ya
  // cercados con wrapUntrusted (contenido no confiable escrito por personas).
  // Las otras tres áreas siguen siendo bitácora pura (AREA_COMMENTS_ARE_HUMAN_NOT_POLICY).
  //
  // La lectura es BEST-EFFORT a propósito (fail-open): el contexto de áreas es
  // opcional y aditivo, no es el dictamen ni bloquea su validez. Un fallo de
  // lectura (tabla, RLS, red) deja el snapshot en [] y la auditoría sigue: es
  // el mismo criterio que PROJECTION_IS_NOT_THE_DICTAMEN aplica a la proyección
  // de país/canal. El warn es la única huella del fallo en logs (el texto del
  // comentario jamás se loguea).
  const scopes = new Set<string>(AREA_COMMENT_SCOPES);
  let areaComments: AreaCommentContext[] = [];
  try {
    areaComments = (await listAreaComments(client, caseRow.id))
      .filter((row) => scopes.has(row.area))
      .map((row) => ({
        area: row.area as AreaCommentScope,
        comment: wrapUntrusted(`COMENTARIO DE ÁREA — ${row.area}`, row.comment),
      }));
  } catch (cause) {
    console.warn('[audit] no se pudo leer el contexto de áreas; se audita sin él', {
      caseId: caseRow.id,
      error: cause instanceof Error ? cause.message : 'error desconocido',
    });
  }

  // Los comentarios cuentan hacia el MISMO presupuesto de texto que las
  // evidencias (el límite protege la ventana de contexto del modelo). Pero su
  // exceso no puede tumbar el dictamen (best-effort, igual que la lectura): si
  // no caben, se omiten con warn y se audita sin contexto. El tope total queda
  // garantizado: evidencias solas ya pasaron enforceAggregateTextLimit (que
  // lanza si se excede), y aquí se descartan los comentarios si el total se
  // pasaría.
  const areaChars = areaComments.reduce((total, entry) => total + entry.comment.length, 0);
  if (aggregateTextChars + areaChars > getEnv().MAX_AUDIT_TEXT_CHARS) {
    console.warn('[audit] el contexto de áreas excede el presupuesto de texto; se audita sin él', {
      caseId: caseRow.id,
      areaChars,
      aggregateTextChars,
    });
    areaComments = [];
  }

  return {
    caseId: caseRow.id,
    studentIdentifier: caseRow.student_identifier,
    evidences: items,
    areaComments,
    // Fecha de inicio aportada por el equipo. Se lee como OPCIONAL a propósito
    // (`?? null`): si la migración `case-cycle-start-date-human` todavía no está
    // aplicada, el `select('*')` no trae la columna, `cycle_start_date` es
    // `undefined` y el expediente se arma sin ella en vez de romperse. Cuando sí
    // existe es un ISO ya validado por el endpoint: por eso viaja sin cercar.
    humanCycleStartDate: caseRow.cycle_start_date ?? null,
  };
}

function enforceEvidenceSetLimits(evidences: EvidenceRow[]): void {
  const env = getEnv();
  if (evidences.length > env.MAX_EVIDENCE_COUNT) {
    throw new ApiError(413, 'VALIDATION_ERROR', `El expediente excede ${env.MAX_EVIDENCE_COUNT} evidencias; elimina archivos no relevantes`);
  }
  const imageBytes = evidences
    .filter((evidence) => detectKind(evidence.mime_type) === 'IMAGE')
    .reduce((sum, evidence) => sum + evidence.size_bytes, 0);
  enforceMultimodalLimit(imageBytes);
}

function enforceAggregateTextLimit(chars: number): void {
  const max = getEnv().MAX_AUDIT_TEXT_CHARS;
  if (chars > max) {
    throw new ApiError(413, 'VALIDATION_ERROR', `El texto agregado del expediente excede ${max} caracteres; reduce o divide evidencias`);
  }
}

function enforceMultimodalLimit(bytes: number): void {
  const max = getEnv().MAX_AUDIT_MULTIMODAL_BYTES;
  if (bytes > max) {
    throw new ApiError(413, 'VALIDATION_ERROR', `El contenido multimodal excede ${max} bytes; reduce evidencias visuales/PDF`);
  }
}

function limitEvidenceText(text: string): { text: string; truncated: boolean; originalChars: number } {
  const max = getEnv().MAX_AUDIT_TEXT_CHARS_PER_EVIDENCE;
  return { text: text.slice(0, max), truncated: text.length > max, originalChars: text.length };
}

/**
 * Versión del pipeline que produce el expediente (preparación + prompt + schema).
 * Si cambia cómo se prepara o cómo se dictamina, el fingerprint cambia y los
 * dictámenes anteriores NO se reutilizan: es deliberado (DO_NOT_REPROCESS_AI_UNNECESSARILY
 * aplica a la MISMA evidencia con el MISMO pipeline, no a un pipeline distinto).
 *
 * El bump 2 corresponde a la incorporación del bloque `origin` (país y canal) al
 * contrato del assessment: un dictamen del contrato anterior no trae esos campos
 * y reutilizarlo dejaría el caso sin dimensiones de origen indefinidamente.
 */
export const AUDIT_PIPELINE_VERSION = 'audit-v5-pipeline-2';

/**
 * Versión del pipeline de EXTRACCIÓN (pdf.js / lectura de texto). Si cambia la
 * lógica de extracción, el caché de derivados se invalida por completo porque
 * la versión guardada deja de coincidir.
 */
const EXTRACTION_PIPELINE_VERSION = 'extract-v1';

/**
 * Huella canónica del expediente: QUÉ se audita, nunca CÓMO está el caso.
 *
 * Deliberadamente EXCLUIDOS:
 * - `processing_status`: un refresco de estado (UPLOADED → TRANSCRIBING → READY)
 *   invalidaba un COMPLETED y obligaba a volver a pagar la misma auditoría.
 * - `assemblyId`/estados de la transcripción: se hashea el TEXTO derivado, que es
 *   lo que entra al expediente. Re-transcribir el mismo audio con el mismo
 *   resultado no es un expediente distinto.
 *
 * Incluidos: id y hash de cada original, hash del texto derivado y la versión del
 * pipeline. Si cambia un byte de una evidencia, cambia la huella.
 */
export function computeEvidenceFingerprint(evidences: EvidenceRow[]): string {
  return computeEvidenceFingerprintFor(AUDIT_PIPELINE_VERSION, evidences);
}

/**
 * Huella con una versión de pipeline explícita.
 *
 * Existe para poder fijar con un test que la versión forma parte de la huella: si
 * alguien la quitara del cálculo, dos pipelines distintos darían la misma huella y
 * un dictamen viejo se reutilizaría contra el contrato nuevo (el fallo exacto que
 * el bump existe para evitar). En producción siempre se usa la versión vigente.
 */
export function computeEvidenceFingerprintFor(version: string, evidences: EvidenceRow[]): string {
  const canonical = evidences
    .map((evidence) => {
      const derived = evidence.transcript_json ? readTranscriptFromJson(evidence.transcript_json) : null;
      const derivedText = derived?.transcript ?? '';
      return {
        id: evidence.id,
        hash: evidence.hash,
        derivedHash: derivedText ? createHash('sha256').update(derivedText).digest('hex') : null,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  return createHash('sha256')
    .update(JSON.stringify({ pipeline: version, evidence: canonical }))
    .digest('hex');
}

/**
 * Ejecuta o reutiliza la auditoría del caso.
 * - No hay evidencias → 400.
 * - Evidencias en TRANSCRIBING → 202 (pending).
 * - Evidencias en ERROR → 400 TRANSCRIPTION_ERROR.
 * - Audit COMPLETED previo → lo devuelve (idempotente).
 * - Audit RUNNING previo → lo devuelve (el cliente pollea).
 */
export interface RunAuditOptions {
  /** Usuario que pide la ejecución; se cobra cuota por él. Sin él, no se cobra. */
  userId?: string;
}

export async function runAudit(
  client: InsForgeClient,
  caseId: string,
  options?: RunAuditOptions,
): Promise<RunAuditOutcome> {
  await getCaseOr404(client, caseId);

  await refreshTranscriptions(client, caseId, getEnv().TRANSCRIPTION_POLL_TIMEOUT_MS);

  const evidences = await listEvidenceRows(client, caseId);
  if (evidences.length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'El caso no tiene evidencias; sube al menos una antes de auditar');
  }

  const notReady = evidences.filter((evidence) => evidence.processing_status !== 'READY');
  const transcribing = notReady.filter(
    (evidence) => evidence.processing_status === 'UPLOADED' || evidence.processing_status === 'TRANSCRIBING',
  );
  const errored = notReady.filter((evidence) => evidence.processing_status === 'ERROR');

  if (transcribing.length > 0) {
    return { phase: 'pending', pendingEvidence: transcribing.map((evidence) => evidence.id) };
  }
  if (errored.length > 0) {
    throw new ApiError(
      400,
      'TRANSCRIPTION_ERROR',
      `Hay evidencias en estado ERROR: ${errored.map((evidence) => evidence.filename).join(', ')}`,
    );
  }

  const caseRow = await getCaseOr404(client, caseId);
  const fingerprint = computeEvidenceFingerprint(evidences);
  const completed = await latestCompletedAuditByFingerprint(client, caseId, fingerprint);
  if (completed) return { phase: 'done', audit: auditToDto(completed) };
  const running = await latestRunningAuditByFingerprint(client, caseId, fingerprint);
  if (running) {
    const deadlineAt = running.deadline_at ? new Date(running.deadline_at).getTime() : new Date(running.created_at).getTime() + getEnv().AUDIT_STALE_AFTER_MS;
    if (Date.now() <= deadlineAt) return { phase: 'running', audit: auditToDto(running) };
    const ageMs = Date.now() - new Date(running.created_at).getTime();
    await updateAuditResult(client, running.id, {
      status: 'ERROR',
      result_json: null,
      error_category: 'AI_PROVIDER_ERROR',
      latency_ms: ageMs,
      provider_metadata: { stale: true, deadlineAt: new Date(deadlineAt).toISOString(), fingerprint },
    });
  }

  // Prepara y valida expediente antes de crear RUNNING: errores 413/validación
  // son accionables por el usuario y no deben dejar una auditoría técnica fallida.
  const inputs = await buildAuditInputs(client, caseRow, evidences);

  // Cuota ANTES de la fila durable y ANTES del proveedor, y DESPUÉS de las
  // comprobaciones de reutilización de arriba: reutilizar un COMPLETED o una
  // RUNNING vigente no cuesta dinero y no debe devolver 429 (invariante
  // DO_NOT_REPROCESS_AI_UNNECESSARILY). Un 429 aquí no deja estado escrito.
  if (options?.userId) {
    await checkPaidQuota(options.userId, `audit:${caseId}:${fingerprint}`);
  }

  // La fila durable se crea ANTES de la llamada al modelo.
  const startedAt = Date.now();
  const deadlineMs = startedAt + getEnv().TOTAL_AUDIT_TIMEOUT_MS;
  const attempts = await countAuditsByFingerprint(client, caseId, fingerprint);
  let auditRow;
  try {
    auditRow = await insertAudit(client, {
      case_id: caseId,
      status: 'RUNNING',
      provider: 'openrouter',
      model: getEnv().OPENROUTER_MODEL,
      evidence_fingerprint: fingerprint,
      attempt_number: attempts + 1,
      deadline_at: new Date(deadlineMs).toISOString(),
      provider_metadata: null,
    });
  } catch (error) {
    const concurrent = await latestRunningAuditByFingerprint(client, caseId, fingerprint).catch(() => null);
    if (concurrent) return { phase: 'running', audit: auditToDto(concurrent) };
    throw error;
  }
  await updateCaseStatus(client, caseId, 'AUDITING');

  try {
    const execution = await auditSkill.executeWithMetadata(inputs, { deadlineMs });
    const result = execution.result;
    const latencyMs = Date.now() - startedAt;

    const final = await updateAuditResult(client, auditRow.id, {
      status: 'COMPLETED',
      result_json: result,
      error_category: null,
      latency_ms: latencyMs,
      model: execution.model,
      provider_metadata: { usage: execution.usage, openrouterAttempts: execution.attempts },
    });
    await updateCaseStatus(client, caseId, 'COMPLETED');
    // El dictamen ya está persistido en `result_json` y es la fuente de verdad; estas
    // dimensiones son solo una proyección para poder filtrar. Si la escritura falla,
    // se traga el error a propósito: perder el filtro no puede invalidar un dictamen
    // válido ni dejar el caso en ERROR. `try/catch` y no `.catch()` porque un fallo
    // síncrono (cliente mal formado) también debe quedar contenido.
    try {
      await updateCaseDimensions(client, caseId, {
        country: result.origin.country,
        channel: result.origin.channel,
      });
    } catch {
      // Deliberado: la proyección es best-effort.
    }

    return { phase: 'done', audit: auditToDto(final) };
  } catch (error) {
    const category: ErrorCategory = error instanceof ApiError ? error.category : 'AI_PROVIDER_ERROR';
    const latencyMs = Date.now() - startedAt;
    const diagnostics = error instanceof OpenRouterAuditError ? error.diagnostics : null;
    // Una sola línea JSON: en producción un SCHEMA_VALIDATION_ERROR solo dejaba
    // ruido de `pdfjs-dist` en `vercel logs`, así que el motivo real era
    // indescifrable. Se registra la categoría, el modelo, la latencia y el
    // detalle saneado de cada intento. Deliberadamente NO se registra
    // `error.message` (puede traer texto del proveedor, expediente o PII) ni el
    // prompt, el expediente, las transcripciones o las claves: solo el TIPO de
    // la excepción y los contadores de `buildAuditFailureLog`.
    console.error(
      '[audit] fallo de auditoría',
      JSON.stringify(
        buildAuditFailureLog({
          auditId: auditRow.id,
          caseId,
          errorCategory: category,
          error,
          model: auditRow.model,
          latencyMs,
          diagnostics: diagnostics ?? [],
        }),
      ),
    );
    await updateAuditResult(client, auditRow.id, {
      status: 'ERROR',
      result_json: null,
      error_category: category,
      latency_ms: latencyMs,
      provider_metadata: diagnostics ? { openrouterAttempts: diagnostics } : null,
    }).catch(() => undefined);
    await updateCaseStatus(client, caseId, 'ERROR').catch(() => undefined);
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, category, 'La auditoría falló; reintenta más tarde');
  }
}

/** Estado para polling del cliente: refresca transcripciones y sana RUNNING viejos. */
export async function getAuditForPolling(client: InsForgeClient, caseId: string): Promise<{ audit: AuditDetailDto | null }> {
  await getCaseOr404(client, caseId);
  await refreshTranscriptions(client, caseId, 10_000);
  await healStaleAudit(client, caseId);
  const audit = await latestAudit(client, caseId);
  return { audit: audit ? auditToDto(audit) : null };
}
