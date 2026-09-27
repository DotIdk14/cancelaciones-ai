/**
 * §3 — Árbol de causales de `decision-tree.md`.
 *
 * Cada bloque corresponde a una subsección del árbol y conserva su cita.
 */

import { all, any, equals, fact, not, when } from '../conditions';
import type { Condition } from '../conditions';
import { primary } from '../sources';
import type { Rule } from './types';

// ---------------------------------------------------------------------------
// 3.1 / 3.2 Ajuste administrativo y error en área de aprobación
// ---------------------------------------------------------------------------

const CAUSAL_V: readonly Rule[] = [
  {
    ruleId: 'R-CAUSAL-V',
    nodeId: 'NODE-CAUSALES',
    kind: 'CAUSAL',
    description:
      'Ajuste administrativo por error de inscripción dentro de la ventana de 20 días, con decisión del estudiante de no continuar: aplica cancelación de venta.',
    condition: all(
      fact('F-ajuste_por_error_inscripcion'),
      fact('F-ce_decision_no_continuar'),
    ) as Condition,
    onMatch: { kind: 'OUTCOME', outcome: 'CANCELACION_VENTA' },
    conflictIds: ['AMB-CON-04'],
    sourceRefs: [primary(5, '5.2', 'N-36'), primary(6, '5.2', 'N-37')],
  },
  {
    ruleId: 'R-CAUSAL-V-BAJA',
    nodeId: 'NODE-CAUSALES',
    kind: 'CAUSAL',
    description:
      'El mismo inciso declara «aplica cancelación de venta o baja» y no declara cuál de las dos. Se modelan las dos lecturas como reglas que coinciden, de modo que el motor no pueda elegir.',
    condition: all(fact('F-ajuste_por_error_inscripcion'), fact('F-ce_decision_no_continuar')) as Condition,
    onMatch: { kind: 'OUTCOME', outcome: 'BAJA' },
    conflictIds: ['AMB-CON-04'],
    sourceRefs: [primary(5, '5.2', 'N-36')],
  },
  {
    ruleId: 'R-CAUSAL-EE',
    nodeId: 'NODE-CAUSALES',
    kind: 'CAUSAL',
    description:
      'Ajuste que corresponde a GM o EE: el inciso no produce desenlace de cancelación, produce gestión, y si no procede ningún trámite o está fuera de plazo escala a Mejora Continua con segunda inscripción.',
    condition: equals('F-tipo_ajuste', 'GM_EE'),
    onMatch: { kind: 'OUTCOME', outcome: 'RETENCION' },
    sourceRefs: [primary(7, '5.2', 'N-43'), primary(7, '5.2', 'N-44')],
  },
] as const;

// ---------------------------------------------------------------------------
// 3.3 / 3.4 Cambio de ciclo
// ---------------------------------------------------------------------------

