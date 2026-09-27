/**
 * Test 21 — Restricción del desenlace de auditoría (obligatorio).
 *
 * ```
 * PRIMARY_NORMATIVE_DECISION_SOURCE = GDM_GAM_PRD_MLG_003
 * AUXILIARY_SOURCE_CANNOT_DEFINE_TOP_LEVEL_OUTCOME
 * ```
 *
 * ## Por qué estos tests son obligatorios y no una curiosidad
 *
 * Es tentador tratar «D53 es un procedimiento real, y el primario lo lista entre
 * los procedimientos que referencia» como permiso para que D53 cierre casos. No
 * lo es. El primario referencia a D53 igual que referencia a un manual de
 * tickets: usa su contenido sin adoptar sus desenlaces. Si una regla de D53
 * pudiera emitir un desenlace de primer nivel, entonces cambiar una auxiliary
 * source cambiaría la resolución de una auditoría de deserción, y el SHA-256 del
 * procedimiento rector dejaría de explicar el resultado.
 *
 * Estos tests son la defensa automática de esa separación.
 */

import { describe, expect, it } from 'vitest';
import {
  OUTCOMES,
  POLICY_VERSION,
  RULES,
  SOURCES,
  isNormativeAuthority,
  isPrimaryNormativeSource,
  provisionalOnlyRules,
  sourceById,
} from '../index';
import type { EvidenceContext, Fact, Rule } from '../index';
import { bool, evidencia } from '../testing/fixtures';

const PRIMARY = 'GDM_GAM_PRD_MLG_003';

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

const reglasQueEmiten = RULES.filter((rule) => rule.onMatch.kind === 'OUTCOME');
const auxiliares = SOURCES.filter((source) => !isPrimaryNormativeSource(source.sourceLockId as never));

describe('rol de las fuentes', () => {
  it('exactamente una fuente es la autoridad normativa primaria', () => {
    expect(SOURCES.filter((s) => isPrimaryNormativeSource(s.sourceLockId as never))).toHaveLength(1);
  });

  it('la autoridad primaria es GDM_GAM_PRD_MLG_003', () => {
    const primaria = SOURCES.find((s) => isPrimaryNormativeSource(s.sourceLockId as never));
    expect(primaria?.documentCode).toBe(PRIMARY);
  });

  it('D53 es fuente auxiliar referenciada, no primaria', () => {
    expect(sourceById('SOURCE-02' as never).documentCode).toBe('GDM_GAM_PRD_MXL_008');
    expect(isPrimaryNormativeSource('SOURCE-02' as never)).toBe(false);
  });

  it('el glosario es fuente auxiliar de definición, no primaria', () => {
    expect(sourceById('SOURCE-03' as never).role).toBe('AUXILIARY_DEFINITION_SOURCE');
    expect(isPrimaryNormativeSource('SOURCE-03' as never)).toBe(false);
  });

  it('D53 no es un desenlace de primer nivel', () => {
    // `D53 IS NOT A TOP-LEVEL AUDIT OUTCOME`: el nombre del procedimiento no
    // puede aparecer en el catálogo de desenlaces de deserción.
    expect(OUTCOMES as readonly string[]).not.toContain('D53');
    for (const outcome of OUTCOMES) {
      expect(outcome, outcome).not.toMatch(/D53/);
    }
  });
});

