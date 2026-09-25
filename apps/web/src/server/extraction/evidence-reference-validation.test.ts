import type { JobArtifact } from '@cancelaciones/db';
import type { FactProvenanceV1 } from '@cancelaciones/domain';
import type { ExtractionToolContext } from './contracts';
import { describe, expect, it } from 'vitest';
import {
  validateEvidenceReferences,
  validateExtractionArtifactInput,
  validateExtractionToolOutputReferences,
} from './evidence-reference-validation';

const reference: FactProvenanceV1 = {
  evidenceId: 'evidence-1',
  artifactId: 'artifact-1',
  artifactHash: 'artifact-hash-1',
  extractionMethod: 'DETERMINISTIC',
  extractorId: 'extract_dates',
  extractorVersion: '1.0.0',
};

const artifact: JobArtifact = {
  id: 'artifact-1',
  jobId: 'job-1',
  evidenceId: 'evidence-1',
  artifactType: 'document-text',
  result: {},
  contentSha256: 'artifact-hash-1',
  createdAt: '2026-09-25T00:00:00Z',
};

const evidence = {
  id: 'evidence-1',
  auditId: 'audit-1',
  sha256: 'evidence-hash-1',
  documentRole: 'EVIDENCE' as const,
};

const context: ExtractionToolContext = {
  auditId: 'audit-1',
  mode: 'SHADOW',
  evidences: [evidence],
  artifacts: [artifact],
  allowedEvidenceIds: ['evidence-1'],
};

describe('validateEvidenceReferences', () => {
  it('rechaza en runtime los modos PROD e inválido en las tres barreras', () => {
    for (const mode of ['PROD', 'LEGACY'] as const) {
      const invalidContext = { ...context, mode: mode as never };

      expect(() => validateEvidenceReferences({
        auditId: invalidContext.auditId,
        mode: invalidContext.mode,
        references: [],
        evidences: [...invalidContext.evidences],
        artifacts: [...invalidContext.artifacts],
        allowedEvidenceIds: invalidContext.allowedEvidenceIds,
      })).toThrow('EXTRACTION_CONTEXT_INVALID');
      expect(() => validateExtractionArtifactInput(artifact, invalidContext)).toThrow('EXTRACTION_CONTEXT_INVALID');
      expect(() => validateExtractionToolOutputReferences({ facts: [] }, invalidContext)).toThrow('EXTRACTION_CONTEXT_INVALID');
    }
  });

  it('rechaza referencias en blanco o fuera de la allowlist', () => {
    expect(validateEvidenceReferences({
      auditId: 'audit-1',
      mode: 'SHADOW',
      references: [{ ...reference, evidenceId: '' }],
      evidences: [evidence],
      artifacts: [artifact],
      allowedEvidenceIds: ['evidence-1'],
    })).toEqual([{ code: 'EVIDENCE_REFERENCE_INCOMPLETE', evidenceId: '' }]);

    expect(validateEvidenceReferences({
      auditId: 'audit-1',
      mode: 'SHADOW',
      references: [{ ...reference, evidenceId: 'evidence-2' }],
      evidences: [evidence],
      artifacts: [],
      allowedEvidenceIds: ['evidence-1'],
    })).toEqual([{ code: 'EVIDENCE_NOT_ALLOWED', evidenceId: 'evidence-2', artifactId: 'artifact-1' }]);
  });

  it('rechaza artifactHash sin artifactId y artifact incompletos', () => {
    expect(validateEvidenceReferences({
      auditId: 'audit-1',
      mode: 'SHADOW',
      references: [{ ...reference, artifactId: undefined }],
      evidences: [evidence],
      artifacts: [artifact],
      allowedEvidenceIds: ['evidence-1'],
    })).toEqual([{ code: 'EVIDENCE_REFERENCE_INCOMPLETE', evidenceId: 'evidence-1' }]);
  });

  it('rechaza un evidence ID inexistente', () => {
    expect(validateEvidenceReferences({ auditId: 'audit-1', mode: 'SHADOW', allowedEvidenceIds: ['evidence-1'], references: [reference], evidences: [], artifacts: [] })).toEqual([
      { code: 'EVIDENCE_NOT_FOUND', evidenceId: 'evidence-1', artifactId: 'artifact-1' },
    ]);
  });

  it('rechaza evidencia perteneciente a otra auditoría', () => {
    expect(validateEvidenceReferences({ auditId: 'audit-1', mode: 'SHADOW', allowedEvidenceIds: ['evidence-1'], references: [reference], evidences: [{ ...evidence, auditId: 'audit-2' }], artifacts: [artifact] })).toEqual([
      { code: 'EVIDENCE_AUDIT_MISMATCH', evidenceId: 'evidence-1', artifactId: 'artifact-1' },
    ]);
  });

  it('rechaza un hash de artifact distinto', () => {
    expect(validateEvidenceReferences({ auditId: 'audit-1', mode: 'SHADOW', allowedEvidenceIds: ['evidence-1'], references: [reference], evidences: [evidence], artifacts: [{ ...artifact, contentSha256: 'artifact-hash-2' }] })).toEqual([
      { code: 'EVIDENCE_HASH_MISMATCH', evidenceId: 'evidence-1', artifactId: 'artifact-1' },
    ]);
  });

  it('rechaza evidencia humana en modo blind', () => {
    expect(validateEvidenceReferences({ auditId: 'audit-1', mode: 'BLIND', allowedEvidenceIds: ['evidence-1'], references: [reference], evidences: [{ ...evidence, documentRole: 'HUMAN_DECISION_DOCUMENT' }], artifacts: [artifact] })).toEqual([
      { code: 'EVIDENCE_NOT_ALLOWED_BLIND', evidenceId: 'evidence-1', artifactId: 'artifact-1' },
    ]);
  });

  it('acepta una referencia permitida y consistente', () => {
    expect(validateEvidenceReferences({ auditId: 'audit-1', mode: 'BLIND', allowedEvidenceIds: ['evidence-1'], references: [reference], evidences: [evidence], artifacts: [artifact] })).toEqual([]);
  });
});
