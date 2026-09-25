import { describe, expect, it } from 'vitest';
import { extractedFactSchema, extractionToolOutputSchema } from './contracts';

describe('extraction tool contracts', () => {
  it('acepta exclusivamente un contenedor de facts', () => {
    expect(extractionToolOutputSchema.safeParse({ facts: [] }).success).toBe(true);

    for (const forbidden of ['outcome', 'suggestedOutcome', 'decision', 'resolution', 'ruleId', 'matchedRule', 'policyDecision']) {
      expect(extractionToolOutputSchema.safeParse({ facts: [], [forbidden]: 'CANCELACION_VENTA' }).success).toBe(false);
    }
  });

  it('rechaza campos normativos anidados en values, arrays y records', () => {
    for (const value of [
      { nested: { decision: 'CANCELACION_VENTA' } },
      [{ outcome: 'CANCELACION_VENTA' }],
      [{ nested: { records: [{ policyDecision: 'APPLY' }] } }],
    ]) {
      expect(extractionToolOutputSchema.safeParse({
        facts: [{
          factType: 'evidence.date',
          value,
          state: 'UNKNOWN',
          provenance: [{
            evidenceId: 'evidence-1',
            artifactId: 'artifact-1',
            artifactHash: 'hash-1',
            extractionMethod: 'DETERMINISTIC',
            extractorId: 'extract_dates',
            extractorVersion: '1.0.0',
          }],
        }],
      }).success).toBe(false);
    }
  });

  it('exige provenance completa para cada fact', () => {
    expect(extractedFactSchema.safeParse({ factType: 'evidence.date', value: '2026-09-25T10:00:00Z', state: 'OBSERVED' }).success).toBe(false);
    expect(extractedFactSchema.safeParse({
      factType: 'evidence.date',
      state: 'OBSERVED',
      provenance: [{
        evidenceId: 'evidence-1',
        extractionMethod: 'DETERMINISTIC',
        extractorId: 'extract_dates',
        extractorVersion: '1.0.0',
      }],
    }).success).toBe(false);
    expect(extractedFactSchema.safeParse({
      factType: 'evidence.date',
      value: '2026-09-25T10:00:00Z',
      state: 'OBSERVED',
      provenance: [{
        evidenceId: 'evidence-1',
        artifactId: 'artifact-1',
        artifactHash: 'hash-1',
        extractionMethod: 'DETERMINISTIC',
        extractorId: 'extract_dates',
        extractorVersion: '1.0.0',
      }],
    }).success).toBe(true);
  });
});
