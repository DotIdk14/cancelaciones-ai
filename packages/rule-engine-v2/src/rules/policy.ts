/**
 * Registro de reglas completo del Policy V2.
 *
 * El archivo es puro y determinista: concatena las colecciones existentes.
 */

import type { Rule } from './types';
import { FILTERS, TEMPORAL } from './types';
import { CAUSALS } from './causals';
import { CV_DEF, D53, RETENTION } from './phase15';

export const RULES: readonly Rule[] = [
  ...FILTERS,
  ...TEMPORAL,
  ...CAUSALS,
  ...CV_DEF,
  ...D53,
  ...RETENTION,
] as const;

/** Mapa por `ruleId`. No modifica orden. */
export function ruleById(ruleId: string): Rule | undefined {
  return RULES.find((rule) => rule.ruleId === ruleId);
}

/** Reglas aplicables a un nodo determinado. */
export function rulesForNode(nodeId: string): readonly Rule[] {
  return RULES.filter((rule) => rule.nodeId === nodeId);
}

export { type Rule, type RuleKind, type DecisionTarget } from './types';
export { FILTERS, TEMPORAL } from './types';
export { CAUSALS } from './causals';
export { CV_DEF, D53, RETENTION } from './phase15';
