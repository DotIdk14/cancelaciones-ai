/**
 * Test 3/20 — Integridad referencial del registro normativo.
 *
 * Este test existe porque durante la implementación se encontraron **19
 * referencias colgantes** que ningún test detectaba:
 *
 * - `allConflicts()` devolvía sólo los `XDC-*` y omitía los 9 `AMB-*`, así que
 *   toda referencia de regla a un conflicto `AMB-*` parecía no resolver.
 * - 9 `affectedRuleIds` apuntaban a reglas inexistentes (`R-D53-RELOJ`,
 *   `R-ILOC-ESPECIAL`, `R-DOC-A`, `R-D53-COMPROMISO`, `R-ILOC-ACTIVIDAD`,
 *   `R-ILOC-NO-CONTINUAR`): nombres sin sufijo frente a las reglas reales
 *   `-6M`, `-ESPECIAL-CV`, `-A-BREAK`, `-OK`/`-FALTA`, etc.
 * - 17 `requiredBy` del catálogo apuntaban a las mismas reglas fantasma.
 *
 * Un conflicto que nombra una regla inexistente no se materializa nunca, porque
 * el filtro de conflicto local compara contra `ruleId` reales. Es decir: la
 * ambigüedad se reportaba como resuelta porque su regla nunca existió.
 *
 * Estos tests son la red que impide que eso vuelva a pasar.
 */

import { describe, expect, it } from 'vitest';
import {
  FACT_DEFINITIONS,
  RULES,
  allConflicts,
  conflictById,
  isKnownFact,
  rulesForNode,
} from '../index';
import { NODE_ORDER, NODES } from '../index';

const RULE_IDS = new Set(RULES.map((rule) => rule.ruleId));
const CONFLICT_IDS = new Set(allConflicts().map((conflict) => conflict.conflictId));
const FACT_IDS = new Set(FACT_DEFINITIONS.map((definition) => definition.factId));

