/**
 * Prevalencia declarada por la fuente, en un solo lugar.
 *
 * ## Por qué existe
 *
 * La prevalencia se declara en dos formatos y ambos son normativos:
 *
 * 1. `declaredPrecedenceOver` — el texto nombra la regla desplazada.
 * 2. `declaredPrecedenceOverOutcomes` — el texto excluye una *categoría* de
 *    desenlace («por ningún motivo podrá ser considerado como cancelación de
 *    venta», `decision-tree.md` §1.1).
 *
 * Antes, `status.ts` calculaba la prevalencia por su cuenta y el ranking la
 * ignoraba por completo. Esa duplicación tenía dos fallos encadenados: un
 * desenlace desplazado podía seguir siendo elegido como `closestOutcome` en la
 * ruta de revisión, y no había forma de expresar una exclusión por categoría.
 * Ahora ambos consumidores leen este módulo.
 *
 * ## Lo que este módulo NO hace
 *
 * No infiere precedencia. No aplica la regla operativa aprobada por el Owner
 * (`OPERATIONAL_PRECEDENCE_IS_NOT_POLICY`). No ordena reglas por posición en el
 * árbol: el orden del documento no es un criterio de prevalencia y usarlo sería
 * inventar política.
 */

import type { Outcome } from '../contracts';
import { RULE_INDEX } from '../nodes/graph';
import type { RuleApplication } from './application';
import type { Rule } from '../rules/types';

/** Desenlace que declara una regla por `ruleId`, si lo declara. */
export function outcomeOfRule(ruleId: string): Outcome | undefined {
  const rule = RULE_INDEX.get(ruleId);
  if (!rule || rule.onMatch.kind !== 'OUTCOME') return undefined;
  return rule.onMatch.outcome;
}

export interface DeclaredPrecedence {
  /** Desenlaces desplazados por alguna regla coincidente. */
  readonly overridden: ReadonlySet<Outcome>;
  /** Para cada desenlace desplazado, qué regla lo desplazó. */
  readonly overriddenBy: ReadonlyMap<Outcome, readonly string[]>;
}

/**
 * Calcula la prevalencia declarada sobre las reglas **efectivas** (es decir, ya
 * sin las bloqueadas por contraevidencia).
 *
 * Sólo cuenta como prevalencia lo que el texto declara. Una regla desplazada
 * queda fuera; si el resto de las propuestas se reduce a un solo desenlace, el
 * caso es `DETERMINATE` con ese desenlace y no hay conflicto que escalar.
 */
export function computeDeclaredPrecedence(
  applications: readonly RuleApplication[],
  outcomeOfRule: (ruleId: string) => Outcome | undefined,
): DeclaredPrecedence {
  const overridden = new Set<Outcome>();
  const overriddenBy = new Map<Outcome, string[]>();

  const claim = (outcome: Outcome, rule: Rule): void => {
    overridden.add(outcome);
    const prior = overriddenBy.get(outcome);
    if (prior) {
      if (!prior.includes(rule.ruleId)) prior.push(rule.ruleId);
    } else {
      overriddenBy.set(outcome, [rule.ruleId]);
    }
  };

  for (const application of applications) {
    const rule = application.rule;
    if (rule.onMatch.kind !== 'OUTCOME') continue;

    for (const otherId of rule.declaredPrecedenceOver ?? []) {
      const other = outcomeOfRule(otherId);
      if (other) claim(other, rule);
    }

    for (const excluded of rule.declaredPrecedenceOverOutcomes ?? []) {
      claim(excluded, rule);
    }
  }

  return { overridden, overriddenBy };
}

/**
 * Desenlaces que sobreviven a la prevalencia declarada.
 *
 * Un desenlace propuesto sobrevive si nadie lo desplaza. Si la prevalencia
 * desplazara todos los propuestos, no sobrevive ninguno: eso no es «el
 * siguiente gana», es un caso sin salida y debe escalarse, no resolverse.
 */
export function survivingOutcomes(
  proposed: ReadonlySet<Outcome>,
  precedence: DeclaredPrecedence,
): Outcome[] {
  return [...proposed].filter((outcome) => !precedence.overridden.has(outcome));
}
