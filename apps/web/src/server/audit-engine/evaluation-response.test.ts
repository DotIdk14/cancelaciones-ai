/**
 * Tests del contrato de respuesta de la evaluación.
 *
 * ```
 * PROVISIONAL_IS_NOT_NORMATIVE
 * HUMAN_REVIEW_DOES_NOT_ERASE_CLOSEST_OUTCOME
 * ```
 *
 * ## Qué se está defendiendo
 *
 * La respuesta de red es donde un resultado provisional se convertía en dictamen.
 * Con un `outcome` suelto más un `status`, cualquier cliente podía leer
 * «BAJA» sin mirar que el estado era `REQUIRES_HUMAN_REVIEW`. Estos tests
 * comprueban que la separación survives la serialización, y que la unión
 * discriminada hace imposible la combinación peligrosa.
 */
import { describe, expect, it } from 'vitest';
import { POLICY_VERSION, evaluateAudit, knownFact } from '@cancelaciones/rule-engine-v2';
import type { EvidenceContext, Fact } from '@cancelaciones/rule-engine-v2';

import { toAuditEvaluationResponse } from './evaluation-response';

/**
 * Contexto con la solicitud fuera de la ventana de cancelación.
 *
 * Importa: con la solicitud 60 días después del inicio, `R-REGLA-20-DIAS`
 * coincide **sólo con las fechas**, sin ningún hecho. Por eso un conjunto de
 * hechos vacío produce un candidato y no un «nada que ordenar».
 */
function contexto(): EvidenceContext {
  return construirContexto('2026-03-06');
}

/** Contexto con la solicitud dentro de la ventana: ninguna regla temporal cierra. */
function contextoDentroDeVentana(): EvidenceContext {
  return construirContexto('2026-01-15');
}

