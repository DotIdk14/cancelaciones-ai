/**
 * Modelo de vista de la evaluación de auditoría.
 *
 * ```
 * HUMAN_REVIEW_DOES_NOT_ERASE_CLOSEST_OUTCOME
 * PROVISIONAL_IS_NOT_NORMATIVE
 * ```
 *
 * ## Por qué la regla vive aquí y no en el componente
 *
 * El requisito del producto es que la resolución sea el valor principal y que
 * `REQUIRES_HUMAN_REVIEW` sea un calificador aparte. Si esa regla vive en JSX,
 * no hay forma de comprobarla: un `text-warning` encima del desenlace es
 * indistinguible de un cartel de advertencia, y un refactor puede invertir la
 * jerarquía sin que nada lo note.
 *
 * Al expresarla como datos, la regla es comprobable: la resolución va en
 * `resolution`, el estado de revisión en `qualifier`, y un test falla si
 * alguno se intercambia.
 *
 * Se mantiene sin DOM a propósito —no hay `jsdom` en esta app— para que la
 * lógica de presentación se pueda verificar en el gate sin montar un navegador.
 */
import type {
  AuditEvaluationResponse,
  ProvisionalRankedEvaluation,
} from '@/server/audit-engine/evaluation-response';

/**
 * Etiquetas en español de los desenlaces de primer nivel.
 *
 * El vocabulario es del primario; las claves se validan contra `OUTCOMES` en los
 * tests para que un desenlace nuevo no se renderice como texto crudo.
 */
export const OUTCOME_LABELS: Record<string, string> = {
  CANCELACION_VENTA: 'Cancelación de venta',
  CANCELACION_VENTA_OPERATIVA: 'Cancelación de venta operativa',
  CANCELACION_MATRICULA: 'Cancelación de matrícula',
  BAJA: 'Baja',
  RETENCION: 'Retención',
  DICTAMINACION: 'Dictaminación',
};

/** Cómo se explica el puntaje de soporte, sin llamarlo «probabilidad». */
export const SUPPORT_SCORE_EXPLANATION =
  'El puntaje de soporte cuenta cuántas reglas independientes sostienen el desenlace. ' +
  'No es una probabilidad ni un porcentaje de acierto.';

export type EvaluationViewModel =
  | NormativeViewModel
  | ProvisionalRankedViewModel
  | ProvisionalUnresolvedViewModel;

interface ViewModelBase {
  /** Estado legible, siempre visible y siempre distinto del valor principal. */
  readonly statusLabel: string;
  /** El motivo, en la voz del motor y no una etiqueta genérica. */
  readonly reason: string;
  /** Qué falta para poder cerrar. Vacío cuando nada bloquea. */
  readonly pendingItems: readonly PendingItem[];
  /** Ambigüedades del Owner, mostradas como identificadores rastreables. */
  readonly pendingAmbiguityIds: readonly string[];
  /** Identificador de la evaluación, para enlazar la traza. */
  readonly traceFingerprint: string;
  /** Autoridad que puede fijar el desenlace. */
  readonly normativeSource: string;
}

/**
 * Un punto pendiente de la evaluación.
 *
 * `whatToDo` es obligatorio: un pendiente sin acción es ruido, y el auditor
 * acaba ignorar la lista entera.
 */
export interface PendingItem {
  readonly kind: 'AMBIGUITY' | 'FACT' | 'CONFLICT' | 'AUXILIARY_RULE';
  readonly id: string;
  readonly whatToDo: string;
}

interface NormativeViewModel extends ViewModelBase {
  readonly kind: 'NORMATIVE';
  /** Texto principal de la resolución. */
  readonly resolution: string;
  /** Etiqueta del desenlace normativo. */
  readonly resolutionLabel: string;
  readonly isNormative: true;
  /** En el caso normativo no hay calificador de revisión. */
  readonly qualifier: null;
  readonly supportingRuleIds: readonly string[];
  readonly supportExplanation: null;
}

interface ProvisionalRankedViewModel extends ViewModelBase {
  readonly kind: 'PROVISIONAL_RANKED';
  /**
   * La resolución más respaldada. Es el valor principal aunque no sea
   * normativa: el auditor necesita una respuesta, y ocultarla lo devuelve a la
   * hoja en blanco.
   */
  readonly resolution: string;
  readonly resolutionLabel: string;
  readonly isNormative: false;
  /**
   * El calificador. Vive aparte y nunca sustituye a `resolution`: es lo que
   * impide leer el resultado como dictamen.
   */
  readonly qualifier: string;
  readonly supportingRuleIds: readonly string[];
  readonly supportExplanation: string;
}

interface ProvisionalUnresolvedViewModel extends ViewModelBase {
  readonly kind: 'PROVISIONAL_UNRESOLVED';
  /** No hay resolución que mostrar y no se inventa. */
  readonly resolution: string;
  readonly resolutionLabel: null;
  readonly isNormative: false;
  readonly qualifier: string;
  readonly supportingRuleIds: readonly string[];
  readonly supportExplanation: null;
}

