// @cancelaciones/reporting
// Logica pura de Phase 7: revision humana, snapshot, fingerprints, seleccion de
// evidencia, mapeo de comentarios y campos del Dictamen.
// Pura, determinista y desacoplada de React, Next.js, InsForge, filesystem y HTTP.
import { createHash } from 'node:crypto';
import { stableFingerprint } from '@cancelaciones/domain';

// ---------------------------------------------------------------------------
// Hashes
// ---------------------------------------------------------------------------

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function sha256HexBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Fingerprint determinista de un valor estructurado (JSON canónico + sha256). */
export function contentHash(value: unknown): string {
  return sha256Hex(stableFingerprint(value));
}

// ---------------------------------------------------------------------------
// Machine Decision (inmutable)
// ---------------------------------------------------------------------------

export interface MachineDecisionRef {
  engineRunId: string;
  machineOutcome: string | null;
  machineReason: string | null;
  machineDecisionStatus: string;
  factsFingerprint: string;
  rulesFingerprint: string;
}

export interface MachineDecisionRefInput {
  engineRunId: string;
  factRunId?: string | null;
  machineOutcome?: string | null;
  machineReason?: string | null;
  machineDecisionStatus?: string | null;
  factsFingerprint?: string | null;
  rulesFingerprint?: string | null;
}

/** Extrae solo los campos inmutables de la decision de maquina. */
export function freezeMachineDecision(input: MachineDecisionRefInput): MachineDecisionRef {
  if (!input.engineRunId) throw new Error('engineRunId es obligatorio para congelar la decision de maquina.');
  return {
    engineRunId: input.engineRunId,
    machineOutcome: input.machineOutcome ?? null,
    machineReason: input.machineReason ?? null,
    machineDecisionStatus: input.machineDecisionStatus ?? 'UNKNOWN',
    factsFingerprint: input.factsFingerprint ?? '',
    rulesFingerprint: input.rulesFingerprint ?? '',
  };
}

/** Compara dos decisiones de maquina; la correccion humana no debe alterarlas. */
export function assertMachineUnchanged(original: MachineDecisionRef, current: MachineDecisionRef): boolean {
  return (
    original.engineRunId === current.engineRunId &&
    original.machineOutcome === current.machineOutcome &&
    original.machineReason === current.machineReason &&
    original.machineDecisionStatus === current.machineDecisionStatus &&
    original.factsFingerprint === current.factsFingerprint &&
    original.rulesFingerprint === current.rulesFingerprint
  );
}

// ---------------------------------------------------------------------------
// Human Review
// ---------------------------------------------------------------------------

export type HumanDecisionType = 'APPROVE' | 'CORRECT';

export interface HumanReviewDecision {
  decisionType: HumanDecisionType;
  humanOutcome: string | null;
  humanCause: string | null;
  humanReason: string | null;
  reviewedBy: string;
  reviewedAt: string;
}

export interface BuildHumanReviewInput {
  decisionType: HumanDecisionType;
  machineOutcome?: string | null;
  machineReason?: string | null;
  machineDecisionStatus?: string | null;
  humanOutcome?: string | null;
  humanCause?: string | null;
  humanReason?: string | null;
  reviewedBy: string;
  reviewedAt?: string;
}

export type BuildHumanReviewResult =
  | { ok: true; decision: HumanReviewDecision }
  | { ok: false; code: string; message: string };

export function buildHumanReview(input: BuildHumanReviewInput): BuildHumanReviewResult {
  if (input.decisionType !== 'APPROVE' && input.decisionType !== 'CORRECT') {
    return { ok: false, code: 'INVALID_DECISION_TYPE', message: 'decisionType debe ser APPROVE o CORRECT.' };
  }
  if (!input.reviewedBy) {
    return { ok: false, code: 'MISSING_REVIEWED_BY', message: 'reviewedBy es obligatorio.' };
  }

  const normalizedOutcome = (value: string | null | undefined): string | null => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed.length > 0 ? trimmed : null;
  };

  if (input.decisionType === 'APPROVE') {
    const machineOutcome = normalizedOutcome(input.machineOutcome);
    return {
      ok: true,
      decision: {
        decisionType: 'APPROVE',
        humanOutcome: machineOutcome,
        humanCause: normalizedOutcome(input.humanCause),
        humanReason: normalizedOutcome(input.humanReason),
        reviewedBy: input.reviewedBy,
        reviewedAt: input.reviewedAt ?? new Date().toISOString(),
      },
    };
  }

  const humanOutcome = normalizedOutcome(input.humanOutcome);
  const humanReason = normalizedOutcome(input.humanReason);
  if (!humanOutcome) {
    return { ok: false, code: 'MISSING_HUMAN_OUTCOME', message: 'Para corregir el resultado, humanOutcome es obligatorio.' };
  }
  if (!humanReason) {
    return { ok: false, code: 'MISSING_HUMAN_REASON', message: 'Para corregir el resultado, humanReason es obligatorio.' };
  }
  return {
    ok: true,
    decision: {
      decisionType: 'CORRECT',
      humanOutcome,
      humanCause: normalizedOutcome(input.humanCause),
      humanReason,
      reviewedBy: input.reviewedBy,
      reviewedAt: input.reviewedAt ?? new Date().toISOString(),
    },
  };
}