function construirContexto(fechaSolicitud: string): EvidenceContext {
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

/**
 * Se usa `knownFact` del motor en vez de construir el objeto a mano: el
 * constructor del motor es la única forma garantizada de obtener una
 * `FactProvenance` completa, y estos tests no deben duplicar ese conocimiento.
 */
function hecho(factId: string, value: unknown): Fact {
  return knownFact(factId, value, {
    evidenceRefs: [{ evidenceId: 'EV-1', kind: 'PDF', label: 'Expediente' }],
  });
}

const D53_MAS_50: Fact[] = [
  hecho('F2-es_nuevo_ingreso', true),
  hecho('F2-tipo_ingreso', 'REGULAR'),
  hecho('F2-d53_supera_50', true),
];

function responder(facts: Fact[], context: EvidenceContext = contexto()) {
  return toAuditEvaluationResponse(
    evaluateAudit({ facts, evidenceContext: context, policyVersion: POLICY_VERSION }),
  );
}

describe('el discriminante separa lo normativo de lo provisional', () => {
  it('un caso cerrado por la fuente es NORMATIVE_DETERMINATE', () => {
    const r = responder([hecho('F-calificaciones_bimestre_1', true)]);
    expect(r.evaluationKind).toBe('NORMATIVE_DETERMINATE');
    expect(r.isNormative).toBe(true);
    expect(r.requiresHumanReview).toBe(false);
  });

  it('un caso con lectura auxiliar es PROVISIONAL_RANKED', () => {
    const r = responder(D53_MAS_50);
    expect(r.evaluationKind).toBe('PROVISIONAL_RANKED');
    expect(r.isNormative).toBe(false);
    expect(r.requiresHumanReview).toBe(true);
  });

  it('sin hechos y sin regla temporal que cierre, es PROVISIONAL_UNRESOLVED', () => {
    const r = responder([], contextoDentroDeVentana());
    expect(r.evaluationKind).toBe('PROVISIONAL_UNRESOLVED');
    expect(r.isNormative).toBe(false);
  });

  it('sin hechos pero con una ventana temporal que aplica, conserva el candidato', () => {
    // `R-REGLA-20-DIAS` no necesita hechos: la fecha basta. Descartar el
    // candidato porque falten hechos sería perder información real.
    const r = responder([]);
    expect(r.evaluationKind).toBe('PROVISIONAL_RANKED');
    expect(r.closestOutcome).toBe('BAJA');
    expect(r.normativeOutcome).toBeNull();
  });

  it('ninguna respuesta provisional se marca como normativa', () => {
    for (const facts of [[], D53_MAS_50, [hecho('F-calificaciones_bimestre_1', true)]]) {
      const r = responder(facts);
      if (r.isNormative) {
        expect(r.normativeOutcome).not.toBeNull();
        expect(r.evaluationKind).toBe('NORMATIVE_DETERMINATE');
      } else {
        expect(r.normativeOutcome).toBeNull();
        expect(r.evaluationKind).not.toBe('NORMATIVE_DETERMINATE');
      }
    }
  });
});

describe('la revisión no borra la respuesta', () => {
  it('el caso provisional conserva su resolución más respaldada', () => {
    // El motivo de esta aserción: si closestOutcome se perdiera al responder, el
    // cliente volvería a un INSUFFICIENT_EVIDENCE y el producto quedaría igual que
    // antes de existir.
    const r = responder(D53_MAS_50);
    expect(r.closestOutcome).toBe('BAJA');
  });

  it('el caso provisional nombra las reglas que sostienen la resolución', () => {
    const r = responder(D53_MAS_50);
    expect(r.evaluationKind).toBe('PROVISIONAL_RANKED');
    if (r.evaluationKind !== 'PROVISIONAL_RANKED') throw new Error('variante inesperada');
    expect(r.supportingRuleIds).toContain('R-D53-RELOJ-50');
  });

  it('el caso no resuelto no inventa ganador', () => {
    const r = responder([], contextoDentroDeVentana());
    expect(r.closestOutcome).toBeNull();
  });
});

describe('lo pendiente viaja en la respuesta', () => {
  it('expone las ambigüedades del Owner que bloquean el cierre', () => {
    const r = responder(D53_MAS_50);
    expect(r.pendingAmbiguityIds).toEqual(expect.arrayContaining(['AMB-TEM-07']));
  });

  it('expone qué reglas son sólo provisionales', () => {
    const r = responder(D53_MAS_50);
    expect(r.provisionalOnlyRuleIds).toContain('R-D53-RELOJ-50');
  });

  it('expone los hechos que faltan', () => {
    const r = responder([], contextoDentroDeVentana());
    expect(r.missingFactIds.length).toBeGreaterThan(0);
  });

  it('expone el motivo, no una etiqueta genérica', () => {
    const r = responder(D53_MAS_50);
    expect(r.reason).toContain('R-D53-RELOJ-50');
  });

  it('enlaza la traza por huella', () => {
    const r = responder(D53_MAS_50);
    expect(r.traceFingerprint.length).toBeGreaterThan(0);
  });

  it('declara la autoridad normativa y la versión de política', () => {
    const r = responder(D53_MAS_50);
    expect(r.normativeSource).toBe('GDM_GAM_PRD_MLG_003');
    expect(r.policyVersion).toBe(POLICY_VERSION);
  });
});

describe('la respuesta sobrevive la serialización', () => {
  it('un caso normativo no pierde su outcome al serializarse', () => {
    const r = responder([hecho('F-calificaciones_bimestre_1', true)]);
    const json = JSON.parse(JSON.stringify(r));
    expect(json.normativeOutcome).toBe('BAJA');
    expect(json.isNormative).toBe(true);
  });

  it('un caso no resuelto serializa ambos campos en null', () => {
    const json = JSON.parse(JSON.stringify(responder([], contextoDentroDeVentana())));
    expect(json.normativeOutcome).toBeNull();
    expect(json.closestOutcome).toBeNull();
  });

  it('un caso provisional conserva null y el candidato por separado', () => {
    const r = responder(D53_MAS_50);
    const json = JSON.parse(JSON.stringify(r));
    expect(json.normativeOutcome).toBeNull();
    expect(json.closestOutcome).toBe('BAJA');
    expect(json.isNormative).toBe(false);
  });

  it('no hay ningún campo outcome suelto que se pueda leer sin el estado', () => {
    // Si algún día se agrega un `outcome` plano, un cliente podría usarlo y
    // saltarse la separación. Esta aserción lo prohíbe por contrato.
    const respuestas = [
      responder([], contextoDentroDeVentana()),
      responder(D53_MAS_50),
      responder([hecho('F-calificaciones_bimestre_1', true)]),
    ];
    for (const r of respuestas) {
      expect(r).not.toHaveProperty('outcome');
    }
  });
});
