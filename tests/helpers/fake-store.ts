// =============================================================================
// Store en memoria que reemplaza `src/server/cases`, `src/server/reviews` y el
// Storage de InsForge en los tests de estado de evidencia y de revisión humana.
// Sin red, sin base de datos.
// Solo persiste: NO implementa ninguna regla de negocio ni transición de estado
// (esas viven en el código de producción y es justo lo que se testea).
// =============================================================================

// `errors.ts` y no `http.ts`: el store se carga DENTRO de las fábricas de
// `vi.mock`, e importar `http` cerraría el círculo `http -> auth -> insforge
// (mock) -> store -> http` y colgaría la suite antes del primer test.
import { ApiError } from '../../src/server/errors';
import type { InsForgeClient } from '../../src/server/insforge';
// `capabilities` y no `auth`: el store se carga DENTRO de las fabricas de
// `vi.mock`, y `auth.ts` arrastra el SDK de InsForge (cuyo mock llama a este
// mismo store), asi que importarlo aqui cerraria el circulo y colgaria la suite
// antes del primer test. `capabilities.ts` es el modulo hoja que `auth.ts`
// reexporta: la MISMA funcion, sin el arrastre.
import { capabilitiesForRole } from '../../src/server/capabilities';
import type { CaseStatus, EvidenceStatus, TranscriptData } from '../../src/skills/audit/types';
import type { HumanResolution } from '../../src/skills/review/types';
import type {
  AuditRow,
  AuditStatus,
  CaseRow,
  EvidenceRow,
  InsertAuditRow,
  InsertEvidenceRow,
} from '../../src/server/cases';
import type {
  CaseReviewRow,
  ComparisonRow,
  ComparisonStatus,
  CreateCaseReviewInput,
  FinalizeCaseReviewInput,
  InsertComparisonInput,
  RearmComparisonInput,
  UpdateComparisonErrorInput,
  UpdateComparisonResultInput,
} from '../../src/server/reviews';
import { validAuditResult } from '../fixtures/audit-result';

export interface FakeTranscription {
  state: 'TRANSCRIBING' | 'READY' | 'ERROR';
  transcript: TranscriptData | null;
  error?: string;
}

const caseRows: CaseRow[] = [];
const evidenceRows: EvidenceRow[] = [];
const auditRows: AuditRow[] = [];
const reviewRows: CaseReviewRow[] = [];
const comparisonRows: ComparisonRow[] = [];
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
  reviewRows.length = 0;
  comparisonRows.length = 0;
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
    created_by: null,
    created_at: '2026-02-01T10:00:00Z',
    updated_at: '2026-02-01T10:00:00Z',
    // Mismo default que la columna: un caso sin marca es REAL. Los tests que
    // necesitan una prueba pasan `is_test: true` explícito.
    is_test: false,
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
    extracted_text: rest.extracted_text ?? null,
    extraction_pipeline_version: rest.extraction_pipeline_version ?? null,
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

/** Siembra una fila de `audits`. `resultJson` permite variar el dictamen. */
export function seedAudit(overrides: Partial<AuditRow> & { resultJson?: unknown } = {}): AuditRow {
  const { resultJson, ...rest } = overrides;
  const row: AuditRow = {
    id: rest.id ?? nextId('audit'),
    case_id: rest.case_id ?? 'case-1',
    status: rest.status ?? 'COMPLETED',
    provider: rest.provider ?? 'openrouter',
    model: rest.model ?? 'google/gemini-2.5-flash-lite',
    result_json: resultJson ?? validAuditResult,
    error_category: rest.error_category ?? null,
    latency_ms: rest.latency_ms ?? null,
    evidence_fingerprint: rest.evidence_fingerprint ?? 'f'.repeat(64),
    attempt_number: rest.attempt_number ?? 1,
    deadline_at: rest.deadline_at ?? null,
    provider_metadata: rest.provider_metadata ?? null,
    created_at: rest.created_at ?? '2026-02-01T10:10:00Z',
  };
  auditRows.push(row);
  return { ...row };
}

