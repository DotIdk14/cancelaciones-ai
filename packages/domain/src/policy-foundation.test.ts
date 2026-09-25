import { describe, expect, it } from 'vitest';
import {
  canonicalFingerprintV1,
  canonicalizeV1,
  type ExtractedFactV1,
  type ShadowPolicyResult,
} from './policy-foundation';

describe('policy foundation contracts', () => {
  it('no convierte UNKNOWN en false', () => {
    const fact: ExtractedFactV1<unknown> = {
      factType: 'classroom.hasGrades',
      value: null,
      state: 'UNKNOWN',
      provenance: [],
    };
    expect(fact.value).toBeNull();
    expect(fact.state).not.toBe('OBSERVED');
  });

  it('produce el mismo fingerprint para clavescanónicas equivalentes', () => {
    expect(canonicalFingerprintV1({ b: 2, a: { d: 4, c: 3 } }))
      .toBe(canonicalFingerprintV1({ a: { c: 3, d: 4 }, b: 2 }));
  });

  it('excluye campos operativos generados del input canónico', () => {
    expect(canonicalFingerprintV1({ artifact: { id: 'a', content: 'x' }, createdAt: '2026-01-01' }))
      .toBe(canonicalFingerprintV1({ artifact: { id: 'a', content: 'x' }, createdAt: '2026-01-02' }));
  });

  it('ordena las claves por code points', () => {
    expect(canonicalFingerprintV1({ 'ä': 4, 'á': 3, b: 2, a: 1 }))
      .toBe('{"a":1,"b":2,"á":3,"ä":4}');
  });

  it('conserva el orden de los arrays', () => {
    expect(canonicalizeV1([{ value: 'tercero' }, { value: 'primero' }, { value: 'segundo' }]))
      .toEqual([{ value: 'tercero' }, { value: 'primero' }, { value: 'segundo' }]);
  });

  it('elimina propiedades undefined', () => {
    expect(canonicalizeV1({ keep: 'sí', omit: undefined, nested: { keep: 'sí', omit: undefined } }))
      .toEqual({ keep: 'sí', nested: { keep: 'sí' } });
  });

  it('marca shadow como no autoritativo', () => {
    const result: ShadowPolicyResult = {
      authoritative: false,
      source: 'DECLARATIVE_SHADOW',
      evaluation: null,
    };
    expect(result.authoritative).toBe(false);
  });

});
