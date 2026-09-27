/**
 * Tipos compartidos del evaluador.
 *
 * `RuleApplication` es el resultado de evaluar una regla. Vive aquí, y no en
 * `evaluate-audit.ts`, porque `ranking/` y `trace/` lo consumen y no deben
 * importar el evaluador: si lo hicieran, el ranking dependería del recorrido y
 * dejaría de ser una función pura del conjunto de reglas.
 */

import type { ConditionValue } from '../conditions';
import type { Rule } from '../rules/types';
import type { NodeId } from '../nodes/graph';

/** Resultado de evaluar una regla contra el caso. */
export interface RuleApplication {
  readonly rule: Rule;
  readonly nodeId: NodeId;
  /** Valor de cinco valores de la condición. */
  readonly conditionValue: ConditionValue;
  /** `true` si la condición se cumplió (`TRUE`). */
  readonly matched: boolean;
  /** `true` si una contraevidencia neutralizó la coincidencia. */
  readonly blocked: boolean;
  /** Reglas cuya coincidencia bloqueó esta. */
  readonly blockingRuleIds: readonly string[];
  /** Hechos no determinables que la condición consultó. */
  readonly blockingFactIds: readonly string[];
  /** Hechos `CONTRADICTED` que la condición consultó. */
  readonly contradictoryFactIds: readonly string[];
  /** Hechos `KNOWN` que la condición usó. */
  readonly usedFactIds: readonly string[];
  /** Conflictos declarados y temporales que esta regla alcanza. */
  readonly conflictIds: readonly string[];
  /** Motivo legible de la evaluación de la condición. */
  readonly reason: string;
}

/** Resumen de un nodo evaluado. */
export interface NodeEvaluation {
  readonly nodeId: NodeId;
  readonly applications: readonly RuleApplication[];
  /** Coincidencias que sobrevivieron a la contraevidencia. */
  readonly effectiveApplications: readonly RuleApplication[];
}