describe('integridad referencial del registro normativo', () => {
  it('no tiene affectedRuleIds que apunten a reglas inexistentes', () => {
    const colgantes: string[] = [];
    for (const conflict of allConflicts()) {
      for (const ruleId of conflict.affectedRuleIds) {
        if (!RULE_IDS.has(ruleId)) colgantes.push(`${conflict.conflictId} -> ${ruleId}`);
      }
    }
    expect(colgantes).toEqual([]);
  });

  it('no tiene conflictIds de regla que no resuelvan a un conflicto declarado', () => {
    const colgantes: string[] = [];
    for (const rule of RULES) {
      for (const conflictId of rule.conflictIds ?? []) {
        if (!CONFLICT_IDS.has(conflictId)) colgantes.push(`${rule.ruleId} -> ${conflictId}`);
      }
    }
    expect(colgantes).toEqual([]);
  });

  it('no tiene requiredBy de catálogo que apunten a reglas inexistentes', () => {
    const colgantes: string[] = [];
    for (const definition of FACT_DEFINITIONS) {
      for (const ruleId of definition.requiredBy) {
        if (!RULE_IDS.has(ruleId)) colgantes.push(`${definition.factId} -> ${ruleId}`);
      }
    }
    expect(colgantes).toEqual([]);
  });

  it('no tiene factId duplicados en el catálogo', () => {
    const ids = FACT_DEFINITIONS.map((definition) => definition.factId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no tiene ruleId duplicados en el registro', () => {
    const ids = RULES.map((rule) => rule.ruleId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every rule belongs to a node that exists in NODE_ORDER', () => {
    const nodos = new Set<string>(NODE_ORDER);
    const huerfanas = RULES.filter((rule) => !nodos.has(rule.nodeId)).map((r) => r.ruleId);
    expect(huerfanas).toEqual([]);
  });

  it('every rule that blocksRuleIds points to an existing rule', () => {
    const colgantes: string[] = [];
    for (const rule of RULES) {
      for (const blocked of rule.blocksRuleIds ?? []) {
        if (!RULE_IDS.has(blocked)) colgantes.push(`${rule.ruleId} -> ${blocked}`);
      }
    }
    expect(colgantes).toEqual([]);
  });

  it('expone los conflictos AMB-* junto con los XDC-*', () => {
    // Regresión de `allConflicts()`: antes sólo devolvía DRAFTS.
    expect(allConflicts().some((c) => c.conflictId === 'AMB-CON-04')).toBe(true);
    expect(allConflicts().some((c) => c.conflictId === 'XDC-01')).toBe(true);
    expect(conflictById('AMB-LOG-02')).toBeDefined();
  });

  it('catalogs the derived facts so their provenance is resolvable', () => {
    // Sin entrada en el catálogo, la traza no puede responder de dónde salió el
    // hecho que consultó una regla.
    for (const factId of ['F-nivel-academico', 'F-sin-actividad-nivel', 'F-con-actividad-nivel']) {
      expect(isKnownFact(factId)).toBe(true);
    }
  });

  it('declares sourceRefs in every rule', () => {
    // Una regla sin cita no es trazable a la fuente (`TRACE_EVERY_DECISION`).
    const sinCita = RULES.filter((rule) => rule.sourceRefs.length === 0).map((r) => r.ruleId);
    expect(sinCita).toEqual([]);
  });

  it('ties every sourceRef to a sealed source with a sha256', () => {
    for (const rule of RULES) {
      for (const ref of rule.sourceRefs) {
        expect(ref.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(['SOURCE-01', 'SOURCE-02', 'SOURCE-03']).toContain(ref.sourceLockId);
        expect(ref.page).toBeGreaterThan(0);
        expect(ref.statementId).not.toBe('');
      }
    }
  });

  it('uses each node declared in NODE_ORDER for at least one rule or a documented delegation', () => {
    // NODE-D35-DELEGADO es el único nodo sin reglas propias: su regla vive en
    // NODE-ILOC y lo escala. Se documenta aquí para que la excepción sea
    // explícita y no parezca un hueco.
    const sinReglas = NODE_ORDER.filter((nodeId) => rulesForNode(nodeId).length === 0);
    expect(sinReglas).toEqual(['NODE-D35-DELEGADO']);
  });

  it('keeps every declared conflict reachable from at least one rule', () => {
    // Un conflicto que ninguna regla referencia nunca se materializa, porque el
    // filtro de conflicto local compara `ruleId` reales. Se verificó que los 18
    // conflictos declarados (9 XDC + 8 AMB) están referenciados por al menos una
    // regla.
    const referenciados = new Set(RULES.flatMap((rule) => rule.conflictIds ?? []));
    const noReferenciados = [...CONFLICT_IDS].filter((id) => !referenciados.has(id));
    expect(noReferenciados).toEqual([]);
  });

  it('fact catalog contains no definition without a factId collision with rules', () => {
    for (const rule of RULES) {
      // los factIds usados en la condicion deben existir
      for (const factId of conditionFactsOf(rule)) {
        expect(FACT_IDS.has(factId)).toBe(true);
      }
    }
  });
});

/** Extrae los `factId` de la condición de una regla. */
function conditionFactsOf(rule: { condition: unknown }): string[] {
  const found: string[] = [];
  const visit = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    if (node.kind === 'fact' || node.kind === 'equals' || node.kind === 'in') {
      if (typeof node.factId === 'string' && !found.includes(node.factId)) found.push(node.factId);
      return;
    }
    if (node.kind === 'and' || node.kind === 'or') {
      for (const operand of node.operands ?? []) visit(operand);
      return;
    }
    if (node.kind === 'not') visit(node.operand);
  };
  visit(rule.condition);
  return found;
}

describe('nodos sin reglas', () => {
  /**
   * Un nodo vacío es inerte, pero su etiqueta viaja a la traza. Sin esta regla,
   * un mantenedor podría leer «D35 delegado (5.8.h.c)» y dar por cubierta una
   * sección que ningún nodo atiende. Por eso el bidireccional: todo nodo vacío
   * debe justificar su existencia, y ningún nodo con reglas puede(alias)
   * justificarse como placeholder.
   */
  it('todo nodo sin reglas declara por qué existe', () => {
    for (const nodeId of NODE_ORDER) {
      const node = NODES[nodeId];
      const vacio = rulesForNode(nodeId).length === 0;
      if (vacio) {
        expect(node.placeholderReason, nodeId).toBeTruthy();
      }
    }
  });

  it('ningún nodo con reglas se disfraza de placeholder', () => {
    for (const nodeId of NODE_ORDER) {
      if (rulesForNode(nodeId).length > 0) {
        expect(NODES[nodeId].placeholderReason, nodeId).toBeUndefined();
      }
    }
  });

  it('todo nodo sin reglas es inerte: no altera ningún desenlace', () => {
    for (const nodeId of NODE_ORDER) {
      if (rulesForNode(nodeId).length === 0) {
        expect(NODES[nodeId].declaresPrecedence, nodeId).toBe(false);
      }
    }
  });

  it('la sección citada por un nodo vacío no promete reglas que no tiene', () => {
    // `NODE-D35-DELEGADO` rotula 5.8.h.c, y el inventario normativo sólo llega
    // a 5.8.h.vi. El placeholderReason es lo que evita que esa diferencia pase
    // inadvertida.
    const vacios = NODE_ORDER.filter((nodeId) => rulesForNode(nodeId).length === 0);
    for (const nodeId of vacios) {
      expect(NODES[nodeId].placeholderReason, nodeId).toMatch(/no contiene|reservad/i);
    }
  });
});
