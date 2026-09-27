/**
 * Test 8/20 — Hechos derivados, polaridad por nivel y contraevidencia.
 *
 * ## `AMB-LOG-02` en una frase
 *
 * Cuatro niveles usan la misma estructura sintáctica con polaridad opuesta:
 *
 * | Nivel          | Enunciado                                  | `TRUE` significa |
 * | -------------- | ------------------------------------------ | ---------------- |
 * | Licenciatura   | «Haber seleccionado la modalidad…»          | **hay** actividad|
 * | Posgrado       | «**No** haber registrado foros»             | **no hay**       |
 * | Alianza        | «**No** haber ingresado a asignatura»      | **no hay**       |
 * | Diplomado      | «**No** haber registrado foros»             | **no hay**       |
 *
 * Una bandera única invertiría el resultado en tres de los cuatro niveles. Este
 * test es el guardarraíl de diseño que el propio catálogo declara: si alguien
 * unifica la bandera, la prueba se rompe.
 */

import { describe, expect, it } from 'vitest';
import { POLICY_VERSION, activityFactForLevel, evaluateAudit, knownFact } from '../index';
import type { EvidenceContext, Fact, NivelAcademico, TemporalContext } from '../index';
import { bool, evidencia } from '../testing/fixtures';

const INICIO = '2026-01-05';
const DOMINGO_SEMANA_2 = '2026-01-18';

function ctx(nivel: NivelAcademico, solicitud = '2026-01-15'): EvidenceContext {
  return {
    evidences: [evidencia('EV-1')],
    temporal: {
      cicloFechaInicio: INICIO,
      fechaSolicitud: solicitud,
      fechaIngreso: INICIO,
      inicioPrimerCiclo: '2024-08-05',
      avanceCurricularPercent: 10,
    },
    nivelAcademico: nivel,
    campus: 'MEXICO',
  };
}

function hechoDeActividad(nivel: NivelAcademico, valor: boolean): Fact {
  return knownFact(activityFactForLevel(nivel).factId, valor, { evidenceRefs: [evidencia('EV-1')] });
}

function evaluarIlocalizable(nivel: NivelAcademico, actividadCruda: boolean, solicitud?: string) {
  return evaluateAudit({
    facts: [bool('F-contacto_efectivo', false), hechoDeActividad(nivel, actividadCruda)],
    evidenceContext: ctx(nivel, solicitud),
    policyVersion: POLICY_VERSION,
  });
}

/** ¿La regla `R-ILOC` coincidió en esta evaluación? */
function ilocCoincidio(facts: Fact[], nivel: NivelAcademico, solicitud?: string): boolean {
  const r = evaluateAudit({
    facts,
    evidenceContext: ctx(nivel, solicitud),
    policyVersion: POLICY_VERSION,
  });
  const paso = r.trace.entries.find((e) => e.ruleId === 'R-ILOC');
  const value = paso?.value as Record<string, unknown> | undefined;
  return value?.matched === true;
}