/** Siembra una revisión humana (fila de `case_reviews`). */
export function seedReview(overrides: Partial<CaseReviewRow> = {}): CaseReviewRow {
  const row: CaseReviewRow = {
    id: overrides.id ?? nextId('review'),
    case_id: overrides.case_id ?? 'case-1',
    audit_id: overrides.audit_id ?? 'audit-1',
    result: overrides.result ?? 'BAJA',
    reviewer_name: overrides.reviewer_name ?? null,
    comment: overrides.comment ?? 'Se acredita la baja por solicitud posterior al inicio de ciclo.',
    created_at: overrides.created_at ?? '2026-02-02T09:00:00Z',
    created_by: overrides.created_by ?? null,
    coordinator_decision: overrides.coordinator_decision ?? null,
    coordinator_resolution: overrides.coordinator_resolution ?? null,
    coordinator_created_by: overrides.coordinator_created_by ?? null,
    coordinator_created_at: overrides.coordinator_created_at ?? null,
    coordinator_comment: overrides.coordinator_comment ?? null,
  };
  reviewRows.push(row);
  return { ...row };
}

/** Siembra una comparación (fila de `case_comparisons`). */
export function seedComparison(overrides: Partial<ComparisonRow> = {}): ComparisonRow {
  const row: ComparisonRow = {
    id: overrides.id ?? nextId('comparison'),
    case_review_id: overrides.case_review_id ?? 'review-1',
    audit_id: overrides.audit_id ?? 'audit-1',
    status: overrides.status ?? 'RUNNING',
    result_json: overrides.result_json ?? null,
    provider: overrides.provider ?? 'openrouter',
    model: overrides.model ?? 'google/gemini-2.5-flash-lite',
    error_category: overrides.error_category ?? null,
    latency_ms: overrides.latency_ms ?? null,
    attempt_count: overrides.attempt_count ?? 1,
    deadline_at: overrides.deadline_at ?? null,
    created_at: overrides.created_at ?? '2026-02-02T09:05:00Z',
    updated_at: overrides.updated_at ?? overrides.created_at ?? '2026-02-02T09:05:00Z',
  };
  comparisonRows.push(row);
  return { ...row };
}

export function listReviews(): CaseReviewRow[] {
  return reviewRows.map((row) => ({ ...row }));
}

