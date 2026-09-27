import { describe, expect, it } from 'vitest';

import {
  candidateToFact,
  validateCanonicalFactCandidate,
  type CanonicalFactCandidate,
} from '../index';

const base = {
  evidenceId: 'ev-1',
  artifactId: 'art-1',
  artifactHash: 'a'.repeat(64),
  extractionMethod: 'LLM',
  extractionConfidence: 0.82,
  extractorId: 'test-extractor',
  extractorVersion: '1.0.0',
  sourceText: 'CONTACTO EFECTIVO',
} satisfies Omit<CanonicalFactCandidate, 'factId' | 'proposedState' | 'value'>;

describe('25 — validación de candidatos canónicos', () => {
  it('convierte un candidato booleano válido en Fact con provenance y confidence de extracción', () => {
    const candidate: CanonicalFactCandidate = {
      ...base,
      factId: 'F-contacto_efectivo',
      proposedState: 'KNOWN',
      value: true,
    };

    const fact = candidateToFact(candidate);

    expect(fact.factId).toBe('F-contacto_efectivo');
    expect(fact.state).toBe('KNOWN');
    expect(fact.value).toBe(true);
    expect(fact.evidenceRefs).toHaveLength(1);
    expect(fact.provenance[0]).toMatchObject({
      evidenceId: 'ev-1',
      artifactId: 'art-1',
      extractionState: 'OBSERVED',
      extractionMethod: 'LLM',
      extractorId: 'test-extractor',
      extractorVersion: '1.0.0',
      extractionConfidence: 0.82,
    });
  });

  it('rechaza factId inexistente, enum fuera de dominio y fecha no ISO', () => {
    expect(() => validateCanonicalFactCandidate({ ...base, factId: 'legacy.contact', proposedState: 'KNOWN', value: true })).toThrow(/no está en el catálogo/);
    expect(() => validateCanonicalFactCandidate({ ...base, factId: 'F-nivel-academico', proposedState: 'KNOWN', value: 'PRIMARIA' })).toThrow(/dominio/);
    expect(() => validateCanonicalFactCandidate({ ...base, factId: 'F2-d53_cierre_aula_3a_semana_bimestre', proposedState: 'KNOWN', value: '27-09-2026' })).toThrow(/fecha ISO/);
  });

  it('preserva UNKNOWN como ausencia de valor y nunca lo transforma en false', () => {
    const fact = candidateToFact({
      ...base,
      factId: 'F-contacto_efectivo',
      proposedState: 'UNKNOWN',
      value: null,
    });

    expect(fact.state).toBe('UNKNOWN');
    expect(fact.value).toBeNull();
    expect(fact.unknownReason).toContain('no pudo determinar');
  });
});
