// Servicio server-side del workflow de Dictamen (Phase 7).
// Orquesta datos durables (engine run, review humana, comentarios, seleccion de
// evidencia) -> snapshot congelado -> render del PDF (DRAFT/FINAL) -> storage.
// Idempotente por fingerprint; el final solo se genera desde snapshot aprobado.
import { createHash } from 'node:crypto';
import {
  createAuditLogRepository,
  createAuditRepository,
  createAuditManualCommentsRepository,
  createDictamenDocumentRepository,
  createEvidenceRepository,
  createEvidenceSelectionRepository,
  createFactRepository,
  createHumanReviewRepository,
  createReportSnapshotRepository,
  type DictamenDocumentRecord,
  type EvidenceSelectionRecord,
  type HumanReviewRecord,
  type ReportSnapshotRecord,
} from '@cancelaciones/db';
import {
  buildHumanReview,
  buildReportSnapshot,
  buildRuleTraceRef,
  computeDocumentFingerprint,
  freezeMachineDecision,
  mapDictamenFields,
  mapManualCommentsForPdf,
  type BuildHumanReviewInput,
  type EvidenceSelectionItem,
  type HumanReviewDecision,
  type MachineDecisionRef,
  type ManualCommentsMap,
  type RuleTraceRef,
} from '@cancelaciones/reporting';
import { loadDictamenTemplate, REPORT_BUCKET } from '@/server/reporting/template';
import { renderDictamenPdf, type RenderEvidenceItem } from '@/server/reporting/render';
import type { DictamenCellId } from '@/server/reporting/layout';
import type { AuthorizedContext } from '@/server/reporting/authz';

const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

// ---------------------------------------------------------------------------
// Lectura de datos durables
// ---------------------------------------------------------------------------

type EngineRunRow = {
  id: string;
  audit_id: string;
  fact_run_id: string | null;
  policy_code: string;
  policy_version: string;
  rules_fingerprint: string;
  facts_fingerprint: string;
  status: string;
  suggested_outcome: string | null;
  outcome_status: string;
  evaluation: Record<string, unknown>;
  created_at: string;
};