describe('polaridad de actividad por nivel (AMB-LOG-02)', () => {
  it('Licenciatura: TRUE significa que SÍ hay actividad', () => {
    expect(activityFactForLevel('LICENCIATURA').factId).toBe('F-actividad_licenciatura');
    expect(activityFactForLevel('LICENCIATURA').activityPolarity).toBe('POSITIVE');
  });

  it('Posgrado: TRUE significa que NO hay actividad', () => {
    const definition = activityFactForLevel('POSGRADO');
    expect(definition.factId).toBe('F-actividad_posgrado');
    expect(definition.activityPolarity).toBe('NEGATIVE');
  });

  it('Alianza y Diplomado también tienen polaridad negativa', () => {
    expect(activityFactForLevel('ALIANZA').activityPolarity).toBe('NEGATIVE');
    expect(activityFactForLevel('DIPLOMADO').activityPolarity).toBe('NEGATIVE');
  });

  it('el mismo valor crudo significa lo contrario en Licenciatura que en los otros tres', () => {
    // Éste es el guardarraíl de AMB-LOG-02. Con el crudo en `true`:
    //
    // - Licenciatura: «haber seleccionado la modalidad» ⇒ SÍ hay actividad.
    // - Posgrado/Alianza/Diplomado: «NO haber registered» ⇒ NO hay actividad.
    //
    // Una bandera única daría `sin_actividad = false` en los cuatro y haría que
    // R-ILOC muriera en tres niveles. Aquí se exige exactamente lo contrario.
    const crudoTrue = {
      LICENCIATURA: false,
      POSGRADO: true,
      ALIANZA: true,
      DIPLOMADO: true,
    } as const;

    for (const [nivel, esperado] of Object.entries(crudoTrue) as [NivelAcademico, boolean][]) {
      const facts = [bool('F-contacto_efectivo', false), hechoDeActividad(nivel, true)];
      expect(ilocCoincidio(facts, nivel), `nivel ${nivel}`).toBe(esperado);
    }
  });

  it('invertir el crudo invierte el resultado en los cuatro niveles', () => {
    // Con el crudo en `false` los papeles se invierten: ahora R-ILOC coincide en
    // Licenciatura y en ninguno de los otros tres.
    expect(
      ilocCoincidio(
        [bool('F-contacto_efectivo', false), hechoDeActividad('LICENCIATURA', false)],
        'LICENCIATURA',
      ),
    ).toBe(true);

    for (const nivel of ['POSGRADO', 'ALIANZA', 'DIPLOMADO'] as const) {
      expect(
        ilocCoincidio(
          [bool('F-contacto_efectivo', false), hechoDeActividad(nivel, false)],
          nivel,
        ),
        `nivel ${nivel}`,
      ).toBe(false);
    }
  });

  it('la ventana del domingo de la semana 2 se respeta', () => {
    // Sin contacto efectivo y sin actividad, dentro de la ventana R-ILOC aplica.
    const dentro = ilocCoincidio(
      [bool('F-contacto_efectivo', false), hechoDeActividad('LICENCIATURA', false)],
      'LICENCIATURA',
      '2026-01-15',
    );
    expect(dentro).toBe(true);
  });

  it('fuera de la ventana R-ILOC ya no aplica aunque todo lo demás se cumpla', () => {
    // Éste es el defecto que el test fija: sin la cláusula temporal, un caso
    // ilocalizable resuelto después del domingo de la semana 2 cerraba como CV.
    const fuera = ilocCoincidio(
      [bool('F-contacto_efectivo', false), hechoDeActividad('LICENCIATURA', false)],
      'LICENCIATURA',
      '2026-01-25',
    );
    expect(fuera).toBe(false);
  });

  it('R-ILOC no queda muerto para Posgrado, Alianza ni Diplomado', () => {
    // La regla ya no exige `LICENCIATURA`: los cuatro niveles del catálogo
    // participan con su propia polaridad.
    const rawParaFalsoEnPosgrado = evaluarIlocalizable('POSGRADO', false, '2026-01-15');
    const paso = rawParaFalsoEnPosgrado.trace.entries.find((e) => e.ruleId === 'R-ILOC');
    const value = paso?.value as Record<string, unknown> | undefined;
    // Posgrado con crudo `false` significa «registró foros» = SÍ hay actividad,
    // así que R-ILOC no debe coincidir, pero la regla sí se evaluó.
    expect(paso).toBeDefined();
    expect(value?.matched).toBe(false);
  });
});

describe('derivación sin duplicar ni pisar lo entregado', () => {
  it('un hecho derivado entregado por el llamador gana sobre la derivación', () => {
    const supplied = knownFact('F-sin-actividad-nivel', true, { evidenceRefs: [evidencia('EV-2')] });
    const r = evaluateAudit({
      facts: [bool('F-contacto_efectivo', false), supplied],
      evidenceContext: ctx('LICENCIATURA'),
      policyVersion: POLICY_VERSION,
    });
    const paso = r.trace.entries.find((e) => e.ref === 'F-sin-actividad-nivel');
    expect(paso?.value).toMatchObject({ extracted: true });
  });

  it('el hecho derivado no aparece duplicado', () => {
    const r = evaluateAudit({
      facts: [bool('F-contacto_efectivo', false), hechoDeActividad('LICENCIATURA', false)],
      evidenceContext: ctx('LICENCIATURA'),
      policyVersion: POLICY_VERSION,
    });
    const pasos = r.trace.entries.filter((e) => e.kind === 'FACT' && e.ref === 'F-sin-actividad-nivel');
    expect(pasos).toHaveLength(1);
  });

  it('sin hecho de actividad los derivados quedan UNKNOWN, no FALSE', () => {
    const r = evaluateAudit({
      facts: [bool('F-contacto_efectivo', false)],
      evidenceContext: ctx('LICENCIATURA'),
      policyVersion: POLICY_VERSION,
    });
    const paso = r.trace.entries.find((e) => e.ref === 'F-sin-actividad-nivel');
    expect(JSON.stringify(paso?.value)).toContain('UNKNOWN');
  });

  it('el nivel se deriva del contexto, no de un hecho que nadie entregó', () => {
    const r = evaluateAudit({
      facts: [bool('F-contacto_efectivo', false), hechoDeActividad('LICENCIATURA', false)],
      evidenceContext: ctx('LICENCIATURA'),
      policyVersion: POLICY_VERSION,
    });
    const paso = r.trace.entries.find((e) => e.ref === 'F-nivel-academico');
    expect(paso?.value).toMatchObject({ extracted: 'LICENCIATURA' });
  });
});
