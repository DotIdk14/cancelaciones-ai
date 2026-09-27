/**
 * Test 18/20 — Versión de política y huella del registro de reglas.
 *
 * ## Por qué la huella viaja en cada evaluación
 *
 * `rulesFingerprint` responde «¿esto es la misma política que la vez pasada?».
 * Sin ella, dos auditorías con la misma `policyVersion` pero distinto registro de
 * reglas serían indistinguibles, y un cambio de criterio normativo passaría
 * inadvertido: el motor seguiría announcing la misma versión mientras decide de
 * otra manera.
 *
 * ## Lo que la huella debe cubrir
 *
 * Todo campo que **cambie un desenlace**: condición, `onMatch`, prevalencia
 * declarada, contraevidencia y citas. Si un campo olvidara entrar, cambiarlo sería
 * invisible.
 */

import { describe, expect, it } from 'vitest';
import {
  POLICY_VERSION,
  RULES,
  SUPPORTED_POLICY_VERSIONS,
  evaluateAudit,
  ruleById,
  rulesFingerprint,
  stableHash,
} from '../index';
import type { EvidenceContext, Fact, Rule } from '../index';
import { bool, evidencia } from '../testing/fixtures';

function contexto(): EvidenceContext {
  return {
    evidences: [evidencia('EV-1')],
    temporal: {
      cicloFechaInicio: '2026-01-05',
      fechaSolicitud: '2026-01-15',
      fechaIngreso: '2026-01-05',
      inicioPrimerCiclo: '2024-08-05',
      avanceCurricularPercent: 10,
    },
    nivelAcademico: 'LICENCIATURA',
    campus: 'MEXICO',
  };
}

function evaluar(facts: Fact[]) {
  return evaluateAudit({ facts, evidenceContext: contexto(), policyVersion: POLICY_VERSION });
}

/** Copia superficial de una regla con un campo sustituido. */
function con(over: Partial<Rule>): Rule {
  return { ...(ruleById('R-FILTRO-CALIFICACIONES') as Rule), ...over };
}

describe('guarda de versión de política', () => {
  it('la versión por defecto es una de las soportadas', () => {
    expect(SUPPORTED_POLICY_VERSIONS).toContain(POLICY_VERSION);
  });

  it('rechaza una versión desconocida en vez de degradar', () => {
    // Degradar en silencio produciría decisiones con una versión de política que
    // el registro no implementa: el peor tipo de bug de este motor.
    expect(() =>
      evaluateAudit({ facts: [], evidenceContext: contexto(), policyVersion: 'policy-v0.0.0' }),
    ).toThrow(RangeError);
  });

  it('el mensaje de error nombra las versiones soportadas', () => {
    expect(() =>
      evaluateAudit({ facts: [], evidenceContext: contexto(), policyVersion: 'inventada' }),
    ).toThrow(/policy/);
  });

  it('la versión queda registrada en la evaluación', () => {
    expect(evaluar([]).policyVersion).toBe(POLICY_VERSION);
  });

  it('cada versión soportada se acepta sin error', () => {
    for (const version of SUPPORTED_POLICY_VERSIONS) {
      expect(() => evaluateAudit({ facts: [], evidenceContext: contexto(), policyVersion: version })).not.toThrow();
    }
  });
});

describe('huella del registro de reglas', () => {
  it('es estable entre llamadas', () => {
    expect(rulesFingerprint(RULES)).toBe(rulesFingerprint(RULES));
  });

  it('no depende del orden del arreglo', () => {
    expect(rulesFingerprint(RULES)).toBe(rulesFingerprint([...RULES].reverse()));
  });

  it('viaja en cada evaluación', () => {
    expect(evaluar([]).rulesFingerprint).toBe(rulesFingerprint(RULES));
  });

  it('cambia si cambia la condición de una regla', () => {
    const original = rulesFingerprint([con({})]);
    const alterada = rulesFingerprint([con({ condition: { kind: 'alwaysTrue' } })]);
    expect(alterada).not.toBe(original);
  });

  it('cambia si cambia el desenlace de una regla', () => {
    const original = rulesFingerprint([con({})]);
    const alterada = rulesFingerprint([
      con({ onMatch: { kind: 'OUTCOME', outcome: 'RETENCION' } }),
    ]);
    expect(alterada).not.toBe(original);
  });

  it('cambia si cambia la prevalencia declarada por regla', () => {
    const original = rulesFingerprint([con({})]);
    const alterada = rulesFingerprint([con({ declaredPrecedenceOver: ['R-ILOC'] })]);
    expect(alterada).not.toBe(original);
  });

  it('cambia si cambia la prevalencia declarada por categoría', () => {
    // Campo que se añadió con la prevalencia de N-64: si no entrara en la
    // huella, cambiar quién queda desplazado sería invisible.
    const original = rulesFingerprint([con({})]);
    const alterada = rulesFingerprint([con({ declaredPrecedenceOverOutcomes: ['BAJA'] })]);
    expect(alterada).not.toBe(original);
  });

  it('cambia si cambia la contraevidencia', () => {
    const original = rulesFingerprint([con({})]);
    const alterada = rulesFingerprint([con({ blocksRuleIds: ['R-ILOC'] })]);
    expect(alterada).not.toBe(original);
  });

  it('cambia si cambia una cita de la fuente', () => {
    const base = ruleById('R-FILTRO-CALIFICACIONES') as Rule;
    const alterada: Rule = { ...base, sourceRefs: [{ ...base.sourceRefs[0], page: 99 }] };
    expect(rulesFingerprint([alterada])).not.toBe(rulesFingerprint([base]));
  });

  it('cambia si se añade una regla', () => {
    const extra: Rule = { ...(ruleById('R-ILOC') as Rule), ruleId: 'R-EXTRA' };
    expect(rulesFingerprint([...RULES, extra])).not.toBe(rulesFingerprint(RULES));
  });

  it('no cambia por reordenar las citas de una regla', () => {
    const base = ruleById('R-ILOC') as Rule;
    expect(rulesFingerprint([{ ...base, sourceRefs: [...base.sourceRefs].reverse() }])).toBe(
      rulesFingerprint([base]),
    );
  });
});

describe('stableHash', () => {
  it('responde igual a valores iguales', () => {
    expect(stableHash({ a: 1, b: [2, 3] })).toBe(stableHash({ a: 1, b: [2, 3] }));
  });

  it('responde distinto a valores distintos', () => {
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }));
  });

  it('no depende del orden de las claves', () => {
    expect(stableHash({ a: 1, b: 2 })).toBe(stableHash({ b: 2, a: 1 }));
  });

  it('devuelve ocho dígitos hexadecimales', () => {
    expect(stableHash('x')).toMatch(/^[0-9a-f]{8}$/);
  });
});