async function getLatestEngineRun(auth: AuthorizedContext): Promise<EngineRunRow | null> {
  const result = await auth.client.database
    .from('engine_runs')
    .select('*')
    .eq('audit_id', auth.auditId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (result.error) throw new Error(result.error.message ?? 'No fue posible leer la corrida del motor.');
  return (result.data?.[0] ?? null) as EngineRunRow | null;
}

function machineRefFromRun(run: EngineRunRow): MachineDecisionRef {
  const evaluation = (run.evaluation ?? {}) as { decisionStatus?: string; suggestedReason?: string | null };
  return freezeMachineDecision({
    engineRunId: run.id,
    machineOutcome: run.suggested_outcome,
    machineReason: evaluation.suggestedReason ?? null,
    machineDecisionStatus: evaluation.decisionStatus ?? run.outcome_status,
    factsFingerprint: run.facts_fingerprint,
    rulesFingerprint: run.rules_fingerprint,
  });
}

function ruleTraceFromRun(run: EngineRunRow): RuleTraceRef {
  const evaluation = (run.evaluation ?? {}) as {
    decisionStatus?: string;
    suggestedOutcome?: string | null;
    trace?: { ruleIds?: string[]; factIds?: string[]; evidenceRefs?: Array<{ evidenceId?: string; artifactId?: string | null; sha256?: string | null }> };
  };
  return buildRuleTraceRef({
    ruleIds: evaluation.trace?.ruleIds ?? [],
    factIds: evaluation.trace?.factIds ?? [],
    evidenceRefs: evaluation.trace?.evidenceRefs ?? [],
    suggestedOutcome: evaluation.suggestedOutcome ?? run.suggested_outcome,
    decisionStatus: evaluation.decisionStatus ?? run.outcome_status,
  });
}

function humanDecisionFromRecord(record: HumanReviewRecord): HumanReviewDecision {
  return {
    decisionType: record.decisionType,
    humanOutcome: record.humanOutcome,
    humanCause: record.humanCause,
    humanReason: record.humanReason,
    reviewedBy: record.reviewedBy,
    reviewedAt: record.reviewedAt,
  };
}

function manualCommentsFromRecord(row: {
  backOfficeComment: string | null;
  helpdeskComment: string | null;
  schoolServicesComment: string | null;
  financeComment: string | null;
  additionalComment: string | null;
}): ManualCommentsMap {
  return {
    backOfficeComment: row.backOfficeComment,
    helpdeskComment: row.helpdeskComment,
    schoolServicesComment: row.schoolServicesComment,
    financeComment: row.financeComment,
    additionalComment: row.additionalComment,
  };
}

function selectionItemsFromRecords(records: EvidenceSelectionRecord[]): EvidenceSelectionItem[] {
  return records.map((row) => ({
    evidenceId: row.evidenceId,
    artifactId: row.artifactId,
    sha256: row.sha256,
    page: row.page,
    region: row.region as EvidenceSelectionItem['region'],
    timestampStart: row.timestampStart,
    timestampEnd: row.timestampEnd,
    cell: row.cell,
    originalFilename: row.originalFilename,
    selectedAt: row.selectedAt,
  }));
}

// Mapeo de ids de campo del Dictamen (reporting) a celdas de la plantilla.
const FIELD_TO_CELL: Record<string, DictamenCellId> = {
  nombre: 'nombre',
  matricula: 'matricula',
  correo: 'correo',
  canal: 'canal',
  programa: 'programa',
  fechaCreacion: 'fechaCreacion',
  fechaDecision: 'fechaDecision',
  fechaInicioCiclo: 'fechaInicioCiclo',
  fechaSolicitudTicket: 'fechaSolicitudTicket',
  asignadoADictaminar: 'asignado',
  ultimaSesion: 'ultimaSesion',
  telefono: 'telefono',
  primerPago: 'primerPago',
  politicaAplica: 'politica',
  motivo: 'motivo',
  descripcion: 'descripcion',
  descripcionBackOffice: 'comentariosBO',
  descripcionHelpDesk: 'comentariosHelpDesk',
  descripcionSER: 'comentariosSER',
  descripcionFinanzas: 'comentariosFinanzas',
  dictamenAplicadoEl: 'dictamenAplicadoEl',
  dictamen: 'dictamen',
};

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export interface BuildSnapshotResult {
  snapshot: ReportSnapshotRecord;
  created: boolean;
}

/** Construye (o reutiliza) el snapshot DRAFT de la auditoria. Idempotente por fingerprint. */
export async function buildSnapshot(auth: AuthorizedContext): Promise<BuildSnapshotResult> {
  const run = await getLatestEngineRun(auth);
  if (!run) {
    const error = new Error('No existe corrida del motor para esta auditoria.');
    (error as Error & { code?: string }).code = 'ENGINE_RUN_NOT_FOUND';
    throw error;
  }

  const humanRepo = createHumanReviewRepository(auth.client.database);
  const commentsRepo = createAuditManualCommentsRepository(auth.client.database);
  const selectionRepo = createEvidenceSelectionRepository(auth.client.database);
  const snapshotRepo = createReportSnapshotRepository(auth.client.database);

  const [humanRecord, commentsRecord, selectionRecords] = await Promise.all([
    humanRepo.findByAudit(auth.auditId),
    commentsRepo.findByAudit(auth.auditId),
    selectionRepo.listByAudit(auth.auditId),
  ]);

  const machine = machineRefFromRun(run);
  const human = humanRecord ? humanDecisionFromRecord(humanRecord) : null;
  const manualComments = commentsRecord
    ? manualCommentsFromRecord(commentsRecord)
    : { backOfficeComment: null, helpdeskComment: null, schoolServicesComment: null, financeComment: null, additionalComment: null };
  const selectedEvidence = selectionItemsFromRecords(selectionRecords);
  const template = await loadDictamenTemplate();
  const ruleTrace = ruleTraceFromRun(run);

  const built = buildReportSnapshot({
    auditId: auth.auditId,
    factRunId: run.fact_run_id,
    engineRunId: run.id,
    policyCode: run.policy_code,
    policyVersion: run.policy_version,
    machine,
    human,
    manualComments,
    selectedEvidence,
    templateHash: template.sha256,
    ruleTrace,
  });
  if (!built.ok) {
    const error = new Error(built.message);
    (error as Error & { code?: string }).code = built.code;
    throw error;
  }

  const latest = await snapshotRepo.findLatestByAudit(auth.auditId);
  if (latest && latest.snapshotFingerprint === built.fingerprint) {
    return { snapshot: latest, created: false };
  }

  const created = await snapshotRepo.create({
    auditId: auth.auditId,
    factRunId: built.snapshot.factRunId,
    engineRunId: built.snapshot.engineRunId,
    policyCode: built.snapshot.policyCode,
    policyVersion: built.snapshot.policyVersion,
    snapshotFingerprint: built.fingerprint,
    machine: built.snapshot.machine as unknown as Record<string, unknown>,
    human: built.snapshot.human as unknown as Record<string, unknown> | null,
    manualComments: built.snapshot.manualComments as unknown as Record<string, unknown>,
    selectedEvidence: built.snapshot.selectedEvidence as unknown as Record<string, unknown>[],
    templateHash: built.snapshot.templateHash,
    ruleTrace: built.snapshot.ruleTrace as unknown as Record<string, unknown>,
    createdBy: auth.user.id,
  });

  await createAuditLogRepository(auth.client.database).record({
    auditId: auth.auditId,
    eventType: 'REPORT_SNAPSHOT_CREATED',
    actorId: auth.user.id,
    metadata: { snapshotId: created.id, fingerprint: built.fingerprint },
  });
  return { snapshot: created, created: true };
}

// ---------------------------------------------------------------------------
// Aprobacion (snapshot DRAFT -> FINAL)
// ---------------------------------------------------------------------------

/** Aprueba el snapshot DRAFT mas reciente. Solo con revisión humana registrada. */
export async function approveSnapshot(auth: AuthorizedContext): Promise<ReportSnapshotRecord> {
  const snapshotRepo = createReportSnapshotRepository(auth.client.database);
  const humanRepo = createHumanReviewRepository(auth.client.database);
  const auditLogRepo = createAuditLogRepository(auth.client.database);

  const snapshot = await snapshotRepo.findLatestByAudit(auth.auditId);
  if (!snapshot) {
    const error = new Error('Primero crea el snapshot.');
    (error as Error & { code?: string }).code = 'SNAPSHOT_NOT_FOUND';
    throw error;
  }
  if (snapshot.status === 'FINAL') return snapshot;

  const human = await humanRepo.findByAudit(auth.auditId);
  if (!human) {
    const error = new Error('Sin revisión humana registrada no se puede aprobar el dictamen.');
    (error as Error & { code?: string }).code = 'HUMAN_REVIEW_REQUIRED';
    throw error;
  }

  const approved = await snapshotRepo.markFinal(snapshot.id, auth.user.id);
  await auditLogRepo.record({
    auditId: auth.auditId,
    eventType: 'REPORT_SNAPSHOT_APPROVED',
    actorId: auth.user.id,
    metadata: { snapshotId: snapshot.id },
  });
  return approved;
}

// ---------------------------------------------------------------------------
// Render y documento
// ---------------------------------------------------------------------------

export interface GenerateResult {
  document: DictamenDocumentRecord;
  pdfSha256: string;
  storageKey: string;
  generated: boolean; // true = se re-renderizo, false = ya existia (idempotente)
}

function snapshotToTyped(snapshot: ReportSnapshotRecord): {
  machine: MachineDecisionRef;
  human: HumanReviewDecision | null;
  manualComments: ManualCommentsMap;
  selectedEvidence: EvidenceSelectionItem[];
  ruleTrace: RuleTraceRef;
} {
  return {
    machine: snapshot.machine as unknown as MachineDecisionRef,
    human: snapshot.human as unknown as HumanReviewDecision | null,
    manualComments: snapshot.manualComments as unknown as ManualCommentsMap,
    selectedEvidence: snapshot.selectedEvidence as unknown as EvidenceSelectionItem[],
    ruleTrace: snapshot.ruleTrace as unknown as RuleTraceRef,
  };
}

function dictamenStorageKey(input: { auditId: string; snapshotId: string; kind: 'DRAFT' | 'FINAL' }): string {
  return `dictamen/${input.auditId}/${input.snapshotId}/${input.kind.toLowerCase()}.pdf`;
}

async function generateDocumentInner(auth: AuthorizedContext, kind: 'DRAFT' | 'FINAL', snapshot: ReportSnapshotRecord) {
  const docRepo = createDictamenDocumentRepository(auth.client.database);
  const auditLogRepo = createAuditLogRepository(auth.client.database);
  const evidencesRepo = createEvidenceRepository(auth.client.database);
  const factRepo = createFactRepository(auth.client.database);
  const auditRepo = createAuditRepository(auth.client.database);

  const [template, audit, typed] = await Promise.all([
    loadDictamenTemplate(),
    auditRepo.findById(auth.auditId),
    Promise.resolve(snapshotToTyped(snapshot)),
  ]);
  if (!audit) throw new Error('Auditoria no encontrada.');

  const docFingerprint = computeDocumentFingerprint({
    auditId: auth.auditId,
    kind,
    snapshotFingerprint: snapshot.snapshotFingerprint,
    templateHash: snapshot.templateHash,
    policyCode: snapshot.policyCode,
    policyVersion: snapshot.policyVersion,
  });
  const existing = await docRepo.findForSnapshot(snapshot.id, kind);
  if (existing && existing.pdfSha256) return { document: existing, pdfSha256: existing.pdfSha256, storageKey: existing.storageKey, generated: false };

  // Facts del fact run congelado (no se reprocesa IA).
  const storedFacts = snapshot.factRunId ? await factRepo.listFactsByRun(snapshot.factRunId) : [];
  const evidenceRows = typed.selectedEvidence.length > 0 ? await evidencesRepo.listByAudit(auth.auditId) : [];
  const shaByEvidence = new Map(evidenceRows.map((e) => [e.id, e.sha256]));
  const fileNameByEvidence = new Map(evidenceRows.map((e) => [e.id, e.originalFilename ?? e.id]));

  const renderItems: RenderEvidenceItem[] = typed.selectedEvidence.map((item) => ({
    fileName: item.originalFilename ?? fileNameByEvidence.get(item.evidenceId) ?? item.evidenceId,
    sha256: item.sha256 ?? shaByEvidence.get(item.evidenceId) ?? '',
    page: item.page ?? null,
    note: item.cell ?? null,
  }));

  const entries = mapDictamenFields({
    facts: storedFacts.map((f) => ({ factType: f.factType, value: f.value })),
    audit: { createdAt: audit.createdAt },
    policyCode: snapshot.policyCode,
    policyVersion: snapshot.policyVersion,
    machineOutcome: typed.machine.machineOutcome,
    machineReason: typed.machine.machineReason,
    decisionStatus: typed.machine.machineDecisionStatus,
    humanDecision: typed.human,
    comments: mapManualCommentsForPdf(typed.manualComments, false),
    dictamenAppliedAt: kind === 'FINAL' ? snapshot.approvedAt : null,
  });
  const fields: Partial<Record<DictamenCellId, string | null>> = {};
  for (const entry of entries) {
    const cell = FIELD_TO_CELL[entry.id];
    if (cell) fields[cell] = entry.value;
  }

  const generatedAtIso = snapshot.approvedAt ?? snapshot.createdAt;
  const bytes = await renderDictamenPdf({
    templateBytes: template.bytes,
    kind,
    auditId: auth.auditId,
    docFingerprint,
    generatedAtIso,
    fields,
    selectedEvidence: renderItems,
  });

  const pdfSha256 = sha256Hex(bytes);
  const storageKey = dictamenStorageKey({ auditId: auth.auditId, snapshotId: snapshot.id, kind });

  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  const blob = new Blob([body], { type: 'application/pdf' });
  const upload = await auth.client.storage.from(REPORT_BUCKET).upload(storageKey, blob);
  if (upload.error) throw new Error(upload.error.message ?? 'No fue posible guardar el PDF en storage.');

  const document = await docRepo.createIfAbsent({
    snapshotId: snapshot.id,
    auditId: auth.auditId,
    kind,
    docFingerprint,
    pdfSha256,
    storageBucket: REPORT_BUCKET,
    storageKey,
    templateHash: template.sha256,
    generatedBy: auth.user.id,
    generatedAt: generatedAtIso,
  });
  if (!document) {
    throw new Error('Ya existe un documento FINAL distinto para este snapshot.');
  }

  await auditLogRepo.record({
    auditId: auth.auditId,
    eventType: kind === 'FINAL' ? 'DICTAMEN_FINAL_GENERATED' : 'DICTAMEN_DRAFT_GENERATED',
    actorId: auth.user.id,
    metadata: { snapshotId: snapshot.id, documentId: document.id, pdfSha256 },
  });
  return { document, pdfSha256, storageKey, generated: true };
}

export function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && (error as Error & { code?: string }).code === code;
}

