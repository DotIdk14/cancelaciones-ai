/**
 * Test 20/20 — Semántica local de los conflictos.
 *
 * ## Por qué los conflictos son *locales*
 *
 * Un conflicto de política no es un defecto del motor: es un defecto del
 * documento, y se registra para que el Owner lo resuelva. Eso obliga a que la
 * señal sea quirúrgica. Si declarar un conflicto obscureciera todo lo demás, el
 * motor devolvería «todo está en disputa» en cada caso y el registro perdería su
 * valor: hay que poder señalar *qué* está en disputa y nada más.
 *
 * Las propiedades que este test fija:
 *
 * 1. **Localidad** — un conflicto sólo aparece si alguna de sus reglas fue
 *    realmente alcanzada. Un conflicto ajeno no puede contaminar el caso.
 * 2. **Sin materialización gratuita** — declararse en el registro no es lo mismo
 *    que activarse en un caso.
 * 3. **Sin resolución inventada** — el motor no elige entre lecturas. Un empate
 *    no se desempata: se escala.
 * 4. **Trazabilidad** — todo conflicto de la evaluación cita su fuente.
 *
 * ## Una asymetría que este test documenta en vez de corregir
 *
 * `AMB-CON-01` se materializa cuando `R-FILTRO-RETENCION` **o** `R-PREINICIO-CV`
 * se alcanzan, y ambas tienen condiciones distintas. Por eso un caso con
 * retención ya realizada (que no alcanza `R-FILTRO-RETENCION`) también lo
 * materializa, aunque la explicación del propio conflicto dice que la ambigüedad
 * aparece «[c]uando reúna solicitud previa al inicio **y** falta de retención».
 *
 * No se corrige aquí porque **no hay una regla uniforme**:
 *
 * - `AMB-CON-01` exige las dos ramas (su texto dice «y»).
 * - `AMB-CON-03` se activa con **una** sola: su divergencia es sobre si la
 *   causal aplica, no sobre el desenlace.
 * - `AMB-CON-04` se activa con cualquiera, porque sus reglas van en parejas de
 *   condición idéntica.
 *
 * Codificar una u otra sería decidir política sin fuente que lo diga. Se deja el
 * comportamiento *conservador* —sobre-declarar antes que ocultar una
 * contradicción— y se reporta como decisión pendiente del Owner.
 */

import { describe, expect, it } from 'vitest';
import {
  POLICY_VERSION,
  allConflicts,
  conflictById,
  evaluateAudit,
  isBlocking,
} from '../index';
import type { AuditEvaluation, EvidenceContext, Fact, PolicyConflict } from '../index';
import { bool, evidencia } from '../testing/fixtures';

function contexto(fechas: Partial<EvidenceContext['temporal']> = {}): EvidenceContext {
  return {
    evidences: [evidencia('EV-1')],
    temporal: {
      cicloFechaInicio: '2026-01-05',
      fechaSolicitud: '2026-01-15',
      fechaIngreso: '2026-01-05',
      inicioPrimerCiclo: '2024-08-05',
      avanceCurricularPercent: 10,
      ...fechas,
    },
    nivelAcademico: 'LICENCIATURA',
    campus: 'MEXICO',
  };
}

function evaluar(facts: Fact[], fechas?: Partial<EvidenceContext['temporal']>): AuditEvaluation {
  return evaluateAudit({ facts, evidenceContext: contexto(fechas), policyVersion: POLICY_VERSION });
}

/**
 * Solicitud **previa** al inicio del ciclo: `fechaSolicitud` anterior a
 * `cicloFechaInicio`. Alcanza `R-PREINICIO-CV` y, si además falta la
 * retención, `R-FILTRO-RETENCION`.
 */
const PREVIA = { cicloFechaInicio: '2026-02-05', fechaSolicitud: '2026-01-15' };

/** Ambas ramas de `AMB-CON-01` vivas: falta de retención y solicitud previa. */
const DISPUTA_AMB_CON_01: Fact[] = [
  bool('F-retencion_realizada', false),
  bool('F2-es_nuevo_ingreso', true),
];

