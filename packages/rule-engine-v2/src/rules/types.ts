/**
 * Tipos del registro de reglas y filtro de prevalencia + regla temporal
 * rectora (§1 y §2 de `decision-tree.md`).
 */

import type { Condition } from '../conditions';
import { all, any, equals, fact, isIn, not, when } from '../conditions';
import type { Outcome, SourceRef } from '../contracts';
import { primary } from '../sources';

/** Clasificación de una regla. Determina cómo se reporta en la traza. */
export type RuleKind =
  | 'PREVALENCE_FILTER'
  | 'TEMPORAL_RULING'
  | 'CAUSAL'
  | 'SUB_CAUSAL'
  | 'COUNTEREVIDENCE'
  | 'ESCALATION'
  | 'D53'
  | 'DEFINITION'
  | 'INVARIANT';

/**
 * Destino de una regla que coincide.
 *
 * `OWNER_DECISION_REQUIRED` existe para los casos en que la fuente **alcanza el
 * caso pero no fija desenlace**. Es distinto de un conflicto entre fuentes: aquí
 * la fuente es silenciosa, no contradictoria. Ambos terminan en
 * `REQUIRES_HUMAN_REVIEW`, pero el informe al Owner es distinto.
 */
export type DecisionTarget =
  | { readonly kind: 'OUTCOME'; readonly outcome: Outcome }
  | { readonly kind: 'ESCALATE_TO_NODE'; readonly nodeId: string }
  | { readonly kind: 'OWNER_DECISION_REQUIRED'; readonly conflictId: string }
  | { readonly kind: 'CONTINUE' };

export interface Rule {
  readonly ruleId: string;
  readonly nodeId: string;
  readonly kind: RuleKind;
  readonly description: string;
  readonly condition: Condition;
  readonly onMatch: DecisionTarget;
  /**
   * Prevalencia **declarada por texto**, expresada sobre reglas concretas.
   *
   * Sólo se rellena cuando el documento nombra la regla desplazada. Sin este
   * campo, dos reglas que coinciden con desenlaces distintos producen conflicto.
   */
  readonly declaredPrecedenceOver?: readonly string[];
  /**
   * Prevalencia **declarada por texto**, expresada sobre una categoría de
   * desenlace.
   *
   * Existe porque el documento excluye *categorías*, no reglas concretas. `N-64`
   * dice «por ningún motivo podrá ser considerado como cancelación de venta»: eso
   * cierra la puerta a **toda** regla que produzca `CANCELACION_VENTA`,
   * incluidas las que se agreguen mañana. Enumerar reglas hoy dejaría el mismo
   * hueco que las demás correcciones de este módulo cerraron: una exclusión normativa
   * que se comporta como si no existiera para las reglas que no estuviera en la
   * lista.   *
   * `decision-tree.md` §1.1 lo exige explícitamente: «Se implementa como
   * cortocircuito antes de cualquier evaluación causal».
   */
  readonly declaredPrecedenceOverOutcomes?: readonly Outcome[];

  /**
   * Cita del **primario** que autoriza a esta regla a determinar un desenlace
   * de primer nivel.
   *
   * ## Por qué existe
   *
   * `AUXILIARY_SOURCE_CANNOT_DEFINE_TOP_LEVEL_OUTCOME`. Una regla que emite
   * `OUTCOME` sin una cita en `GDM_GAM_PRD_MLG_003` está afirmando algo que
   * sólo el primario puede afirmar. En el registro actual existían cinco reglas
   * así: cuatro de D53 y una del glosario, ninguna con grounding en el primario.
   *
   * No se borran: el primario sí invoca a D53 (`N-139` en §10 lo lista entre los
   * procedimientos referenciados; `N-33` y `N-63` lo nombran). Lo que no hace es
   * autorizar sus desenlaces — sus bases normativas son `N-33`, `N-53`, `N-64` y
   * `N-98`, y ninguna cubre un plazo de 6 meses, un 50 % de avance, un
   * expediente incompleto ni una sospecha de apócrifo. Esos dependen de
   * `XDC-02`, `XDC-03`, `XDC-04`, `XDC-05`, `AMB-TEM-07` y `AMB-CON-02`, todas
   * sin respuesta del Owner.
   *
   * ## Consecuencia
   *
   * Sin `primaryGrounding`, la regla siguedicieniendo su desenlace —así el
   * ranking provisional puede ofrecerlo y el auditor recibe una respuesta— pero
   * ese desenlace **nunca** puede promoverse a `normativeOutcome`: el estado
   * pasa a `REQUIRES_HUMAN_REVIEW`. Se representa, se traza, se escala y se
   * continúa; no se borra ni se contesta por el Owner.
   */
  readonly primaryGrounding?: SourceRef;

