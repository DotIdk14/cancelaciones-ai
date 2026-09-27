/**
 * Lenguaje de condiciones declarativo y su evaluación de cinco valores.
 *
 * ## Por qué cinco valores y no tres
 *
 * La lógica de tres valores de `decision-tree.md` §4 (`TRUE` / `FALSE` /
 * `UNKNOWN`) es correcta pero insuficiente: la §4.3 exige además distinguir
 * centinelas. Este motor evalúa cinco:
 *
 * | Valor            | Significado                                        | ¿Cierra como `FALSE`? |
 * |------------------|----------------------------------------------------|------------------------|
 * | `TRUE`           | La condición se cumple                              | —                      |
 * | `FALSE`          | La condición no se cumple                           | Sí, es `FALSE` real     |
 * | `UNKNOWN`        | Se buscó y no se pudo determinar                    | **NO**                 |
 * | `NOT_APPLICABLE` | La norma excluye el caso                            | **NO**                 |
 * | `CONTRADICTED`   | Evidencia en conflicto interno                      | **NO**                 |
 *
 * `UNKNOWN`, `NOT_APPLICABLE` y `CONTRADICTED` se propagan y se reportan, pero
 * **nunca** se convierten en `FALSE` para desbloquear una decisión. Esa es la
 * diferencia entre un motor que puede fallar en silencio y uno que no.
 *
 * `NOT_APPLICABLE` ≠ `UNKNOWN` porque la fuente los distingue: «la norma excluye
 * este caso» (`XDC-06`, reingreso fuera del subárbol D53) no es «no sabemos»
 * (`G-13`, no hay evidencia de la ventana temporal).
 */

import type { Fact, TemporalContext } from './contracts';
import * as temporal from './temporal';

/** Valor de una condición evaluada. */
export type ConditionValue = 'TRUE' | 'FALSE' | 'UNKNOWN' | 'NOT_APPLICABLE' | 'CONTRADICTED';

/** Predicado temporal evaluable. */
export type TemporalPredicate =
  | 'WITHIN_20_DAYS_OF_START'
  | 'WITHIN_2_WEEKS_AFTER_START'
  | 'BEFORE_START'
  | 'BEFORE_SUNDAY_OF_WEEK_2'
  | 'BEFORE_FIRST_SUNDAY_OF_CYCLE'
  | 'AFTER_WEEK_3_IRREVERSIBILITY'
  | 'ONE_DAY_BEFORE_START'
  | 'SIX_MONTHS_FROM_ENTRY'
  | 'SIX_MONTHS_FROM_FIRST_CYCLE'
  | 'FIFTY_PERCENT_ADVANCE'
  | 'WITHIN_FIRST_MONTH_OF_ENTRY';

/** Árbol de condiciones serializable. */
export type Condition =
  | { readonly kind: 'and'; readonly operands: readonly Condition[] }
  | { readonly kind: 'or'; readonly operands: readonly Condition[] }
  | { readonly kind: 'not'; readonly operand: Condition }
  /** El hecho es `KNOWN` y su valor es truthy. */
  | { readonly kind: 'fact'; readonly factId: string }
  /** El hecho es `KNOWN` y su valor es exactamente `value`. */
  | { readonly kind: 'equals'; readonly factId: string; readonly value: unknown }
  /** El hecho es `KNOWN` y su valor está en `values`. */
  | { readonly kind: 'in'; readonly factId: string; readonly values: readonly unknown[] }
  | { readonly kind: 'temporal'; readonly predicate: TemporalPredicate }
  | { readonly kind: 'alwaysTrue' }
  | { readonly kind: 'alwaysFalse' };

// ---------------------------------------------------------------------------
// Constructores
// ---------------------------------------------------------------------------