export function isHumanApproval(decision: HumanReviewDecision | null | undefined): boolean {
  return Boolean(decision && decision.decisionType === 'APPROVE');
}

// ---------------------------------------------------------------------------
// Manual Area Comments (mapeo a Dictamen)
// ---------------------------------------------------------------------------

export interface ManualCommentsMap {
  backOfficeComment: string | null;
  helpdeskComment: string | null;
  schoolServicesComment: string | null;
  financeComment: string | null;
  additionalComment: string | null;
}

export type DictamenCommentFieldId = 'back_office' | 'helpdesk' | 'school_services' | 'finance' | 'additional';

export interface DictamenCommentField {
  id: DictamenCommentFieldId;
  label: string;
  value: string | null;
}

/**
 * Mapeo obligatorio de comentarios manuales al Dictamen.
 * `additional_comment` NUNCA se inserta automaticamente: requiere includeAdditional.
 */
export function mapManualCommentsForPdf(
  comments: Partial<ManualCommentsMap> | null | undefined,
  includeAdditional: boolean,
): DictamenCommentField[] {
  const trim = (value: string | null | undefined): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const fields: DictamenCommentField[] = [
    { id: 'back_office', label: 'Comentarios BO', value: trim(comments?.backOfficeComment) },
    { id: 'helpdesk', label: 'Comentarios HelpDesk', value: trim(comments?.helpdeskComment) },
    { id: 'school_services', label: 'Comentarios SER', value: trim(comments?.schoolServicesComment) },
    { id: 'finance', label: 'Comentarios Finanzas', value: trim(comments?.financeComment) },
  ];
  if (includeAdditional) {
    fields.push({ id: 'additional', label: 'Comentarios adicionales', value: trim(comments?.additionalComment) });
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Evidence Selection (provenance preservada)
// ---------------------------------------------------------------------------

export interface EvidenceRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EvidenceSelectionItem {
  evidenceId: string;
  artifactId?: string | null;
  sha256?: string | null;
  page?: number | null;
  region?: EvidenceRegion | null;
  timestampStart?: number | null;
  timestampEnd?: number | null;
  cell?: string | null;
  originalFilename?: string | null;
  /** No participa en fingerprints (es metadata de persistencia). */
  selectedAt?: string | null;
}

export function validateEvidenceSelection(
  item: EvidenceSelectionItem,
  allowedEvidenceIds: Set<string>,
): { ok: true; item: EvidenceSelectionItem } | { ok: false; code: string; message: string } {
  if (!item.evidenceId) return { ok: false, code: 'MISSING_EVIDENCE_ID', message: 'evidenceId es obligatorio.' };
  if (!allowedEvidenceIds.has(item.evidenceId)) {
    return { ok: false, code: 'EVIDENCE_NOT_IN_AUDIT', message: 'La evidencia no pertenece a esta auditoria.' };
  }
  return { ok: true, item };
}

// ---------------------------------------------------------------------------
// Rule trace
// ---------------------------------------------------------------------------

export interface RuleTraceRef {
  ruleIds: string[];
  factIds: string[];
  evidenceRefs: Array<{ evidenceId: string; artifactId?: string | null; sha256?: string | null }>;
  suggestedOutcome: string | null;
  decisionStatus: string;
}

export interface TraceEvidenceInput {
  evidenceId?: string;
  artifactId?: string | null;
  sha256?: string | null;
}

export function buildRuleTraceRef(input: {
  ruleIds?: string[];
  factIds?: string[];
  evidenceRefs?: TraceEvidenceInput[];
  suggestedOutcome?: string | null;
  decisionStatus?: string;
}): RuleTraceRef {
  return {
    ruleIds: input.ruleIds ?? [],
    factIds: input.factIds ?? [],
    evidenceRefs: (input.evidenceRefs ?? [])
      .filter((ref): ref is TraceEvidenceInput & { evidenceId: string } => Boolean(ref?.evidenceId))
      .map((ref) => ({ evidenceId: ref.evidenceId, artifactId: ref.artifactId ?? null, sha256: ref.sha256 ?? null })),
    suggestedOutcome: input.suggestedOutcome ?? null,
    decisionStatus: input.decisionStatus ?? 'UNKNOWN',
  };
}

// ---------------------------------------------------------------------------
// Report Snapshot (congela el contenido del documento)
// ---------------------------------------------------------------------------

export interface ReportSnapshotFields {
  auditId: string;
  factRunId: string | null;
  engineRunId: string;
  policyCode: string;
  policyVersion: string;
  machine: MachineDecisionRef;
  human: HumanReviewDecision | null;
  manualComments: ManualCommentsMap;
  selectedEvidence: EvidenceSelectionItem[];
  templateHash: string;
  ruleTrace: RuleTraceRef;
}

export type BuildSnapshotResult =
  | { ok: true; snapshot: ReportSnapshotFields; fingerprint: string }
  | { ok: false; code: string; message: string };

export function buildReportSnapshot(input: ReportSnapshotFields): BuildSnapshotResult {
  if (!input.auditId) return { ok: false, code: 'MISSING_AUDIT_ID', message: 'auditId es obligatorio.' };
  if (!input.engineRunId) return { ok: false, code: 'MISSING_ENGINE_RUN_ID', message: 'engineRunId es obligatorio.' };
  if (!input.policyCode || !input.policyVersion) {
    return { ok: false, code: 'MISSING_POLICY', message: 'policyCode y policyVersion son obligatorios.' };
  }
  if (!input.templateHash) return { ok: false, code: 'MISSING_TEMPLATE_HASH', message: 'templateHash es obligatorio.' };
  const fingerprint = computeSnapshotFingerprint(input);
  return { ok: true, snapshot: input, fingerprint };
}

/** El fingerprint NUNCA incluye timestamps ni metadata de persistencia. */
export function computeSnapshotFingerprint(input: ReportSnapshotFields): string {
  const content = {
    auditId: input.auditId,
    factRunId: input.factRunId,
    engineRunId: input.engineRunId,
    policyCode: input.policyCode,
    policyVersion: input.policyVersion,
    machine: input.machine,
    human: input.human,
    manualComments: input.manualComments,
    selectedEvidence: input.selectedEvidence.map((item) => ({
      evidenceId: item.evidenceId,
      artifactId: item.artifactId ?? null,
      sha256: item.sha256 ?? null,
      page: item.page ?? null,
      region: item.region ?? null,
      timestampStart: item.timestampStart ?? null,
      timestampEnd: item.timestampEnd ?? null,
      cell: item.cell ?? null,
      originalFilename: item.originalFilename ?? null,
    })),
    templateHash: input.templateHash,
    ruleTrace: input.ruleTrace,
  };
  return contentHash(content);
}

// ---------------------------------------------------------------------------
// Campos del Dictamen (mapeo desde data disponible; nunca inventar ausentes)
// ---------------------------------------------------------------------------

export const DICTAMEN_FIELD_LABELS = {
  nombre: 'Nombre',
  matricula: 'Matrícula',
  correo: 'Correo',
  canal: 'Canal',
  programa: 'Programa',
  fechaCreacion: 'Fecha de creación',
  fechaDecision: 'Fecha Decisión',
  fechaInicioCiclo: 'Fecha de inicio de ciclo',
  fechaSolicitudTicket: 'Fecha solicitud de ticket',
  asignadoADictaminar: 'Asignado a Dictaminar',
  ultimaSesion: 'Última sesión',
  telefono: 'Teléfono',
  primerPago: 'Primer pago',
  politicaAplica: 'Política aplica/solicitada',
  motivo: 'Motivo',
  descripcion: 'Descripción',
  descripcionBackOffice: 'Comentarios BO',
  descripcionHelpDesk: 'Comentarios HelpDesk',
  descripcionSER: 'Comentarios SER',
  descripcionFinanzas: 'Comentarios Finanzas',
  dictamenAplicadoEl: 'Dictamen aplicado el',
  dictamen: 'Dictamen',
} as const;

export type DictamenFieldId = keyof typeof DICTAMEN_FIELD_LABELS;

export interface DictamenFieldEntry {
  id: DictamenFieldId;
  label: string;
  value: string;
}

export interface DictamenDataFact {
  factType: string;
  value: unknown;
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number') return String(value);
  return null;
}

function dateTimeValue(value: unknown): string | null {
  const raw = stringValue(value);
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export interface MapDictamenFieldsInput {
  facts?: DictamenDataFact[];
  audit?: { createdAt?: string; externalCaseId?: string | null } | null;
  policyCode?: string;
  policyVersion?: string;
  machineOutcome?: string | null;
  machineReason?: string | null;
  decisionStatus?: string;
  humanDecision?: HumanReviewDecision | null;
  comments?: DictamenCommentField[];
  dictamenAppliedAt?: string | null;
}

/** Construye el texto del campo Dictamen a partir de la decision de maquina y humana. */
export function buildDictamenText(input: {
  machineOutcome?: string | null;
  machineReason?: string | null;
  decisionStatus?: string;
  humanDecision?: HumanReviewDecision | null;
}): string {
  const machine = input.machineOutcome ?? 'Sin resultado sugerible';
  if (!input.humanDecision) {
    return `Resultado sugerido: ${machine}. Pendiente de revisión humana.`;
  }
  if (input.humanDecision.decisionType === 'APPROVE') {
    return `Se confirma el resultado sugerido: ${machine}.${input.machineReason ? ` ${input.machineReason}` : ''}`;
  }
  const parts = [`Se corrige el resultado sugerido: ${machine} -> ${input.humanDecision.humanOutcome ?? 'n/a'}.`];
  if (input.humanDecision.humanReason) parts.push(`Motivo: ${input.humanDecision.humanReason}.`);
  return parts.join(' ');
}

export function mapDictamenFields(input: MapDictamenFieldsInput): DictamenFieldEntry[] {
  const facts = input.facts ?? [];
  const byType = new Map<string, unknown>();
  for (const fact of facts) {
    if (!fact?.factType) continue;
    const existing = byType.get(fact.factType);
    if (existing === undefined) byType.set(fact.factType, fact.value);
  }
  const get = (type: string): string | null => stringValue(byType.get(type));

  const entries: DictamenFieldEntry[] = [];
  const push = (id: DictamenFieldId, value: string | null | undefined) => {
    const trimmed = typeof value === 'string' ? value.trim() : null;
    if (trimmed && trimmed.length > 0) entries.push({ id, label: DICTAMEN_FIELD_LABELS[id], value: trimmed });
  };

  push('nombre', get('student.identity.name') ?? get('student.name'));
  push('matricula', get('student.identity.enrollmentId') ?? get('student.enrollment'));
  push('correo', get('student.email'));
  push('canal', get('sale.channel'));
  push('programa', get('student.program'));
  push('fechaCreacion', input.audit?.createdAt ? dateTimeValue(input.audit.createdAt) : null);
  push('fechaDecision', dateTimeValue(get('decision.decisionDate')));
  push('fechaInicioCiclo', dateTimeValue(get('student.startDate')));
  push('fechaSolicitudTicket', dateTimeValue(get('audit.ticketRequestDate')));
  push('asignadoADictaminar', get('audit.assignedTo'));
  push('ultimaSesion', dateTimeValue(get('academic.lastCourseAccess')));
  push('telefono', get('student.phone'));
  push('primerPago', dateTimeValue(get('finance.firstPaymentDate')));
  push('politicaAplica', input.policyCode ? `${input.policyCode} V${input.policyVersion ?? ''}`.trim() : null);
  push('motivo', get('audit.reason') ?? get('student.requestedNotContinueReason'));
  push('descripcion', get('audit.description'));

  for (const comment of input.comments ?? []) {
    if (comment.id === 'additional') continue;
    const target: DictamenFieldId =
      comment.id === 'back_office' ? 'descripcionBackOffice'
      : comment.id === 'helpdesk' ? 'descripcionHelpDesk'
      : comment.id === 'school_services' ? 'descripcionSER'
      : comment.id === 'finance' ? 'descripcionFinanzas'
      : 'descripcion';
    if (comment.value) push(target, comment.value);
  }

  push('dictamenAplicadoEl', input.dictamenAppliedAt ?? null);
  push('dictamen', buildDictamenText({
    machineOutcome: input.machineOutcome,
    machineReason: input.machineReason,
    decisionStatus: input.decisionStatus,
    humanDecision: input.humanDecision,
  }));

  return entries;
}

// ---------------------------------------------------------------------------
// Idempotencia de documento
// ---------------------------------------------------------------------------

export interface DictamenDocumentFingerprintInput {
  auditId: string;
  kind: 'DRAFT' | 'FINAL';
  snapshotFingerprint: string;
  templateHash: string;
  policyCode: string;
  policyVersion: string;
}

/** Fingerprint determinista del documento: mismo snapshot aprobado -> mismo final. */
export function computeDocumentFingerprint(input: DictamenDocumentFingerprintInput): string {
  return contentHash({
    auditId: input.auditId,
    kind: input.kind,
    snapshotFingerprint: input.snapshotFingerprint,
    templateHash: input.templateHash,
    policyCode: input.policyCode,
    policyVersion: input.policyVersion,
  });
}