/**
 * Conflictos normativos explícitos (`XDC-01` … `XDC-09`).
 *
 * ## Regla dura
 *
 * Ninguna de estas entradas resuelve un conflicto. Cada una **preserva todas las
 * lecturas** con su cita y su consecuencia. El motor nunca elige por
 * plausibilidad, ni por antigüedad, ni por especificidad, ni por ser el
 * documento rector, ni por comportamiento legacy (`NO_INVENT_RESOLUTIONS`).
 *
 * ## Activación perezosa
 *
 * Un conflicto se materializa **sólo** si la evaluación alcanza alguna de las
 * reglas de `affectedRuleIds`. Un caso que no toca `XDC-07` no lo ve. Esto es
 * lo que permite que un conflicto en una rama no bloquee el resto de las
 * auditorías (`CONFLICT_IS_LOCAL`).
 */

import type { Outcome, PolicyConflict, SourceRef } from '../contracts';
import { d53, glossary, primary } from '../sources';

type Draft = {
  readonly conflictId: string;
  readonly kind: PolicyConflict['kind'];
  readonly title: string;
  readonly affectedRuleIds: readonly string[];
  readonly sourceRefs: readonly SourceRef[];
  readonly conflictingInterpretations: PolicyConflict['conflictingInterpretations'];
  readonly candidateOutcomes: readonly Outcome[];
  readonly explanation: string;
};