export const all = (...operands: Condition[]): Condition => ({ kind: 'and', operands });
export const any = (...operands: Condition[]): Condition => ({ kind: 'or', operands });
export const not = (operand: Condition): Condition => ({ kind: 'not', operand });
export const fact = (factId: string): Condition => ({ kind: 'fact', factId });
export const equals = (factId: string, value: unknown): Condition => ({ kind: 'equals', factId, value });
export const isIn = (factId: string, values: readonly unknown[]): Condition => ({ kind: 'in', factId, values });
export const when = (predicate: TemporalPredicate): Condition => ({ kind: 'temporal', predicate });
export const ALWAYS_TRUE: Condition = { kind: 'alwaysTrue' };
export const ALWAYS_FALSE: Condition = { kind: 'alwaysFalse' };

// ---------------------------------------------------------------------------
// Evaluación
// ---------------------------------------------------------------------------

/** Resultado de evaluar una condición, con los hechos que la bloquean. */
export interface ConditionEvaluation {
  readonly value: ConditionValue;
  /** Hechos con estado distinto de `KNOWN` que la condición consultó. */
  readonly blockingFactIds: readonly string[];
  /** Hechos con estado `CONTRADICTED`. */
  readonly contradictoryFactIds: readonly string[];
  /** Motivo legible para la traza. */
  readonly reason: string;
  /** Conflictos temporales explícitos cuando la condición alcanza un umbral en disputa. */
  readonly temporalConflicts: readonly temporal.TemporalConflict[];
  /** Identificadores de los hechos `KNOWN` que la condición usó. */
  readonly usedFactIds: readonly string[];
}

const EMPTY: readonly string[] = [];

/**
 * `EMPTY` es `readonly string[]` y sirve para los campos de identificadores.
 * Los conflictos temporales son objetos, así que necesitan su propia constante
 * vacía con el tipo correcto.
 */
const NO_TEMPORAL_CONFLICTS: readonly temporal.TemporalConflict[] = [];

/** Índice de hechos por `factId`, con detección de duplicados. */
export class FactIndex {
  private readonly byId: ReadonlyMap<string, Fact>;

  constructor(facts: readonly Fact[]) {
    const map = new Map<string, Fact>();
    for (const item of facts) {
      if (map.has(item.factId)) {
        throw new RangeError(`Hecho duplicado en la entrada: ${item.factId}.`);
      }
      map.set(item.factId, item);
    }
    this.byId = map;
  }

  get(factId: string): Fact | undefined {
    return this.byId.get(factId);
  }

  has(factId: string): boolean {
    return this.byId.has(factId);
  }

  get size(): number {
    return this.byId.size;
  }

  all(): readonly Fact[] {
    return [...this.byId.values()];
  }
}

/**
 * Traduce el estado de un hecho a valor de condición.
 *
 * `KNOWN` + valor truthy → `TRUE`; `KNOWN` + valor falsy → `FALSE`;
 * el resto se propaga tal cual. Un hecho ausente se trata como `UNKNOWN`: la
 * ausencia de un hecho en la entrada es ausencia de evidencia, no `FALSE`.
 */