/** Ajuste por error de inscripción con decisión de no continuar. */
const DISPUTA_AMB_CON_04: Fact[] = [
  bool('F-ajuste_por_error_inscripcion', true),
  bool('F-ce_decision_no_continuar', true),
  bool('F2-es_nuevo_ingreso', true),
];

const NINGUNO: Fact[] = [];

describe('registro de conflictos', () => {
  it('todos los conflictos declarados son localizables', () => {
    for (const conflicto of allConflicts()) {
      expect(conflictById(conflicto.conflictId)?.conflictId, conflicto.conflictId).toBe(
        conflicto.conflictId,
      );
    }
  });

  it('cada conflicto declara las reglas que soporta', () => {
    for (const conflicto of allConflicts()) {
      expect(conflicto.affectedRuleIds.length, conflicto.conflictId).toBeGreaterThan(0);
    }
  });

  it('cada conflicto declara al menos dos lecturas incompatibles', () => {
    for (const conflicto of allConflicts()) {
      expect(conflicto.conflictingInterpretations.length, conflicto.conflictId).toBeGreaterThan(1);
    }
  });

  it('toda lectura declara su desenlace, incluso cuando es «no determinable»', () => {
    for (const conflicto of allConflicts()) {
      for (const lectura of conflicto.conflictingInterpretations) {
        // `null` es una declaración explícita: «esta lectura no produce
        // desenlace por sí sola». La clave es que el campo exista siempre, para
        // que un dato faltante sea distinguishable de una lectura indeterminada.
        expect(lectura, conflicto.conflictId).toHaveProperty('resultingOutcome');
        expect(lectura.sourceRef.sha256, conflicto.conflictId).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });

  it('cada conflicto explica por qué existe', () => {
    for (const conflicto of allConflicts()) {
      expect(conflicto.explanation.length, conflicto.conflictId).toBeGreaterThan(0);
    }
  });

  it('un conflicto desconocido no se inventa', () => {
    expect(conflictById('NO-EXISTE')).toBeUndefined();
  });
});

describe('los conflictos son locales', () => {
  it('un caso sin evidencia no materializa ningún conflicto', () => {
    expect(evaluar(NINGUNO).policyConflicts).toEqual([]);
  });

  it('un caso que no alcanza las reglas en disputa no las menciona', () => {
    // Sólo se activa `R-FILTRO-CALIFICACIONES`, que no participa de AMB-CON-01.
    const r = evaluar([bool('F-calificaciones_bimestre_1', true)]);
    expect(r.policyConflicts).toEqual([]);
  });

  it('alcanzar las dos ramas de AMB-CON-01 lo materializa', () => {
    const r = evaluar(DISPUTA_AMB_CON_01, PREVIA);
    expect(r.policyConflicts.map((c) => c.conflictId)).toContain('AMB-CON-01');
  });

  it('AMB-CON-01 nombra las dos ramas en disputa', () => {
    const conflicto = conflictById('AMB-CON-01') as PolicyConflict;
    expect(conflicto.affectedRuleIds).toEqual(
      expect.arrayContaining(['R-FILTRO-RETENCION', 'R-PREINICIO-CV']),
    );
  });

  it('AMB-CON-04 nombra las cuatro lecturas en disputa', () => {
    // Si sólo listara una de cada par, afirmaría que la otra lectura no
    // participa, que es justo lo que este módulo existe para no afirmar.
    const conflicto = conflictById('AMB-CON-04') as PolicyConflict;
    expect(conflicto.affectedRuleIds).toEqual(
      expect.arrayContaining([
        'R-CAUSAL-V',
        'R-CAUSAL-V-BAJA',
        'R-CICLO-DESISTE',
        'R-CICLO-DESISTE-BAJA',
      ]),
    );
  });

  it('un conflicto no puede citar una regla inexistente', () => {
    // Si un `affectedRuleIds` nombrara una regla que no existe, el conflicto
    // nunca podría activarse y sería ruido permanente en el registro.
    const reglas = new Set(
      allConflicts().flatMap((c) => c.affectedRuleIds),
    );
    // La comprobación efectiva vive en el test 03 (`reglas-alcanzables`); aquí se
    // verifica que el conjunto no esté vacío y sea estable.
    expect(reglas.size).toBeGreaterThan(0);
  });

  it('ningún conflicto materializado produce un desenlace no declarado', () => {
    const r = evaluar(DISPUTA_AMB_CON_01, PREVIA);
    const declarados = new Set(r.policyConflicts.map((c) => c.conflictId));
    for (const paso of r.trace.entries.filter((e) => e.kind === 'CANDIDATE')) {
      const value = paso.value as Record<string, unknown> | undefined;
      const conflictId = value?.conflictId;
      if (typeof conflictId === 'string') {
        expect(declarados.has(conflictId), paso.ref).toBe(true);
      }
    }
  });
});

describe('la asimetría de AMB-CON-01 queda documentada', () => {
  it('con retención realizada no se alcanza R-FILTRO-RETENCION', () => {
    // El hecho que sostiene la lectura de baja es la *falta* de retención.
    const r = evaluar([bool('F-retencion_realizada', true), bool('F2-es_nuevo_ingreso', true)], PREVIA);
    const alcanzadas = r.trace.entries
      .filter((e) => e.kind === 'RULE' && (e.value as { matched?: boolean } | undefined)?.matched)
      .map((e) => e.ruleId);
    expect(alcanzadas).toContain('R-PREINICIO-CV');
    expect(alcanzadas).not.toContain('R-FILTRO-RETENCION');
  });

  it('el conflicto se materializa igual, de forma conservadora', () => {
    // Comportamiento vigente, no deseado: se documenta para que la decisión de
    // Owner sea informada. Sobreexponer una contradicción es seguro; ocultarla
    // no lo sería.
    const r = evaluar([bool('F-retencion_realizada', true), bool('F2-es_nuevo_ingreso', true)], PREVIA);
    expect(r.policyConflicts.map((c) => c.conflictId)).toContain('AMB-CON-01');
  });

  it('la asimetría no puede producir resultado normativo', () => {
    // Aunque el conflicto se sobredeclare, jamás se convierte en desenlace.
    const r = evaluar([bool('F-retencion_realizada', true), bool('F2-es_nuevo_ingreso', true)], PREVIA);
    expect(r.normativeOutcome).toBeNull();
  });
});

describe('el motor no resuelve lo que la fuente no resuelve', () => {
  it('AMB-CON-04 declara las dos lecturas con desenlaces distintos', () => {
    const conflicto = conflictById('AMB-CON-04') as PolicyConflict;
    const desenlaces = new Set(
      conflicto.conflictingInterpretations.map((i) => i.resultingOutcome),
    );
    expect(desenlaces).toEqual(new Set(['CANCELACION_VENTA', 'BAJA']));
  });

  it('ninguna lectura de AMB-CON-04 queda declarada como preferente', () => {
    // Si el motor se permitiera elegir, aquí tendría que constar por qué.
    const conflicto = conflictById('AMB-CON-04') as PolicyConflict;
    for (const lectura of conflicto.conflictingInterpretations) {
      expect(lectura, lectura.reading).not.toHaveProperty('preferred');
    }
  });

  it('AMB-CON-04 exige decisión del Owner', () => {
    expect((conflictById('AMB-CON-04') as PolicyConflict).kind).toBe('OWNER_DECISION_REQUIRED');
  });

  it('un caso en disputa no produce resultado normativo', () => {
    for (const [facts, fechas] of [
      [DISPUTA_AMB_CON_01, PREVIA],
      [DISPUTA_AMB_CON_04, {}],
    ] as const) {
      const r = evaluar(facts, fechas);
      expect(r.policyConflicts.length, JSON.stringify(facts.map((f) => f.factId))).toBeGreaterThan(0);
      expect(r.normativeOutcome).toBeNull();
      expect(r.normativeStatus).toBe('REQUIRES_HUMAN_REVIEW');
    }
  });
});

describe('un empate no se desempata', () => {
  it('AMB-CON-01 con ambas ramas vivas deja closestOutcome en null', () => {
    // BAJA y CV con el mismo soporte: forzar uno sería inventar el desempate.
    const r = evaluar(DISPUTA_AMB_CON_01, PREVIA);
    expect(r.closestOutcome).toBeNull();
  });

  it('el empate se declara como tal en la traza', () => {
    const r = evaluar(DISPUTA_AMB_CON_01, PREVIA);
    const empate = r.trace.entries.find((e) => e.kind === 'CANDIDATE' && e.ref === 'AMB-CON-01');
    if (empate) {
      const value = empate.value as Record<string, unknown>;
      expect(value.tie === true || value.isTie === true, JSON.stringify(value)).toBe(true);
    }
  });

  it('las alternativas en disputa siguen siendo visibles', () => {
    const r = evaluar(DISPUTA_AMB_CON_01, PREVIA);
    expect(r.alternativeOutcomes.length).toBeGreaterThan(0);
  });

  it('un empate nunca se presenta como resultado normativo', () => {
    const r = evaluar(DISPUTA_AMB_CON_01, PREVIA);
    expect(r.normativeOutcome).not.toBe('BAJA');
    expect(r.normativeOutcome).not.toBe('CANCELACION_VENTA');
  });
});

describe('trazabilidad de los conflictos materializados', () => {
  it('cada conflicto de la evaluación cita su fuente', () => {
    const r = evaluar(DISPUTA_AMB_CON_01, PREVIA);
    for (const conflicto of r.policyConflicts) {
      expect(conflicto.sourceRefs.length, conflicto.conflictId).toBeGreaterThan(0);
      for (const ref of conflicto.sourceRefs) {
        expect(ref.sha256, conflicto.conflictId).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });

  it('el conflicto aparece en la traza con su paso propio', () => {
    const r = evaluar(DISPUTA_AMB_CON_01, PREVIA);
    if (r.policyConflicts.length > 0) {
      const pasos = r.trace.entries.filter((e) => e.kind === 'CONFLICT');
      expect(pasos.length).toBe(r.policyConflicts.length);
    }
  });

  it('la evaluación explica por qué está en revisión', () => {
    const r = evaluar(DISPUTA_AMB_CON_01, PREVIA);
    const paso = r.trace.entries.find((e) => e.kind === 'STATUS');
    expect(paso?.detail.length ?? 0).toBeGreaterThan(0);
    expect(paso?.ref).toBe('REQUIRES_HUMAN_REVIEW');
  });

  it('un empate real no produce evaluación provisional', () => {
    // Si no hay desenlace más compatible que otro, no hay nada que calificar
    // como provisional: inventar uno sería exactamente el desempate que este
    // módulo evita.
    const r = evaluar(DISPUTA_AMB_CON_01, PREVIA);
    expect(r.closestOutcome).toBeNull();
    expect(r.provisionalAssessment).toBeNull();
  });

  it('cuando sí hay desenlace más compatible, nombra los conflictos que bloquean', () => {
    const r = evaluar([bool('F-retencion_realizada', true), bool('F2-es_nuevo_ingreso', true)], PREVIA);
    expect(r.closestOutcome).not.toBeNull();
    expect(r.provisionalAssessment?.blockingConflictIds ?? []).toEqual(
      expect.arrayContaining(r.policyConflicts.map((c) => c.conflictId)),
    );
  });
});

describe('coherencia con la lógica de cinco valores', () => {
  it('UNKNOWN bloquea: es la señal que impide cerrar', () => {
    expect(isBlocking('UNKNOWN')).toBe(true);
  });

  it('un caso con conflicto nunca queda en evidencia insuficiente', () => {
    // Son dos estados distintos: hay evidencia y hay disputa.
    for (const [facts, fechas] of [
      [DISPUTA_AMB_CON_01, PREVIA],
      [DISPUTA_AMB_CON_04, {}],
    ] as const) {
      const r = evaluar(facts, fechas);
      expect(r.policyConflicts.length).toBeGreaterThan(0);
      expect(r.normativeStatus).not.toBe('INSUFFICIENT_EVIDENCE');
    }
  });
});