const CAUSAL_CICLO: readonly Rule[] = [
  {
    ruleId: 'R-CAUSAL-CICLO-A',
    nodeId: 'NODE-CAUSALES',
    kind: 'CAUSAL',
    description:
      'Cambio de ciclo gestionado antes del inicio de clases y el estudiante no ingresa en el nuevo ciclo.',
    condition: all(fact('F-cambio_ciclo_antes_del_inicio'), fact('F-cambio_ciclo_nuevo_no_ingresa')),
    onMatch: { kind: 'OUTCOME', outcome: 'CANCELACION_VENTA' },
    sourceRefs: [primary(7, '5.2', 'N-41')],
  },
  {
    ruleId: 'R-CAUSAL-CICLO-B',
    nodeId: 'NODE-CAUSALES',
    kind: 'CAUSAL',
    description:
      'Cambio de ciclo gestionado por EE a partir del inicio de clases y el estudiante no ingresa: aplica retención y NO cancelación de venta. Es la excepción más limpia del documento.',
    condition: all(
      not(fact('F-cambio_ciclo_antes_del_inicio')),
      equals('F-cambio_ciclo_gestionado_por', 'EE'),
      fact('F-cambio_ciclo_nuevo_no_ingresa'),
    ),
    onMatch: { kind: 'OUTCOME', outcome: 'RETENCION' },
    sourceRefs: [primary(7, '5.2', 'N-42')],
  },
  {
    ruleId: 'R-CICLO-NO-AUTORIZADO',
    nodeId: 'NODE-CAUSALES',
    kind: 'CAUSAL',
    description:
      'El estudiante no autoriza el cambio de ciclo y está en revalidación o equivalencia de bloques intermedios.',
    condition: all(
      not(fact('F-cambio_ciclo_autorizado')),
      fact('F-ciclo_revalidacion_equivalencia'),
    ),
    onMatch: { kind: 'OUTCOME', outcome: 'CANCELACION_VENTA' },
    sourceRefs: [primary(6, '5.2', 'N-39')],
  },
  {
    ruleId: 'R-CICLO-DESISTE',
    nodeId: 'NODE-CAUSALES',
    kind: 'CAUSAL',
    description:
      'En el nuevo ciclo el estudiante desiste nuevamente de su ingreso: la primera lectura de «cancelación de venta o baja según corresponda».',
    condition: fact('F-cambio_ciclo_desiste_nuevamente'),
    onMatch: { kind: 'OUTCOME', outcome: 'CANCELACION_VENTA' },
    conflictIds: ['AMB-CON-04'],
    sourceRefs: [primary(13, '5.6', 'N-78')],
  },
  {
    ruleId: 'R-CICLO-DESISTE-BAJA',
    nodeId: 'NODE-CAUSALES',
    kind: 'CAUSAL',
    description:
      'La segunda lectura del mismo inciso de desistimiento: «o baja, según corresponda». El documento no declara cuál aplica.',
    condition: fact('F-cambio_ciclo_desiste_nuevamente'),
    onMatch: { kind: 'OUTCOME', outcome: 'BAJA' },
    conflictIds: ['AMB-CON-04'],
    sourceRefs: [primary(13, '5.6', 'N-78')],
  },
] as const;

// ---------------------------------------------------------------------------
// 3.5 Promesa de venta no cumplida
// ---------------------------------------------------------------------------

