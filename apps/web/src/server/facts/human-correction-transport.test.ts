import { describe, expect, it } from 'vitest';
import { toDerivedFactRpcPayload, type DerivedFact } from './human-correction';
import { mapSnapshotFactsToPolicyFacts } from '@/server/policy/frozen-fact-run';

/**
 * El defecto que estos tests cubren fue MEDIDO contra el backend, no supuesto:
 * `create_derived_fact_run_v1` leía `f->>'fact_type'` sobre un payload que la
 * aplicación enviaba con `factType`, y la derivación moría con
 * `value in column "fact_type" of relation "facts" violates not-null constraint`.
 *
 * Aquí se fija el contrato de transporte en los dos sentidos, porque hay dos
 * consumidores con grafías distintas y basta con arreglar uno para que el otro
 * falle en silencio.
 */

function fact(overrides: Partial<DerivedFact> = {}): DerivedFact {
  return {
    id: 'fact-1',
    factType: 'classroom.hasActivities',
    classification: 'OBSERVABLE',
    value: true,
    sourceRef: { artifactId: 'artifact-1' },
    confidence: 0.8,
    ...overrides,
  };
}

describe('toDerivedFactRpcPayload', () => {
  describe('mapeo de claves que el RPC lee como columna', () => {
    it('mapea factType -> fact_type', () => {
      expect(toDerivedFactRpcPayload([fact({ factType: 'student.level' })])[0].fact_type).toBe('student.level');
    });

    it('mapea sourceRef -> source_ref', () => {
      expect(toDerivedFactRpcPayload([fact({ sourceRef: { artifactId: 'a-9' } })])[0].source_ref).toEqual({ artifactId: 'a-9' });
    });

    it('preserva classification, value y confidence sin transformarlos', () => {
      const [payload] = toDerivedFactRpcPayload([
        fact({ classification: 'HUMAN_CORRECTED', value: { nested: [1, 2] }, confidence: 0.42 }),
      ]);
      expect(payload.classification).toBe('HUMAN_CORRECTED');
      expect(payload.value).toEqual({ nested: [1, 2] });
      expect(payload.confidence).toBe(0.42);
    });

    it('no deja ninguna clave del payload sin equivalente en las dos grafías', () => {
      const [payload] = toDerivedFactRpcPayload([fact()]);
      // Lo que el RPC lee.
      expect(payload.fact_type).toBe(payload.type);
      expect(payload.source_ref).toEqual(payload.source);
      expect(payload.confidence).toBe(payload.extractionConfidence);
    });
  });

  describe('el snapshot que el RPC guarda verbatim sigue siendo legible', () => {
    it('el payload pasa mapSnapshotFactsToPolicyFacts sin lanzar', () => {
      // El RPC guarda `p_facts` tal cual en fact_run_frozen_snapshots.facts. Si
      // el payload no tuviera `type`, el Fact Run derivado quedaría sellado y
      // sería ilegible para el motor. Este test es el que impide ese fallo.
      const facts = mapSnapshotFactsToPolicyFacts(toDerivedFactRpcPayload([fact()]));
      expect(facts).toHaveLength(1);
      expect(facts[0].id).toBe('fact-1');
      expect(facts[0].type).toBe('classroom.hasActivities');
      expect(facts[0].value).toBe(true);
    });

    it('el snapshot conserva la confianza y la evidencia del hecho', () => {
      const [projected] = mapSnapshotFactsToPolicyFacts(
        toDerivedFactRpcPayload([fact({ confidence: 0.55, sourceRef: { artifactId: 'artifact-7' } })]),
      );
      expect(projected.extractionConfidence).toBe(0.55);
      expect(projected.source).toEqual({ artifactId: 'artifact-7' });
    });
  });

  describe('lo que el adaptador NO debe hacer', () => {
    it('no inventa ids: conserva el id del hecho padre, que es la trazabilidad', () => {
      expect(toDerivedFactRpcPayload([fact({ id: 'fact-original-42' })])[0].id).toBe('fact-original-42');
    });

    it('no convierte un UNKNOWN en false ni altera el valor', () => {
      const [payload] = toDerivedFactRpcPayload([fact({ value: null })]);
      expect(payload.value).toBeNull();
      expect('value' in payload).toBe(true);
    });

    it('no introduce ninguna propiedad normativa en el payload', () => {
      const forbidden = ['outcome', 'suggestedOutcome', 'decision', 'resolution', 'ruleId', 'matchedRule', 'policyDecision'];
      for (const payload of toDerivedFactRpcPayload([fact()])) {
        for (const key of forbidden) expect(payload).not.toHaveProperty(key);
      }
    });

    it('no muta la entrada', () => {
      const original = fact();
      const snapshot = structuredClone(original);
      toDerivedFactRpcPayload([original]);
      expect(original).toEqual(snapshot);
    });

    it('devuelve un array vacío para una entrada vacía, sin inventar hechos', () => {
      expect(toDerivedFactRpcPayload([])).toEqual([]);
    });
  });

  it('conserva el orden y la longitud: el fingerprint depende de eso', () => {
    const facts = [fact({ id: 'a', factType: 't.a' }), fact({ id: 'b', factType: 't.b' }), fact({ id: 'c', factType: 't.c' })];
    const payload = toDerivedFactRpcPayload(facts);
    expect(payload.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
    expect(payload).toHaveLength(3);
  });
});
