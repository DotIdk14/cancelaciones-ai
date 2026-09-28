// =============================================================================
// Servicio de auditoría — orquesta el flujo durable (secciones 13 y 14).
// =============================================================================
// La fila `audits` (status RUNNING) se inserta ANTES de llamar al modelo:
// si la función de Vercel muere a mitad de ejecución, el estado queda durable
// y GET /audit lo recupera (a) sigue RUNNING mientras el cliente pollea, o
// (b) se marca ERROR si es antiguo (self-healing). Sin colas de jobs.
// =============================================================================

import type { InsForgeClient } from './insforge';
import { getEnv } from './env';
import { auditSkill, PDF_MIN_TEXT_CHARS } from '../skills/audit/execute';
import type { AuditSkillInput, ErrorCategory, EvidenceInputItem } from '../skills/audit/types';
import { getTranscription } from './assemblyai';
import { extractPdfText } from './pdf';
import {
  detectKind,
  imageDataUrl,
  isAudio,
  readTranscriptFromJson,
  sleep,
} from './evidence-prep';
import { ApiError } from './http';
import {
  getCaseOr404,
  insertAudit,
  latestAudit,
  listEvidenceRows,
  updateAuditResult,
  updateCaseStatus,
  updateEvidenceStatus,
  type CaseRow,
  type EvidenceRow,
} from './cases';
import { auditToDto, type AuditDetailDto } from './dto';

const STALE_AUDIT_MS = 4 * 60 * 1000; // 4 min
const POLL_INTERVAL_MS = 2_000;

export type RunAuditOutcome =
  | { phase: 'pending'; pendingEvidence: string[] }
  | { phase: 'running'; audit: AuditDetailDto }
  | { phase: 'done'; audit: AuditDetailDto };

/** Marca ERROR las auditorías RUNNING abandonadas (función interrumpida). */
async function healStaleAudit(client: InsForgeClient, caseId: string): Promise<void> {
  const audit = await latestAudit(client, caseId);
  if (!audit || audit.status !== 'RUNNING') return;
  const ageMs = Date.now() - new Date(audit.created_at).getTime();
  if (ageMs > STALE_AUDIT_MS) {
    await updateAuditResult(client, audit.id, {
      status: 'ERROR',
      result_json: null,
      error_category: 'AI_PROVIDER_ERROR',
      latency_ms: ageMs,
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
  const items: EvidenceInputItem[] = [];
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
      items.push({ ...base, imageBase64: imageDataUrl(buffer, evidence.mime_type) });
    } else if (kind === 'PDF') {
      const buffer = await downloadEvidenceBuffer(client, evidence);
      const text = await extractPdfText(buffer);
      if (text.trim().length >= PDF_MIN_TEXT_CHARS) {
        items.push({ ...base, text });
      } else {
        // Escaneado: texto pobre → archivo nativo al modelo multimodal.
        items.push({ ...base, text: text.slice(0, 600), pdfBase64: buffer.toString('base64') });
      }
    } else if (kind === 'AUDIO') {
      const transcript = readTranscriptFromJson(evidence.transcript_json);
      items.push({ ...base, transcript });
    } else {
      const buffer = await downloadEvidenceBuffer(client, evidence);
      items.push({ ...base, text: buffer.toString('utf-8').slice(0, 80_000) });
    }
  }
  return {
    caseId: caseRow.id,
    studentIdentifier: caseRow.student_identifier,
    evidences: items,
  };
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

  const existing = await latestAudit(client, caseId);
  if (existing) {
    if (existing.status === 'COMPLETED') return { phase: 'done', audit: auditToDto(existing) };
    if (existing.status === 'RUNNING') return { phase: 'running', audit: auditToDto(existing) };
  }

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

  // La fila durablese crea ANTES de la llamada al modelo.
  const startedAt = Date.now();
  const auditRow = await insertAudit(client, {
    case_id: caseId,
    status: 'RUNNING',
    provider: 'openrouter',
    model: getEnv().OPENROUTER_MODEL,
  });
  await updateCaseStatus(client, caseId, 'AUDITING');

  try {
    const inputs = await buildAuditInputs(client, caseRow, evidences);
    const result = await auditSkill.execute(inputs);
    const latencyMs = Date.now() - startedAt;

    await updateAuditResult(client, auditRow.id, {
      status: 'COMPLETED',
      result_json: result,
      error_category: null,
      latency_ms: latencyMs,
    });
    await updateCaseStatus(client, caseId, 'COMPLETED');

    const final = await latestAudit(client, caseId);
    return { phase: 'done', audit: auditToDto(final ?? auditRow) };
  } catch (error) {
    const category: ErrorCategory = error instanceof ApiError ? error.category : 'AI_PROVIDER_ERROR';
    const latencyMs = Date.now() - startedAt;
    await updateAuditResult(client, auditRow.id, {
      status: 'ERROR',
      result_json: null,
      error_category: category,
      latency_ms: latencyMs,
    }).catch(() => undefined);
    await updateCaseStatus(client, caseId, 'ERROR').catch(() => undefined);
    throw new ApiError(
      502,
      category,
      error instanceof ApiError ? error.message : 'La auditoría falló; reintenta más tarde',
    );
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