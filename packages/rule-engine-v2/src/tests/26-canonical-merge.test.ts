import { describe, expect, it } from 'vitest';

import { candidateToFact, mergeCanonicalFacts, type CanonicalFactCandidate } from '../index';

function candidate(value: boolean | null, evidenceId: string): CanonicalFactCandidate {
  return {
    factId: 'F-contacto_efectivo',
    proposedState: value === null ? 'UNKNOWN' : 'KNOWN',
    value,
    evidenceId,
    artifactId: `${evidenceId}-artifact`,
    extractionMethod: 'DETERMINISTIC',
    extractorId: 'test',
    extractorVersion: '1.0.0',
  };
}

describe('26 — merge canónico de hechos', () => {
  it('fusiona hechos idénticos preservando provenance de ambas evidencias', () => {
    const merged = mergeCanonicalFacts([
      candidateToFact(candidate(true, 'ev-a')),
      candidateToFact(candidate(true, 'ev-b')),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].state).toBe('KNOWN');
    expect(merged[0].value).toBe(true);
    expect(merged[0].provenance.map((p) => p.evidenceId)).toEqual(['ev-a', 'ev-b']);
  });

  it('convierte evidencia true y false del mismo hecho en CONTRADICTED sin elegir ganadora', () => {
    const merged = mergeCanonicalFacts([
      candidateToFact(candidate(true, 'ev-a')),
      candidateToFact(candidate(false, 'ev-b')),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].state).toBe('CONTRADICTED');
    expect(merged[0].value).toBeNull();
    expect(merged[0].provenance.map((p) => p.evidenceId)).toEqual(['ev-a', 'ev-b']);
  });

  it('UNKNOWN no se transforma en false ni contradice un KNOWN', () => {
    const merged = mergeCanonicalFacts([
      candidateToFact(candidate(null, 'ev-a')),
      candidateToFact(candidate(true, 'ev-b')),
    ]);

    expect(merged[0].state).toBe('KNOWN');
    expect(merged[0].value).toBe(true);
    expect(merged[0].provenance.map((p) => p.evidenceId)).toEqual(['ev-a', 'ev-b']);
  });
});