/** Genera el DRAFT desde el snapshot DRAFT mas reciente. */
export async function generateDraft(auth: AuthorizedContext): Promise<GenerateResult> {
  const snapshotRepo = createReportSnapshotRepository(auth.client.database);
  const snapshot = await snapshotRepo.findLatestByAudit(auth.auditId);
  if (!snapshot) throw codeError('SNAPSHOT_NOT_FOUND', 'Primero crea el snapshot.');
  if (snapshot.status === 'FINAL') throw codeError('SNAPSHOT_ALREADY_FINAL', 'El snapshot ya esta aprobado; genera el documento FINAL.');
  return generateDocumentInner(auth, 'DRAFT', snapshot);
}

/** Genera el FINAL desde el snapshot aprobado (FINAL). Idempotente e inmutable. */
export async function generateFinal(auth: AuthorizedContext): Promise<GenerateResult> {
  const snapshotRepo = createReportSnapshotRepository(auth.client.database);
  const snapshot = await snapshotRepo.findLatestByAudit(auth.auditId);
  if (!snapshot) throw codeError('SNAPSHOT_NOT_FOUND', 'Primero crea y aprueba el snapshot.');
  if (snapshot.status !== 'FINAL') throw codeError('SNAPSHOT_NOT_APPROVED', 'El snapshot debe estar aprobado (FINAL) para generar el documento final.');
  return generateDocumentInner(auth, 'FINAL', snapshot);
}

