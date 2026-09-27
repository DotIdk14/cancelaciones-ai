/**
 * Test 12/20 — Contraevidencia: neutraliza en un sentido, conserva en el otro.
 *
 * ## Qué declara la fuente
 *
 * `5.8.a` (N-74, N-75, N-91, pp.13-15) enumera tres contraevidencias que
 * anulan la causal de estudiante ilocalizable. Lo que el test fija es la
 * simetría:
 *
 * - La contraevidencia **sí** coincide y queda en la traza: es una lectura de la
 *   fuente, no un descarte.
 * - La causal **deja** de proponer desenlace.
 * - La contraevidencia **no** propone desenlace propio: neutraliza, no decide.
 *
 * ## El defecto que este test atrapa
 *
 * En una versión anterior, `blockingRuleIds` se llenaba con *todas* las reglas
 * que bloquean algo en el registro, no con las que bloquearon *esa* regla. La
 * traza hacía responsable de la baja a reglas que nunca intervuvieron. Y una
 * regla ya neutralizada seguía neutralizando a las suyas.
 */

import { describe, expect, it } from 'vitest';
import { POLICY_VERSION, activityFactForLevel, evaluateAudit, knownFact } from '../index';
import type { EvidenceContext, Fact, TraceEntry } from '../index';
import { bool, evidencia } from '../testing/fixtures';

function contexto(solicitud = '2026-01-15'): EvidenceContext {
  return {
    evidences: [evidencia('EV-1')],
    temporal: {
      cicloFechaInicio: '2026-01-05',
      fechaSolicitud: solicitud,
      fechaIngreso: '2026-01-05',
      inicioPrimerCiclo: '2024-08-05',
      avanceCurricularPercent: 10,
    },
    nivelAcademico: 'LICENCIATURA',
    campus: 'MEXICO',
  };
}

/** Valor estructurado de un paso de la traza. */
function valor(entries: readonly TraceEntry[], ruleId: string): Record<string, unknown> {
  const entry = entries.find((e) => e.ruleId === ruleId);
  return (entry?.value as Record<string, unknown> | undefined) ?? {};
}

function actividadSinRegistro(): Fact {
  // Licenciatura: `false` = no seleccionó modalidad = SIN actividad.
  return knownFact(activityFactForLevel('LICENCIATURA').factId, false, {
    evidenceRefs: [evidencia('EV-1')],
  });
}

function evaluar(extra: Fact[]) {
  return evaluateAudit({
    facts: [bool('F-contacto_efectivo', false), actividadSinRegistro(), ...extra],
    evidenceContext: contexto(),
    policyVersion: POLICY_VERSION,
  });
}