const DRAFTS: readonly Draft[] = [
  {
    conflictId: 'XDC-01',
    kind: 'CROSS_DOCUMENT_CONFLICT',
    title: 'Ventana de cancelación de venta: tres definiciones incompatibles',
    affectedRuleIds: [
      'R-CV-DEF',
      'R-CV-NO-CONTINUAR',
      'R-ILOC',
      'R-OP-F',
      'R-OP-G',
      'R-D53-EXPEDIENTE',
    ],
    sourceRefs: [primary(6, '5.1.d', 'N-25'), glossary(7, 'Alumno', 'G-13'), d53(6, '5.4.1.1', 'D53-17')],
    conflictingInterpretations: [
      {
        reading: 'Las cancelaciones de venta solo se pueden solicitar durante las primeras 2 semanas después de la fecha de inicio.',
        sourceRef: primary(6, '5.1.d', 'N-25'),
        resultingOutcome: 'CANCELACION_VENTA',
      },
      {
        reading: 'Se solicita dentro de las primeras 2 semanas del ciclo o cuando sea solicitado por el alumno antes de su inicio de clases.',
        sourceRef: glossary(7, 'Alumno', 'G-13'),
        resultingOutcome: 'CANCELACION_VENTA',
      },
      {
        reading: 'Una cancelación de venta se aplica cuando el estudiante es dado de baja durante el primer mes de ingreso por motivos ajenos a la decisión D53.',
        sourceRef: d53(6, '5.4.1.1', 'D53-17'),
        resultingOutcome: 'CANCELACION_VENTA',
      },
    ],
    candidateOutcomes: ['CANCELACION_VENTA', 'BAJA'],
    explanation:
      'Las tres ventanas no son reconciliables sin arbitramento. Primario y Glosario son mayormente compatibles. D53 es incompatible con la irreversibilidad CV↔baja declarada en el primario (p.17, 5.9): su ventana de primer mes cae en torno a la semana 4, después del punto de irreversibilidad de la semana 3. El motor conserva las tres y no elige.',
  },
  {
    conflictId: 'XDC-02',
    kind: 'CROSS_DOCUMENT_CONFLICT',
    title: '«Carta compromiso»: 2 meses (Glosario) contra ≤6 meses (D53)',
    affectedRuleIds: ['R-D53-COMPROMISO-OK', 'R-D53-COMPROMISO-FALTA'],
    sourceRefs: [glossary(24, 'Alumno', 'G-19'), d53(5, '5.3.2', 'D53-12')],
    conflictingInterpretations: [
      {
        reading: 'La carta compromiso tiene un término de dos meses.',
        sourceRef: glossary(24, 'Alumno', 'G-19'),
        resultingOutcome: null,
      },
      {
        reading: 'La fecha límite de entrega es no mayor a 6 meses.',
        sourceRef: d53(5, '5.3.2', 'D53-12'),
        resultingOutcome: null,
      },
    ],
    candidateOutcomes: ['BAJA', 'CANCELACION_VENTA'],
    explanation:
      'Ninguna fuente sellada establece precedencia entre ambos plazos. El motor no fija el término de la carta compromiso: F2-cc_termino_meses queda reportado como requisito no determinable.',
  },
  {
    conflictId: 'XDC-03',
    kind: 'CROSS_DOCUMENT_CONFLICT',
    title: 'Anclaje del plazo de 6 meses: «desde su ingreso» contra «desde el primer ciclo»',
    affectedRuleIds: ['R-D53-RELOJ-6M'],
    sourceRefs: [d53(3, '5.1.6', 'D53-06'), glossary(6, 'Alumno', 'G-08')],
    conflictingInterpretations: [
      {
        reading: 'La baja se aplica a los 6 meses desde su ingreso.',
        sourceRef: d53(3, '5.1.6', 'D53-06'),
        resultingOutcome: 'BAJA',
      },
      {
        reading: 'La baja se aplica a los 6 meses posteriores al inicio del primer ciclo académico.',
        sourceRef: glossary(6, 'Alumno', 'G-08'),
        resultingOutcome: 'BAJA',
      },
    ],
    candidateOutcomes: ['BAJA'],
    explanation:
      'Para alumnos que cambian de ciclo o se reinscriben a mitad de ciclo, los relojes difieren. Ambos desenlaces coinciden (BAJA), así que el desenlace no se invierte: lo que no se puede determinar es la FECHA en que se agota. El motor marca el conflicto y la fecha queda indeterminada.',
  },
  {
    conflictId: 'XDC-04',
    kind: 'CROSS_DOCUMENT_CONFLICT',
    title: 'Duración del bimestre sin declarar y contradictoria',
    affectedRuleIds: ['R-D53-EXPEDIENTE', 'R-D53-RELOJ-6M'],
    sourceRefs: [
      glossary(29, 'Temporalidad', 'G-29'),
      glossary(30, 'Temporalidad', 'G-30'),
      glossary(29, 'Temporalidad', 'G-31'),
      d53(4, '5.2.2', 'D53-11'),
      primary(18, '5.12', 'N-114'),
    ],
    conflictingInterpretations: [
      {
        reading: 'El ciclo tiene una duración de 14 semanas.',
        sourceRef: glossary(29, 'Temporalidad', 'G-29'),
        resultingOutcome: null,
      },
      {
        reading: 'El periodo es la parte bimestral de un ciclo, de 7 semanas.',
        sourceRef: glossary(30, 'Temporalidad', 'G-30'),
        resultingOutcome: null,
      },
      {
        reading: 'El bimestre de Licenciatura dura 7+6+4+9 = 26 semanas, lo que contradice el ciclo de 14 semanas.',
        sourceRef: glossary(29, 'Temporalidad', 'G-31'),
        resultingOutcome: null,
      },
      {
        reading: 'El cierre de aula es el miércoles de la semana 3 del bimestre, sin que ninguna fuente declare la duración del bimestre.',
        sourceRef: d53(4, '5.2.2', 'D53-11'),
        resultingOutcome: 'BAJA',
      },
    ],
    candidateOutcomes: ['BAJA', 'CANCELACION_VENTA'],
    explanation:
      'La unidad «bimestre» que usan el primario y D53 no tiene duración declarada, y el Glosario se contradice a sí mismo (14 contra 26 semanas). No se puede calcular la fecha del cierre de aula ni alinear «primer bimestre» con «30 días» o con «semana 3». El motor no puede fechar el cierre de aula.',
  },
  {
    conflictId: 'XDC-05',
    kind: 'UNAVAILABLE_SOURCE',
    title: '«Expediente completo»: conjunto de documentos no disponible',
    affectedRuleIds: ['R-D53-EXPEDIENTE'],
    sourceRefs: [glossary(26, 'Trámites', 'G-23'), d53(4, '5.2.2', 'D53-10'), d53(5, '5.1.23', 'D53-23')],
    conflictingInterpretations: [
      {
        reading: 'El expediente escolar es el conjunto de documentos que acredita la trayectoria del alumno.',
        sourceRef: glossary(26, 'Trámites', 'G-23'),
        resultingOutcome: null,
      },
      {
        reading: 'Si al finalizar el bimestre el expediente no está completo, la baja es definitiva.',
        sourceRef: d53(4, '5.2.2', 'D53-10'),
        resultingOutcome: 'BAJA',
      },
    ],
    candidateOutcomes: ['BAJA'],
    explanation:
      'El conjunto de documentos obligatorios está en el Anexo 1 de D53 y en el Anexo 1 del primario, ninguno disponible. Sin esos anexos, «¿está completo el expediente?» NO es determinable. Clasificado DEFERRED_UNAVAILABLE_SOURCE: bloquea localmente NODO-D53-05, no la auditoría entera.',
  },
  {
    conflictId: 'XDC-06',
    kind: 'CROSS_DOCUMENT_CONFLICT',
    title: '«Alumno regular» (estatus) contra «Regular» (tipo de ingreso)',
    affectedRuleIds: ['R-D53-APLICA', 'R-D53-EXCLUIDO'],
    sourceRefs: [glossary(6, 'Alumno', 'G-03'), glossary(28, 'Clasificación de alumnos', 'G-22'), d53(2, '5.1.1', 'D53-01')],
    conflictingInterpretations: [
      {
        reading: '«Alumno regular» es un estatus definido por condiciones de trayectoria.',
        sourceRef: glossary(6, 'Alumno', 'G-03'),
        resultingOutcome: null,
      },
      {
        reading: '«Regular» es un tipo de ingreso, y D53 aplica al nuevo ingreso de tipo regular o dictamen técnico.',
        sourceRef: d53(2, '5.1.1', 'D53-01'),
        resultingOutcome: null,
      },
    ],
    candidateOutcomes: [],
    explanation:
      'No hay colisión textual entre documentos, sino colisión de término dentro del Glosario. El motor mantiene F2-estatus_alumno_regular y F2-tipo_ingreso como hechos separados y NO los fusiona.',
  },
  {
    conflictId: 'XDC-07',
    kind: 'CROSS_DOCUMENT_CONFLICT',
    title: '«Alumno futuro» y la CV de quien no inicia',
    affectedRuleIds: ['R-ILOC'],
    sourceRefs: [glossary(6, 'Alumno', 'G-02'), glossary(7, 'Alumno', 'G-13'), primary(16, '5.9.a', 'N-93')],
    conflictingInterpretations: [
      {
        reading: 'El alumno futuro es quien espera la fecha de inicio de un ciclo.',
        sourceRef: glossary(6, 'Alumno', 'G-02'),
        resultingOutcome: null,
      },
      {
        reading: 'Los canales College y Upselling contemplan inscripciones de estudiantes futuros, para los cuales la CV operativa no aplica.',
        sourceRef: primary(16, '5.9.a', 'N-93'),
        resultingOutcome: null,
      },
    ],
    candidateOutcomes: ['CANCELACION_VENTA', 'CANCELACION_VENTA_OPERATIVA'],
    explanation:
      'Tensión documental menor: el estatus «futuro» interactúa con la CV de ilocalizable de G-13 sin que se declare la relación exacta con la ventana de 2 semanas. No se resuelve.',
  },
  {
    conflictId: 'XDC-08',
    kind: 'CROSS_DOCUMENT_CONFLICT',
    title: '«Contacto»: lead de CRM contra contacto efectivo con el alumno',
    affectedRuleIds: ['R-ILOC', 'R-ILOC-ESPECIAL-RETENCION', 'R-ILOC-ESPECIAL-CV'],
    sourceRefs: [glossary(14, 'Alumno', 'G-27'), glossary(14, 'Alumno', 'G-28'), primary(14, '5.8.h', 'N-68')],
    conflictingInterpretations: [
      {
        reading: '«Contacto» es el registro de un lead con respuesta en el CRM.',
        sourceRef: glossary(14, 'Alumno', 'G-27'),
        resultingOutcome: null,
      },
      {
        reading: '«Contacto efectivo» es la interacción con el estudiante titular del proceso.',
        sourceRef: primary(14, '5.8.h', 'N-68'),
        resultingOutcome: null,
      },
    ],
    candidateOutcomes: ['CANCELACION_VENTA', 'RETENCION'],
    explanation:
      'El término «contacto» tiene dos significados en fuentes distintas sin que ninguna declare equivalencia. El motor NO los fusiona: F-contacto_efectivo y F-contacto_any_gestion son hechos distintos.',
  },
  {
    conflictId: 'XDC-09',
    kind: 'CROSS_DOCUMENT_CONFLICT',
    title: '«Carta manifiesto» contra «carta compromiso»',
    affectedRuleIds: [
      'R-DOC-A-BREAK',
      'R-D53-COMPROMISO-OK',
      'R-D53-COMPROMISO-FALTA',
    ],
    sourceRefs: [primary(10, '5.7.a', 'N-59'), d53(5, '5.3.2', 'D53-12'), glossary(24, 'Alumno', 'G-19')],
    conflictingInterpretations: [
      {
        reading: 'La carta manifiesto del primario no tiene plazo declarado.',
        sourceRef: primary(10, '5.7.a', 'N-59'),
        resultingOutcome: 'CANCELACION_VENTA',
      },
      {
        reading: 'La carta compromiso de D53 tiene fecha límite no mayor a 6 meses.',
        sourceRef: d53(5, '5.3.2', 'D53-12'),
        resultingOutcome: 'BAJA',
      },
      {
        reading: 'La carta compromiso del Glosario tiene un término de dos meses.',
        sourceRef: glossary(24, 'Alumno', 'G-19'),
        resultingOutcome: 'BAJA',
      },
    ],
    candidateOutcomes: ['CANCELACION_VENTA', 'BAJA'],
    explanation:
      'No se establece si «carta manifiesto» y «carta compromiso» son el mismo instrumento. El motor mantiene F-carta_manifiesto_firmada y F2-cc_* como hechos separados y no los equates.',
  },
] as const;