describe('una fuente auxiliar no puede fundamentar un desenlace', () => {
  it('una regla apoyada sólo en fuentes auxiliares nunca es autoritativa', () => {
    // Éste es el invariante real, y no «no existir reglas así»: existen cuatro
    // reglas de D53 que proponen desenlace, y lo que garantiza el motor es que
    // **ninguna** pueda fundar un desenlace normativo. Lo contrario sería
    // exigir que el registro ocultara reglas legítimas para hacer más corto el
    // test.
    const apoyadasSoloEnAuxiliares = reglasQueEmiten.filter(
      (rule) => rule.sourceRefs.every((ref) => !isPrimaryNormativeSource(ref.sourceLockId as never)),
    );
    for (const rule of apoyadasSoloEnAuxiliares) {
      const grounded =
        rule.primaryGrounding !== undefined &&
        isPrimaryNormativeSource(rule.primaryGrounding.sourceLockId as never);
      if (grounded) {
        // Único caso admisible: la fuente auxiliar propone, y el primario la
        // conecta explícitamente. `R-RET-03` (glosario) con `N-32` (primario).
        expect(isNormativeAuthority(rule), rule.ruleId).toBe(true);
      } else {
        expect(isNormativeAuthority(rule), rule.ruleId).toBe(false);
      }
    }
  });

  it('toda regla que propone desenlace sin grounding del primario queda provisional', () => {
    const ids = new Set(provisionalOnlyRules(RULES).map((rule) => rule.ruleId));
    for (const rule of reglasQueEmiten) {
      if (!isNormativeAuthority(rule)) {
        expect(ids.has(rule.ruleId), rule.ruleId).toBe(true);
      }
    }
  });

  it('toda regla provisional-only cita al menos una fuente auxiliar', () => {
    // Es la definición del caso: si no cita al primario y no tiene grounding,
    // su proposición viene de una auxiliar.
    for (const rule of provisionalOnlyRules(RULES)) {
      const autoritativa = isNormativeAuthority(
        RULES.find((r) => r.ruleId === rule.ruleId) as Rule,
      );
      expect(autoritativa, rule.ruleId).toBe(false);
    }
  });

  it('toda regla provisional-only declara qué ambigüedad espera', () => {
    // Sin esto, la UI sólo podría decir «revisar», que es justo lo que el
    // producto prohíbe: la revisión debe ser accionable.
    for (const rule of provisionalOnlyRules(RULES)) {
      expect(rule.awaitsAmbiguityIds.length, rule.ruleId).toBeGreaterThan(0);
    }
  });

  it('ninguna regla provisional-only cita al primario en sus propias citas', () => {
    // Si citara al primario, sería autoritativa por la vía directa. Que alguna lo
    // haga y aún así sea provisional sería una incoherencia del registro.
    for (const rule of provisionalOnlyRules(RULES)) {
      for (const ref of rule.sourceRefs) {
        expect(isPrimaryNormativeSource(ref.sourceLockId as never), rule.ruleId).toBe(false);
      }
    }
  });

  it('el glosario sólo aporta vocabulario: nunca fundamento de un desenlace', () => {
    const soloGlosario = RULES.filter(
      (rule) =>
        rule.sourceRefs.length > 0 && rule.sourceRefs.every((ref) => ref.sourceLockId === 'SOURCE-03'),
    );
    for (const rule of soloGlosario) {
      // Puede proponer desenlace —`R-RET-03` lo hace— pero sólo si el primario
      // lo conecta explícitamente. Sin ese grounding sería una invención: el
      // glosario define «permanencia», no resuelve deserciones.
      const grounded =
        rule.primaryGrounding !== undefined &&
        isPrimaryNormativeSource(rule.primaryGrounding.sourceLockId as never);
      if (rule.onMatch.kind === 'OUTCOME' && !grounded) {
        expect(isNormativeAuthority(rule), rule.ruleId).toBe(false);
      }
    }
  });

  it('ninguna regla del glosario queda provisional sin naming su ambigüedad', () => {
    for (const rule of RULES) {
      const soloGlosario =
        rule.sourceRefs.length > 0 && rule.sourceRefs.every((ref) => ref.sourceLockId === 'SOURCE-03');
      if (soloGlosario && rule.onMatch.kind === 'OUTCOME' && !isNormativeAuthority(rule)) {
        expect(rule.awaitsAmbiguityIds?.length ?? 0, rule.ruleId).toBeGreaterThan(0);
      }
    }
  });
});

describe('el grounding indirecto está explícito y es del primario', () => {
  it('toda regla con grounding lo cita en el primario', () => {
    for (const rule of RULES) {
      if (rule.primaryGrounding !== undefined) {
        expect(rule.primaryGrounding.sourceLockId, rule.ruleId).toBe('SOURCE-01');
      }
    }
  });

  it('ningún grounding apunta al glosario', () => {
    for (const rule of RULES) {
      if (rule.primaryGrounding !== undefined) {
        expect(rule.primaryGrounding.sourceLockId, rule.ruleId).not.toBe('SOURCE-03');
      }
    }
  });

  it('el grounding de R-RET-03 es N-32, el proceso de retención del primario', () => {
    // El primario sí ordena la retención y sus desenlaces en N-32. Eso es
    // grounding; el glosario sólo aporta el vocabulario de «permanencia».
    const rule = RULES.find((r) => r.ruleId === 'R-RET-03') as Rule;
    expect(rule.primaryGrounding?.statementId).toBe('N-32');
    expect(isNormativeAuthority(rule)).toBe(true);
  });
});

describe('el dominio de desenlaces es el del procedimiento rector', () => {
  it('ningún desenlace emitido queda fuera del catálogo', () => {
    const catalogue = new Set<string>(OUTCOMES);
    for (const rule of reglasQueEmiten) {
      if (rule.onMatch.kind === 'OUTCOME') {
        expect(catalogue.has(rule.onMatch.outcome), rule.ruleId).toBe(true);
      }
    }
  });

  it('el catálogo completo es el que declara el coverage matrix', () => {
    // Seis desenlaces de primer nivel. Este test falla si alguien añade uno sin
    // fundamento normativo en el primario.
    expect([...OUTCOMES].sort()).toEqual([
      'BAJA',
      'CANCELACION_MATRICULA',
      'CANCELACION_VENTA',
      'CANCELACION_VENTA_OPERATIVA',
      'DICTAMINACION',
      'RETENCION',
    ]);
  });

  it('ninguna fuente auxiliar nombra un desenlace propio', () => {
    // Los desenlaces de las auxiliares (si los tuviera) no entrarían al
    // catálogo: el catálogo es del primario.
    for (const source of auxiliares) {
      expect(OUTCOMES as readonly string[]).not.toContain(source.documentCode);
    }
  });
});