describe('contraevidencia de la causal ilocalizable', () => {
  it('sin contraevidencia la causal propone cancelación de venta', () => {
    const r = evaluar([]);
    expect(valor(r.trace.entries, 'R-ILOC').matched).toBe(true);
  });

  it('N-74 (actividad en alguna asignatura) neutraliza la causal', () => {
    const r = evaluar([bool('F-actividad_en_alguna_asignatura', true)]);
    expect(valor(r.trace.entries, 'R-ILOC').matched).toBe(true);
    expect(valor(r.trace.entries, 'R-ILOC').blocked).toBe(true);
  });

  it('N-75 (cualquier contacto durante la gestión) también neutraliza', () => {
    const r = evaluar([bool('F-contacto_any_gestion', true)]);
    expect(valor(r.trace.entries, 'R-ILOC').blocked).toBe(true);
  });

  it('la contraevidencia que neutralizó sigue siendo visible en la traza', () => {
    const r = evaluar([bool('F-actividad_en_alguna_asignatura', true)]);
    const contra = valor(r.trace.entries, 'R-ILOC-N74');
    // Neutralizar no es descartar: la fuente sí dice algo, y la traza lo dice.
    expect(contra.matched).toBe(true);
    expect(contra.blocked).toBe(false);
  });

  it('cada paso declara qué regla lo bloqueó, no todas las bloqueantes', () => {
    const r = evaluar([bool('F-contacto_any_gestion', true)]);
    const bloqueantes = valor(r.trace.entries, 'R-ILOC').blockingRuleIds;
    expect(Array.isArray(bloqueantes)).toBe(true);
    // Sólo N-75 coincide: N-74 y N-91 no, y no deben aparecer como responsables.
    expect(bloqueantes).toEqual(['R-ILOC-N75']);
  });

  it('la contraevidencia no propone desenlace propio', () => {
    const r = evaluar([bool('F-actividad_en_alguna_asignatura', true)]);
    const candidatos = r.candidateTrace.map((c) => c.outcome);
    // N-74 declara `CONTINUE`: no crea un desenlace, sólo detiene uno.
    expect(candidatos).not.toContain('CONTINUE' as never);
  });

  it('una causal neutralizada desaparece del ranking', () => {
    const sinContra = evaluar([]);
    const conContra = evaluar([bool('F-actividad_en_alguna_asignatura', true)]);
    const apoyoDeCv = (r: typeof sinContra) =>
      r.candidateTrace.find((c) => c.outcome === 'CANCELACION_VENTA')?.supportingRuleIds ?? [];
    expect(apoyoDeCv(sinContra)).toContain('R-ILOC');
    expect(apoyoDeCv(conContra)).not.toContain('R-ILOC');
  });

  it('N-91 neutraliza cuando EE no cumple y no hay causa operativa', () => {
    const r = evaluar([
      bool('F-ee_cumplio_interacciones', false),
      bool('F-causa_operativa_documentada', false),
    ]);
    expect(valor(r.trace.entries, 'R-ILOC-N91').matched).toBe(true);
    expect(valor(r.trace.entries, 'R-ILOC').blocked).toBe(true);
  });

  it('con causa operativa documentada N-91 no neutraliza', () => {
    const r = evaluar([
      bool('F-ee_cumplio_interacciones', false),
      bool('F-causa_operativa_documentada', true),
    ]);
    expect(valor(r.trace.entries, 'R-ILOC-N91').matched).toBe(false);
    expect(valor(r.trace.entries, 'R-ILOC').blocked).toBeFalsy();
  });

  it('la incidencia de sistema desactiva la operativa completa', () => {
    // R-OP-C bloquea las siete sub-causales de 5.9 (N-95, p.16). Cada
    // sub-causal necesita además sus propios hechos para llegar a coincidir: sin
    // ellos no hay coincidencia que neutralizar, y marcarla «bloqueada» sería
    // afirmar que produjo un desenlace que nunca produjo.
    const r = evaluar([
      bool('F-op_incidencia_sistema', true),
      bool('F-op_error_servicios_escolares_d35', true),
      bool('F-op_canal_no_excluido', true),
    ]);
    expect(valor(r.trace.entries, 'R-OP-A').matched).toBe(true);
    expect(valor(r.trace.entries, 'R-OP-A').blocked).toBe(true);
    expect(valor(r.trace.entries, 'R-OP-A').blockingRuleIds).toEqual(['R-OP-C']);
  });

  it('sin la incidencia la sub-causal operativa no queda neutralizada', () => {
    const r = evaluar([
      bool('F-op_error_servicios_escolares_d35', true),
      bool('F-op_canal_no_excluido', true),
    ]);
    expect(valor(r.trace.entries, 'R-OP-A').matched).toBe(true);
    expect(valor(r.trace.entries, 'R-OP-A').blocked).toBe(false);
  });

  it('la regla que bloquea no se autoneutraliza', () => {
    const r = evaluar([
      bool('F-op_incidencia_sistema', true),
      bool('F-op_error_servicios_escolares_d35', true),
      bool('F-op_canal_no_excluido', true),
    ]);
    // Si R-OP-C se neutralizara a sí misma, desactivaría su propio bloqueo.
    expect(valor(r.trace.entries, 'R-OP-C').matched).toBe(true);
    expect(valor(r.trace.entries, 'R-OP-C').blocked).toBe(false);
  });

  it('toda regla neutralizada declara quién la neutralizó', () => {
    const r = evaluar([bool('F-actividad_en_alguna_asignatura', true)]);
    const bloqueadas = r.trace.entries.filter(
      (e) => (e.value as Record<string, unknown> | undefined)?.blocked === true,
    );
    expect(bloqueadas.length).toBeGreaterThan(0);
    for (const entrada of bloqueadas) {
      const bloqueantes = valor(r.trace.entries, entrada.ref).blockingRuleIds;
      expect(Array.isArray(bloqueantes)).toBe(true);
      // Una lista con todos los bloqueantes del registro atribuiría la baja a
      // reglas que no intervuvieron.
      expect((bloqueantes as string[]).length).toBeGreaterThan(0);
    }
  });
});