/**
 * Conflicto por `conflictId`, si existe.
 *
 * Busca en las dos familias (`DRAFTS` e `INTERNAL_CONFLICTS`). Buscar sólo en
 * `DRAFTS` hacía que todo `AMB-*` devolviera `undefined`, que es la misma
 * omisión que sufría `allConflicts` en su versión anterior.
 */
export function conflictById(conflictId: string): PolicyConflict | undefined {
  const draft = DRAFTS.find((entry) => entry.conflictId === conflictId);
  if (draft) return toPolicyConflict(draft);
  return INTERNAL_CONFLICTS.find((conflict) => conflict.conflictId === conflictId);
}

/**
 * Convierte un borrador en conflicto materializable.
 *
 * `status` es siempre `REQUIRES_HUMAN_REVIEW`: un conflicto no se resuelve por
 * código. Es la razón por la que la V2 puede **representar** la ambigüedad sin
 * que esa ambigüedad sea un defecto del motor.
 */
export function toPolicyConflict(draft: Draft): PolicyConflict {
  return {
    conflictId: draft.conflictId,
    kind: draft.kind,
    title: draft.title,
    affectedRuleIds: draft.affectedRuleIds,
    sourceRefs: draft.sourceRefs,
    conflictingInterpretations: draft.conflictingInterpretations,
    candidateOutcomes: draft.candidateOutcomes,
    explanation: draft.explanation,
    status: 'REQUIRES_HUMAN_REVIEW',
  };
}

