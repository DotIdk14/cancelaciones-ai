/**
 * Grafo de nodos de decisión y recorrido determinista.
 *
 * Cada nodo agrupa reglas que compiten por el mismo desenlace. El evaluador
 * evalúa **todas** las reglas de un nodo: nunca cortocircuita por coincidencia
 * para poder detectar conflictos entre lecturas concurrentes de la misma fuente.
 *
 * ## Orden de recorrido
 *
 * El orden es explícito (`NODE_ORDER`), no derivado de hashes ni del orden de
 * inserción, para garantizar determinismo y trazabilidad.
 */

import type { Rule } from '../rules/types';
import { RULES, rulesForNode } from '../rules/policy';

/** Identificadores de nodo. */
export type NodeId =
  | 'NODE-FILTROS'
  | 'NODE-TEMPORAL'
  | 'NODE-PREINICIO'
  | 'NODE-CV-DEF'
  | 'NODE-CAUSALES'
  | 'NODE-ILOC'
  | 'NODE-OPERATIVA'
  | 'NODE-QUORUM'
  | 'NODE-DOCUMENTOS'
  | 'NODE-ESCALAMIENTO'
  | 'NODE-D53'
  | 'NODE-D53-SUBTREE'
  | 'NODE-D53-COMPROMISO'
  | 'NODE-RETENCION'
  | 'NODE-RET-PROCESO'
  | 'NODE-D35-DELEGADO';

export interface DecisionNode {
  readonly nodeId: NodeId;
  /** Etiqueta en español para la traza. */
  readonly label: string;
  /** Sección del documento rector que origina el nodo. */
  readonly section: string;
  /** `true` si el nodo puede cerrar el caso con un desenlace normativo. */
  readonly terminal: boolean;
  /**
   * `true` si las reglas del nodo declaran precedencia sobre reglas de otros
   * nodos. Sin este flag, ninguna regla puede desplazar a otra de otro nodo.
   */
  readonly declaresPrecedence: boolean;
  /**
   * Razón por la que el nodo existe sin reglas.
   *
   * Un nodo vacío es inerte —no altera ningún desenlace— pero su etiqueta viaja
   * a la traza, y «D35 delegado (5.8.h.c)» sugiere que ahí se resuelve la
   * sección 5.8.h.c. No la resuelve: el inventario normativo sólo contiene
   * 5.8.h.i a 5.8.h.vi, y esas las atienden `R-ILOC-SOLIC` (N-88) y
   * `R-ESCALAMIENTO-N89` (N-89) en otros nodos.
   *
   * Hacer la condición explícita —un nodo sin reglas debe justificar por qué—
   * convierte un hueco silencioso en un invariante verificable, y evita que un
   * mantenedor dé por cubierto algo que no lo está.
   */
  readonly placeholderReason?: string;
}

/**
 * Orden de recorrido normativo.
 *
 * §1 filtros → §2 temporal/preinicio → §12 definición CV → §3 causales →
 * §3.6-3.8 iloc → §3.9 operativas → §3.10 quórum → §3.13 documentos →
 * §3.14 escalamiento → §11 D53 → §13 retención → delegado D35.
 */
export const NODE_ORDER: readonly NodeId[] = [
  'NODE-FILTROS',
  'NODE-TEMPORAL',
  'NODE-PREINICIO',
  'NODE-CV-DEF',
  'NODE-CAUSALES',
  'NODE-ILOC',
  'NODE-OPERATIVA',
  'NODE-QUORUM',
  'NODE-DOCUMENTOS',
  'NODE-ESCALAMIENTO',
  'NODE-D53',
  'NODE-D53-SUBTREE',
  'NODE-D53-COMPROMISO',
  'NODE-RETENCION',
  'NODE-RET-PROCESO',
  'NODE-D35-DELEGADO',
] as const;