function codeError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

// ---------------------------------------------------------------------------
// Revisión humana
// ---------------------------------------------------------------------------

export interface SubmitReviewResult {
  review: HumanReviewRecord;
}

/** Registra la revisión humana (APPROVE o CORRECT). CORRECT exige razon. */
export async function submitHumanReview(
  auth: AuthorizedContext,
  input: Omit<BuildHumanReviewInput, 'reviewedBy'>,
): Promise<SubmitReviewResult> {
  const run = await getLatestEngineRun(auth);
  if (!run) throw codeError('ENGINE_RUN_NOT_FOUND', 'No existe corrida del motor para revisar.');

  const built = buildHumanReview({
    ...input,
    reviewedBy: auth.user.id,
    machineOutcome: run.suggested_outcome,
    machineReason: ((run.evaluation ?? {}) as { suggestedReason?: string | null }).suggestedReason ?? null,
    machineDecisionStatus: ((run.evaluation ?? {}) as { decisionStatus?: string }).decisionStatus ?? run.outcome_status,
  });
  if (!built.ok) throw codeError(built.code, built.message);

  const repo = createHumanReviewRepository(auth.client.database);
  const machine = machineRefFromRun(run);
  const review = await repo.upsert({
    auditId: auth.auditId,
    machineDecision: machine as unknown as Record<string, unknown>,
    decisionType: built.decision.decisionType,
    humanOutcome: built.decision.humanOutcome,
    humanCause: built.decision.humanCause,
    humanReason: built.decision.humanReason,
    reviewedBy: auth.user.id,
    reviewedAt: built.decision.reviewedAt,
  });

  await createAuditLogRepository(auth.client.database).record({
    auditId: auth.auditId,
    eventType: 'HUMAN_REVIEW_SUBMITTED',
    actorId: auth.user.id,
    metadata: { decisionType: built.decision.decisionType, reviewId: review.id },
  });
  return { review };
}

