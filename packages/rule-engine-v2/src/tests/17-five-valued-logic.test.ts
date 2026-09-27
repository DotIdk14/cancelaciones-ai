/**
 * Test 17/20 — Lógica de cinco valores.
 *
 * ## La tabla
 *
 * | Estado           | ¿Coincide? | ¿Bloquea? | Por qué                                  |
 * | ---------------- | ---------- | --------- | ---------------------------------------- |
 * | `TRUE`           | sí         | no        | la evidencia dice que sí                 |
 * | `FALSE`          | no         | no        | la evidencia dice que no                 |
 * | `UNKNOWN`        | no         | **sí**    | nadie lo consultó                        |
 * | `NOT_APPLICABLE` | no         | **sí**    | la regla no aplica a este caso           |
 * | `CONTRADICTED`   | no         | **sí**    | dos evidencias oficiales se oponen       |
 *
 * La fila crítica es la tercera a la quinta: esos tres estados **bloquean**. Si
 * se comportaran como `FALSE`, el motor cerraría el caso con una negación que
 * nadie.evidenció, que es el modo de fallo más caro de un motor de política.
 */

import { describe, expect, it } from 'vitest';
import {
  all,
  any,
  equals,
  evaluateCondition,
  FactIndex,
  foldAnd,
  foldOr,
  hasFact,
  isBlocking,
  isMatch,
  not,
  when,
} from '../index';
import type { ConditionValue, Fact } from '../index';
import { TEMPORAL_DEFECTO } from '../testing/fixtures';
import { bool, contradicted, notApplicable, unknown as unknownFact } from '../testing/fixtures';

const TRUE = bool('V', true);
const FALSE_X = bool('X', false);
const FALSE = bool('V', false);
const UNKNOWN = unknownFact('V');
const NA = notApplicable('V');
const CONTRA = contradicted('V');

function index(fact: Fact): FactIndex {
  return new FactIndex([fact]);
}

function valor(fact: Fact, condition = hasFact('V')): ConditionValue {
  return evaluateCondition(condition, index(fact), TEMPORAL_DEFECTO).value;
}

describe('isMatch: sólo TRUE cierra una regla', () => {
  it('TRUE coincide', () => {
    expect(isMatch('TRUE')).toBe(true);
  });

  it('FALSE no coincide', () => {
    expect(isMatch('FALSE')).toBe(false);
  });

  it('ninguno de los otros tres coincide', () => {
    for (const value of ['UNKNOWN', 'NOT_APPLICABLE', 'CONTRADICTED'] as const) {
      expect(isMatch(value), value).toBe(false);
    }
  });
});

describe('isBlocking: sólo FALSE deja pasar', () => {
  it('FALSE no bloquea: la evidencia descartó la rama', () => {
    expect(isBlocking('FALSE')).toBe(false);
  });

  it('UNKNOWN y CONTRADICTED bloquean', () => {
    for (const value of ['UNKNOWN', 'CONTRADICTED'] as const) {
      expect(isBlocking(value), value).toBe(true);
    }
  });

  it('NOT_APPLICABLE no bloquea: no se pide evidencia de lo que no aplica', () => {
    // `isBlocking` responde «¿esto es evidencia que falta?», no «¿esto cerró?».
    // Un hecho declarado no aplicable está resuelto por definición: pedir su
    // evidencia sería pedir algo que no existe y que nadie debe producir.
    expect(isBlocking('NOT_APPLICABLE')).toBe(false);
    // Y aun así no coincide: la regla sigue sin poder disparar.
    expect(isMatch('NOT_APPLICABLE')).toBe(false);
  });

  it('TRUE no bloquea', () => {
    expect(isBlocking('TRUE')).toBe(false);
  });
});

describe('lectura de un hecho por estado', () => {
  it('KNOWN conserva su valor', () => {
    expect(valor(TRUE)).toBe('TRUE');
    expect(valor(FALSE)).toBe('FALSE');
  });

  it('UNKNOWN se propaga como UNKNOWN', () => {
    expect(valor(UNKNOWN)).toBe('UNKNOWN');
  });

  it('NOT_APPLICABLE se propaga como NOT_APPLICABLE', () => {
    expect(valor(NA)).toBe('NOT_APPLICABLE');
  });

  it('CONTRADICTED se propaga como CONTRADICTED', () => {
    expect(valor(CONTRA)).toBe('CONTRADICTED');
  });

  it('los tres estados no determinables se distinguen entre sí', () => {
    const vistos = new Set([valor(UNKNOWN), valor(NA), valor(CONTRA)]);
    // colapsarlos sería perder información que cambia decisiones.
    expect(vistos.size).toBe(3);
  });
});

describe('conjunción', () => {
  it('TRUE AND TRUE = TRUE', () => {
    expect(foldAnd(['TRUE', 'TRUE'])).toBe('TRUE');
  });

  it('FALSE domina: la evidencia descartar cierra la conjunción', () => {
    expect(foldAnd(['TRUE', 'FALSE'])).toBe('FALSE');
    expect(foldAnd(['FALSE', 'UNKNOWN'])).toBe('FALSE');
  });

  it('CONTRADICTED domina sobre UNKNOWN', () => {
    // La contradicción es más específica que la ausencia.
    expect(foldAnd(['UNKNOWN', 'CONTRADICTED'])).toBe('CONTRADICTED');
  });

  it('UNKNOWN y NOT_APPLICABLE bloquean sin volverse FALSE', () => {
    expect(foldAnd(['TRUE', 'UNKNOWN'])).toBe('UNKNOWN');
    expect(foldAnd(['TRUE', 'NOT_APPLICABLE'])).toBe('NOT_APPLICABLE');
  });
});

