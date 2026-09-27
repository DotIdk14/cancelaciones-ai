/**
 * Tests de la regla de presentación de la evaluación.
 *
 * ```
 * HUMAN_REVIEW_DOES_NOT_ERASE_CLOSEST_OUTCOME
 * PROVISIONAL_IS_NOT_NORMATIVE
 * ```
 *
 * ## La prueba de fuego
 *
 * El producto dice: la resolución es el valor principal y la revisión es un
 * calificador. Estos tests lo comprueban sobre el modelo de vista, sin DOM, para
 * que la jerarquía sea una propiedad verificable y no una convención de CSS que
 * un refactor pueda invertir en silencio.
 */
import { describe, expect, it } from 'vitest';
import { OUTCOMES, POLICY_VERSION, evaluateAudit, knownFact } from '@cancelaciones/rule-engine-v2';
import type { EvidenceContext, Fact } from '@cancelaciones/rule-engine-v2';

import { toAuditEvaluationResponse } from '@/server/audit-engine/evaluation-response';
import type { AuditEvaluationResponse } from '@/server/audit-engine/evaluation-response';

import { OUTCOME_LABELS, SUPPORT_SCORE_EXPLANATION, buildEvaluationViewModel } from './evaluation-view-model';

function contexto(fechaSolicitud: string): EvidenceContext {
  return {
    evidences: [{ evidenceId: 'EV-1', kind: 'PDF', label: 'Expediente' }],
    temporal: {
      cicloFechaInicio: '2026-01-05',
      fechaSolicitud,
      fechaIngreso: '2026-01-05',
      inicioPrimerCiclo: '2024-08-05',
      avanceCurricularPercent: 10,
    },
    nivelAcademico: 'LICENCIATURA',
    campus: 'MEXICO',
  };
}

const hecho = (factId: string, value: unknown): Fact => knownFact(factId, value);

const FUERA_DE_VENTANA = '2026-03-06';
const DENTRO_DE_VENTANA = '2026-01-15';

function responder(facts: Fact[], fechaSolicitud = FUERA_DE_VENTANA): AuditEvaluationResponse {
  return toAuditEvaluationResponse(
    evaluateAudit({
      facts,
      evidenceContext: contexto(fechaSolicitud),
      policyVersion: POLICY_VERSION,
    }),
  );
}

const D53_MAS_50: Fact[] = [
  hecho('F2-es_nuevo_ingreso', true),
  hecho('F2-tipo_ingreso', 'REGULAR'),
  hecho('F2-d53_supera_50', true),
];

describe('el vocabulario de desenlaces está completo y es del primario', () => {
  it('cada desenlace del motor tiene etiqueta en español', () => {
    for (const outcome of OUTCOMES) {
      expect(OUTCOME_LABELS[outcome], outcome).toBeDefined();
      // Ninguna etiqueta puede ser el identificador crudo: si se olvidara la
      // traducción, `label` devolvería el código y la UI lo mostraría así.
      expect(OUTCOME_LABELS[outcome], outcome).not.toBe(outcome);
    }
  });

  it('no hay etiquetas para desenlaces que el primario no declara', () => {
    for (const key of Object.keys(OUTCOME_LABELS)) {
      expect(OUTCOMES as readonly string[]).toContain(key);
    }
  });

  it('el puntaje de soporte no se presenta como probabilidad', () => {
    expect(SUPPORT_SCORE_EXPLANATION).toContain('No es una probabilidad');
    expect(SUPPORT_SCORE_EXPLANATION).toContain('cuántas reglas');
  });
});

describe('caso normativo: la resolución manda y no hay calificador', () => {
  const model = () => buildEvaluationViewModel(responder([hecho('F-calificaciones_bimestre_1', true)]));

  it('la resolución es el valor principal', () => {
    expect(model().resolution).toContain('Resultado normativo');
    expect(model().isNormative).toBe(true);
  });

  it('no inventa un calificador de revisión donde no hay duda', () => {
    expect(model().qualifier).toBeNull();
  });

  it('no pendings porque la fuente cerró el caso', () => {
    // `missingFacts` del motor enumera los requisitos de las reglas que no
    // coincidieron, que en un caso cerrado son decenas. Mostrarlos bajo el
    // encabezado «qué falta para cerrar» sugeriría reabrir una decisión ya
    // tomada. La lista se reserva para el caso abierto.
    expect(model().pendingItems).toEqual([]);
  });

  it('no sugiere recabar hechos aunque el motor reporte requisitos', () => {
    const response = responder([hecho('F-calificaciones_bimestre_1', true)]);
    // El motor sí reporta requisitos; la vista no los convierte en pendientes.
    expect(response.missingFactIds.length).toBeGreaterThan(0);
    expect(buildEvaluationViewModel(response).pendingItems).toEqual([]);
  });

  it('el estado se presenta como determinado por la norma', () => {
    expect(model().statusLabel).toBe('Determinado por la norma');
  });
});

