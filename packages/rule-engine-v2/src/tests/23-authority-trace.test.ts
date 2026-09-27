/**
 * Test 23 — Trazabilidad de la decisión de autoridad.
 *
 * ```
 * TRACE_EVERY_DECISION
 * ```
 *
 * ## La omisión que estos tests atrapan
 *
 * El motor separaba normativo de provisional en los *datos*, pero la explicación
 * llegaba tarde y parcial: el paso `STATUS` decía «REQUIRES_HUMAN_REVIEW» con una
 * frase genérica, y nada decía qué reglas eran auxiliares ni qué ambigüedades
 * faltaban. El resultado era un sistema correcto e inexplicable — el peor
 * estado posible en un dictamen, porque invita a desconfiar sin ofrecer nada.
 *
 * Estos tests fijan que la autoridad sea un hecho trazable, no una inferencia que
 * el revisor tenga que reconstruir.
 */

import { describe, expect, it } from 'vitest';
import { POLICY_VERSION, evaluateAudit } from '../index';
import type { AuditEvaluation, EvidenceContext, Fact, TraceEntry } from '../index';
import { bool, evidencia, val } from '../testing/fixtures';

function contexto(): EvidenceContext {
  return {
    evidences: [evidencia('EV-1')],
    temporal: {
      cicloFechaInicio: '2026-01-05',
      fechaSolicitud: '2026-03-06',
      fechaIngreso: '2026-01-05',
      inicioPrimerCiclo: '2024-08-05',
      avanceCurricularPercent: 10,
    },
    nivelAcademico: 'LICENCIATURA',
    campus: 'MEXICO',
  };
}

const D53_MAS_50: Fact[] = [
  bool('F2-es_nuevo_ingreso', true),
  val('F2-tipo_ingreso', 'REGULAR'),
  bool('F2-d53_supera_50', true),
];

const D53_RELOJ_6M: Fact[] = [
  bool('F2-es_nuevo_ingreso', true),
  val('F2-tipo_ingreso', 'REGULAR'),
  bool('F2-baja_falta_docs_6meses', true),
];

const D53_EXPEDIENTE: Fact[] = [
  bool('F2-es_nuevo_ingreso', true),
  val('F2-tipo_ingreso', 'REGULAR'),
  bool('F2-d53_expediente_completo', false),
];

const D53_APOCRIFO: Fact[] = [
  bool('F2-es_nuevo_ingreso', true),
  val('F2-tipo_ingreso', 'REGULAR'),
  bool('F2-d53_apocrifo_sospecha', true),
];

function evaluar(facts: Fact[]): AuditEvaluation {
  return evaluateAudit({ facts, evidenceContext: contexto(), policyVersion: POLICY_VERSION });
}

const de = (r: AuditEvaluation, kind: TraceEntry['kind']): TraceEntry[] =>
  r.trace.entries.filter((entry) => entry.kind === kind);

/**
 * `TraceEntry.value` es `unknown` a propósito: un paso puede llevar cualquier
 * estructura. Los tests acota que el motor emite, de modo que un
 * cambio de contrato falle aquí en vez de compara `undefined` con `undefined`.
 */
function valor<T>(entry: TraceEntry | undefined): T {
  if (entry === undefined) throw new Error('se esperaba un paso de traza y no hubo ninguno');
  return entry.value as T;
}

describe('cada regla de desenlace deja constancia de su autoridad', () => {
  const r = () => evaluar(D53_MAS_50);

  it('toda regla de desenlace que coincide tiene paso AUTHORITY', () => {
    const autoridades = de(r(), 'AUTHORITY');
    expect(autoridades.length).toBeGreaterThan(0);
    for (const entry of autoridades) {
      const tipo = valor<{ isNormative: boolean }>(entry).isNormative;
      expect(typeof tipo, entry.ref).toBe('boolean');
    }
  });

  it('una regla auxiliar queda marcada como no autoritativa', () => {
    const paso = de(r(), 'AUTHORITY').find((entry) => entry.ref === 'R-D53-RELOJ-50');
    const data = valor<{ isNormative: boolean; authority: string }>(paso);
    expect(data.isNormative).toBe(false);
    expect(data.authority).toBe('AUXILIARY_WITHOUT_PRIMARY_GROUNDING');
  });

  it('una regla del primario queda marcada como autoritativa', () => {
    const paso = de(r(), 'AUTHORITY').find((entry) => entry.ref === 'R-REGLA-20-DIAS');
    const data = valor<{ isNormative: boolean; authority: string }>(paso);
    expect(data.isNormative).toBe(true);
    expect(data.authority).toBe('PRIMARY_GROUNDED');
  });

  it('el paso AUTHORITY cita las fuentes de la regla', () => {
    const paso = de(r(), 'AUTHORITY').find((entry) => entry.ref === 'R-D53-RELOJ-50');
    expect(paso?.sourceRefs?.length ?? 0).toBeGreaterThan(0);
  });

  it('el motivo legible explica la no autoridad', () => {
    const paso = de(r(), 'AUTHORITY').find((entry) => entry.ref === 'R-D53-RELOJ-50');
    expect(paso?.detail).toContain('PROVISIONAL');
    expect(paso?.detail).toContain('GDM_GAM_PRD_MLG_003');
  });
});