  /**
   * Ambigüedades del Owner cuya respuesta convertiría esta regla en
   * autoritativa. Estructurado, no embebido en texto, para que la UI pueda
   * decir *por qué* espera revisión sin parsear prosa.
   */
  readonly awaitsAmbiguityIds?: readonly string[];
  /** Reglas que esta regla anula al coincidir. Modela contraevidencia. */
  readonly blocksRuleIds?: readonly string[];
  /** Conflictos declarados que esta regla alcanza si coincide. */
  readonly conflictIds?: readonly string[];
  readonly sourceRefs: readonly SourceRef[];
  /**
   * `true` si la regla depende de un umbral que la fuente NO declara. Se
   * evalúa y se reporta, pero el motor sabe que no puede cerrar con ella.
   */
  readonly dependsOnUndeclaredThreshold?: boolean;
  /** `true` si la regla sólo informa (no decide desenlace). */
  readonly informative?: boolean;
}

// ---------------------------------------------------------------------------
// §1 — Filtros de prevalencia
// ---------------------------------------------------------------------------

/**
 * Filtros de prevalencia de §1 del árbol.
 *
 * ## Cómo se implementa el cortocircuito
 *
 * Un cortocircuito de *regla* («el primer filtro que coincide gana») sería
 * incorrecto aquí: el orden en que el documento enumera los filtros no es un
 * criterio de prevalencia, y aplicarlo sería inventar política. Lo que el texto
 * declara es una exclusión por **categoría de desenlace**, y eso es lo que se
 * modela con `declaredPrecedenceOverOutcomes`.
 *
 * ## Filtros que NO declaran prevalencia
 *
 * - `R-FILTRO-RETENCION`: su texto dice «sin que la fecha de inicio ni la
 *   aplicación de D35 o D53 afecten», lo que insinúa prevalencia, pero
 *   `decision-tree.md` §1.4 registra que el documento **no** declara prevalencia
 *   frente a `N-27` y lo manda a `AMB-CON-01`. Declarar la prevalencia aquí
 *   resolvería en código una ambigüedad congelada. No se declara.
 * - `R-FILTRO-MYSTERY`: el texto es afirmativo («aplican como cancelación de
 *   matrícula»), no excluye nada. Si además el caso reuniera una causal de CV,
 *   el motor escala; ver `docs/reports/rule-engine-v2-implementation-report.md`.
 */