function evaluateFactRef(index: FactIndex, factId: string): ConditionEvaluation {
  const found = index.get(factId);
  if (!found) {
    return {
      value: 'UNKNOWN',
      blockingFactIds: [factId],
      contradictoryFactIds: EMPTY,
      reason: `El hecho ${factId} no fue provisto: se trata como UNKNOWN, nunca como FALSE.`,
      temporalConflicts: NO_TEMPORAL_CONFLICTS,
      usedFactIds: EMPTY,
    };
  }
  switch (found.state) {
    case 'KNOWN':
      return {
        value: truthy(found.value) ? 'TRUE' : 'FALSE',
        blockingFactIds: EMPTY,
        contradictoryFactIds: EMPTY,
        reason: `Hecho ${factId} = ${JSON.stringify(found.value)} (KNOWN).`,
        temporalConflicts: NO_TEMPORAL_CONFLICTS,
        usedFactIds: [factId],
      };
    case 'UNKNOWN':
      return {
        value: 'UNKNOWN',
        blockingFactIds: [factId],
        contradictoryFactIds: EMPTY,
        reason: `Hecho ${factId} = UNKNOWN (${found.unknownReason ?? 'sin razón declarada'}).`,
        temporalConflicts: NO_TEMPORAL_CONFLICTS,
        usedFactIds: EMPTY,
      };
    case 'NOT_APPLICABLE':
      return {
        value: 'NOT_APPLICABLE',
        blockingFactIds: [factId],
        contradictoryFactIds: EMPTY,
        reason: `Hecho ${factId} = NOT_APPLICABLE (${found.notes ?? 'la norma excluye el caso'}).`,
        temporalConflicts: NO_TEMPORAL_CONFLICTS,
        usedFactIds: EMPTY,
      };
    case 'CONTRADICTED':
      return {
        value: 'CONTRADICTED',
        blockingFactIds: [factId],
        contradictoryFactIds: [factId],
        reason: `Hecho ${factId} = CONTRADICTED (${found.notes ?? 'evidencia en conflicto'}).`,
        temporalConflicts: NO_TEMPORAL_CONFLICTS,
        usedFactIds: EMPTY,
      };
    default: {
      const exhaustive: never = found.state;
      throw new RangeError(`Estado de hecho no soportado: ${String(exhaustive)}.`);
    }
  }
}

/** Semántica de truthiness del motor: sólo `true` y `false` explícitos cuentan. */
function truthy(value: unknown): boolean {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === 'string') return value.length > 0;
  if (typeof value === 'number') return value !== 0;
  return value !== null && value !== undefined;
}

function mergeUnique(...groups: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>();
  for (const group of groups) for (const id of group) seen.add(id);
  return [...seen].sort();
}

function mergeConflicts(
  ...groups: readonly (readonly temporal.TemporalConflict[])[]
): temporal.TemporalConflict[] {
  const byId = new Map<string, temporal.TemporalConflict>();
  for (const group of groups) for (const conflict of group) byId.set(conflict.conflictId, conflict);
  return [...byId.values()].sort((a, b) => (a.conflictId < b.conflictId ? -1 : a.conflictId > b.conflictId ? 1 : 0));
}

const TEMPORAL_FNS: Record<TemporalPredicate, (context: TemporalContext) => temporal.TemporalResult> = {
  WITHIN_20_DAYS_OF_START: temporal.withinTwentyDaysOfStart,
  WITHIN_2_WEEKS_AFTER_START: temporal.withinTwoWeeksAfterStart,
  BEFORE_START: temporal.beforeStart,
  BEFORE_SUNDAY_OF_WEEK_2: temporal.beforeSundayOfWeekTwo,
  BEFORE_FIRST_SUNDAY_OF_CYCLE: temporal.beforeFirstSundayOfCycle,
  AFTER_WEEK_3_IRREVERSIBILITY: temporal.afterWeekThreeIrreversibility,
  ONE_DAY_BEFORE_START: temporal.oneDayBeforeStart,
  SIX_MONTHS_FROM_ENTRY: temporal.sixMonthsFromEntry,
  SIX_MONTHS_FROM_FIRST_CYCLE: temporal.sixMonthsFromFirstCycle,
  FIFTY_PERCENT_ADVANCE: temporal.fiftyPercentAdvanceReached,
  WITHIN_FIRST_MONTH_OF_ENTRY: temporal.withinFirstMonthOfEntry,
};

/** Evalúa un predicado temporal por nombre. */
export function evaluateTemporalPredicate(
  predicate: TemporalPredicate,
  context: TemporalContext,
): temporal.TemporalResult {
  const fn = TEMPORAL_FNS[predicate];
  if (!fn) throw new RangeError(`Predicado temporal desconocido: ${String(predicate)}.`);
  return fn(context);
}