/**
 * Conflictos cuyo conjunto de reglas afectadas intersecta las reglas que la
 * evaluación realmente alcanzó.
 *
 * Ésta es la función que implementa `CONFLICT_IS_LOCAL`.
 */
export function conflictsForReachedRules(reachedRuleIds: readonly string[]): PolicyConflict[] {
  const reached = new Set(reachedRuleIds);
  return DRAFTS.filter((draft) => draft.affectedRuleIds.some((ruleId) => reached.has(ruleId)))
    .map(toPolicyConflict)
    .sort((a, b) => (a.conflictId < b.conflictId ? -1 : a.conflictId > b.conflictId ? 1 : 0));
}

/** Todos los conflictos declarados, sin filtrar. Útil para documentación y tests. */
/**
 * Todos los conflictos declarados, sin filtrar.
 *
 * Incluye **las dos familias**: los `XDC-*` de `DRAFTS` y los `AMB-*` internos
 * de `INTERNAL_CONFLICTS`. Una versión anterior de esta función devolvía sólo
 * los `DRAFTS`, lo que hacía que toda referencia de regla a un conflicto `AMB-*`
 * pareciera no resolver. Un catálogo que oculta la mitad de sus entradas no
 * puede usarse para auditar la integridad del registro de reglas.
 */