const CAUSAL_PROMESA: readonly Rule[] = [
  {
    ruleId: 'R-CAUSAL-PROMESA',
    nodeId: 'NODE-CAUSALES',
    kind: 'CAUSAL',
    description:
      'Promesa de venta no cumplida: los tres requisitos de N-46. Información errónea en la inscripción Y decisión explícita derivada de promesas Y rechazo de beneficios adicionales.',
    condition: all(
      fact('F-informacion_erronea_inscripcion'),
      fact('F-decision_explicita_por_promesas'),
      fact('F-rechazo_beneficios_adicionales'),
    ),
    onMatch: { kind: 'OUTCOME', outcome: 'CANCELACION_VENTA' },
    conflictIds: ['AMB-CON-03'],
    sourceRefs: [primary(7, '5.3', 'N-45'), primary(8, '5.3', 'N-46')],
  },
  {
    ruleId: 'R-PROMESA-N50',
    nodeId: 'NODE-CAUSALES',
    kind: 'COUNTEREVIDENCE',
    description:
      'Si Gestión de Validación realizó la interacción, registrada en tipificaciones, con speech de términos y condiciones, NO es promesa de venta no cumplida.',
    condition: fact('F-validacion_registrada_speech_tc'),
    onMatch: { kind: 'CONTINUE' },
    blocksRuleIds: ['R-CAUSAL-PROMESA', 'R-PROMESA-N52'],
    sourceRefs: [primary(8, '5.3', 'N-50')],
  },
  {
    ruleId: 'R-PROMESA-N52',
    nodeId: 'NODE-CAUSALES',
    kind: 'CAUSAL',
    description:
      'Si no hay evidencias en sistemas oficiales, sí es cancelación de venta por promesa no cumplida. La fuente expande aquí lo que N-46 restringe.',
    condition: not(fact('F-evidencia_sistema_oficial')),
    onMatch: { kind: 'OUTCOME', outcome: 'CANCELACION_VENTA' },
    conflictIds: ['AMB-CON-03'],
    sourceRefs: [primary(9, '5.3', 'N-52')],
  },
  {
    ruleId: 'R-PROMESA-N53',
    nodeId: 'NODE-CAUSALES',
    kind: 'CAUSAL',
    description:
      'Validación completa, sin incidencias y registrada, pero el estudiante expresa intención de darse de baja.',
    condition: all(fact('F-validacion_sin_incidencias'), fact('F-intencion_expresa_darse_de_baja')),
    onMatch: { kind: 'OUTCOME', outcome: 'BAJA' },
    sourceRefs: [primary(9, '5.3', 'N-53')],
  },
  {
    ruleId: 'R-PROMESA-N54',
    nodeId: 'NODE-CAUSALES',
    kind: 'CAUSAL',
    description:
      'Previo al inicio, GM conoce la solicitud e induce a modalidad de evaluación: aplica cancelación de venta con evidencia obligatoria.',
    condition: all(fact('F-gm_conoce_solicitud_previo')),
    onMatch: { kind: 'OUTCOME', outcome: 'CANCELACION_VENTA' },
    sourceRefs: [primary(9, '5.3', 'N-54')],
  },
  {
    ruleId: 'R-PROMESA-N56',
    nodeId: 'NODE-CAUSALES',
    kind: 'CAUSAL',
    description:
      'LATAM: sin evidencia de convalidación y el estudiante no desea continuar, aplica cancelación de venta.',
    condition: all(
      equals('F2-campus', 'LATAM'),
      not(fact('F-latam_convalidacion_evidencia')),
      not(fact('F-ce_decision_no_continuar')),
    ),
    onMatch: { kind: 'OUTCOME', outcome: 'CANCELACION_VENTA' },
    sourceRefs: [primary(10, '5.3', 'N-56')],
  },
] as const;

// ---------------------------------------------------------------------------
// 3.6 / 3.7 / 3.8 Ilocalizable, ingreso al aula y bot
// ---------------------------------------------------------------------------