describe('caso provisional con candidato: la respuesta sobrevive', () => {
  const model = () => buildEvaluationViewModel(responder(D53_MAS_50));

  it('la resolución más compatible es el valor principal', () => {
    // Ésta es la exigencia central del producto: el auditor recibe una respuesta.
    expect(model().resolution).toBe('Resolución más compatible: Baja');
    expect(model().resolutionLabel).toBe('Baja');
  });

  it('el texto principal dice «más compatible», no el desenlace a secas', () => {
    expect(model().resolution).toContain('más compatible');
  });

  it('la revisión es un calificador aparte, no el valor principal', () => {
    expect(model().qualifier).toContain('Revisión humana requerida');
    expect(model().qualifier).toContain('no es un dictamen');
  });

  it('el calificador no sustituye a la resolución', () => {
    // Si el calificador contuviera el desenlace, la UI podría pintar sólo el
    // calificador en algún estado y perder la respuesta.
    expect(model().qualifier).not.toContain('Baja');
    expect(model().resolution).toContain('Baja');
  });

  it('el resultado se marca como no normativo', () => {
    expect(model().isNormative).toBe(false);
  });

  it('explica el soporte sin llamarlo probabilidad', () => {
    expect(model().supportExplanation).toBe(SUPPORT_SCORE_EXPLANATION);
  });

  it('lista las reglas que sostienen la resolución', () => {
    expect(model().supportingRuleIds).toContain('R-D53-RELOJ-50');
  });
});

describe('lo pendiente es accionable', () => {
  const model = () => buildEvaluationViewModel(responder(D53_MAS_50));

  it('cada pendiente dice qué hacer', () => {
    expect(model().pendingItems.length).toBeGreaterThan(0);
    for (const item of model().pendingItems) {
      expect(item.whatToDo.length, item.id).toBeGreaterThan(0);
    }
  });

  it('nombra la ambigüedad del Owner pendiente', () => {
    const ids = model().pendingItems.map((item) => item.id);
    expect(ids).toContain('AMB-TEM-07');
  });

  it('explica por qué la regla auxiliar no basta', () => {
    const auxiliar = model().pendingItems.find((item) => item.kind === 'AUXILIARY_RULE');
    expect(auxiliar?.whatToDo).toContain('fuente primaria');
  });

  it('no duplica pendientes: la ambigüedad y la regla son entradas distintas', () => {
    const keys = model().pendingItems.map((item) => `${item.kind}:${item.id}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('caso sin candidato: no se inventa una resolución', () => {
  const model = () => buildEvaluationViewModel(responder([], DENTRO_DE_VENTANA));

  it('no hay etiqueta de desenlace', () => {
    expect(model().resolutionLabel).toBeNull();
  });

  it('lo dice en el texto principal, no lo omite en silencio', () => {
    expect(model().resolution).toContain('no prefiere ningún desenlace');
  });

  it('el estado es «sin resultado», no «provisional»', () => {
    // Un provisional con candidato y un caso sin candidato son estados
    // distintos para el auditor; colapsarlos lo esconde.
    expect(model().statusLabel).toBe('Sin resultado');
  });

  it('no inventa reglas de apoyo', () => {
    expect(model().supportingRuleIds).toEqual([]);
  });

  it('no explica un puntaje de soporte que no existe', () => {
    expect(model().supportExplanation).toBeNull();
  });

  it('pide los hechos que faltan', () => {
    expect(model().pendingItems.some((item) => item.kind === 'FACT')).toBe(true);
  });
});

describe('toda evaluación declara su autoridad y su traza', () => {
  for (const [nombre, response] of [
    ['normativa', responder([hecho('F-calificaciones_bimestre_1', true)])],
    ['provisional', responder(D53_MAS_50)],
    ['sin resultado', responder([], DENTRO_DE_VENTANA)],
  ] as const) {
    it(`${nombre} declara la fuente primaria y la huella de traza`, () => {
      const model = buildEvaluationViewModel(response);
      expect(model.normativeSource).toBe('GDM_GAM_PRD_MLG_003');
      expect(model.traceFingerprint.length).toBeGreaterThan(0);
    });

    it(`${nombre} expone el motivo del motor`, () => {
      expect(buildEvaluationViewModel(response).reason.length).toBeGreaterThan(0);
    });
  }
});