export function listComparisons(): ComparisonRow[] {
  return comparisonRows.map((row) => ({ ...row }));
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

/**
 * Caché de derivados (`extracted_text` + `extraction_pipeline_version`).
 *
 * Se reexporta la implementación REAL a propósito: es lógica pura y determinista
 * (qué texto se considera vigente para una versión de pipeline), no
 * persistencia. Reimplementarla en el store haría que los tests validaran una
 * regla distinta de la de producción. Viene de `derived.ts`, no de `cases.ts`,
 * porque `cases.ts` es justo el módulo que estos tests sustituyen.
 */
export { derivedExtractionOf } from '../../src/server/derived';

/** Persiste el derivado en la fila en memoria. */
export async function persistDerivedExtraction(
  _client: unknown,
  evidenceId: string,
  text: string,
  pipelineVersion: string,
): Promise<void> {
  const row = evidenceRows.find((item) => item.id === evidenceId);
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Evidencia no encontrada');
  row.extracted_text = text;
  row.extraction_pipeline_version = pipelineVersion;
}

/**
 * Scoping por dueño, replicando la regla real: se ve el caso propio y, además,
 * cualquier caso si el rol tiene `canReadAllCases` (coordinador y gerente).
 * "Ajeno" e "inexistente" responden igual (404).
 *
 * Reutiliza la MISMA `capabilitiesForRole` de producción en vez de copiar la
 * regla: si el contrato de capacidades cambia, este doble no puede quedarse
 * viejo por descuido (era el riesgo real del `role === 'user'` de antes).
 *
 * Igual que la producción, un `created_by` nulo NO es visible para un lector no
 * global: el alcance compara el dueño con `auth.sub` sin excepción para nulo (la
 * producción real siempre asigna dueño al crear el caso, así que un nulo es, a
 * todos los efectos, "de otro"). Los tests que necesiten un caso propio siembran
 * `created_by` explícito.
 */
export async function getScopedCaseOr404(
  _client: unknown,
  caseId: string,
  auth: { sub: string; role: 'user' | 'coordinator' | 'manager' },
): Promise<CaseRow> {
  const row = getCase(caseId);
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Caso no encontrado');
  const foreign = row.created_by !== auth.sub;
  if (foreign && !capabilitiesForRole(auth.role).canReadAllCases) {
    throw new ApiError(404, 'NOT_FOUND', 'Caso no encontrado');
  }
  return { ...row };
}

/** Mutación: solo el dueño. Responde 404 (no 403) para no enumerar existencia. */
export function assertCaseOwner(row: { created_by?: string | null }, auth: { sub: string }): void {
  if (row.created_by !== auth.sub) {
    throw new ApiError(404, 'NOT_FOUND', 'Caso no encontrado');
  }
}

export async function listCaseSummaries(
  _client: unknown,
  auth?: { sub: string; role: 'user' | 'coordinator' | 'manager' },
): Promise<unknown[]> {
  const canReadAll = auth ? capabilitiesForRole(auth.role).canReadAllCases : true;
  return caseRows
    // Espejo de la producción: sin capacidad de lectura global (Asesor) solo se
    // devuelven los casos propios. Se trata un `created_by` nulo como visible
    // para no obligar a cada test a declarar el dueño (la producción real nunca
    // crea un caso sin `created_by`).
    .filter((row) => canReadAll || row.created_by === null || row.created_by === undefined || row.created_by === auth?.sub)
    .map((row) => {
      const review = reviewRows.find((r) => r.case_id === row.id) ?? null;
      const auditsForCase = auditRows.filter((a) => a.case_id === row.id && a.status === 'COMPLETED');
      const audit = auditsForCase[auditsForCase.length - 1] ?? null;
      return {
        ...row,
        evidence: [{ count: evidenceRows.filter((e) => e.case_id === row.id).length }],
        review,
        audit,
      };
    });
}

export async function createCase(
  _client: unknown,
  studentIdentifier: string | null,
  createdBy?: string,
  isTest = false,
): Promise<CaseRow> {
  return seedCase({
    id: nextId('case'),
    created_by: createdBy ?? null,
    student_identifier: studentIdentifier,
    is_test: isTest,
  });
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

export async function latestCompletedAuditByFingerprint(_client: unknown, caseId: string, fingerprint: string): Promise<AuditRow | null> {
  const rows = auditRows.filter((row) => row.case_id === caseId && row.status === 'COMPLETED' && row.evidence_fingerprint === fingerprint);
  const last = rows[rows.length - 1];
  return last ? { ...last } : null;
}

export async function latestRunningAuditByFingerprint(_client: unknown, caseId: string, fingerprint: string): Promise<AuditRow | null> {
  const rows = auditRows.filter((row) => row.case_id === caseId && row.status === 'RUNNING' && row.evidence_fingerprint === fingerprint);
  const last = rows[rows.length - 1];
  return last ? { ...last } : null;
}

export async function countAuditsByFingerprint(_client: unknown, caseId: string, fingerprint: string): Promise<number> {
  return auditRows.filter((row) => row.case_id === caseId && row.evidence_fingerprint === fingerprint).length;
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
    evidence_fingerprint: row.evidence_fingerprint,
    attempt_number: row.attempt_number,
    deadline_at: row.deadline_at,
    provider_metadata: row.provider_metadata ?? null,
    created_at: new Date().toISOString(),
  };
  auditRows.push(audit);
  return { ...audit };
}

export async function updateAuditResult(
  _client: unknown,
  auditId: string,
  patch: { status: AuditStatus; result_json: unknown; error_category: AuditRow['error_category']; latency_ms: number; model?: string; provider_metadata?: unknown },
): Promise<AuditRow> {
  const row = auditRows.find((item) => item.id === auditId);
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Auditoría no encontrada');
  row.status = patch.status;
  row.result_json = patch.result_json;
  row.error_category = patch.error_category;
  row.latency_ms = patch.latency_ms;
  if (patch.model) row.model = patch.model;
  if (patch.provider_metadata !== undefined) row.provider_metadata = patch.provider_metadata;
  return { ...row };
}

export async function updateCaseStatus(_client: unknown, caseId: string, status: CaseStatus): Promise<void> {
  const row = getCase(caseId);
  if (row) row.status = status;
}

/**
 * Proyección del origen a las dimensiones del caso, con la misma regla que la
 * implementación real: un `null` no borra el valor que ya estaba.
 */
export async function updateCaseDimensions(
  _client: unknown,
  caseId: string,
  dimensions: { country?: string | null; channel?: string | null },
): Promise<void> {
  const row = getCase(caseId);
  if (!row) return;
  if (dimensions.country != null) (row as { country?: string | null }).country = dimensions.country;
  if (dimensions.channel != null) (row as { channel?: string | null }).channel = dimensions.channel;
}

export async function getAuditById(_client: unknown, auditId: string): Promise<AuditRow | null> {
  const row = auditRows.find((item) => item.id === auditId);
  return row ? { ...row } : null;
}

export async function latestCompletedAudit(_client: unknown, caseId: string): Promise<AuditRow | null> {
  const rows = auditRows.filter((row) => row.case_id === caseId && row.status === 'COMPLETED');
  const last = rows[rows.length - 1];
  return last ? { ...last } : null;
}

// -------------------------------------- implementación de `src/server/reviews`

/** Mensaje único de duplicado: el que usan producción y este store. */
const DUPLICATE_REVIEW_MESSAGE =
  'El caso ya tiene una revisión humana registrada; cada caso admite una sola revisión.';

/** Mensaje único de finalización duplicada, espejo del de producción. */
const DUPLICATE_FINALIZATION_MESSAGE =
  'El caso ya tiene la decisión final del coordinador registrada; la finalización es única e inmutable.';

export async function createCaseReview(_client: unknown, input: CreateCaseReviewInput): Promise<CaseReviewRow> {
  if (reviewRows.some((row) => row.case_id === input.caseId)) {
    throw new ApiError(409, 'VALIDATION_ERROR', DUPLICATE_REVIEW_MESSAGE);
  }
  return seedReview({
    case_id: input.caseId,
    audit_id: input.auditId,
    result: input.result,
    reviewer_name: input.reviewerName,
    comment: input.comment,
    created_by: input.userId,
  });
}

export async function getCaseReview(_client: unknown, caseId: string): Promise<CaseReviewRow | null> {
  const row = reviewRows.find((item) => item.case_id === caseId);
  return row ? { ...row } : null;
}

/**
 * Espejo de `finalizeCaseReview` de producción: misma semántica de persistencia
 * (sin revisión → 400; ya finalizada → 409; CHANGE exige resolución distinta).
 * No implementa reglas de negocio: las decide el endpoint con capabilities.
 */
export async function finalizeCaseReview(_client: unknown, input: FinalizeCaseReviewInput): Promise<CaseReviewRow> {
  const row = reviewRows.find((item) => item.case_id === input.caseId);
  if (!row) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'El caso no tiene revisión de asesor que finalizar; regístrala antes de decidir.');
  }
  if (row.coordinator_decision != null) {
    throw new ApiError(409, 'VALIDATION_ERROR', DUPLICATE_FINALIZATION_MESSAGE);
  }
  if (input.decision === 'CHANGE') {
    if (!input.resolution) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'La decisión CHANGE exige una resolución final distinta de la del asesor.');
    }
    if (input.resolution === row.result) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'La decisión CHANGE exige una resolución distinta de la del asesor.');
    }
  }
  row.coordinator_decision = input.decision;
  row.coordinator_resolution = input.decision === 'CHANGE' ? input.resolution : null;
  row.coordinator_created_by = input.coordinatorUserId;
  row.coordinator_created_at = new Date().toISOString();
  row.coordinator_comment = input.comment;
  return { ...row };
}