export const FILTERS: readonly Rule[] = [
  {
    ruleId: 'R-FILTRO-CALIFICACIONES',
    nodeId: 'NODE-FILTROS',
    kind: 'PREVALENCE_FILTER',
    description:
      'Si en el bimestre 1 o inicial ya tiene calificaciones, por ningún motivo podrá ser considerado como cancelación de venta y deberá ser considerado como una baja, debido al devengamiento del servicio.',
    condition: fact('F-calificaciones_bimestre_1'),
    onMatch: { kind: 'OUTCOME', outcome: 'BAJA' },
    // «por ningún motivo podrá ser considerado como cancelación de venta»: cierra
    // la puerta a TODA causal de CV, incluidas las que se agreguen después.
    declaredPrecedenceOverOutcomes: ['CANCELACION_VENTA'],
    sourceRefs: [primary(11, '5.7.a', 'N-64')],
  },
  {
    ruleId: 'R-FILTRO-MYSTERY',
    nodeId: 'NODE-FILTROS',
    kind: 'PREVALENCE_FILTER',
    description:
      'Todas las ventas que ingresen a través del canal de Mystery Shopper aplican como cancelación de matrícula.',
    condition: equals('F-canal_venta', 'MYSTERY_SHOPPER'),
    onMatch: { kind: 'OUTCOME', outcome: 'CANCELACION_MATRICULA' },
    sourceRefs: [primary(17, '5.12', 'N-105')],
  },
  {
    ruleId: 'R-FILTRO-INCIDENCIA-BAJA',
    nodeId: 'NODE-FILTROS',
    kind: 'PREVALENCE_FILTER',
    description:
      'La incidencia de sistema desactiva la operativa, pero si el estudiante expresa intención expresa de desertar por la incidencia el desenlace es baja.',
    condition: all(fact('F-op_incidencia_sistema'), fact('F-intencion_expresa_darse_de_baja')),
    onMatch: { kind: 'OUTCOME', outcome: 'BAJA' },
    // «Con N-98, si el estudiante expresa intención de desertar por la
    // incidencia, el desenlace es baja» (`decision-tree.md` §1.3): este caso
    // especial desplaza al filtro de incidencia, que por sí solo daría retención.
    declaredPrecedenceOver: ['R-FILTRO-INCIDENCIA'],
    sourceRefs: [primary(16, '5.9.c', 'N-96'), primary(16, '5.9.c', 'N-98')],
  },
  {
    ruleId: 'R-FILTRO-INCIDENCIA',
    nodeId: 'NODE-FILTROS',
    kind: 'PREVALENCE_FILTER',
    description:
      'No aplicará la política operativa de cancelación cuando la falta de activación, acceso o continuidad sea consecuencia de una incidencia identificada en el Aula Virtual, SIU u otros sistemas institucionales.',
    condition: fact('F-op_incidencia_sistema'),
    onMatch: { kind: 'OUTCOME', outcome: 'RETENCION' },
    sourceRefs: [primary(16, '5.9.c', 'N-95'), primary(16, '5.9.c', 'N-96')],
  },
  {
    ruleId: 'R-FILTRO-RETENCION',
    nodeId: 'NODE-FILTROS',
    kind: 'PREVALENCE_FILTER',
    description:
      'En caso de no realizarse el proceso de retención, la solicitud deberá gestionarse como baja, sin que la fecha de inicio ni la aplicación de D35 o D53 afecten dicha determinación.',
    condition: not(fact('F-retencion_realizada')),
    onMatch: { kind: 'OUTCOME', outcome: 'BAJA' },
    conflictIds: ['AMB-CON-01'],
    sourceRefs: [primary(5, '5.2', 'N-33')],
  },
] as const;

// ---------------------------------------------------------------------------
// §2 — Regla temporal rectora y pre-inicio (5.3)
// ---------------------------------------------------------------------------

export const TEMPORAL: readonly Rule[] = [
  {
    ruleId: 'R-REGLA-20-DIAS',
    nodeId: 'NODE-TEMPORAL',
    kind: 'TEMPORAL_RULING',
    description:
      'Transcurridos 20 días desde la fecha de inicio del ciclo, cualquier solicitud deberá gestionarse como baja, debido a que el estudiante habrá devengado un mes de servicio.',
    condition: not(when('WITHIN_20_DAYS_OF_START')),
    onMatch: { kind: 'OUTCOME', outcome: 'BAJA' },
    declaredPrecedenceOver: ['R-CV-DEF', 'R-D35-TARDE'],
    conflictIds: ['AMB-TEM-02'],
    sourceRefs: [primary(5, '5.2', 'N-35')],
  },
  {
    ruleId: 'R-PREINICIO-CV',
    nodeId: 'NODE-PREINICIO',
    kind: 'CAUSAL',
    description:
      'La cancelación de venta aplica cuando la solicitud del alumno es previa a la fecha de inicio de clases.',
    condition: all(when('BEFORE_START'), fact('F2-es_nuevo_ingreso')),
    onMatch: { kind: 'OUTCOME', outcome: 'CANCELACION_VENTA' },
    conflictIds: ['AMB-CON-01'],
    sourceRefs: [primary(4, '5.3.a', 'N-26'), primary(4, '5.3.a', 'N-27')],
  },
  {
    ruleId: 'R-D35-TARDE',
    nodeId: 'NODE-PREINICIO',
    kind: 'CAUSAL',
    description:
      'Con D35 o D53 extemporánea, la solicitud se acepta hasta el primer domingo del inicio del ciclo.',
    condition: all(
      not(when('BEFORE_START')),
      when('BEFORE_FIRST_SUNDAY_OF_CYCLE'),
      any(isIn('F2-decision_35', ['NO_ACEPTADO', 'PREADMITIDO']), fact('F2-decision_53_preadmitido')),
    ),
    onMatch: { kind: 'OUTCOME', outcome: 'CANCELACION_VENTA' },
    sourceRefs: [primary(4, '5.3.c', 'N-29')],
  },
] as const;