export const NODES: Readonly<Record<NodeId, DecisionNode>> = {
  'NODE-FILTROS': {
    nodeId: 'NODE-FILTROS',
    label: 'Filtros de prevalencia',
    section: '5.1-5.2',
    terminal: true,
    declaresPrecedence: true,
  },
  'NODE-TEMPORAL': {
    nodeId: 'NODE-TEMPORAL',
    label: 'Regla temporal rectora (20 días)',
    section: '5.2',
    terminal: true,
    declaresPrecedence: true,
  },
  'NODE-PREINICIO': {
    nodeId: 'NODE-PREINICIO',
    label: 'Solicitud previa al inicio',
    section: '5.3.a-5.3.c',
    terminal: true,
    declaresPrecedence: false,
  },
  'NODE-CV-DEF': {
    nodeId: 'NODE-CV-DEF',
    label: 'Definición de cancelación de venta (G-13)',
    section: '5.1.d',
    terminal: true,
    declaresPrecedence: false,
  },
  'NODE-CAUSALES': {
    nodeId: 'NODE-CAUSALES',
    label: 'Causales de cancelación',
    section: '5.2-5.6',
    terminal: true,
    declaresPrecedence: false,
  },
  'NODE-ILOC': {
    nodeId: 'NODE-ILOC',
    label: 'Estudiante ilocalizable',
    section: '5.8',
    terminal: true,
    declaresPrecedence: false,
  },
  'NODE-OPERATIVA': {
    nodeId: 'NODE-OPERATIVA',
    label: 'Causales operativas',
    section: '5.9',
    terminal: true,
    declaresPrecedence: true,
  },
  'NODE-QUORUM': {
    nodeId: 'NODE-QUORUM',
    label: 'Programa sin quórum',
    section: '5.11',
    terminal: true,
    declaresPrecedence: true,
  },
  'NODE-DOCUMENTOS': {
    nodeId: 'NODE-DOCUMENTOS',
    label: 'Documentación faltante',
    section: '5.7',
    terminal: true,
    declaresPrecedence: false,
  },
  'NODE-ESCALAMIENTO': {
    nodeId: 'NODE-ESCALAMIENTO',
    label: 'Escalamiento a Dictaminación',
    section: '5.4-5.7',
    terminal: true,
    declaresPrecedence: false,
  },
  'NODE-D53': {
    nodeId: 'NODE-D53',
    label: 'Aplicabilidad D53',
    section: '5.1.1',
    terminal: false,
    declaresPrecedence: false,
  },
  'NODE-D53-SUBTREE': {
    nodeId: 'NODE-D53-SUBTREE',
    label: 'D53: relojes e invariantes',
    section: '5.1.2-5.2.2',
    terminal: true,
    declaresPrecedence: false,
  },
  'NODE-D53-COMPROMISO': {
    nodeId: 'NODE-D53-COMPROMISO',
    label: 'D53: compromiso documental',
    section: '5.1.7-5.3.2',
    terminal: true,
    declaresPrecedence: false,
  },
  'NODE-RETENCION': {
    nodeId: 'NODE-RETENCION',
    label: 'Disparo del proceso de retención',
    section: 'G-14',
    terminal: false,
    declaresPrecedence: false,
  },
  'NODE-RET-PROCESO': {
    nodeId: 'NODE-RET-PROCESO',
    label: 'Retención: decisión de continuar',
    section: 'G-15',
    terminal: true,
    declaresPrecedence: false,
  },
  'NODE-D35-DELEGADO': {
    nodeId: 'NODE-D35-DELEGADO',
    label: 'D35 delegado (5.8.h.c)',
    section: '5.8',
    terminal: true,
    declaresPrecedence: false,
    placeholderReason:
      'Nodo reservado y vacío. El inventario normativo no contiene 5.8.h.c: las ' +
      'condiciones 5.8.h.i–5.8.h.vi las atienden R-ILOC-SOLIC (N-88) y ' +
      'R-ESCALAMIENTO-N89 (N-89). No se le asignan reglas porque hacerlo sería ' +
      'inventar una sección que la fuente no contiene. Abierto a decisión del ' +
      'Owner: confirmar si la delegación a D35 debe tener reglas propias.',
  },
} as const satisfies Record<NodeId, DecisionNode>;

/** Nodos de entrada del recorrido. */
export const ENTRY_NODES: readonly NodeId[] = ['NODE-FILTROS'] as const;

/** Nodos alcanzables por `ESCALATE_TO_NODE`. */
export const ESCALATION_TARGETS: readonly NodeId[] = NODE_ORDER.filter(
  (nodeId) => nodeId !== 'NODE-FILTROS' && nodeId !== 'NODE-TEMPORAL',
);

/** Reglas de un nodo, en orden estable. */
export function nodeRules(nodeId: NodeId): readonly Rule[] {
  return rulesForNode(nodeId);
}

/**
 * Reglas cuyo `blocksRuleIds` apuntan a `ruleId`.
 *
 * Se usa para neutralizar contraevidencia: si la regla bloqueante coincide, la
 * bloqueada no aporta soporte aunque su propia condición sea verdadera.
 */
export function blockersOf(ruleId: string): readonly Rule[] {
  return RULES.filter((rule) => rule.blocksRuleIds?.includes(ruleId));
}

/** Índice `ruleId` → regla, construido una vez. */
export const RULE_INDEX: ReadonlyMap<string, Rule> = new Map(
  RULES.map((rule) => [rule.ruleId, rule]),
);