export async function insertComparison(_client: unknown, input: InsertComparisonInput): Promise<ComparisonRow> {
  return seedComparison({
    case_review_id: input.caseReviewId,
    audit_id: input.auditId,
    status: 'RUNNING',
    attempt_count: 1,
    deadline_at: input.deadlineAt,
  });
}

export async function getLatestComparisonForReview(
  _client: unknown,
  caseReviewId: string,
): Promise<ComparisonRow | null> {
  const rows = comparisonRows.filter((row) => row.case_review_id === caseReviewId);
  const last = rows[rows.length - 1];
  return last ? { ...last } : null;
}

export async function rearmComparison(
  _client: unknown,
  comparisonId: string,
  input: RearmComparisonInput,
): Promise<ComparisonRow> {
  const row = comparisonRows.find((item) => item.id === comparisonId);
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Comparación no encontrada');
  row.status = 'RUNNING';
  row.result_json = null;
  row.error_category = null;
  row.latency_ms = null;
  row.attempt_count = input.attemptCount;
  row.deadline_at = input.deadlineAt;
  if (input.model) row.model = input.model;
  row.updated_at = new Date().toISOString();
  return { ...row };
}

export async function updateComparisonResult(
  _client: unknown,
  comparisonId: string,
  input: UpdateComparisonResultInput,
): Promise<ComparisonRow> {
  const row = comparisonRows.find((item) => item.id === comparisonId);
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Comparación no encontrada');
  row.status = 'COMPLETED';
  row.result_json = input.resultJson;
  row.provider = input.provider;
  row.model = input.model;
  row.error_category = null;
  row.latency_ms = input.latencyMs;
  row.updated_at = new Date().toISOString();
  return { ...row };
}

