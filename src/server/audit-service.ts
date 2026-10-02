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
import type { AuditSkillInput, ErrorCategory, EvidenceInputItem } from '../skills/audit/types.js';
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
import { buildAuditFailureLog } from './audit-observability.js';
import {
  getCaseOr404,
  insertAudit,
  countAuditsByFingerprint,
  latestCompletedAuditByFingerprint,
  latestRunningAuditByFingerprint,
  latestAudit,
  listEvidenceRows,
  updateAuditResult,
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
    if (Date.now() >= deadline) return;
    const assemblyId = readAssemblyId(evidence);
    if (!assemblyId) {
      await updateEvidenceStatus(client, evidence.id, {
        processing_status: 'ERROR',
        transcript_json: { status: 'ERROR', error: 'Transcripción no iniciada' },
      }).catch(() => undefined);
      continue;
    }
    while (Date.now() < deadline) {
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
      const buffer = await downloadEvidenceBuffer(client, evidence);
      const text = await extractPdfText(buffer);
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
      const buffer = await downloadEvidenceBuffer(client, evidence);
      const limited = limitEvidenceText(buffer.toString('utf-8'));
      aggregateTextChars += limited.text.length;
      items.push({ ...base, text: limited.text, truncated: limited.truncated, originalChars: limited.originalChars });
    }
    enforceAggregateTextLimit(aggregateTextChars);
  }
  enforceAggregateTextLimit(aggregateTextChars);
  enforceMultimodalLimit(aggregateMultimodalBytes);
  return {
    caseId: caseRow.id,
    studentIdentifier: caseRow.student_identifier,
    evidences: items,
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

export function computeEvidenceFingerprint(evidences: EvidenceRow[]): string {
  const canonical = evidences
    .map((evidence) => ({
      id: evidence.id,
      hash: evidence.hash,
      processingStatus: evidence.processing_status,
      transcriptHash: evidence.transcript_json
        ? createHash('sha256').update(JSON.stringify(evidence.transcript_json)).digest('hex')
        : null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * Ejecuta o reutiliza la auditoría del caso.
 * - No hay evidencias → 400.
 * - Evidencias en TRANSCRIBING → 202 (pending).
 * - Evidencias en ERROR → 400 TRANSCRIPTION_ERROR.
 * - Audit COMPLETED previo → lo devuelve (idempotente).
 * - Audit RUNNING previo → lo devuelve (el cliente pollea).
 */
export async function runAudit(client: InsForgeClient, caseId: string): Promise<RunAuditOutcome> {
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
