/** Navegación operativa derivada; no modifica el dictamen ni los estados guardados. */
export const CASE_BUCKETS = [
  { value: 'ALL', label: 'Todo' },
  { value: 'DRAFTS', label: 'Borradores' },
  { value: 'IN_PROGRESS', label: 'En curso' },
  { value: 'COMPLETED', label: 'Completados' },
  { value: 'ERRORS', label: 'Errores' },
] as const;

export const CASE_STAGES = [
  { value: 'PENDING_AUDIT', label: 'Por auditar', description: 'Expedientes con evidencias que necesitan una auditoría vigente.' },
  { value: 'PENDING_ADVISOR', label: 'Dictamen del Asesor', description: 'La auditoría vigente está lista y falta la decisión del Asesor.' },
  { value: 'PENDING_COORDINATOR', label: 'Cierre del Coordinador', description: 'El Asesor ya decidió; falta la aprobación o el cambio del Coordinador.' },
] as const;

export type CaseBucket = (typeof CASE_BUCKETS)[number]['value'];
export type CaseStage = (typeof CASE_STAGES)[number]['value'];
export type CaseBucketCounts = Record<CaseBucket | CaseStage, number>;

interface WorkflowSummary {
  status: string;
  evidenceCount: number;
  workflowState?: string;
  auditIsCurrent?: boolean | null;
  effectiveResolution?: { source: string } | null;
}

export function caseStageOf(row: WorkflowSummary): CaseStage | 'DRAFT' | 'FINALIZED' | 'ERROR' {
  // Un cierre humano persistido conserva su carácter terminal.
  if (row.workflowState === 'FINALIZED') return 'FINALIZED';
  if (row.evidenceCount === 0) return 'DRAFT';
  if (row.status === 'ERROR') return 'ERROR';
  if (row.workflowState === 'PENDING_COORDINATOR') return 'PENDING_COORDINATOR';
  if (row.auditIsCurrent !== false && row.effectiveResolution?.source === 'AI') return 'PENDING_ADVISOR';
  return 'PENDING_AUDIT';
}

export function matchesCaseBucket(row: WorkflowSummary, bucket: CaseBucket, canFinalizeAnyCase: boolean): boolean {
  const stage = caseStageOf(row);
  if (bucket === 'ALL') return true;
  if (bucket === 'DRAFTS') return stage === 'DRAFT';
  if (bucket === 'COMPLETED') return stage === 'FINALIZED';
  if (bucket === 'ERRORS') return stage === 'ERROR';
  return stage === 'PENDING_AUDIT' || stage === 'PENDING_ADVISOR'
    || (stage === 'PENDING_COORDINATOR' && canFinalizeAnyCase);
}

export function matchesCaseActorScope(bucket: CaseBucket, scope: { canReviewOwnCases: boolean; ownsCase: boolean; reviewedCase: boolean }): boolean {
  if (!scope.canReviewOwnCases || bucket === 'ALL' || bucket === 'DRAFTS') return true;
  return bucket === 'COMPLETED' ? scope.reviewedCase : scope.ownsCase;
}

export function caseProgressLabel(row: WorkflowSummary): string {
  const stage = caseStageOf(row);
  if (stage === 'DRAFT') return 'Borrador · sin evidencias';
  if (stage === 'FINALIZED') return 'Cerrado';
  if (stage === 'ERROR') return 'Error técnico';
  if (stage === 'PENDING_ADVISOR') return 'Pendiente del Asesor';
  if (stage === 'PENDING_COORDINATOR') return 'Pendiente del Coordinador';
  if (stage === 'PENDING_AUDIT' && row.status === 'AUDITING') return 'Auditoría en curso';
  return CASE_STAGES.find(item => item.value === stage)!.label;
}