const CAUSAL_ILOC: readonly Rule[] = [
  {
    ruleId: 'R-ILOC-N74',
    nodeId: 'NODE-ILOC',
    kind: 'COUNTEREVIDENCE',
    description:
      'Si el estudiante cursa varias asignaturas y en al menos una registra ingreso o selección de modalidad, no aplica cancelación de venta. Contraevidencia válida para cualquier nivel.',
    condition: fact('F-actividad_en_alguna_asignatura'),
    onMatch: { kind: 'CONTINUE' },
    blocksRuleIds: ['R-ILOC'],
    sourceRefs: [primary(13, '5.8.a', 'N-74')],
  },
  {
    ruleId: 'R-ILOC-N75',
    nodeId: 'NODE-ILOC',
    kind: 'COUNTEREVIDENCE',
    description:
      'Cualquier contacto durante la gestión de GM, Mejora Continua o Dictaminación: el estudiante no es ilocalizable, aunque el contacto no sea efectivo.',
    condition: fact('F-contacto_any_gestion'),
    onMatch: { kind: 'CONTINUE' },
    blocksRuleIds: ['R-ILOC'],
    sourceRefs: [primary(13, '5.8.a', 'N-75')],
  },
  {
    ruleId: 'R-ILOC-N91',
    nodeId: 'NODE-ILOC',
    kind: 'COUNTEREVIDENCE',
    description:
      'EE no cumple el número o porcentaje de interacciones y no hay causa operativa documentada: el requisito de gestión no se acredita.',
    condition: all(
      not(fact('F-ee_cumplio_interacciones')),
      not(fact('F-causa_operativa_documentada')),
    ),
    onMatch: { kind: 'CONTINUE' },
    blocksRuleIds: ['R-ILOC'],
    dependsOnUndeclaredThreshold: true,
    sourceRefs: [primary(15, '5.8.f', 'N-91')],
  },
  {
    ruleId: 'R-ILOC',
    nodeId: 'NODE-ILOC',
    kind: 'CAUSAL',
    description:
      'Cuando no se logre establecer ningún contacto efectivo dentro del límite del domingo de la semana 2, la solicitud se gestiona como cancelación de venta.',
    condition: all(
      // La ventana es parte de la regla, no un comentario: `decision-tree.md`
      // §3.6 la lista como campo «Ventana: hasta el domingo de la semana 2
      // (N-68, p.12)» y la propia descripción de la regla dice «dentro del
      // límite». Sin ella, un caso ilocalizable resuelto después de la semana 2
      // cerraría como CV cuando la fuente ya no lo sostiene.
      when('BEFORE_SUNDAY_OF_WEEK_2'),
      not(fact('F-contacto_efectivo')),
      fact('F-sin-actividad-nivel'),
      // Sin `equals(nivel, LICENCIATURA)`: la fuente define criterio de
      // actividad para cuatro niveles (N-70..N-73, fact-catalog §6.2) y el
      // catálogo ya normaliza los cuatro a `F-sin-actividad-nivel` con su
      // polaridad. Fijar un solo nivel dejaba muertos a Posgrado, Alianza,
      // Diplomado y Ejecutiva.
    ),
    onMatch: { kind: 'OUTCOME', outcome: 'CANCELACION_VENTA' },
    conflictIds: ['XDC-01', 'XDC-07', 'XDC-08', 'AMB-LOG-04', 'AMB-LOG-02'],
    sourceRefs: [
      primary(12, '5.8', 'N-68'),
      primary(12, '5.8.a', 'N-70'),
      primary(13, '5.8.a', 'N-75'),
    ],
  },
  {
    ruleId: 'R-ILOC-ESPECIAL-RETENCION',
    nodeId: 'NODE-ILOC',
    kind: 'CAUSAL',
    description:
      'Hay contacto pero no ingreso al aula, y EE o GM cumplieron las 4 acciones de activación: aplica retención.',
    condition: all(
      fact('F-contacto_efectivo'),
      not(fact('F-ingreso_aula_regular')),
      fact('F-acciones_activacion_gm'),
    ),
    onMatch: { kind: 'OUTCOME', outcome: 'RETENCION' },
    sourceRefs: [primary(14, '5.8.h', 'N-79'), primary(14, '5.8.h', 'N-80')],
  },
  {
    ruleId: 'R-ILOC-ESPECIAL-CV',
    nodeId: 'NODE-ILOC',
    kind: 'CAUSAL',
    description:
      'Hay contacto pero no ingreso al aula, y EE o GM no cumplieron las 4 acciones de activación: aplica cancelación de venta.',
    condition: all(
      fact('F-contacto_efectivo'),
      not(fact('F-ingreso_aula_regular')),
      not(fact('F-acciones_activacion_gm')),
    ),
    onMatch: { kind: 'OUTCOME', outcome: 'CANCELACION_VENTA' },
    sourceRefs: [primary(14, '5.8.h', 'N-79'), primary(14, '5.8.h', 'N-80')],
  },
  {
    ruleId: 'R-ILOC-SOLIC',
    nodeId: 'NODE-ILOC',
    kind: 'CAUSAL',
    description:
      'El estudiante que era ilocalizable contacta al Asesor de Ventas y pide no continuar: el Asesor debe canalizar de inmediato a EE y el desenlace lo fija la regla D35 según los tiempos estipulados.',
    condition: all(
      fact('F-estudiante_se_presenta_no_continuar'),
      fact('F-canalizado_a_ee'),
    ),
    onMatch: { kind: 'ESCALATE_TO_NODE', nodeId: 'NODE-D35-DELEGADO' },
    sourceRefs: [primary(14, '5.8', 'N-81')],
  },
  {
    ruleId: 'R-CAUSAL-BOT',
    nodeId: 'NODE-ILOC',
    kind: 'CAUSAL',
    description:
      'Única interacción con bot o asistente virtual, sin contacto con el Gestor de EE, con ambos equipos cumpliendo sus gestiones: cancelación de venta operativa sin impacto en ninguno de los dos equipos.',
    condition: fact('F-contacto_unico_bot'),
    onMatch: { kind: 'OUTCOME', outcome: 'CANCELACION_VENTA_OPERATIVA' },
    sourceRefs: [primary(14, '5.8', 'N-82')],
  },
] as const;

