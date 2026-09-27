/**
 * Phase 1.5 — Nodos derivados de las fuentes de apoyo.
 *
 * - §12 `NODO-CV-DEF` — definición de cancelación de venta (`G-13`, p.7).
 * - §11 `NODO-D53-01` … `NODO-D53-08` — subárbol D53 (`D53-01`…`D53-15`).
 * - §13 `NODO-RET-01` … `NODO-RET-04` — retención (`G-14`…`G-17`, p.21).
 *
 * ## Nombres de los hechos derivados
 *
 * `F-sin-actividad-nivel` y `F-nivel-academico` son hechos **derivados** que el
 * evaluador sintetiza a partir del nivel académico y del hecho de actividad
 * correspondiente. El derivado se calcula leyendo `activityPolarity` del
 * catálogo, nunca hardcodeando la inversión en el `if` del evaluador. Es la
 * forma de preservar `AMB-LOG-02` sin destruir la polaridad de la fuente.
 */

import { all, any, equals, fact, isIn, not, when } from '../conditions';
import { d53, glossary, primary } from '../sources';
import type { Rule } from './types';

// ---------------------------------------------------------------------------
// §12 — NODO-CV-DEF
// ---------------------------------------------------------------------------

export const CV_DEF: readonly Rule[] = [
  {
    ruleId: 'R-CV-DEF-ALCANCE',
    nodeId: 'NODE-CV-DEF',
    kind: 'DEFINITION',
    description:
      'La definición de cancelación de venta del Glosario tiene predicado de alcance (alumnos de nuevo ingreso) y una taxonomía cerrada de 3 motivos. Los 3 motivos mapean 1:1 a ramas ya inventariadas del primario: la taxonomía valida la estructura del árbol y no añade ramas.',
    condition: all(fact('F2-es_nuevo_ingreso'), fact('F-cv-motivo')),
    onMatch: { kind: 'CONTINUE' },
    informative: true,
    sourceRefs: [glossary(7, 'Alumno', 'G-13')],
  },
  {
    ruleId: 'R-CV-DEF',
    nodeId: 'NODE-CV-DEF',
    kind: 'DEFINITION',
    description:
      'Dentro de la ventana de cancelación de venta declarada, la solicitud de un alumno de nuevo ingreso se gestiona como cancelación de venta. Ventanas en conflicto: XDC-01.',
    // `decision-tree.md` §12 declara el ámbito «alumnos de nuevo ingreso» como
    // «predicado necesario». Sin él, la ventana temporal sola bastaba: cualquier
    // auditoría con fechas —incluso sin un solo hecho— proponía cancelación de
    // venta, y el ranking la mostraba como desenlace provisional más cercano.
    condition: all(
      any(when('WITHIN_2_WEEKS_AFTER_START'), when('BEFORE_START')),
      fact('F2-es_nuevo_ingreso'),
    ),
    onMatch: { kind: 'OUTCOME', outcome: 'CANCELACION_VENTA' },
    conflictIds: ['XDC-01'],
    // La ventana de 2 semanas es `N-15` (§5.1.d, p.3); la solicitud previa al
    // inicio, `N-27` (§5.3.a.I, p.4); la definición, `G-13` (p.7). Antes se
    // citaba `N-25`, que es §5.2.h p.4 y no habla de la ventana de CV.
    sourceRefs: [
      primary(3, '5.1.d', 'N-15'),
      primary(4, '5.3.a.I', 'N-27'),
      glossary(7, 'Alumno', 'G-13'),
    ],
  },
  {
    ruleId: 'R-CV-NO-CONTINUAR',
    nodeId: 'NODE-CV-DEF',
    kind: 'CAUSAL',
    description:
      'Motivo G-13 M3: el alumno ya no está interesado en iniciar. Es el cruce con el inciso 5.3 del primario.',
    condition: equals('F-cv-motivo', 'YA_NO_ESTA_INTERESADO'),
    onMatch: { kind: 'OUTCOME', outcome: 'CANCELACION_VENTA' },
    conflictIds: ['XDC-01'],
    sourceRefs: [primary(4, '5.3.a', 'N-30'), glossary(7, 'Alumno', 'G-13')],
  },
  {
    ruleId: 'R-CV-PAQUETE',
    nodeId: 'NODE-CV-DEF',
    kind: 'CAUSAL',
    description:
      'Motivo G-13 M1: error en el paquete de inscripción. No decide desenlace por sí misma: continúa al cruce con 5.9.f y 5.9.g del primario.',
    condition: equals('F-cv-motivo', 'ERROR_PAQUETE_INSCRIPCION'),
    onMatch: { kind: 'CONTINUE' },
    conflictIds: ['XDC-01'],
    sourceRefs: [glossary(7, 'Alumno', 'G-13')],
  },
  {
    ruleId: 'R-CV-ILOC',
    nodeId: 'NODE-CV-DEF',
    kind: 'CAUSAL',
    description:
      'Motivo G-13 M2: no se localiza al alumno y no ingresa al Aula. No decide desenlace por sí misma: continúa al cruce con 5.8 del primario.',
    condition: equals('F-cv-motivo', 'NO_SE_LOCALIZA_NO_INGRESA'),
    onMatch: { kind: 'CONTINUE' },
    conflictIds: ['XDC-01', 'XDC-07'],
    sourceRefs: [glossary(7, 'Alumno', 'G-13')],
  },
] as const;

