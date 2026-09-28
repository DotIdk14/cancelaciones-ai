// =============================================================================
// Store en memoria que reemplaza `src/server/cases` y el Storage de InsForge
// en los tests de estado de evidencia. Sin red, sin base de datos.
// Solo persiste: NO implementa ninguna regla de negocio ni transición de estado
// (esas viven en el código de producción y es justo lo que se testea).
// =============================================================================

import { ApiError } from '../../src/server/http';
import type { InsForgeClient } from '../../src/server/insforge';
import type { CaseStatus, EvidenceStatus, TranscriptData } from '../../src/skills/audit/types';
import type {
  AuditRow,
  AuditStatus,
  CaseRow,
  EvidenceRow,
  InsertAuditRow,
  InsertEvidenceRow,
} from '../../src/server/cases';

export interface FakeTranscription {
  state: 'TRANSCRIBING' | 'READY' | 'ERROR';
  transcript: TranscriptData | null;
  error?: string;
}

const caseRows: CaseRow[] = [];
const evidenceRows: EvidenceRow[] = [];
const auditRows: AuditRow[] = [];
/** Binarios "guardados" por `storage_path` (los lee `buildAuditInputs`). */
const blobs = new Map<string, Buffer>();
/** Respuestas de AssemblyAI por `assemblyId`. */
const transcriptions = new Map<string, FakeTranscription>();

export const storageLog: { uploads: string[]; downloads: string[]; removeErrors: Map<string, Error> } = {
  uploads: [],
  downloads: [],
  removeErrors: new Map(),
};

let sequence = 0;
function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

export function resetStore(): void {
  caseRows.length = 0;
  evidenceRows.length = 0;
  auditRows.length = 0;
  blobs.clear();
  transcriptions.clear();
  storageLog.uploads.length = 0;
  storageLog.downloads.length = 0;
  storageLog.removeErrors.clear();
  sequence = 0;
}

// --------------------------------------------------------------------- siembras

export function seedCase(overrides: Partial<CaseRow> = {}): CaseRow {
  const row: CaseRow = {
    id: 'case-1',
    status: 'DRAFT',
    student_identifier: 'UTEL-2026-001',
    created_by: 'user-1',
    created_at: '2026-02-01T10:00:00Z',
    updated_at: '2026-02-01T10:00:00Z',
    ...overrides,
  };
  caseRows.push(row);
  return row;
}

export function seedEvidence(overrides: Partial<EvidenceRow> & { content?: string }): EvidenceRow {
  const { content, ...rest } = overrides;
  const id = rest.id ?? nextId('ev');
  const storagePath = rest.storage_path ?? `case-1/${id}-${rest.filename ?? 'archivo'}`;
  const row: EvidenceRow = {
    id,
    case_id: rest.case_id ?? 'case-1',
    filename: rest.filename ?? 'archivo',
    mime_type: rest.mime_type ?? 'text/plain',
    size_bytes: rest.size_bytes ?? 10,
    hash: rest.hash ?? 'a'.repeat(64),
    storage_path: storagePath,
    processing_status: rest.processing_status ?? 'READY',
    transcript_json: rest.transcript_json ?? null,
    created_at: rest.created_at ?? '2026-02-01T10:05:00Z',
  };
  evidenceRows.push(row);
  // `insertEvidence` no conoce el binario (lo subió el Storage): no debe pisar
  // el blob que ya guardó `fakeClient.storage.upload`.
  if (content !== undefined || !blobs.has(storagePath)) {
    blobs.set(storagePath, Buffer.from(content ?? 'contenido', 'utf-8'));
  }
  return row;
}

export function setTranscription(assemblyId: string, value: FakeTranscription): void {
  transcriptions.set(assemblyId, value);
}

export function getTranscriptionState(assemblyId: string): FakeTranscription {
  return transcriptions.get(assemblyId) ?? { state: 'ERROR', transcript: null, error: 'sin transcripción' };
}

export function listEvidence(): EvidenceRow[] {
  return evidenceRows.map((row) => ({ ...row }));
}

export function listAudits(): AuditRow[] {
  return auditRows.map((row) => ({ ...row }));
}

export function getCase(id: string): CaseRow | undefined {
  return caseRows.find((row) => row.id === id);
}

// -------------------------------------- implementación de `src/server/cases`

export async function getCaseOr404(_client: unknown, caseId: string): Promise<CaseRow> {
  const row = getCase(caseId);
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Caso no encontrado');
  return { ...row };
}

export async function listCaseSummaries(): Promise<unknown[]> {
  return caseRows.map((row) => ({ ...row, evidence: [{ count: evidenceRows.length }] }));
}

export async function createCase(
  _client: unknown,
  userId: string,
  studentIdentifier: string | null,
): Promise<CaseRow> {
  return seedCase({ id: nextId('case'), created_by: userId, student_identifier: studentIdentifier });
}