/**
 * Evalúa una condición.
 *
 * Reglas de propagación (decision-tree.md §4.1, extendidas a cinco valores):
 *
 * `AND` — `FALSE` domina (`UNKNOWN ∧ FALSE = FALSE`); si no hay `FALSE`,
 * `CONTRADICTED` domina sobre `UNKNOWN` (la contradicción es más específica);
 * luego `UNKNOWN`; luego `NOT_APPLICABLE`; si no, `TRUE`.
 *
 * `OR` — `TRUE` domina (`UNKNOWN ∨ TRUE = TRUE`); si no hay `TRUE`,
 * `CONTRADICTED` domina sobre `UNKNOWN`; luego `UNKNOWN`; luego
 * `NOT_APPLICABLE`; si no, `FALSE`.
 *
 * `NOT` — invierte `TRUE`/`FALSE`; el resto se propaga sin cambios.
 */
export function evaluateCondition(
  condition: Condition,
  index: FactIndex,
  temporalContext: TemporalContext,
): ConditionEvaluation {
  switch (condition.kind) {
    case 'alwaysTrue':
      return {
        value: 'TRUE',
        blockingFactIds: EMPTY,
        contradictoryFactIds: EMPTY,
        reason: 'Condición constante verdadera.',
        temporalConflicts: NO_TEMPORAL_CONFLICTS,
        usedFactIds: EMPTY,
      };

    case 'alwaysFalse':
      return {
        value: 'FALSE',
        blockingFactIds: EMPTY,
        contradictoryFactIds: EMPTY,
        reason: 'Condición constante falsa.',
        temporalConflicts: NO_TEMPORAL_CONFLICTS,
        usedFactIds: EMPTY,
      };

    case 'fact':
      return evaluateFactRef(index, condition.factId);

    case 'equals': {
      const base = evaluateFactRef(index, condition.factId);
      if (base.value !== 'TRUE' && base.value !== 'FALSE') {
        return { ...base, reason: `${base.reason} No se puede comparar por igualdad.` };
      }
      const found = index.get(condition.factId);
      const equal = found?.value === condition.value;
      return {
        ...base,
        value: equal ? 'TRUE' : 'FALSE',
        reason: `Hecho ${condition.factId} = ${JSON.stringify(found?.value)}; se esperaba ${JSON.stringify(condition.value)}.`,
      };
    }

    case 'in': {
      const base = evaluateFactRef(index, condition.factId);
      if (base.value !== 'TRUE' && base.value !== 'FALSE') {
        return { ...base, reason: `${base.reason} No se puede comprobar pertenencia.` };
      }
      const found = index.get(condition.factId);
      const included = condition.values.some((candidate) => candidate === found?.value);
      return {
        ...base,
        value: included ? 'TRUE' : 'FALSE',
        reason: `Hecho ${condition.factId} = ${JSON.stringify(found?.value)}; dominio ${JSON.stringify(condition.values)}.`,
      };
    }

    case 'temporal': {
      const result = evaluateTemporalPredicate(condition.predicate, temporalContext);
      return {
        value: result.value,
        blockingFactIds: EMPTY,
        contradictoryFactIds: EMPTY,
        reason: result.reason,
        temporalConflicts: result.conflicts,
        usedFactIds: EMPTY,
      };
    }

    case 'not': {
      const inner = evaluateCondition(condition.operand, index, temporalContext);
      const value: ConditionValue =
        inner.value === 'TRUE' ? 'FALSE' : inner.value === 'FALSE' ? 'TRUE' : inner.value;
      return { ...inner, value, reason: `NOT(${inner.reason})` };
    }

    case 'and': {
      const parts = condition.operands.map((operand) =>
        evaluateCondition(operand, index, temporalContext),
      );
      const value = foldAnd(parts.map((part) => part.value));
      return {
        value,
        blockingFactIds: mergeUnique(...parts.map((part) => part.blockingFactIds)),
        contradictoryFactIds: mergeUnique(...parts.map((part) => part.contradictoryFactIds)),
        reason: `AND de ${parts.length} operandos = ${value}.`,
        temporalConflicts: mergeConflicts(...parts.map((part) => part.temporalConflicts)),
        usedFactIds: mergeUnique(...parts.map((part) => part.usedFactIds)),
      };
    }

    case 'or': {
      const parts = condition.operands.map((operand) =>
        evaluateCondition(operand, index, temporalContext),
      );
      const value = foldOr(parts.map((part) => part.value));
      return {
        value,
        blockingFactIds: mergeUnique(...parts.map((part) => part.blockingFactIds)),
        contradictoryFactIds: mergeUnique(...parts.map((part) => part.contradictoryFactIds)),
        reason: `OR de ${parts.length} operandos = ${value}.`,
        temporalConflicts: mergeConflicts(...parts.map((part) => part.temporalConflicts)),
        usedFactIds: mergeUnique(...parts.map((part) => part.usedFactIds)),
      };
    }

    default: {
      const exhaustive: never = condition;
      throw new RangeError(`Condición no soportada: ${JSON.stringify(exhaustive)}.`);
    }
  }
}