export async function updateComparisonError(
  _client: unknown,
  comparisonId: string,
  input: UpdateComparisonErrorInput,
): Promise<ComparisonRow> {
  const row = comparisonRows.find((item) => item.id === comparisonId);
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Comparación no encontrada');
  row.status = 'ERROR';
  row.result_json = null;
  row.error_category = input.errorCategory;
  row.latency_ms = input.latencyMs;
  row.updated_at = new Date().toISOString();
  return { ...row };
}

export async function listComparisonsForCase(_client: unknown, caseId: string): Promise<ComparisonRow[]> {
  const review = reviewRows.find((row) => row.case_id === caseId);
  if (!review) return [];
  return comparisonRows
    .filter((row) => row.case_review_id === review.id)
    .map((row) => ({ ...row }))
    .reverse();
}

export type { CaseReviewRow, ComparisonRow, ComparisonStatus, HumanResolution };

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

  // El servicio de cuotas es el ÚNICO camino de `admit_or_reject_quota` que llega
  // a la base real en producción. En los tests se admite siempre: el objetivo de
  // estos archivos es el ciclo de vida de la evidencia y el dictamen, no la
  // cuota, y su contrato (fail-closed, PII hasheada) ya está cubierto en
  // `tests/quotas.test.ts`.
  database: {
    rpc: async (fn: string): Promise<{ data: unknown; error: unknown }> => {
      if (fn === 'admit_or_reject_quota') {
        return { data: [{ admitted: true, retry_after_seconds: 0 }], error: null };
      }
      return { data: null, error: new Error(`RPC no soportada por el store: ${fn}`) };
    },
  },
} as unknown as InsForgeClient;
