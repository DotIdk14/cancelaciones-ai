import type { JobArtifact } from '@cancelaciones/db';
import type { ExtractionToolContext } from '../contracts';
import { describe, expect, it } from 'vitest';
import { extractDatesTool } from './extract-dates';

const context: ExtractionToolContext = {
  auditId: 'audit-1',
  mode: 'SHADOW',
  evidences: [{ id: 'evidence-1', auditId: 'audit-1', sha256: 'evidence-hash-1', documentRole: 'EVIDENCE' }],
  artifacts: [{
    id: 'artifact-1',
    jobId: 'job-1',
    evidenceId: 'evidence-1',
    artifactType: 'document-text',
    result: {},
    contentSha256: 'artifact-hash-1',
    createdAt: '2026-09-25T00:00:00Z',
  }],
  allowedEvidenceIds: ['evidence-1'],
};

function artifact(extractedFacts: unknown[]): JobArtifact {
  return {
    id: 'artifact-1',
    jobId: 'job-1',
    evidenceId: 'evidence-1',
    artifactType: 'document-text',
    result: { text: 'La fecha visible es 25/09/2026', extractedFacts },
    contentSha256: 'artifact-hash-1',
    createdAt: '2026-09-25T00:00:00Z',
  };
}

describe('extract_dates', () => {
  it('reconoce exclusivamente fechas estructuradas con ISO parseable', async () => {
    const result = await extractDatesTool.execute({ artifact: artifact([
      { factType: 'evidence.date', value: '2026-09-25T10:00:00Z', confidence: 0.9 },
      { factType: 'date', value: '2026-09-26T10:00:00-05:00' },
      { factType: 'evidence.date', value: '2026-09-27' },
      { factType: 'date', value: '26/09/2026' },
      { factType: 'other.date', value: '2026-09-27T10:00:00Z' },
    ]) }, context);

    expect(result.facts).toHaveLength(3);
    expect(result.facts.map((fact) => fact.value)).toEqual(['2026-09-25T10:00:00Z', '2026-09-26T10:00:00-05:00', '2026-09-27']);
  });

  it('devuelve facts vacío cuando no hay fechas', async () => {
    await expect(extractDatesTool.execute({ artifact: artifact([]) }, context)).resolves.toEqual({ facts: [] });
  });

  it('rechaza artifact humano, de otra auditoría o fuera de allowlist antes de leer result', async () => {
    const invalidContexts: ExtractionToolContext[] = [
      {
        ...context,
        mode: 'BLIND',
        evidences: [{ ...context.evidences[0], documentRole: 'HUMAN_DECISION_DOCUMENT' }],
      },
      { ...context, evidences: [{ ...context.evidences[0], auditId: 'audit-2' }] },
      { ...context, allowedEvidenceIds: [] },
    ];

    for (const invalidContext of invalidContexts) {
      await expect(extractDatesTool.execute({ artifact: artifact([]) }, invalidContext)).rejects.toThrow('EXTRACTION_REFERENCE_INVALID');
    }
  });

  it('rechaza artifacts sin evidencia y hash completos', async () => {
    const incomplete = { ...artifact([]), evidenceId: null, contentSha256: null };
    await expect(extractDatesTool.execute({ artifact: incomplete }, context)).rejects.toThrow('EXTRACTION_REFERENCE_INCOMPLETE');
  });

  it('preserva provenance completa y metadata determinista', async () => {
    const result = await extractDatesTool.execute({ artifact: artifact([
      { factType: 'evidence.date', value: '2026-09-25T10:00:00Z', confidence: 0.9 },
    ]) }, context);

    expect(result.facts[0]).toEqual({
      factType: 'evidence.date',
      value: '2026-09-25T10:00:00Z',
      state: 'OBSERVED',
      confidence: 0.9,
      provenance: [{
        evidenceId: 'evidence-1',
        artifactId: 'artifact-1',
        artifactHash: 'artifact-hash-1',
        extractionMethod: 'DETERMINISTIC',
        extractorId: 'extract_dates',
        extractorVersion: '1.0.0',
        confidence: 0.9,
      }],
    });
    expect(extractDatesTool).toMatchObject({
      id: 'extract_dates',
      version: '1.0.0',
      inputSchemaVersion: '1.0.0',
      outputSchemaVersion: '1.0.0',
      deterministic: true,
    });
  });
});