// ---------------------------------------------------------------------------
// 3.9 Cancelaciones operativas
// ---------------------------------------------------------------------------

const CAUSAL_OPERATIVA: readonly Rule[] = [
  {
    ruleId: 'R-OP-C',
    nodeId: 'NODE-OPERATIVA',
    kind: 'SUB_CAUSAL',
    description:
      'La incidencia identificada en Aula Virtual, SIU u otros sistemas institucionales desactiva por completo la política operativa de cancelación.',
    condition: fact('F-op_incidencia_sistema'),
    onMatch: { kind: 'CONTINUE' },
    blocksRuleIds: ['R-OP-A', 'R-OP-B', 'R-OP-D', 'R-OP-E', 'R-OP-F', 'R-OP-G', 'R-OP-H'],
    sourceRefs: [primary(16, '5.9.c', 'N-95')],
  },
  {
    ruleId: 'R-OP-A',
    nodeId: 'NODE-OPERATIVA',
    kind: 'SUB_CAUSAL',
    description:
      'Error de Servicios Escolares que otorga D35 a quien no cumple perfil o documentación. Excluye los canales College y Upselling.',
    condition: all(fact('F-op_error_servicios_escolares_d35'), fact('F-op_canal_no_excluido')),
    onMatch: { kind: 'OUTCOME', outcome: 'CANCELACION_VENTA_OPERATIVA' },
    sourceRefs: [primary(16, '5.9.a', 'N-93')],
  },
  {
    ruleId: 'R-OP-B',
    nodeId: 'NODE-OPERATIVA',
    kind: 'SUB_CAUSAL',
    description:
      'Error administrativo de Finanzas o Cobranza, ajeno a inscripción, que genera afectación en la experiencia y motiva a no continuar.',
    condition: all(fact('F-op_error_finanzas'), fact('F-op_error_afectacion_experiencia')),
    onMatch: { kind: 'OUTCOME', outcome: 'CANCELACION_VENTA_OPERATIVA' },
    sourceRefs: [primary(16, '5.9.b', 'N-94')],
  },
  {
    ruleId: 'R-OP-D',
    nodeId: 'NODE-OPERATIVA',
    kind: 'SUB_CAUSAL',
    description: 'El área operativa no canalizó ni notificó a EE.',
    condition: fact('F-op_no_canalizo_a_ee'),
    onMatch: { kind: 'OUTCOME', outcome: 'CANCELACION_VENTA_OPERATIVA' },
    sourceRefs: [primary(16, '5.9.d', 'N-99')],
  },
  {
    ruleId: 'R-OP-E',
    nodeId: 'NODE-OPERATIVA',
    kind: 'SUB_CAUSAL',
    description: 'Error en el seguimiento de EE o en la solicitud de gestión vía Flokzu.',
    condition: fact('F-op_error_seguimiento_ee'),
    onMatch: { kind: 'OUTCOME', outcome: 'CANCELACION_VENTA_OPERATIVA' },
    sourceRefs: [primary(17, '5.9.e', 'N-100')],
  },
  {
    ruleId: 'R-OP-F',
    nodeId: 'NODE-OPERATIVA',
    kind: 'SUB_CAUSAL',
    description:
      'Discrepancia del 100 % del paquete de venta con el error atribuible al proceso y no al asesor. El inciso dice «aplicará cancelación de venta», sin el calificativo «operativa» que sí usan las demás sub-causales.',
    condition: all(fact('F-op_discrepancia_paquete'), fact('F-op_error_es_proceso_no_asesor')),
    onMatch: { kind: 'OUTCOME', outcome: 'CANCELACION_VENTA' },
    sourceRefs: [primary(17, '5.9.f', 'N-101')],
  },
  {
    ruleId: 'R-OP-G',
    nodeId: 'NODE-OPERATIVA',
    kind: 'SUB_CAUSAL',
    description: 'Error en la validación de venta por Back Office que genera la solicitud.',
    condition: fact('F-op_error_validacion_bo'),
    onMatch: { kind: 'OUTCOME', outcome: 'CANCELACION_VENTA_OPERATIVA' },
    sourceRefs: [primary(17, '5.9.g', 'N-102')],
  },
  {
    ruleId: 'R-OP-H',
    nodeId: 'NODE-OPERATIVA',
    kind: 'SUB_CAUSAL',
    description:
      'Actualización de producto sin capacitación o comunicación formal a Operaciones por RRHH.',
    condition: fact('F-op_actualizacion_producto_sin_comunicacion'),
    onMatch: { kind: 'OUTCOME', outcome: 'CANCELACION_VENTA_OPERATIVA' },
    sourceRefs: [primary(8, '5.1.c', 'N-48')],
  },
  {
    ruleId: 'R-OP-INTENCION-BAJA',
    nodeId: 'NODE-OPERATIVA',
    kind: 'SUB_CAUSAL',
    description:
      'Aunque exista una causa operativa registrada, si el estudiante expresa intención de desertar, el desenlace es baja.',
    condition: fact('F-intencion_expresa_darse_de_baja'),
    onMatch: { kind: 'OUTCOME', outcome: 'BAJA' },
    sourceRefs: [primary(16, '5.9.c', 'N-98')],
  },
] as const;