// ---------------------------------------------------------------------------
// §11 — NODO-D53
// ---------------------------------------------------------------------------

export const D53: readonly Rule[] = [
  {
    ruleId: 'R-D53-APLICA',
    nodeId: 'NODE-D53',
    kind: 'D53',
    description:
      'Aplica D53: es alumno de nuevo ingreso de tipo regular o con dictamen técnico. Entra al subárbol documental.',
    condition: all(
      fact('F2-es_nuevo_ingreso'),
      isIn('F2-tipo_ingreso', ['REGULAR', 'DICTAMEN_TECNICO']),
    ),
    onMatch: { kind: 'ESCALATE_TO_NODE', nodeId: 'NODE-D53-SUBTREE' },
    conflictIds: ['XDC-06'],
    sourceRefs: [d53(2, '5.1.1', 'D53-01')],
  },
  {
    ruleId: 'R-D53-EXCLUIDO',
    nodeId: 'NODE-D53',
    kind: 'D53',
    description:
      'Exclusión por tipo de ingreso: reingreso, equivalencia o revalidación. D53 no aplica y la documentación física y el pago del trámite se rigen por el inciso 5.7.c del primario.',
    condition: isIn('F2-tipo_ingreso', ['REINGRESO', 'EQUIVALENCIA', 'REVALIDACION']),
    onMatch: { kind: 'CONTINUE' },
    informative: true,
    conflictIds: ['XDC-06'],
    sourceRefs: [d53(2, '5.1.1', 'D53-01')],
  },
  {
    ruleId: 'R-D53-RESPONSABLE',
    nodeId: 'NODE-D53-SUBTREE',
    kind: 'D53',
    description:
      'Responsable del documento D53: desde la venta responde Back Office; desde el viernes previo al inicio responde Éxito Estudiantil. No altera el desenlace, cambia el responsable operativo.',
    condition: fact('F2-d53_resp_backoffice'),
    onMatch: { kind: 'CONTINUE' },
    informative: true,
    sourceRefs: [d53(2, '5.1.2', 'D53-02'), d53(2, '5.1.3', 'D53-03')],
  },
  {
    ruleId: 'R-D53-COMPROMISO-OK',
    nodeId: 'NODE-D53-COMPROMISO',
    kind: 'D53',
    description:
      'Compromiso documental cumplido. México: aceptación de términos y condiciones en SIU. LATAM: carta compromiso obligatoria cargada en el SIU antes de la inscripción, firmada manuscrita en tinta azul.',
    condition: any(fact('F2-cc_acepta_tc'), fact('F2-cc_obligatoria_latam')),
    onMatch: { kind: 'CONTINUE' },
    conflictIds: ['XDC-02'],
    sourceRefs: [d53(3, '5.1.7', 'D53-07'), d53(5, '5.3.2.1', 'D53-13')],
  },
  {
    ruleId: 'R-D53-COMPROMISO-FALTA',
    nodeId: 'NODE-D53-COMPROMISO',
    kind: 'D53',
    description:
      'El compromiso documental no está cumplido. La fuente alcanza el caso pero NO fija desenlace: no hay default posible.',
    condition: not(any(fact('F2-cc_acepta_tc'), fact('F2-cc_obligatoria_latam'))),
    onMatch: { kind: 'OWNER_DECISION_REQUIRED', conflictId: 'AMB-D53-COMPROMISO' },
    conflictIds: ['XDC-02', 'XDC-09'],
    sourceRefs: [d53(3, '5.1.7', 'D53-07'), d53(5, '5.3.2', 'D53-12')],
  },
  {
    ruleId: 'R-D53-INVARIANTE',
    nodeId: 'NODE-D53-SUBTREE',
    kind: 'INVARIANT',
    description:
      'Invariante D53: entregar el documento NO cambia la decisión D53, sólo su clasificación a «D53 con expediente completo». Prohíbe derivar «ya entregó ⇒ ya no es D53».',
    condition: fact('F2-d53_decision_mantiene'),
    onMatch: { kind: 'CONTINUE' },
    informative: true,
    sourceRefs: [d53(3, '5.1.8', 'D53-08')],
  },
  {
    ruleId: 'R-D53-RELOJ-6M',
    nodeId: 'NODE-D53-SUBTREE',
    kind: 'D53',
    description:
      'Plazo máximo de 6 meses agotado: se aplica la baja. El anclaje está en disputa entre D53-06 y G-08 (XDC-03).',
    condition: any(
      fact('F2-baja_falta_docs_6meses'),
      when('SIX_MONTHS_FROM_ENTRY'),
    ),
    onMatch: { kind: 'OUTCOME', outcome: 'BAJA' },
    conflictIds: ['XDC-03'],
    // Sin grounding en el primario: las bases de BAJA del primario son N-33,
    // N-53, N-64 y N-98, y ninguna es un plazo de 6 meses. XDC-02 (2 o 6
    // meses) y XDC-03 (anclaje) siguen sin respuesta del Owner, así que la BAJA
    // se ofrece como candidato provisional y nunca como resultado normativo.
    awaitsAmbiguityIds: ['XDC-02', 'XDC-03'],
    sourceRefs: [d53(3, '5.1.6', 'D53-06'), glossary(6, 'Alumno', 'G-08')],
  },
  {
    ruleId: 'R-D53-RELOJ-50',
    nodeId: 'NODE-D53-SUBTREE',
    kind: 'D53',
    description:
      'Se alcanzó el 50 % de avance curricular: se aplica la baja. `D53-05` declara que ese porcentaje «no es fija» y que se pretende reducirlo, pero es intención de reforma y no derogación (AMB-TEM-07).',
    condition: any(fact('F2-d53_supera_50'), when('FIFTY_PERCENT_ADVANCE')),
    onMatch: { kind: 'OUTCOME', outcome: 'BAJA' },
    conflictIds: ['AMB-TEM-07'],
    awaitsAmbiguityIds: ['AMB-TEM-07', 'XDC-04'],
    sourceRefs: [d53(3, '5.1.4', 'D53-04'), d53(3, '5.1.5', 'D53-05')],
  },
  {
    ruleId: 'R-D53-EXPEDIENTE',
    nodeId: 'NODE-D53-SUBTREE',
    kind: 'D53',
    description:
      'Al finalizar el bimestre de cierre de aula el expediente no está completo: la baja es definitiva. La fecha de cierre no es computable porque la duración del bimestre no está declarada (XDC-04) y el conjunto de documentos está en un anexo no disponible (XDC-05).',
    condition: not(fact('F2-d53_expediente_completo')),
    onMatch: { kind: 'OUTCOME', outcome: 'BAJA' },
    conflictIds: ['XDC-04', 'XDC-05'],
    awaitsAmbiguityIds: ['XDC-04', 'XDC-05'],
    sourceRefs: [d53(4, '5.2.2', 'D53-10'), d53(4, '5.2.2', 'D53-11')],
  },
  {
    ruleId: 'R-D53-REINGRESO',
    nodeId: 'NODE-D53-SUBTREE',
    kind: 'D53',
    description:
      'La entrega en el mismo bimestre del cierre de aula no constituye reingreso; entregada después, sí lo es, coherente con la definición de reingreso del Glosario.',
    condition: fact('F2-d53_bimestre_cierre_superado'),
    onMatch: { kind: 'CONTINUE' },
    informative: true,
    sourceRefs: [d53(3, '5.1.9', 'D53-09'), glossary(9, 'Alumno', 'G-11')],
  },
  {
    ruleId: 'R-D53-APOCRIFO',
    nodeId: 'NODE-D53-SUBTREE',
    kind: 'D53',
    description:
      'Inconsistencia documental: clasificar como posible apócrifo e iniciar dictaminación externa ante la dependencia que lo expidió.',
    condition: fact('F2-d53_apocrifo_sospecha'),
    onMatch: { kind: 'OUTCOME', outcome: 'DICTAMINACION' },
    // `DICTAMINACION` está `PARTIAL` en el coverage matrix y su ambigüedad
    // (AMB-CON-02) sigue abierta. D53-15 autoriza el dictaminio *externo* por
    // apócrifo, no el desenlace de auditoría `DICTAMINACION` como resolución de
    // deserción: son cosas distintas y confundirlas sería ampliar el dominio de
    // desenlaces del primario.
    awaitsAmbiguityIds: ['AMB-CON-02'],
    sourceRefs: [d53(4, '5.1.15', 'D53-15')],
  },
] as const;