/** `AND` de cinco valores. `FALSE` domina; luego `CONTRADICTED`; luego `UNKNOWN`. */
export function foldAnd(values: readonly ConditionValue[]): ConditionValue {
  if (values.some((value) => value === 'FALSE')) return 'FALSE';
  if (values.some((value) => value === 'CONTRADICTED')) return 'CONTRADICTED';
  if (values.some((value) => value === 'UNKNOWN')) return 'UNKNOWN';
  if (values.some((value) => value === 'NOT_APPLICABLE')) return 'NOT_APPLICABLE';
  return 'TRUE';
}

/** `OR` de cinco valores. `TRUE` domina; luego `CONTRADICTED`; luego `UNKNOWN`. */
export function foldOr(values: readonly ConditionValue[]): ConditionValue {
  if (values.some((value) => value === 'TRUE')) return 'TRUE';
  if (values.some((value) => value === 'CONTRADICTED')) return 'CONTRADICTED';
  if (values.some((value) => value === 'UNKNOWN')) return 'UNKNOWN';
  if (values.some((value) => value === 'NOT_APPLICABLE')) return 'NOT_APPLICABLE';
  return 'FALSE';
}

/** ¿El valor permite cerrar la rama como coincidencia? */
export function isMatch(value: ConditionValue): boolean {
  return value === 'TRUE';
}

/** ¿El valor exige detenerse y pedir evidencia o revisión? */
export function isBlocking(value: ConditionValue): boolean {
  return value === 'UNKNOWN' || value === 'CONTRADICTED';
}

/**
 * `factId`s referenciados por una condición, en orden de aparición y sin
 * duplicar.
 *
 * Existe para el reporte de evidencia faltante: la única forma de saber si una
 * regla bloqueada es «un hecho falta y ya sabemos del resto» o «no sabemos
 * nada de esta rama» es contar cuántos hechos consulta y cuáles están
 * resueltos. Recorrer el árbol en el evaluador sería duplicar el parser.
 *
 * Las referencias dentro de `not(...)` se incluyen igual: el hecho sigue siendo
 * consultado, y que la conclusión se invierta es problema de la regla, no de
 * la evidencia.
 */
export function conditionFactIds(condition: Condition): string[] {
  const found: string[] = [];
  const visit = (node: Condition): void => {
    switch (node.kind) {
      case 'fact':
      case 'equals':
      case 'in':
        if (!found.includes(node.factId)) found.push(node.factId);
        return;
      case 'and':
      case 'or':
        for (const operand of node.operands) visit(operand);
        return;
      case 'not':
        visit(node.operand);
        return;
      case 'temporal':
      case 'alwaysTrue':
      case 'alwaysFalse':
        return;
      default: {
        const exhaustive: never = node;
        throw new RangeError(`Condición no soportada: ${JSON.stringify(exhaustive)}.`);
      }
    }
  };
  visit(condition);
  return found;
}