// ---------------------------------------------------------------------------
// 3.10 Quórum, 3.13 Documentos y 3.14 Escalamiento
// ---------------------------------------------------------------------------

const REST: readonly Rule[] = [
  {
    ruleId: 'R-CAUSAL-QUORUM',
    nodeId: 'NODE-QUORUM',
    kind: 'CAUSAL',
    description:
      'El programa no alcanza el mínimo de estudiantes para su apertura, el grupo no se abre, no hay alternativa de reprogramación y el estudiante la rechaza. La fecha de solicitud no limita la aplicación del criterio.',
    condition: all(
      fact('F-quorum_no_alcanzado'),
      fact('F-grupo_no_abierto'),
      not(fact('F-evidencia_alternativa_reprogramacion')),
      fact('F-estudiante_rechaza_alternativa'),
    ),
    onMatch: { kind: 'OUTCOME', outcome: 'CANCELACION_VENTA' },
    declaredPrecedenceOver: ['R-REGLA-20-DIAS', 'R-D35-TARDE'],
    sourceRefs: [
      primary(17, '5.11', 'N-106'),
      primary(18, '5.11', 'N-108'),
      primary(18, '5.11', 'N-110'),
      primary(18, '5.11', 'N-111'),
      primary(18, '5.11', 'N-112'),
    ],
  },
  {
    ruleId: 'R-DOC-A-BREAK',
    nodeId: 'NODE-DOCUMENTOS',
    kind: 'CAUSAL',
    description:
      'Sin documento que acredite el grado previo, con carta manifiesto firmada, y el estudiante declara que no podrá entregarla en plazo.',
    condition: all(
      fact('F-documento_grado_previo_ausente'),
      fact('F-carta_manifiesto_firmada'),
      fact('F-estudiante_no_puede_entregar'),
    ),
    onMatch: { kind: 'OUTCOME', outcome: 'CANCELACION_VENTA' },
    conflictIds: ['XDC-09'],
    sourceRefs: [primary(10, '5.7.a', 'N-59'), primary(11, '5.7.a', 'N-60')],
  },
  {
    ruleId: 'R-DOC-B',
    nodeId: 'NODE-DOCUMENTOS',
    kind: 'CAUSAL',
    description:
      'Back Office valida que el estudiante no acredita el grado previo requerido, incluido el caso D53 con convenio firmado: cancelación de venta por invasión de ciclo.',
    condition: fact('F-evidencia_bo_no_acredita_grado'),
    onMatch: { kind: 'OUTCOME', outcome: 'CANCELACION_VENTA' },
    sourceRefs: [primary(11, '5.7.b', 'N-63')],
  },
  {
    ruleId: 'R-ESCALAMIENTO-N13',
    nodeId: 'NODE-ESCALAMIENTO',
    kind: 'ESCALATION',
    description: 'Mejora Continua no logra emitir una definición: escalar a Auditoría de Cancelaciones de Venta.',
    condition: fact('F-mejora_continua_no_emite'),
    onMatch: { kind: 'OUTCOME', outcome: 'DICTAMINACION' },
    sourceRefs: [primary(2, '2.2', 'N-13')],
  },
  {
    ruleId: 'R-ESCALAMIENTO-N14',
    nodeId: 'NODE-ESCALAMIENTO',
    kind: 'ESCALATION',
    description: 'La cancelación deriva de una nueva iniciativa: escalar a Dictaminación.',
    condition: fact('F-nueva_iniciativa'),
    onMatch: { kind: 'OUTCOME', outcome: 'DICTAMINACION' },
    sourceRefs: [primary(3, '2.2', 'N-14')],
  },
  {
    ruleId: 'R-ESCALAMIENTO-N89',
    nodeId: 'NODE-ESCALAMIENTO',
    kind: 'ESCALATION',
    description:
      'La respuesta del estudiante se vincula a otra política o lineamiento: escalar a Dictaminación.',
    condition: fact('F-otra_politica_lineamiento'),
    onMatch: { kind: 'OUTCOME', outcome: 'DICTAMINACION' },
    sourceRefs: [primary(15, '5.7', 'N-89')],
  },
  {
    ruleId: 'R-ESCALAMIENTO-N57',
    nodeId: 'NODE-ESCALAMIENTO',
    kind: 'ESCALATION',
    description:
      'Al exceder los plazos con evidencia de promesa no cumplida se escala y se evalúa cancelación de venta contra baja. Primera de las dos rutas que el documento no distingue.',
    condition: fact('F-excede_plazos_promesa'),
    onMatch: { kind: 'OUTCOME', outcome: 'DICTAMINACION' },
    conflictIds: ['AMB-CON-02'],
    sourceRefs: [primary(10, '5.4', 'N-57')],
  },
  {
    ruleId: 'R-ESCALAMIENTO-N58',
    nodeId: 'NODE-ESCALAMIENTO',
    kind: 'ESCALATION',
    description:
      'Al exceder los plazos con evidencia de promesa no cumplida se escala a Dictaminación. Segunda ruta para la misma hipótesis.',
    condition: fact('F-excede_plazos_promesa'),
    onMatch: { kind: 'OUTCOME', outcome: 'DICTAMINACION' },
    conflictIds: ['AMB-CON-02'],
    sourceRefs: [primary(10, '5.4', 'N-58')],
  },
] as const;

export const CAUSALS: readonly Rule[] = [
  ...CAUSAL_V,
  ...CAUSAL_CICLO,
  ...CAUSAL_PROMESA,
  ...CAUSAL_ILOC,
  ...CAUSAL_OPERATIVA,
  ...REST,
] as const;
