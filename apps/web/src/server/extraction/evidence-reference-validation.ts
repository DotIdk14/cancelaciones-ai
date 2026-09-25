import type { JobArtifact } from '@cancelaciones/db';
import type { DocumentRole, ExtractionToolOutputV1, FactProvenanceV1 } from '@cancelaciones/domain';
import type { ExtractionToolContext } from './contracts';

export type EvidenceReferenceErrorCode =
  | 'EVIDENCE_REFERENCE_INCOMPLETE'
  | 'EVIDENCE_NOT_FOUND'
  | 'EVIDENCE_AUDIT_MISMATCH'
  | 'EVIDENCE_HASH_MISMATCH'
  | 'EVIDENCE_NOT_ALLOWED'
  | 'EVIDENCE_NOT_ALLOWED_BLIND';

export interface EvidenceReferenceError {
  code: EvidenceReferenceErrorCode;
  evidenceId: string;
  artifactId?: string;
}

export interface EvidenceReferenceEvidence {
  id: string;
  auditId: string;
  sha256: string;
  documentRole: DocumentRole;
}

export interface ValidateEvidenceReferencesInput {
  auditId: string;
  mode: 'SHADOW' | 'BLIND';
  references: FactProvenanceV1[];
  evidences: EvidenceReferenceEvidence[];
  artifacts: JobArtifact[];
  allowedEvidenceIds: readonly string[];
}

function referenceError(code: EvidenceReferenceErrorCode, evidenceId: string, artifactId?: string): EvidenceReferenceError {
  return artifactId ? { code, evidenceId, artifactId } : { code, evidenceId };
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}

export function validateExtractionMode(mode: unknown): asserts mode is 'SHADOW' | 'BLIND' {
  if (mode !== 'SHADOW' && mode !== 'BLIND') {
    throw new Error('EXTRACTION_CONTEXT_INVALID');
  }
}

export function validateEvidenceReferences(input: ValidateEvidenceReferencesInput): EvidenceReferenceError[] {
  validateExtractionMode(input.mode);
  const evidenceById = new Map(input.evidences.map((evidence) => [evidence.id, evidence]));
  const artifactById = new Map(input.artifacts.map((artifact) => [artifact.id, artifact]));
  const allowedEvidenceIds = new Set(input.allowedEvidenceIds);
  const errors: EvidenceReferenceError[] = [];

  for (const reference of input.references) {
    if (isBlank(reference.evidenceId)) {
      errors.push(referenceError('EVIDENCE_REFERENCE_INCOMPLETE', reference.evidenceId));
      continue;
    }

    if (reference.artifactHash !== undefined && isBlank(reference.artifactId)) {
      errors.push(referenceError('EVIDENCE_REFERENCE_INCOMPLETE', reference.evidenceId));
      continue;
    }

    if (reference.artifactId !== undefined && (isBlank(reference.artifactId) || isBlank(reference.artifactHash))) {
      errors.push(referenceError('EVIDENCE_REFERENCE_INCOMPLETE', reference.evidenceId));
      continue;
    }

    if (!allowedEvidenceIds.has(reference.evidenceId)) {
      errors.push(referenceError('EVIDENCE_NOT_ALLOWED', reference.evidenceId, reference.artifactId));
      continue;
    }

    const evidence = evidenceById.get(reference.evidenceId);
    const artifact = reference.artifactId ? artifactById.get(reference.artifactId) : undefined;

    if (!evidence || (reference.artifactId && (!artifact || artifact.evidenceId !== reference.evidenceId))) {
      errors.push(referenceError('EVIDENCE_NOT_FOUND', reference.evidenceId, reference.artifactId));
      continue;
    }

    if (evidence.auditId !== input.auditId) {
      errors.push(referenceError('EVIDENCE_AUDIT_MISMATCH', reference.evidenceId, reference.artifactId));
      continue;
    }

    if (input.mode === 'BLIND' && evidence.documentRole !== 'EVIDENCE') {
      errors.push(referenceError('EVIDENCE_NOT_ALLOWED_BLIND', reference.evidenceId, reference.artifactId));
      continue;
    }

    if (reference.artifactId && (!artifact?.contentSha256 || reference.artifactHash !== artifact.contentSha256)) {
      errors.push(referenceError('EVIDENCE_HASH_MISMATCH', reference.evidenceId, reference.artifactId));
    }
  }

  return errors;
}

export function validateExtractionArtifactInput(artifact: JobArtifact, context: ExtractionToolContext): void {
  validateExtractionMode(context.mode);
  if (
    !artifact
    || typeof artifact !== 'object'
    || typeof artifact.id !== 'string'
    || artifact.id.trim().length === 0
    || typeof artifact.evidenceId !== 'string'
    || artifact.evidenceId.trim().length === 0
    || typeof artifact.contentSha256 !== 'string'
    || artifact.contentSha256.trim().length === 0
  ) {
    throw new Error('EXTRACTION_REFERENCE_INCOMPLETE');
  }

  const errors = validateEvidenceReferences({
    auditId: context.auditId,
    mode: context.mode,
    references: [{
      evidenceId: artifact.evidenceId,
      artifactId: artifact.id,
      artifactHash: artifact.contentSha256,
      extractionMethod: 'DETERMINISTIC',
      extractorId: 'artifact_input',
      extractorVersion: '1.0.0',
    }],
    evidences: [...context.evidences],
    artifacts: [...context.artifacts],
    allowedEvidenceIds: context.allowedEvidenceIds,
  });

  if (errors.length > 0) throw new Error('EXTRACTION_REFERENCE_INVALID');
}

export function validateExtractionToolOutputReferences(output: ExtractionToolOutputV1, context: ExtractionToolContext): void {
  validateExtractionMode(context.mode);
  const references = output.facts.flatMap((fact) => fact.provenance);
  const errors = validateEvidenceReferences({
    auditId: context.auditId,
    mode: context.mode,
    references,
    evidences: [...context.evidences],
    artifacts: [...context.artifacts],
    allowedEvidenceIds: context.allowedEvidenceIds,
  });

  if (errors.length > 0) throw new Error('EXTRACTION_REFERENCE_INVALID');
}