// ---------------------------------------------------------------------------
// Selección de evidencia
// ---------------------------------------------------------------------------

export async function saveEvidenceSelection(
  auth: AuthorizedContext,
  items: EvidenceSelectionItem[],
): Promise<EvidenceSelectionRecord[]> {
  const repo = createEvidenceSelectionRepository(auth.client.database);
  const evidencesRepo = createEvidenceRepository(auth.client.database);
  const auditLogRepo = createAuditLogRepository(auth.client.database);

  const evidenceRows = await evidencesRepo.listByAudit(auth.auditId);
  const allowed = new Set(evidenceRows.map((e) => e.id));
  const shaByEvidence = new Map(evidenceRows.map((e) => [e.id, e.sha256]));
  const nameByEvidence = new Map(evidenceRows.map((e) => [e.id, e.originalFilename]));

  const validated = items.map((item) => {
    if (!allowed.has(item.evidenceId)) throw codeError('EVIDENCE_NOT_IN_AUDIT', `La evidencia ${item.evidenceId} no pertenece a esta auditoria.`);
    return {
      evidenceId: item.evidenceId,
      artifactId: item.artifactId ?? null,
      sha256: item.sha256 ?? shaByEvidence.get(item.evidenceId) ?? null,
      page: item.page ?? null,
      region: item.region != null ? (item.region as unknown as Record<string, unknown>) : null,
      timestampStart: item.timestampStart ?? null,
      timestampEnd: item.timestampEnd ?? null,
      cell: item.cell ?? null,
      originalFilename: item.originalFilename ?? nameByEvidence.get(item.evidenceId) ?? null,
    };
  });

  const saved = await repo.replaceForAudit(
    auth.auditId,
    validated.map((item) => ({
      evidenceId: item.evidenceId,
      artifactId: item.artifactId,
      sha256: item.sha256,
      page: item.page,
      region: item.region,
      timestampStart: item.timestampStart,
      timestampEnd: item.timestampEnd,
      cell: item.cell,
      originalFilename: item.originalFilename,
    })),
    auth.user.id,
  );

  await auditLogRepo.record({
    auditId: auth.auditId,
    eventType: 'EVIDENCE_SELECTION_UPDATED',
    actorId: auth.user.id,
    metadata: { count: saved.length },
  });
  return saved;
}

export async function listEvidenceSelection(auth: AuthorizedContext): Promise<EvidenceSelectionRecord[]> {
  return createEvidenceSelectionRepository(auth.client.database).listByAudit(auth.auditId);
}