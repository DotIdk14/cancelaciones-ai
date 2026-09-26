// Tipos compartidos para los componentes de la auditoria (Phase 7).
// Son proyecciones client-only de los datos que entregan las rutas API.

export type AuditStatus = 'DRAFT' | 'PROCESSING' | 'READY' | 'COMPLETED' | 'FAILED' | 'FROZEN' | 'REVIEW' | 'FINAL' | string;

export interface EvidenceRow {
  id: string;
  auditId: string;
  originalFilename: string;
  detectedMimeType: string;
  sizeBytes: number;
  sha256: string | null;
  status: 'PENDING' | 'STORED' | string;
  documentRole?: 'EVIDENCE' | 'HUMAN_DECISION_DOCUMENT' | 'ADJUDICATION_EVIDENCE' | string;
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
