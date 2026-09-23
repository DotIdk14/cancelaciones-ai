// Tipos compartidos para los componentes de la auditoria (Phase 7).
// Son proyecciones client-only de los datos que entregan las rutas API.

export type AuditStatus = 'DRAFT' | 'PROCESSING' | 'READY' | 'COMPLETED' | 'FAILED' | 'FROZEN' | 'REVIEW' | 'FINAL' | string;

export interface EvaluatedRule {
  ruleId: string;
  status: 'SATISFIED' | 'NOT_APPLICABLE' | 'UNKNOWN' | 'CONFLICTED' | 'BLOCKED' | string;
  source: { documentCode: string; version: string; section: string; page: number };
  conditions: Array<{ id: string; description: string; observedValue?: string; state: 'TRUE' | 'FALSE' | 'NOT_APPLICABLE' | 'UNKNOWN' | string }>;
}

export interface MissingItem {
  factType: string;
  whyNeeded: string;
}

export interface PolicyEvaluationShape {
  policyCode: string;
  policyVersion: string;
  suggestedOutcome: string | null;
  outcomeStatus: string;
  decisionStatus: string;
  reviewRequired: boolean;
  evaluatedRules: EvaluatedRule[];
  satisfiedRules: string[];
  unknownRules: string[];
  notApplicableRules: string[];
  missingData: MissingItem[];
  conflicts: unknown[];
  suggestedReason: string | null;
  decisiveRules: string[];
  supportingRules: string[];
  opposingRules: string[];
  missingEvidence: string[];
  missingFacts: string[];
}

export interface EvidenceRow {
  id: string;
  auditId: string;
  originalFilename: string;
  detectedMimeType: string;
  sizeBytes: number;
  sha256: string | null;
  status: 'PENDING' | 'STORED' | string;
}

export interface EvidenceSelectionRecord {
  id: string;
  evidenceId: string;
  artifactId: string | null;
  sha256: string | null;
  page: number | null;
  originalFilename: string | null;
  selectedAt: string;
}

export interface HumanReviewRecord {
  id: string;
  auditId: string;
  decisionType: 'APPROVE' | 'CORRECT';
  humanOutcome: string | null;
  humanCause: string | null;
  humanReason: string | null;
  reviewedBy: string;
  reviewedAt: string;
  machineDecision?: Record<string, unknown> | null;
}

export interface SnapshotRecord {
  id: string;
  auditId: string;
  status: 'DRAFT' | 'FINAL';
  snapshotFingerprint: string;
  policyCode: string;
  policyVersion: string;
  factRunId: string | null;
  engineRunId: string;
  templateHash: string;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  human?: HumanReviewRecord | Record<string, unknown> | null;
  selectedEvidence: EvidenceSelectionRecord[] | Record<string, unknown>[];
}

export interface DictamenDocumentRecord {
  id: string;
  snapshotId: string;
  auditId: string;
  kind: 'DRAFT' | 'FINAL';
  docFingerprint: string;
  pdfSha256: string;
  storageBucket: string;
  storageKey: string;
  templateHash: string;
  generatedBy: string;
  generatedAt: string;
}

export interface TimelineEvent {
  id: string;
  eventType: string;
  actorId: string | null;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
}