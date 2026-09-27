/**
 * Huella de una condición.
 *
 * Existe para que la traza diga, sin ambigüedad, *qué* condición evaluó cada
 * regla. Si dos reglas con la misma huella de condición coinciden y una es
 * bloqueada, la traza muestra que la causa fue la contraevidencia y no una
 * diferencia de texto.
 */

import type { Condition } from '../conditions';
import { stableHash } from './fingerprint';

/** Huella de 8 dígitos hexadecimales. */
export type Fingerprint = string;

/** Huella de una condición serializada canónicamente. */
export function conditionsFingerprint(condition: Condition): Fingerprint {
  return stableHash(canonicalCondition(condition));
}

/**
 * Forma canónica y estable de una condición.
 *
 * Las claves se ordenan y los `undefined` se eliminan, de modo que reordenar
 * el literal no cambia la huella.
 */
function canonicalCondition(condition: Condition): string {
  switch (condition.kind) {
    case 'and':
    case 'or':
      return `${condition.kind}(${condition.operands.map(canonicalCondition).join(',')})`;
    case 'not':
      return `not(${canonicalCondition(condition.operand)})`;
    case 'fact':
      return `fact(${condition.factId})`;
    case 'equals':
      return `equals(${condition.factId},${JSON.stringify(condition.value)})`;
    case 'in':
      return `in(${condition.factId},${JSON.stringify(condition.values)})`;
    case 'temporal':
      return `temporal(${condition.predicate})`;
    case 'alwaysTrue':
      return 'alwaysTrue';
    case 'alwaysFalse':
      return 'alwaysFalse';
    default: {
      const exhaustive: never = condition;
      throw new RangeError(`Condición no soportada: ${JSON.stringify(exhaustive)}.`);
    }
  }
}