export async function listEvidenceRows(_client: unknown, caseId: string): Promise<EvidenceRow[]> {
  return evidenceRows.filter((row) => row.case_id === caseId).map((row) => ({ ...row }));
}

export async function getEvidenceOr404(_client: unknown, caseId: string, evidenceId: string): Promise<EvidenceRow> {
  const row = evidenceRows.find((item) => item.id === evidenceId && item.case_id === caseId);
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Evidencia no encontrada');
  return { ...row };
}

export async function insertEvidence(_client: unknown, row: InsertEvidenceRow): Promise<EvidenceRow> {
  return seedEvidence({ ...row });
}

export async function updateEvidenceStatus(
  _client: unknown,
  evidenceId: string,
  patch: { processing_status: EvidenceStatus; transcript_json: unknown },
): Promise<EvidenceRow> {
  const row = evidenceRows.find((item) => item.id === evidenceId);
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Evidencia no encontrada');
  row.processing_status = patch.processing_status;
  row.transcript_json = patch.transcript_json;
  return { ...row };
}

export async function deleteEvidenceRow(_client: unknown, evidenceId: string): Promise<void> {
  const index = evidenceRows.findIndex((row) => row.id === evidenceId);
  if (index >= 0) evidenceRows.splice(index, 1);
}

export async function latestAudit(_client: unknown, caseId: string): Promise<AuditRow | null> {
  const rows = auditRows.filter((row) => row.case_id === caseId);
  const last = rows[rows.length - 1];
  return last ? { ...last } : null;
}

export async function insertAudit(_client: unknown, row: InsertAuditRow): Promise<AuditRow> {
  const audit: AuditRow = {
    id: nextId('audit'),
    case_id: row.case_id,
    status: row.status,
    provider: row.provider,
    model: row.model,
    result_json: null,
    error_category: null,
    latency_ms: null,
    created_at: new Date().toISOString(),
  };
  auditRows.push(audit);
  return { ...audit };
}

export async function updateAuditResult(
  _client: unknown,
  auditId: string,
  patch: { status: AuditStatus; result_json: unknown; error_category: AuditRow['error_category']; latency_ms: number },
): Promise<AuditRow> {
  const row = auditRows.find((item) => item.id === auditId);
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Auditoría no encontrada');
  row.status = patch.status;
  row.result_json = patch.result_json;
  row.error_category = patch.error_category;
  row.latency_ms = patch.latency_ms;
  return { ...row };
}

export async function updateCaseStatus(_client: unknown, caseId: string, status: CaseStatus): Promise<void> {
  const row = getCase(caseId);
  if (row) row.status = status;
}

// ------------------------------------------------------- cliente InsForge fake

/**
 * PDF mínimo pero VÁLIDO (con xref), para que `extractPdfText` (pdf.js) lo
 * parsee de verdad en los tests en vez de simularse.
 */
export function minimalPdf(text: string): Buffer {
  const escaped = text.replace(/([()\\])/g, '\\$1');
  const content = `BT /F1 12 Tf 72 700 Td (${escaped}) Tj ET`;
  const bodies = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
    `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
  ];

  const chunks: string[] = ['%PDF-1.4\n'];
  const offsets: number[] = [];
  let length = chunks[0]!.length;
  bodies.forEach((body, index) => {
    const block = `${index + 1} 0 obj\n${body}\nendobj\n`;
    offsets.push(length);
    chunks.push(block);
    length += block.length;
  });

  const xrefOffset = length;
  let xref = `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<</Size ${bodies.length + 1}/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(xref);
  return Buffer.from(chunks.join(''), 'latin1');
}

/** Cliente mínimo: solo `storage.from(bucket).upload/download`. */
export const fakeClient = {
  storage: {
    from: (_bucket: string) => ({
      upload: async (path: string, blob: Blob): Promise<{ data: { key: string } | null; error: unknown }> => {
        storageLog.uploads.push(path);
        blobs.set(path, Buffer.from(await blob.arrayBuffer()));
        return { data: { key: path }, error: null };
      },
      download: async (
        path: string,
      ): Promise<{ data: { arrayBuffer(): Promise<ArrayBufferLike> } | null; error: unknown }> => {
        storageLog.downloads.push(path);
        const buffer = blobs.get(path);
        if (!buffer) return { data: null, error: new Error('no encontrado') };
        const copy = new Uint8Array(buffer);
        return { data: { arrayBuffer: async () => copy.buffer.slice(0) }, error: null };
      },
      remove: async (path: string): Promise<{ error: Error | null }> => ({ error: storageLog.removeErrors.get(path) ?? null }),
    }),
  },
} as unknown as InsForgeClient;