/**
 * Construye el modelo de vista.
 *
 * La distinción entre `PROVISIONAL_RANKED` y `PROVISIONAL_UNRESOLVED` se
 * hereda del contrato discriminado, no se recalcula: si el motor dice que no hay
 * ganador, la UI no puede fabricar uno.
 */
export function buildEvaluationViewModel(response: AuditEvaluationResponse): EvaluationViewModel {
  const base: ViewModelBase = {
    statusLabel: statusLabel(response),
    reason: response.reason,
    pendingItems: pendingItems(response),
    pendingAmbiguityIds: response.pendingAmbiguityIds,
    traceFingerprint: response.traceFingerprint,
    normativeSource: response.normativeSource,
  };

  if (response.evaluationKind === 'NORMATIVE_DETERMINATE') {
    return {
      ...base,
      kind: 'NORMATIVE',
      resolution: `Resultado normativo: ${label(response.normativeOutcome)}`,
      resolutionLabel: label(response.normativeOutcome),
      isNormative: true,
      qualifier: null,
      supportingRuleIds: [],
      supportExplanation: null,
    };
  }

  if (response.evaluationKind === 'PROVISIONAL_RANKED') {
    return {
      ...base,
      kind: 'PROVISIONAL_RANKED',
      // El texto principal empieza por «más compatible», no por el desenlace a
      // secas: el orden de las palabras mete la salvedad en la primera lectura.
      resolution: `Resolución más compatible: ${label(response.closestOutcome)}`,
      resolutionLabel: label(response.closestOutcome),
      isNormative: false,
      qualifier: 'Revisión humana requerida. Este resultado es provisional y no es un dictamen.',
      supportingRuleIds: response.supportingRuleIds,
      supportExplanation: SUPPORT_SCORE_EXPLANATION,
    };
  }

  return {
    ...base,
    kind: 'PROVISIONAL_UNRESOLVED',
    resolution: 'Sin resolución: la evidencia disponible no prefiere ningún desenlace.',
    resolutionLabel: null,
    isNormative: false,
    qualifier: 'Revisión humana requerida. No se ha determinado un desenlace.',
    supportingRuleIds: [],
    supportExplanation: null,
  };
}

function label(outcome: string): string {
  return OUTCOME_LABELS[outcome] ?? outcome;
}

function statusLabel(response: AuditEvaluationResponse): string {
  if (response.evaluationKind === 'NORMATIVE_DETERMINATE') return 'Determinado por la norma';
  if (response.evaluationKind === 'PROVISIONAL_RANKED') return 'Resultado provisional';
  return 'Sin resultado';
}

/**
 * Los puntos que impiden cerrar el caso.
 *
 * ## Por qué un caso normativo devuelve una lista vacía
 *
 * `missingFacts` del motor es el conjunto de requisitos de las reglas del
 * recorrido, incluidas las que no coincidieron. En un caso cerrado hay casi
 * siempre decenas de ellos: «recabar el hecho X» para reglas que no aplican a
 * este caso.
 *
 * Publicarlos aquí sería activamente engañoso. El encabezado dice «qué falta para
 * cerrar el caso», y en un caso ya cerrado no falta nada para cerrarlo: lo que
 * se sugeriría es reabrir una decisión que la fuente primaria ya tomó. Además
 * una lista de noventa ítems diluye los dos o tres que sí importan en el caso
 * que sí está abierto.
 *
 * Por eso la lista sólo se puebla cuando la evaluación no es normativa. El
 * resumen completo de requisitos sigue disponible en la traza del motor, que es
 * donde corresponde auditar el árbol entero.
 */
function pendingItems(response: AuditEvaluationResponse): readonly PendingItem[] {
  if (response.evaluationKind === 'NORMATIVE_DETERMINATE') return [];

  const items: PendingItem[] = [];
  for (const id of response.pendingAmbiguityIds) {
    items.push({
      kind: 'AMBIGUITY',
      id,
      whatToDo: `El Owner debe resolver la ambigüedad ${id}.`,
    });
  }
  for (const id of response.provisionalOnlyRuleIds) {
    items.push({
      kind: 'AUXILIARY_RULE',
      id,
      whatToDo:
        `La regla ${id} se apoya en una fuente auxiliar que no puede fijar el desenlace. ` +
        'Requiere grounding en la fuente primaria.',
    });
  }
  for (const id of response.conflictIds) {
    items.push({
      kind: 'CONFLICT',
      id,
      whatToDo: `Resolver el conflicto normativo ${id}.`,
    });
  }
  for (const id of response.missingFactIds) {
    items.push({
      kind: 'FACT',
      id,
      whatToDo: `Recabar el hecho ${id}.`,
    });
  }
  return items;
}

/** Reexportado para que el componente no dependa de la forma de la unión. */
export type { ProvisionalRankedEvaluation };