export function allConflicts(): PolicyConflict[] {
  const byId = new Map<string, PolicyConflict>();
  for (const conflict of DRAFTS.map(toPolicyConflict)) byId.set(conflict.conflictId, conflict);
  for (const conflict of INTERNAL_CONFLICTS) byId.set(conflict.conflictId, conflict);
  return [...byId.values()].sort((a, b) => (a.conflictId < b.conflictId ? -1 : a.conflictId > b.conflictId ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Conflictos heredados de Phase 1 (no entre documentos, sino internos)
// ---------------------------------------------------------------------------

/**
 * `AMB-CON-01` — `N-33` (falta de retención → BAJA) contra `N-27`
 * (solicitud previa al inicio → CV). El primario no declara prevalencia entre
 * ambas y ambas pueden ser ciertas a la vez.
 */
export const AMB_CON_01: PolicyConflict = toPolicyConflict({
  conflictId: 'AMB-CON-01',
  kind: 'OWNER_DECISION_REQUIRED',
  title: 'Falta de retención contra solicitud previa al inicio',
  affectedRuleIds: ['R-FILTRO-RETENCION', 'R-PREINICIO-CV'],
  sourceRefs: [primary(5, '5.2', 'N-33'), primary(4, '5.1', 'N-27')],
  conflictingInterpretations: [
    {
      reading: 'En caso de no realizarse el proceso de retención la solicitud se gestiona como baja, sin que la fecha de inicio ni la aplicación de D35 o D53 afecten dicha determinación.',
      sourceRef: primary(5, '5.2', 'N-33'),
      resultingOutcome: 'BAJA',
    },
    {
      reading: 'La cancelación de venta aplica cuando la solicitud es previa a la fecha de inicio.',
      sourceRef: primary(4, '5.1', 'N-27'),
      resultingOutcome: 'CANCELACION_VENTA',
    },
  ],
  candidateOutcomes: ['BAJA', 'CANCELACION_VENTA'],
  explanation:
    'El documento no declara prevalencia. Un caso que reúna solicitud previa al inicio y falta de retención activa ambas ramas. El motor no elige: escala a revisión humana con ambos desenlaces como candidatos.',
});

/**
 * `AMB-CON-02` — `N-57` y `N-58` describen dos rutas de escalamiento distintas
 * para el desbordamiento de plazos con promesa no cumplida, sin declarar cuál.
 */
export const AMB_CON_02: PolicyConflict = toPolicyConflict({
  conflictId: 'AMB-CON-02',
  kind: 'OWNER_DECISION_REQUIRED',
  title: 'Doble ruta de escalamiento por desbordamiento de plazos',
  affectedRuleIds: ['R-ESCALAMIENTO-N57', 'R-ESCALAMIENTO-N58'],
  sourceRefs: [primary(10, '5.4', 'N-57'), primary(10, '5.4', 'N-58')],
  conflictingInterpretations: [
    {
      reading: 'N-57: al exceder los plazos se escala y se evalúa cancelación de venta contra baja.',
      sourceRef: primary(10, '5.4', 'N-57'),
      resultingOutcome: 'CANCELACION_VENTA',
    },
    {
      reading: 'N-58: al exceder los plazos se escala a Dictaminación.',
      sourceRef: primary(10, '5.4', 'N-58'),
      resultingOutcome: 'DICTAMINACION',
    },
  ],
  candidateOutcomes: ['CANCELACION_VENTA', 'BAJA', 'DICTAMINACION'],
  explanation:
    'Son dos rutas distintas para la misma hipótesis y el documento no declara cuál aplica. No se resuelve.',
});

/**
 * `AMB-CON-03` — `N-46` restringe la causal de promesa no cumplida a tres
 * requisitos; `N-52` la expande («sin evidencias en sistemas oficiales → sí es
 * CV»). Un caso con información errónea acreditada pero sin rechazo de
 * beneficios satisface N-52 y no N-46.
 */
export const AMB_CON_03: PolicyConflict = toPolicyConflict({
  conflictId: 'AMB-CON-03',
  kind: 'OWNER_DECISION_REQUIRED',
  title: 'N-46 restringe la promesa no cumplida y N-52 la expande',
  affectedRuleIds: ['R-CAUSAL-PROMESA', 'R-PROMESA-N52'],
  sourceRefs: [primary(8, '5.3', 'N-46'), primary(9, '5.3', 'N-52')],
  conflictingInterpretations: [
    {
      reading: 'La causal de promesa no cumplida exige los tres requisitos: información errónea, decisión explícita derivada de promesas y rechazo de beneficios adicionales.',
      sourceRef: primary(8, '5.3', 'N-46'),
      resultingOutcome: null,
    },
    {
      reading: 'Si no hay evidencias en sistemas oficiales, sí es cancelación de venta por promesa no cumplida.',
      sourceRef: primary(9, '5.3', 'N-52'),
      resultingOutcome: 'CANCELACION_VENTA',
    },
  ],
  candidateOutcomes: ['CANCELACION_VENTA'],
  explanation:
    'N-46 restringe y N-52 expande la misma causal. Un caso con información errónea acreditada pero sin rechazo de beneficios satisface N-52 y no N-46. El documento no resuelve. Ambos coinciden en que, si la causal aplica, el desenlace es CV: la divergencia es sobre si la causal aplica.',
});

/**
 * `AMB-CON-04` — «aplica cancelación de venta o baja, solo si el estudiante por
 * este motivo desea y expresa de manera tácita el no querer continuar». El
 * documento no declara cuál de los dos desenlaces, ni cómo se verifica una
 * expresión «tácita».
 */
export const AMB_CON_04: PolicyConflict = toPolicyConflict({
  conflictId: 'AMB-CON-04',
  kind: 'OWNER_DECISION_REQUIRED',
  title: '«Cancelación de venta o baja» sin criterio de selección',
  /**
   * Las cuatro reglas que portan esta ambigüedad.
   *
   * Se listan las variantes `-BAJA` además de sus pares porque las dos lecturas
   * de cada inciso se materializan como reglas separadas con condición
   * idéntica: si sólo se listara una de cada par, la traza afirmaría que la
   * otra lectura no participa del conflicto, que es exactamente lo que este
   * módulo existe para no afirmar.
   */
  affectedRuleIds: [
    'R-CAUSAL-V',
    'R-CAUSAL-V-BAJA',
    'R-CICLO-DESISTE',
    'R-CICLO-DESISTE-BAJA',
  ],
  sourceRefs: [primary(5, '5.2', 'N-36'), primary(13, '5.6', 'N-78')],
  conflictingInterpretations: [
    {
      reading: 'Aplica cancelación de venta.',
      sourceRef: primary(5, '5.2', 'N-36'),
      resultingOutcome: 'CANCELACION_VENTA',
    },
    {
      reading: 'Aplica baja.',
      sourceRef: primary(5, '5.2', 'N-36'),
      resultingOutcome: 'BAJA',
    },
  ],
  candidateOutcomes: ['CANCELACION_VENTA', 'BAJA'],
  explanation:
    'El mismo enunciado declara dos desenlaces sin declarar cuál. Además «expresa de manera tácita» es una contradicción interna del original: tácito significa no expreso. Ninguna regla puede elegir. Phase 1.5 confirmó que G-13 no cierra esta ambigüedad.',
});

/**
 * `AMB-TEM-02` — `N-35` («cualquier solicitud» a más de 20 días → BAJA) es más
 * amplia que `N-15` (solicitud de CV en 2 semanas). El texto sugiere la
 * prevalencia pero no la declara.
 */
export const AMB_TEM_02: PolicyConflict = toPolicyConflict({
  conflictId: 'AMB-TEM-02',
  kind: 'OWNER_DECISION_REQUIRED',
  title: 'Prevalencia de N-35 sobre N-15 sólo sugerida por el texto',
  affectedRuleIds: ['R-REGLA-20-DIAS', 'R-CV-DEF'],
  sourceRefs: [primary(5, '5.2', 'N-35'), primary(3, '5.1', 'N-15')],
  conflictingInterpretations: [
    {
      reading: 'Transcurridos 20 días desde el inicio del ciclo, cualquier solicitud deberá gestionarse como baja.',
      sourceRef: primary(5, '5.2', 'N-35'),
      resultingOutcome: 'BAJA',
    },
    {
      reading: 'Las cancelaciones de venta solo se podrán solicitar durante las primeras 2 semanas después de la fecha de inicio.',
      sourceRef: primary(3, '5.1', 'N-15'),
      resultingOutcome: 'CANCELACION_VENTA',
    },
  ],
  candidateOutcomes: ['BAJA', 'CANCELACION_VENTA'],
  explanation:
    'El término «cualquier solicitud» de N-35 incluiría la solicitud de CV, lo que sugiere prevalencia, pero el documento no la declara. El motor implementa N-35 como cortocircuito temporal (su texto es inequívoco en cuanto al desenlace) y expone la tensión en la traza.',
});

/**
 * `AMB-LOG-04` — la conectiva de 5.8.h (los criterios de contacto efectivo) no
 * está declarada: la fuente no dice si se combinan con AND u OR.
 */
export const AMB_LOG_04: PolicyConflict = toPolicyConflict({
  conflictId: 'AMB-LOG-04',
  kind: 'OWNER_DECISION_REQUIRED',
  title: 'Conectiva de 5.8.h no declarada (AND/OR)',
  affectedRuleIds: ['R-ILOC'],
  sourceRefs: [primary(14, '5.8.h', 'N-68')],
  conflictingInterpretations: [
    {
      reading: 'Los criterios de contacto efectivo se combinan con AND.',
      sourceRef: primary(14, '5.8.h', 'N-68'),
      resultingOutcome: 'CANCELACION_VENTA',
    },
    {
      reading: 'Los criterios de contacto efectivo se combinan con OR.',
      sourceRef: primary(14, '5.8.h', 'N-68'),
      resultingOutcome: 'RETENCION',
    },
  ],
  candidateOutcomes: ['CANCELACION_VENTA', 'RETENCION'],
  explanation:
    'La fuente no declara la conectiva. El motor consume F-contacto_efectivo tal como la evidencia lo determina y expone el conflicto: no recompone la conectiva por su cuenta.',
});

/**
 * `AMB-LOG-02` — polaridad contradictoria de 5.8.a para posgrado, alianza y
 * diplomado, y contradicción interna con 5.8.i.
 */
export const AMB_LOG_02: PolicyConflict = toPolicyConflict({
  conflictId: 'AMB-LOG-02',
  kind: 'CROSS_DOCUMENT_CONFLICT',
  title: 'Polaridad de 5.8.a invertida en tres niveles y contradicción con 5.8.i',
  // La polaridad la preserva `facts/derive.ts` leyendo el catálogo; la regla que
  // consume el derivado normalizado es `R-ILOC`, y las contraevidencias de
  // 5.8.a son `R-ILOC-N74`/`R-ILOC-N75`.
  affectedRuleIds: ['R-ILOC', 'R-ILOC-N74', 'R-ILOC-N75'],
  sourceRefs: [
    primary(12, '5.8.a', 'N-70'),
    primary(12, '5.8.a', 'N-71'),
    primary(14, '5.8.i', 'N-124'),
  ],
  conflictingInterpretations: [
    {
      reading: 'Para posgrado, no haber registrado participación en foros es contacto efectivo.',
      sourceRef: primary(12, '5.8.a', 'N-71'),
      resultingOutcome: 'RETENCION',
    },
    {
      reading: 'Para posgrado, evidenciar participación en el foro de presentación es ingreso válido a aula.',
      sourceRef: primary(14, '5.8.i', 'N-124'),
      resultingOutcome: 'CANCELACION_VENTA',
    },
  ],
  candidateOutcomes: ['CANCELACION_VENTA', 'RETENCION'],
  explanation:
    'La fuente se contradice internamente: 5.8.a lista la falta de participación en foros como contacto efectivo y 5.8.i exige evidenciarla. El motor preserva la polaridad declarada por nivel en el catálogo de hechos y NO introduce una abstracción que la destruya.',
});

/**
 * `AMB-TEM-07` — `D53-05` declara que la regla del 50 % «no es fija» y que se
 * «pretende reducirla». El texto es intención de reforma, no derogación.
 */
export const AMB_TEM_07: PolicyConflict = toPolicyConflict({
  conflictId: 'AMB-TEM-07',
  kind: 'OWNER_DECISION_REQUIRED',
  title: 'Vigencia de la regla del 50 % de avance curricular en D53',
  affectedRuleIds: ['R-D53-RELOJ-50'],
  sourceRefs: [d53(3, '5.1.4', 'D53-04'), d53(3, '5.1.5', 'D53-05')],
  conflictingInterpretations: [
    {
      reading: 'La baja se aplica al alcanzar el 50 % de avance curricular.',
      sourceRef: d53(3, '5.1.4', 'D53-04'),
      resultingOutcome: 'BAJA',
    },
    {
      reading: 'El 50 % no es fijo y se pretende reducirlo hasta que el plazo de 6 meses sea el operativo.',
      sourceRef: d53(3, '5.1.5', 'D53-05'),
      resultingOutcome: null,
    },
  ],
  candidateOutcomes: ['BAJA'],
  explanation:
    '«Se pretende reducir» es una intención de reforma, no una derogación vigente. El motor mantiene la regla del 50 % ACTIVA y expone el conflicto. Desactivarla sería inventar una derogación que la fuente no contiene; mantenerla sin marcar el conflicto sería ocultar una contradicción.',
});

/** Conflictos de Phase 1 que no son colisión entre documentos. */
export const INTERNAL_CONFLICTS: readonly PolicyConflict[] = [
  AMB_CON_01,
  AMB_CON_02,
  AMB_CON_03,
  AMB_CON_04,
  AMB_TEM_02,
  AMB_LOG_02,
  AMB_LOG_04,
  AMB_TEM_07,
] as const;

/** Índice de conflictos internos por `conflictId`. */
export function internalConflict(conflictId: string): PolicyConflict | undefined {
  return INTERNAL_CONFLICTS.find((conflict) => conflict.conflictId === conflictId);
}

/** Filtro combinado: XDC + internos, por reglas alcanzadas. */
export function allConflictsForReachedRules(reachedRuleIds: readonly string[]): PolicyConflict[] {
  const byId = new Map<string, PolicyConflict>();
  for (const conflict of conflictsForReachedRules(reachedRuleIds)) byId.set(conflict.conflictId, conflict);
  for (const conflict of INTERNAL_CONFLICTS) {
    if (conflict.affectedRuleIds.some((ruleId) => reachedRuleIds.includes(ruleId))) {
      byId.set(conflict.conflictId, conflict);
    }
  }
  return [...byId.values()].sort((a, b) =>
    a.conflictId < b.conflictId ? -1 : a.conflictId > b.conflictId ? 1 : 0,
  );
}