// ---------------------------------------------------------------------------
// §13 — NODO-RET
// ---------------------------------------------------------------------------

export const RETENTION: readonly Rule[] = [
  {
    ruleId: 'R-RET-01',
    nodeId: 'NODE-RETENCION',
    kind: 'DEFINITION',
    description:
      'El alumno manifiesta su decisión de baja o está en riesgo de baja: es la CAUSA del proceso de retención, no su desenlace.',
    condition: any(fact('F2-manifiesto_baja'), fact('F2-riesgo_de_baja')),
    onMatch: { kind: 'ESCALATE_TO_NODE', nodeId: 'NODE-RET-PROCESO' },
    sourceRefs: [glossary(21, 'Permanencia', 'G-14'), glossary(21, 'Permanencia', 'G-16')],
  },
  {
    ruleId: 'R-RET-03',
    nodeId: 'NODE-RET-PROCESO',
    kind: 'DEFINITION',
    description:
      'El proceso de retención le proporciona estrategias económicas, académicas y de tiempo, y el alumno DECIDE CONTINUAR: se mantiene la matrícula. Este es el desenlace «retención».',
    condition: fact('F2-decide_continuar'),
    onMatch: { kind: 'OUTCOME', outcome: 'RETENCION' },
    // El primario sí ordena el proceso de retención y sus desenlaces en N-32
    // («...procederá la cancelación de la venta o la baja, según corresponda»),
    // y el coverage matrix anota que `RETENCION` se resuelve allí. Eso sí es
    // grounding: el glosario sólo aporta el vocabulario de permanencia.
    primaryGrounding: primary(5, '5.3.b', 'N-32'),
    sourceRefs: [glossary(21, 'Permanencia', 'G-14'), glossary(21, 'Permanencia', 'G-15')],
  },
] as const;