describe('disyunción', () => {
  it('TRUE domina la disyunción', () => {
    expect(foldOr(['FALSE', 'TRUE'])).toBe('TRUE');
    expect(foldOr(['UNKNOWN', 'TRUE'])).toBe('TRUE');
  });

  it('FALSE no absorbe lo indeterminado', () => {
    // `FALSE OR UNKNOWN` no es `FALSE`: sigue sin determinarse.
    expect(foldOr(['FALSE', 'UNKNOWN'])).toBe('UNKNOWN');
    expect(foldOr(['FALSE', 'CONTRADICTED'])).toBe('CONTRADICTED');
  });

  it('FALSE OR FALSE = FALSE', () => {
    expect(foldOr(['FALSE', 'FALSE'])).toBe('FALSE');
  });
});

describe('negación', () => {
  it('TRUE y FALSE se invierten', () => {
    expect(evaluateCondition(not(hasFact('V')), index(TRUE), TEMPORAL_DEFECTO).value).toBe('FALSE');
    expect(evaluateCondition(not(hasFact('V')), index(FALSE), TEMPORAL_DEFECTO).value).toBe('TRUE');
  });

  it('UNKNOWN sigue siendo UNKNOWN: no se convierte en FALSE', () => {
    // Éste es el error clásico: `not UNKNOWN = FALSE` cerraría el caso.
    expect(evaluateCondition(not(hasFact('V')), index(UNKNOWN), TEMPORAL_DEFECTO).value).toBe(
      'UNKNOWN',
    );
  });

  it('NOT_APPLICABLE y CONTRADICTED tampoco se invierten a FALSE', () => {
    expect(evaluateCondition(not(hasFact('V')), index(NA), TEMPORAL_DEFECTO).value).toBe(
      'NOT_APPLICABLE',
    );
    expect(evaluateCondition(not(hasFact('V')), index(CONTRA), TEMPORAL_DEFECTO).value).toBe(
      'CONTRADICTED',
    );
  });
});

describe('predicados temporales y de igualdad', () => {
  it('un predicado temporal no depende de los estados de hecho', () => {
    const conHechos = evaluateCondition(
      when('WITHIN_2_WEEKS_AFTER_START'),
      new FactIndex([TRUE]),
      TEMPORAL_DEFECTO,
    );
    const sinHechos = evaluateCondition(when('WITHIN_2_WEEKS_AFTER_START'), new FactIndex([]), TEMPORAL_DEFECTO);
    expect(conHechos.value).toBe('TRUE');
    expect(sinHechos.value).toBe('TRUE');
  });

  it('un predicado temporal sin fechas es UNKNOWN, no FALSE', () => {
    const resultado = evaluateCondition(when('BEFORE_START'), new FactIndex([]), {
      ...TEMPORAL_DEFECTO,
      cicloFechaInicio: null,
      fechaSolicitud: null,
    });
    expect(resultado.value).toBe('UNKNOWN');
  });

  it('la igualdad compara contra el valor conocido', () => {
    expect(evaluateCondition(equals('V', true), index(TRUE), TEMPORAL_DEFECTO).value).toBe('TRUE');
    expect(evaluateCondition(equals('V', true), index(FALSE), TEMPORAL_DEFECTO).value).toBe('FALSE');
  });

  it('la igualdad sobre un hecho indeterminado es indeterminado', () => {
    expect(evaluateCondition(equals('V', true), index(UNKNOWN), TEMPORAL_DEFECTO).value).toBe(
      'UNKNOWN',
    );
  });
});

describe('composición anidada', () => {
  it('un UNKNOWN anidado sigue bloqueando cuando nada lo resuelve', () => {
    // `not(W)` con W desconocido es UNKNOWN, y la rama hermana es FALSE, así que
    // la disyunción no puede resolverse.
    const resultado = evaluateCondition(
      all(hasFact('V'), any(not(hasFact('W')), hasFact('X'))),
      new FactIndex([TRUE, unknownFact('W'), FALSE_X]),
      TEMPORAL_DEFECTO,
    );
    expect(resultado.value).toBe('UNKNOWN');
  });

  it('un UNKNOWN no bloquea una disyunción que ya tiene un TRUE', () => {
    // `or` con una rama verdadera es verdadera: el UNKNOWN de la otra rama no
    // puededominarla. Éste no es un defecto, es la semántica de la disyunción.
    const resultado = evaluateCondition(
      any(not(hasFact('W')), hasFact('V')),
      new FactIndex([TRUE, unknownFact('W')]),
      TEMPORAL_DEFECTO,
    );
    expect(resultado.value).toBe('TRUE');
  });

  it('un hecho ausente se lee como UNKNOWN', () => {
    const resultado = evaluateCondition(hasFact('NO_EXISTE'), new FactIndex([TRUE]), TEMPORAL_DEFECTO);
    expect(resultado.value).toBe('UNKNOWN');
  });
});
