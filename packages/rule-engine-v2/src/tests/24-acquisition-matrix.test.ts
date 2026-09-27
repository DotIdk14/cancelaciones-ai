import { describe, expect, it } from 'vitest';

import {
  ACQUISITION_CATEGORIES,
  buildCanonicalFactAcquisitionMatrix,
  FACT_DEFINITIONS,
} from '../index';

describe('24 — matriz de adquisición de hechos canónicos', () => {
  it('declara exactamente una estrategia de adquisición por hecho canónico', () => {
    const matrix = buildCanonicalFactAcquisitionMatrix();

    expect(matrix).toHaveLength(FACT_DEFINITIONS.length);
    expect(new Set(matrix.map((entry) => entry.factId)).size).toBe(FACT_DEFINITIONS.length);
    expect(matrix.map((entry) => entry.factId).sort()).toEqual(
      FACT_DEFINITIONS.map((definition) => definition.factId).sort(),
    );
  });

  it('usa sólo categorías aprobadas y conserva trazabilidad operacional', () => {
    const allowed = new Set<string>(ACQUISITION_CATEGORIES);
    const matrix = buildCanonicalFactAcquisitionMatrix();

    for (const entry of matrix) {
      expect(allowed.has(entry.acquisitionCategory), entry.factId).toBe(true);
      expect(entry.meaning.length, entry.factId).toBeGreaterThan(0);
      expect(entry.expectedValueState.length, entry.factId).toBeGreaterThan(0);
      expect(Array.isArray(entry.sourceRuleIds), entry.factId).toBe(true);
      expect(entry.provenanceRequirements.length, entry.factId).toBeGreaterThan(0);
      expect(typeof entry.aiExtractionPermitted, entry.factId).toBe('boolean');
      expect(typeof entry.deterministicValidationPossible, entry.factId).toBe('boolean');
      expect(typeof entry.criticalToDecisionBranch, entry.factId).toBe('boolean');
    }
  });

  it('clasifica invariantes normativos como referencias auxiliares, no como campos de usuario', () => {
    const matrix = buildCanonicalFactAcquisitionMatrix();
    const invariants = matrix.filter((entry) => entry.normativeInvariant);

    expect(invariants.length).toBeGreaterThan(0);
    expect(invariants.every((entry) => entry.acquisitionCategory === 'AUXILIARY_REFERENCE')).toBe(true);
    expect(invariants.every((entry) => entry.aiExtractionPermitted === false)).toBe(true);
  });
});
