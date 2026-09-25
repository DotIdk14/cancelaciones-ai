import type { JobArtifact } from '@cancelaciones/db';
import type { ExtractionToolContext } from '../contracts';
import { describe, expect, it } from 'vitest';
import { extractContactAttemptsTool } from './extract-contact-attempts';

const context: ExtractionToolContext = {
  auditId: 'audit-1',
  mode: 'SHADOW',
  evidences: [{ id: 'evidence-1', auditId: 'audit-1', sha256: 'evidence-hash-1', documentRole: 'EVIDENCE' }],
  artifacts: [{
    id: 'artifact-1',
    jobId: 'job-1',
    evidenceId: 'evidence-1',
    artifactType: 'visual-transcription',
    result: {},
    contentSha256: 'artifact-hash-1',
    createdAt: '2026-09-25T00:00:00Z',
  }],
  allowedEvidenceIds: ['evidence-1'],
};

function artifact(extractedFacts: unknown[], text = ''): JobArtifact {
  return {
    id: 'artifact-1',
    jobId: 'job-1',
    evidenceId: 'evidence-1',
    artifactType: 'visual-transcription',
    result: { text, extractedFacts },
    contentSha256: 'artifact-hash-1',
    createdAt: '2026-09-25T00:00:00Z',
  };
}

describe('extract_contact_attempts', () => {
  it('reutiliza la extracción determinista y filtra sólo contacts permitidos', async () => {
    const result = await extractContactAttemptsTool.execute({ artifact: artifact([
      { factType: 'contact.callAttempts', value: { sourceCompleteness: 'PARTIAL', events: [{ channel: 'CALL', dateTime: '2026-09-25T10:00:00Z' }] } },
      { factType: 'contact.writtenInteractions', value: { sourceCompleteness: 'UNKNOWN', events: [] } },
      { factType: 'contact.effectiveContact', value: true },
    ]) }, context);

    expect(result.facts.map((fact) => fact.factType)).toEqual(['contact.callAttempts', 'contact.writtenInteractions']);
    expect(result.facts[0].value).toMatchObject({ events: [{ kind: 'CALL', occurredAt: '2026-09-25T10:00:00Z' }], sourceCompleteness: 'PARTIAL' });
    expect(result.facts[1].value).toMatchObject({ events: [], sourceCompleteness: 'UNKNOWN' });
    expect(JSON.stringify(result)).not.toContain('contact.effectiveContact');
  });

  it('rechaza artifacts sin evidencia y hash completos', async () => {
    const incomplete = { ...artifact([]), evidenceId: null, contentSha256: null };
    await expect(extractContactAttemptsTool.execute({ artifact: incomplete }, context)).rejects.toThrow('EXTRACTION_REFERENCE_INCOMPLETE');
  });

  it('mapea cada source a FactProvenanceV1 completa', async () => {
    const result = await extractContactAttemptsTool.execute({ artifact: artifact([]) }, context);

    expect(result.facts[0]).toEqual({
      factType: 'contact.callAttempts',
      value: expect.objectContaining({ events: [] }),
      state: 'UNKNOWN',
      confidence: 0.85,
      provenance: [{
        evidenceId: 'evidence-1',
        artifactId: 'artifact-1',
        artifactHash: 'artifact-hash-1',
        extractionMethod: 'DETERMINISTIC',
        extractorId: 'extract_contact_attempts',
        extractorVersion: '1.0.0',
        confidence: 0.85,
      }],
    });
  });

  it('conserva COMPLETE sólo cuando hay un count observado', async () => {
    const result = await extractContactAttemptsTool.execute({ artifact: artifact([
      { factType: 'contact.callAttempts', value: { sourceCompleteness: 'COMPLETE', events: [], observedCount: 0 } },
    ]) }, context);

    expect(result.facts[0].state).toBe('OBSERVED');
    expect(result.facts[0].value).toMatchObject({ events: [], observedCount: 0, sourceCompleteness: 'COMPLETE' });
  });

  it('falla si el contexto no permite la evidencia de la referencia', async () => {
    await expect(extractContactAttemptsTool.execute({ artifact: artifact([]) }, {
      ...context,
      allowedEvidenceIds: [],
    })).rejects.toThrow('EXTRACTION_REFERENCE_INVALID');
  });

  it('rechaza artifact humano o de otra auditoría antes de leer result', async () => {
    const invalidContexts: ExtractionToolContext[] = [
      {
        ...context,
        mode: 'BLIND',
        evidences: [{ ...context.evidences[0], documentRole: 'HUMAN_DECISION_DOCUMENT' }],
      },
      { ...context, evidences: [{ ...context.evidences[0], auditId: 'audit-2' }] },
    ];

    for (const invalidContext of invalidContexts) {
      await expect(extractContactAttemptsTool.execute({ artifact: artifact([]) }, invalidContext)).rejects.toThrow('EXTRACTION_REFERENCE_INVALID');
    }
  });

  it('reutiliza el fallback de texto del extractor existente', async () => {
    const result = await extractContactAttemptsTool.execute({ artifact: artifact([], 'CALL 2026-09-25') }, context);
    const calls = result.facts.find((fact) => fact.factType === 'contact.callAttempts')?.value as { events: Array<{ kind: string; occurredAt: string }> };
    expect(calls.events).toEqual([{ id: 'attempt-1', kind: 'CALL', occurredAt: '2026-09-25T12:00:00.000Z', successful: false, evidenceRefs: [{ evidenceId: 'evidence-1', artifactId: 'artifact-1', sha256: 'artifact-hash-1' }], confidence: 0.65 }]);
  });

  it('no emite outcomes, decisions ni ruleIds', async () => {
    const result = await extractContactAttemptsTool.execute({ artifact: artifact([]) }, context);
    expect(Object.keys(result)).toEqual(['facts']);
    expect(Object.keys(result.facts[0])).toEqual(['factType', 'value', 'state', 'confidence', 'provenance']);
  });
});