describe('el estado explica por qué escaló, no sólo que escaló', () => {
  const r = () => evaluar(D53_MAS_50);

  it('el paso STATUS trae el motivo específico del módulo de estado', () => {
    expect(valor<{ reason: string }>(de(r(), 'STATUS')[0]).reason.length).toBeGreaterThan(0);
  });

  it('el motivo enumera las reglas auxiliares que bloquean el cierre', () => {
    expect(valor<{ reason: string }>(de(r(), 'STATUS')[0]).reason).toContain('R-D53-RELOJ-50');
  });

  it('el motivo advierte que resolver el conflicto no basta', () => {
    // Sin esta advertencia el auditor cierra el conflicto, cree que resolvió el
    // caso y no entiende por qué el motor sigue escalate.
    expect(valor<{ reason: string }>(de(r(), 'STATUS')[0]).reason).toContain('no basta');
  });

  it('el motivo nombra las ambigüedades pendientes del Owner', () => {
    expect(valor<{ reason: string }>(de(r(), 'STATUS')[0]).reason).toContain('AMB-TEM-07');
  });

  it('STATUS enlaza las reglas provisional-only y sus ambigüedades', () => {
    const status = valor<{ provisionalOnlyRuleIds: string[]; pendingAmbiguityIds: string[] }>(
      de(r(), 'STATUS')[0],
    );
    expect(status.provisionalOnlyRuleIds).toContain('R-D53-RELOJ-50');
    expect(status.pendingAmbiguityIds).toEqual(expect.arrayContaining(['AMB-TEM-07']));
  });
});

describe('el resumen de lo pendiente es consumible sin recalcular', () => {
  it('existe un paso PROVISIONAL_ONLY cuando hay reglas auxiliares', () => {
    const paso = de(evaluar(D53_MAS_50), 'PROVISIONAL_ONLY')[0];
    expect(paso?.ref).toBe('pending-authority');
    expect(valor<{ rules: unknown[] }>(paso).rules.length).toBeGreaterThan(0);
  });

  it('cada regla del resumen declara desenlace y ambigüedades', () => {
    const reglas = valor<{
      rules: { ruleId: string; outcome: string; awaitsAmbiguityIds: string[] }[];
    }>(de(evaluar(D53_MAS_50), 'PROVISIONAL_ONLY')[0]).rules;
    const reloj = reglas.find((rule) => rule.ruleId === 'R-D53-RELOJ-50');
    expect(reloj?.outcome).toBe('BAJA');
    expect(reloj?.awaitsAmbiguityIds).toEqual(expect.arrayContaining(['AMB-TEM-07']));
  });

  it('no hay paso PROVISIONAL_ONLY cuando ninguna regla es auxiliar', () => {
    const r = evaluateAudit({
      facts: [bool('F-calificaciones_bimestre_1', true)],
      evidenceContext: contexto(),
      policyVersion: POLICY_VERSION,
    });
    expect(de(r, 'PROVISIONAL_ONLY')).toEqual([]);
  });

  it('el resultado provisional adjunta lo pendiente', () => {
    const paso = de(evaluar(D53_MAS_50), 'RESULT').find((e) => e.ref === 'provisional');
    const data = valor<{ isNormative: boolean; pendingAmbiguityIds: string[] }>(paso);
    expect(data.isNormative).toBe(false);
    expect(data.pendingAmbiguityIds).toEqual(expect.arrayContaining(['AMB-TEM-07']));
  });
});

describe('el motivo de escalada cubre las cuatro reglas auxiliares', () => {
  const casos: [string, Fact[], string][] = [
    ['R-D53-RELOJ-6M', D53_RELOJ_6M, 'XDC-02'],
    ['R-D53-RELOJ-50', D53_MAS_50, 'AMB-TEM-07'],
    ['R-D53-EXPEDIENTE', D53_EXPEDIENTE, 'XDC-05'],
    ['R-D53-APOCRIFO', D53_APOCRIFO, 'AMB-CON-02'],
  ];

  for (const [ruleId, facts, ambiguity] of casos) {
    it(`${ruleId} nombra su ambigüedad pendiente`, () => {
      const status = valor<{ pendingAmbiguityIds: string[] }>(de(evaluar(facts), 'STATUS')[0]);
      expect(status.pendingAmbiguityIds).toContain(ambiguity);
      expect(evaluar(facts).provisionalOnly.map((rule) => rule.ruleId)).toContain(ruleId);
    });
  }
});

describe('la traza sigue siendo determinista', () => {
  it('dos evaluaciones idénticas producen la misma huella', () => {
    expect(evaluar(D53_MAS_50).trace.fingerprint).toBe(evaluar(D53_MAS_50).trace.fingerprint);
  });

  it('cambiar la evidencia cambia la huella de traza', () => {
    const a = evaluar(D53_MAS_50);
    const b = evaluateAudit({
      facts: D53_MAS_50,
      evidenceContext: { ...contexto(), evidences: [evidencia('EV-1'), evidencia('EV-2', 'otro')] },
      policyVersion: POLICY_VERSION,
    });
    expect(a.trace.fingerprint).not.toBe(b.trace.fingerprint);
  });

  it('los pasos siguen numerados de forma correlativa', () => {
    const entries = evaluar(D53_MAS_50).trace.entries;
    entries.forEach((entry, index) => expect(entry.step).toBe(index + 1));
  });
});
