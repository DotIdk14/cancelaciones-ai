/**
 * Catálogo de hechos del Rule Engine V2.
 *
 * Fuente: `docs/policy-v2/fact-catalog.md` (Phase 1 + Phase 1.5).
 * Cada entrada declara su procedencia (`sourceRefs`), su polaridad y por qué
 * importa. El evaluador **no** conoce la polaridad: la lee de aquí.
 *
 * ## `AMB-LOG-02` — por qué existe `activityPolarity`
 *
 * El primario usa la misma estructura sintáctica para cuatro niveles con
 * polaridad opuesta (fact-catalog §6.2, decision-tree §3.6.2):
 *
 * - Licenciaturas  «Haber seleccionado la modalidad…»  → `TRUE` = **hay** actividad
 * - Posgrado        «**No** haber registrado foros»       → `TRUE` = **no hay** actividad
 * - Alianza         «**No** haber ingresado a asignatura» → `TRUE` = **no hay** actividad
 * - Diplomado       «**No** haber registrado foros»       → `TRUE` = **no hay** actividad
 *
 * Una bandera única invertiría el resultado en tres de los cuatro niveles. Por
 * eso existen cuatro hechos distintos y la polaridad es un dato de la
 * definición. Un test de regresión de polaridad por nivel lo verifica.
 *
 * ## `AMB-NUM-02` — umbrales no declarados
 *
 * `F-marcaciones_colapsadas` y `F-llamadas_rango_estudiante` tienen un umbral
 * que la fuente **no fija**. Se marcan `undeclaredThreshold: true` y ninguna
 * regla puede cerrar con ellos: su estado nunca se fuerza a `KNOWN` desde el
 * motor.
 */

import type { ActivityPolarity, EvidenceKind, SourceRef } from '../contracts';
import { d53, glossary, primary } from '../sources';

export interface FactDefinition {
  readonly factId: string;
  readonly name: string;
  readonly description: string;
  readonly dataType: 'BOOLEAN' | 'ENUM' | 'NUMBER' | 'DATE';
  readonly domain?: readonly unknown[];
  /** Polaridad declarada por la fuente. Sólo para hechos de actividad. */
  readonly activityPolarity?: ActivityPolarity;
  /** `true` = el valor `TRUE` significa «hay actividad» (alumno localizado). */
  readonly sourceRefs: readonly SourceRef[];
  readonly requiredBy: readonly string[];
  readonly satisfiableBy: readonly EvidenceKind[];
  /**
   * `true` cuando el hecho es un invariante de interpretación y no un dato a
   * acreditar. Permite que `satisfiableBy` esté vacío de forma intencionada.
   */
  readonly normativeInvariant?: boolean;
  readonly whyItMatters: string;
  /** `true` cuando la fuente no fija el umbral que el concepto requiere. */
  readonly undeclaredThreshold?: boolean;
}

function def(definition: FactDefinition): FactDefinition {
  return definition;
}

const ANY_EVIDENCE: readonly EvidenceKind[] = [
  'PDF',
  'IMAGE',
  'AUDIO',
  'TEXT',
  'TICKET',
  'SIU',
  'ACADEMIC_RECORD',
  'WRITTEN_INTERACTION',
  'STUDENT_STATEMENT',
  'DATABASE',
];


// ---------------------------------------------------------------------------
// Filtros de prevalencia (§1)
// ---------------------------------------------------------------------------

export const FACT_DEFINITIONS: readonly FactDefinition[] = [
  def({
    factId: 'F-calificaciones_bimestre_1',
    name: 'Calificaciones en el bimestre 1 o inicial',
    description:
      'Si el estudiante ya tiene calificaciones en el bimestre 1 o inicial, el servicio ha devengado.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(11, '5.7.a', 'N-64')],
    requiredBy: ['R-FILTRO-CALIFICACIONES'],
    satisfiableBy: ['ACADEMIC_RECORD', 'SIU'],
    whyItMatters:
      'N-64 lo declara con «por ningún motivo»: cierra la puerta a toda causal de cancelación de venta y fuerza BAJA.',
  }),
  def({
    factId: 'F-canal_venta',
    name: 'Canal de la venta',
    description: 'Canal por el que ingresó la venta. `MYSTERY_SHOPPER` tiene desenlace propio.',
    dataType: 'ENUM',
    domain: ['MYSTERY_SHOPPER', 'OTRO'],
    sourceRefs: [primary(17, '5.12', 'N-105')],
    requiredBy: ['R-FILTRO-MYSTERY'],
    satisfiableBy: ['DATABASE'],
    whyItMatters:
      'N-105: toda venta por Mystery Shopper es CANCELACION_MATRICULA y no impacta el indicador de cancelaciones de venta.',
  }),
  def({
    factId: 'F-op_incidencia_sistema',
    name: 'Incidencia en sistema institucional',
    description:
      'Falta de activación, acceso o continuidad consecuencia de una incidencia en Aula Virtual, SIU u otros sistemas institucionales.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(16, '5.9.c', 'N-95')],
    requiredBy: ['R-FILTRO-INCIDENCIA', 'R-OP-C'],
    satisfiableBy: ['TICKET', 'DATABASE', 'TEXT'],
    whyItMatters:
      'N-95 desactiva toda la política operativa de cancelación (sección 5.9 completa).',
  }),
  def({
    factId: 'F-retencion_realizada',
    name: 'Proceso de retención ejecutado',
    description: 'Si se realizó el proceso de retención previo a la solicitud.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(5, '5.2', 'N-32'), primary(5, '5.2', 'N-33')],
    requiredBy: ['R-FILTRO-RETENCION'],
    satisfiableBy: ['DATABASE', 'AUDIO', 'TEXT', 'TICKET'],
    whyItMatters:
      'N-33: la falta de retención obliga a baja «sin que la fecha de inicio ni la aplicación de D35 o D53 afecten dicha determinación».',
  }),

  // -------------------------------------------------------------------------
  // Causales de negocio (§3)
  // -------------------------------------------------------------------------

  def({
    factId: 'F-ajuste_por_error_inscripcion',
    name: 'Ajuste por error de inscripción',
    description: 'El estudiante solicita ajuste administrativo por error en su inscripción.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(5, '5.2', 'N-36'), primary(6, '5.2', 'N-37')],
    requiredBy: ['R-CAUSAL-V'],
    satisfiableBy: ['TEXT', 'WRITTEN_INTERACTION', 'STUDENT_STATEMENT'],
    whyItMatters: 'N-36 declara «cancelación de venta o baja», sin declarar cuál: AMB-CON-04.',
  }),
  def({
    factId: 'F-ce_decision_no_continuar',
    name: 'El estudiante decide no continuar',
    description:
      'El estudiante, por el motivo del ajuste, desea y expresa el no querer continuar.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(5, '5.2', 'N-36')],
    requiredBy: ['R-CAUSAL-V'],
    satisfiableBy: ['STUDENT_STATEMENT', 'AUDIO', 'TEXT'],
    whyItMatters:
      'N-36 exige que el estudiante lo exprese; «de manera tácita» es el estándar contradictorio: AMB-CON-04.',
  }),
  def({
    factId: 'F-tipo_ajuste',
    name: 'Tipo de ajuste administrativo',
    description: 'Sub-caso de ajuste enumerado en N-37 (p.6).',
    dataType: 'ENUM',
    domain: [
      'CAMBIO_PROGRAMA',
      'AJUSTE_PAQUETE',
      'CAMBIO_CICLO_INICIO',
      'CAMBIO_CAMPUS_TRANSFERENCIA',
      'GM_EE',
      'OTRO',
    ],
    sourceRefs: [primary(6, '5.2', 'N-37'), primary(7, '5.2', 'N-43')],
    requiredBy: ['R-CAUSAL-V', 'R-CAUSAL-EE'],
    satisfiableBy: ['TEXT', 'DATABASE'],
    whyItMatters: 'N-43/44 (p.7) distinguen los ajustes de GM/EE, que además producen gestión, no desenlace.',
  }),
  def({
    factId: 'F-habil_1_20_dias',
    name: 'Habilitación dentro de los 20 días',
    description: 'El ajuste se gestiona dentro de la ventana de 20 días desde el inicio.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(5, '5.2', 'N-35')],
    requiredBy: ['R-CAUSAL-V', 'R-CAUSAL-EE'],
    satisfiableBy: ['DATABASE', 'TEXT'],
    whyItMatters: 'N-35 gobierna por encima de la ventana de 2 semanas de N-15.',
  }),
  def({
    factId: 'F-cambio_ciclo_antes_del_inicio',
    name: 'Cambio de ciclo gestionado antes del inicio',
    description: 'El cambio de ciclo se gestionó antes del inicio de clases.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(7, '5.2', 'N-41'), primary(7, '5.2', 'N-42')],
    requiredBy: ['R-CAUSAL-CICLO-A', 'R-CAUSAL-CICLO-B'],
    satisfiableBy: ['DATABASE', 'TEXT'],
    whyItMatters:
      'La misma hipótesis física cambia de desenlace según cuándo y quién gestiona: N-41 da CV, N-42 da RETENCION.',
  }),
  def({
    factId: 'F-cambio_ciclo_gestionado_por',
    name: 'Quién gestiona el cambio de ciclo',
    description: 'GM (Gestor de Matrícula) o EE (Ejecutiva de Expresión Escolar).',
    dataType: 'ENUM',
    domain: ['GM', 'EE', 'OTRO'],
    sourceRefs: [primary(7, '5.2', 'N-42')],
    requiredBy: ['R-CAUSAL-CICLO-A', 'R-CAUSAL-CICLO-B'],
    satisfiableBy: ['DATABASE'],
    whyItMatters:
      'N-42 exige que el cambio lo gestione EE «a partir del inicio»; si lo gestiona GM, N-41 aplica.',
  }),
  def({
    factId: 'F-cambio_ciclo_nuevo_no_ingresa',
    name: 'El estudiante no ingresa en el nuevo ciclo',
    description: 'Tras el cambio de ciclo, el estudiante no ingresa.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(7, '5.2', 'N-41'), primary(7, '5.2', 'N-42')],
    requiredBy: ['R-CAUSAL-CICLO-A', 'R-CAUSAL-CICLO-B'],
    satisfiableBy: ['SIU', 'DATABASE'],
    whyItMatters: 'Hecho compartido por dos ramas con desenlaces opuestos: la polaridad de quién/ cuándo decide.',
  }),
  def({
    factId: 'F-cambio_ciclo_autorizado',
    name: 'El estudiante autoriza el cambio de ciclo',
    description: 'El estudiante autoriza expresamente el cambio de ciclo.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(6, '5.2', 'N-39')],
    requiredBy: ['R-CICLO-NO-AUTORIZADO'],
    satisfiableBy: ['WRITTEN_INTERACTION', 'TEXT', 'DATABASE'],
    whyItMatters: 'N-39: sin autorización, y en revalidación/equivalencia de bloques intermedios, el desenlace es CV.',
  }),
  def({
    factId: 'F-cambio_ciclo_desiste_nuevamente',
    name: 'El estudiante desiste nuevamente en el nuevo ciclo',
    description: 'En el nuevo ciclo, el estudiante vuelve a desistir de su ingreso.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(13, '5.6', 'N-78')],
    requiredBy: ['R-CICLO-DESISTE'],
    satisfiableBy: ['STUDENT_STATEMENT', 'TEXT', 'AUDIO'],
    whyItMatters:
      'N-78 dice «cancelación de venta o baja según corresponda»: no declara cuál. AMB-CON-04.',
  }),
  def({
    factId: 'F-ciclo_revalidacion_equivalencia',
    name: 'El alumno está en revalidación o equivalencia de bloques intermedios',
    description: 'El alumno está en revalidación o equivalencia de bloques intermedios.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(6, '5.2', 'N-39')],
    requiredBy: ['R-CICLO-NO-AUTORIZADO'],
    satisfiableBy: ['ACADEMIC_RECORD', 'DATABASE'],
    whyItMatters: 'N-39 condiciona este desenlace a esos dos supuestos.',
  }),
  def({
    factId: 'F-informacion_erronea_inscripcion',
    name: 'Información errónea en la inscripción',
    description: 'Información errónea, falsa, tendenciosa o no alineada durante la inscripción.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(7, '5.3', 'N-45')],
    requiredBy: ['R-CAUSAL-PROMESA'],
    satisfiableBy: ['TEXT', 'WRITTEN_INTERACTION', 'STUDENT_STATEMENT'],
    whyItMatters: 'Requisito A de la triple condición de N-45/N-46.',
  }),
  def({
    factId: 'F-decision_explicita_por_promesas',
    name: 'Decisión explícita derivada de promesas no cumplidas',
    description: 'El estudiante decidió cancelar por promesas de venta no cumplidas.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(8, '5.3', 'N-46')],
    requiredBy: ['R-CAUSAL-PROMESA'],
    satisfiableBy: ['STUDENT_STATEMENT', 'AUDIO', 'TEXT'],
    whyItMatters: 'Requisito B de la triple condición de N-46.',
  }),
  def({
    factId: 'F-rechazo_beneficios_adicionales',
    name: 'Rechazo de beneficios adicionales',
    description: 'El estudiante rechaza los beneficios ofrecidos: retención o ajustes correctivos.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(8, '5.3', 'N-46')],
    requiredBy: ['R-CAUSAL-PROMESA'],
    satisfiableBy: ['STUDENT_STATEMENT', 'TEXT', 'AUDIO'],
    whyItMatters:
      'Requisito C de la triple condición de N-46. N-46 restringe; N-52 expande: AMB-CON-03.',
  }),
  def({
    factId: 'F-validacion_registrada_speech_tc',
    name: 'Validación con speech de términos y condiciones',
    description:
      'Gestión de Validación realizó la interacción, registrada en tipificaciones, con speech de términos y condiciones.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(8, '5.3', 'N-50')],
    requiredBy: ['R-PROMESA-N50'],
    satisfiableBy: ['DATABASE', 'AUDIO', 'TEXT'],
    whyItMatters: 'N-50 es contraevidencia: anula la causal de promesa no cumplida.',
  }),
  def({
    factId: 'F-evidencia_sistema_oficial',
    name: 'Existe evidencia en sistemas oficiales',
    description: 'Existen evidencias del proceso en sistemas oficiales.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(9, '5.3', 'N-52')],
    requiredBy: ['R-PROMESA-N52'],
    satisfiableBy: ['SIU', 'DATABASE', 'PDF'],
    whyItMatters:
      'N-52 expande la causal: sin evidencia, «sí es CV por promesa no cumplida». Choca con N-46: AMB-CON-03.',
  }),
  def({
    factId: 'F-validacion_sin_incidencias',
    name: 'Validación completa y sin incidencias',
    description: 'La validación se completó, sin incidencias, y quedó registrada.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(9, '5.3', 'N-53')],
    requiredBy: ['R-PROMESA-N53'],
    satisfiableBy: ['DATABASE', 'TICKET'],
    whyItMatters: 'N-53: aun con validación limpia, si el alumno expresa baja, el desenlace es BAJA.',
  }),
  def({
    factId: 'F-intencion_expresa_darse_de_baja',
    name: 'Intención expresa de darse de baja',
    description: 'El estudiante expresa intención de darse de baja.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(9, '5.3', 'N-53'), primary(16, '5.9', 'N-98')],
    requiredBy: ['R-PROMESA-N53', 'R-OP-INTENCION-BAJA'],
    satisfiableBy: ['STUDENT_STATEMENT', 'AUDIO', 'TEXT', 'WRITTEN_INTERACTION'],
    whyItMatters: 'N-53 y N-98 convierten la intención expresa de baja en BAJA.',
  }),
  def({
    factId: 'F-gm_conoce_solicitud_previo',
    name: 'GM conoce la solicitud antes del inicio',
    description: 'Previo al inicio, GM conoce la solicitud e induce a modalidad de evaluación.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(9, '5.3', 'N-54')],
    requiredBy: ['R-PROMESA-N54'],
    satisfiableBy: ['DATABASE', 'TEXT'],
    whyItMatters: 'N-54 permite CV previo al inicio, con evidencia obligatoria.',
  }),
  def({
    factId: 'F-latam_convalidacion_evidencia',
    name: 'Existe evidencia de convalidación en LATAM',
    description: 'LATAM: existe evidencia de convalidación.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(10, '5.3', 'N-56')],
    requiredBy: ['R-PROMESA-N56'],
    satisfiableBy: ['ACADEMIC_RECORD', 'PDF', 'DATABASE'],
    whyItMatters: 'N-56: sin evidencia de convalidación y sin deseo de continuar, la causal es CV.',
  }),
  def({
    factId: 'F-excede_plazos_promesa',
    name: 'La solicitud excede los plazos con evidencia de promesa no cumplida',
    description: 'El caso rebasa los plazos y existe evidencia de promesa no cumplida.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(10, '5.4', 'N-57'), primary(10, '5.4', 'N-58')],
    requiredBy: ['R-ESCALAMIENTO-N57', 'R-ESCALAMIENTO-N58'],
    satisfiableBy: ['TEXT', 'AUDIO', 'STUDENT_STATEMENT'],
    whyItMatters:
      'N-57 y N-58 describen dos rutas distintas de escalamiento sin declarar cuál aplica: AMB-CON-02.',
  }),
  def({
    factId: 'F-canalizado_a_ee',
    name: 'El Asesor canalizó de inmediato a EE',
    description: 'El Asesor de Ventas debe canalizar de inmediato a EE.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(14, '5.8', 'N-81')],
    requiredBy: ['R-ILOC-SOLIC'],
    satisfiableBy: ['DATABASE', 'TEXT'],
    whyItMatters:
      'N-81 delega el desenlace a la regla D35 según tiempos: el inciso no fija desenlace por sí mismo.',
  }),
  def({
    factId: 'F-estudiante_se_presenta_no_continuar',
    name: 'El estudiante se presenta y pide no continuar',
    description: 'El estudiante que era ilocalizable contacta al Asesor y pide no continuar.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(14, '5.8', 'N-81')],
    requiredBy: ['R-ILOC-SOLIC'],
    satisfiableBy: ['AUDIO', 'TEXT', 'STUDENT_STATEMENT'],
    whyItMatters: 'Condición de entrada de N-81.',
  }),

  // -------------------------------------------------------------------------
  // Contacto efectivo y actividad (polaridad crítica)
  // -------------------------------------------------------------------------

  def({
    factId: 'F-actividad_licenciatura',
    name: 'Actividad en Licenciatura (polaridad positiva)',
    description:
      'Haber seleccionado la modalidad de evaluación en al menos una asignatura activa, o haber realizado al menos tres ingresos a la plataforma de 10 minutos.',
    dataType: 'BOOLEAN',
    activityPolarity: 'POSITIVE',
    sourceRefs: [primary(12, '5.8.a', 'N-70')],
    requiredBy: ['R-ILOC-N74', 'R-ILOC'],
    satisfiableBy: ['SIU', 'DATABASE'],
    whyItMatters:
      'TRUE significa que HAY actividad, luego el alumno está localizado. Única de los cuatro con polaridad positiva.',
  }),
  def({
    factId: 'F-actividad_posgrado',
    name: 'No haber registrado participación en foros — Posgrado/Ejecutiva (polaridad negativa)',
    description: 'El enunciado fuente es «No haber registrado participación en foros en ninguna asignatura activa».',
    dataType: 'BOOLEAN',
    activityPolarity: 'NEGATIVE',
    sourceRefs: [primary(12, '5.8.a', 'N-71')],
    requiredBy: ['R-ILOC'],
    satisfiableBy: ['SIU', 'DATABASE'],
    whyItMatters:
      'TRUE significa que NO hay actividad, luego el alumno es ilocalizable. Invertir esta bandera invierte el desenlace (AMB-LOG-02).',
  }),
  def({
    factId: 'F-actividad_alianza',
    name: 'No haber ingresado a ninguna asignatura — Alianza (polaridad negativa)',
    description: 'El enunciado fuente es «No haber ingresado a ninguna asignatura activa».',
    dataType: 'BOOLEAN',
    activityPolarity: 'NEGATIVE',
    sourceRefs: [primary(13, '5.8.a', 'N-72')],
    requiredBy: ['R-ILOC'],
    satisfiableBy: ['SIU', 'DATABASE'],
    whyItMatters: 'TRUE = no hay actividad = ilocalizable. Polaridad negativa (AMB-LOG-02).',
  }),
  def({
    factId: 'F-actividad_diplomado',
    name: 'No haber registrado participación en foros — Diplomado (polaridad negativa)',
    description: 'El enunciado fuente es «No haber registrado participación en foros en ninguna asignatura activa».',
    dataType: 'BOOLEAN',
    activityPolarity: 'NEGATIVE',
    sourceRefs: [primary(13, '5.8.a', 'N-73')],
    requiredBy: ['R-ILOC'],
    satisfiableBy: ['SIU', 'DATABASE'],
    whyItMatters: 'TRUE = no hay actividad = ilocalizable. Polaridad negativa (AMB-LOG-02).',
  }),
  def({
    factId: 'F-actividad_en_alguna_asignatura',
    name: 'Ingreso o selección de modalidad en al menos una asignatura (N-74)',
    description:
      'Si el estudiante cursa varias asignaturas y en al menos una registra ingreso o selección de modalidad, no aplica CV.',
    dataType: 'BOOLEAN',
    activityPolarity: 'POSITIVE',
    sourceRefs: [primary(13, '5.8.a', 'N-74')],
    requiredBy: ['R-ILOC-N74'],
    satisfiableBy: ['SIU', 'DATABASE'],
    whyItMatters:
      'N-74 anula la causal de ilocalizable con una sola evidencia positiva, cualquiera que sea el nivel. Contraevidencia de prioridad alta.',
  }),
  def({
    factId: 'F-contacto_efectivo',
    name: 'Contacto efectivo con el estudiante',
    description:
      'Interacción efectiva con el estudiante titular. La conectiva de 5.8.h (AND/OR) NO está declarada en la fuente.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(14, '5.8.h', 'N-68')],
    requiredBy: ['R-ILOC', 'R-ILOC-ESPECIAL-RETENCION', 'R-ILOC-ESPECIAL-CV'],
    satisfiableBy: ['AUDIO', 'TEXT', 'WRITTEN_INTERACTION', 'DATABASE'],
    whyItMatters:
      'AMB-LOG-04: la fuente no declara si los criterios de 5.8.h se combinan con AND u OR. El motor evalúa el hecho tal como lo entrega la evidencia y expone el conflicto.',
  }),
  def({
    factId: 'F-contacto_any_gestion',
    name: 'Cualquier contacto durante gestión de GM, Mejora Continua o Dictaminación',
    description: 'Se produjo cualquier contacto durante la gestión, incluso no efectivo.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(13, '5.8.a', 'N-75')],
    requiredBy: ['R-ILOC-N75'],
    satisfiableBy: ['DATABASE', 'AUDIO', 'TEXT'],
    whyItMatters: 'N-75 basta con cualquier contacto, incluso no efectivo, y anula la causal de ilocalizable.',
  }),
  def({
    factId: 'F-ee_cumplio_interacciones',
    name: 'EE cumplió el número o porcentaje de interacciones',
    description: 'EE no cumple el número o porcentaje de interacciones y no hay causa operativa documentada.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(15, '5.8.f', 'N-91')],
    requiredBy: ['R-ILOC-N91'],
    satisfiableBy: ['DATABASE', 'TICKET'],
    whyItMatters:
      'N-91: el número o porcentaje exigido no está declarado en la fuente (AMB-NUM-01/02). El hecho lo aporta la evidencia; el motor no fija umbral.',
  }),
  def({
    factId: 'F-causa_operativa_documentada',
    name: 'Existe causa operativa documentada',
    description: 'Existe causa operativa documentada que excuse el incumplimiento de interacciones.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(15, '5.8.f', 'N-91')],
    requiredBy: ['R-ILOC-N91'],
    satisfiableBy: ['TICKET', 'TEXT', 'PDF'],
    whyItMatters: 'N-91: sin causa operativa documentada, el requisito de gestión no se acredita.',
  }),
  def({
    factId: 'F-marcaciones_colapsadas',
    name: 'Marcaciones de contacto colapsadas',
    description: 'Número de marcaciones colapsadas en el CRM que impiden el contacto.',
    dataType: 'NUMBER',
    sourceRefs: [primary(14, '5.8.g', 'N-69')],
    requiredBy: [],
    satisfiableBy: ['DATABASE'],
    whyItMatters:
      'AMB-NUM-02: la fuente NO declara el umbral de colapso. Ninguna regla puede cerrar con este hecho; se reporta como faltante.',
    undeclaredThreshold: true,
  }),
  def({
    factId: 'F-llamadas_rango_estudiante',
    name: 'Llamadas dentro del rango establecido para el estudiante',
    description: 'Llamadas realizadas dentro del rango que la fuente establece para el estudiante.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(15, '5.8.f', 'N-88')],
    requiredBy: [],
    satisfiableBy: ['DATABASE', 'AUDIO'],
    whyItMatters:
      'AMB-NUM-01: el número de contacto y el rango son contradictorios entre la fuente principal y el anexo no disponible. Se conserva sin umbral.',
  }),

  // -------------------------------------------------------------------------
  // Ingreso a aula y activación (§3.7)
  // -------------------------------------------------------------------------

  def({
    factId: 'F-ingreso_aula_regular',
    name: 'Ingreso al aula regular',
    description: 'El estudiante ingresó al aula regular.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(14, '5.8.h', 'N-80')],
    requiredBy: ['R-ILOC-ESPECIAL-RETENCION', 'R-ILOC-ESPECIAL-CV'],
    satisfiableBy: ['SIU', 'DATABASE'],
    whyItMatters: 'N-80: hay contacto pero no ingreso al aula.',
  }),
  def({
    factId: 'F-acciones_activacion_gm',
    name: 'GM/EE cumplieron las 4 acciones de activación',
    description:
      'Las 4 acciones de N-79: transferir a EE o dar instrucciones; confirmar y actualizar datos; proporcionar ligas de contacto; notificar formalmente a EE por correo.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(14, '5.8.h', 'N-79')],
    requiredBy: ['R-ILOC-ESPECIAL-RETENCION', 'R-ILOC-ESPECIAL-CV'],
    satisfiableBy: ['DATABASE', 'TEXT', 'PDF'],
    whyItMatters: 'N-79/N-80: si las 4 acciones se cumplieron, el desenlace es RETENCION, no CV.',
  }),
  def({
    factId: 'F-contacto_unico_bot',
    name: 'Única interacción con bot o asistente virtual',
    description: 'La única interacción del estudiante fue con el bot o asistente virtual, sin contacto con el Gestor de EE.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(14, '5.8', 'N-82')],
    requiredBy: ['R-CAUSAL-BOT'],
    satisfiableBy: ['DATABASE', 'AUDIO', 'TEXT'],
    whyItMatters:
      'N-82: contacto único con bot da CANCELACION_VENTA_OPERATIVA sin impacto en VV ni EE.',
  }),

  // -------------------------------------------------------------------------
  // Cancelaciones operativas (§3.9)
  // -------------------------------------------------------------------------

  def({
    factId: 'F-op_error_servicios_escolares_d35',
    name: 'Error de Servicios Escolares que otorga D35',
    description: 'Error de Servicios Escolares que otorga D35 a quien no cumple perfil o documentación.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(16, '5.9.a', 'N-93')],
    requiredBy: ['R-OP-A'],
    satisfiableBy: ['TICKET', 'TEXT', 'DATABASE'],
    whyItMatters: 'N-93: CV operativa. Excluye canales College y Upselling.',
  }),
  def({
    factId: 'F-op_canal_no_excluido',
    name: 'El canal no es College ni Upselling',
    description: 'El canal de venta no es College ni Upselling.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(16, '5.9.a', 'N-93')],
    requiredBy: ['R-OP-A'],
    satisfiableBy: ['DATABASE'],
    whyItMatters: 'N-93 excluye expresamente College y Upselling.',
  }),
  def({
    factId: 'F-op_error_finanzas',
    name: 'Error administrativo de Finanzas o Cobranza',
    description: 'Error administrativo de Finanzas o Cobranza, ajeno a inscripción.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(16, '5.9.b', 'N-94')],
    requiredBy: ['R-OP-B'],
    satisfiableBy: ['TICKET', 'TEXT'],
    whyItMatters: 'N-94: el error debe afectar la experiencia y motivar a no continuar.',
  }),
  def({
    factId: 'F-op_error_afectacion_experiencia',
    name: 'El error afecta la experiencia del estudiante',
    description: 'El error genera afectación en la experiencia y motiva a no continuar.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(16, '5.9.b', 'N-94')],
    requiredBy: ['R-OP-B'],
    satisfiableBy: ['STUDENT_STATEMENT', 'TICKET', 'TEXT'],
    whyItMatters: 'N-94 exige afectación y motivación; sin ambas no aplica.',
  }),
  def({
    factId: 'F-op_no_canalizo_a_ee',
    name: 'El área operativa no canalizó ni notificó a EE',
    description: 'El área operativa no canalizó ni notificó a EE.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(16, '5.9.d', 'N-99')],
    requiredBy: ['R-OP-D'],
    satisfiableBy: ['DATABASE', 'TICKET'],
    whyItMatters: 'N-99: falta de canalización a EE da CV operativa.',
  }),
  def({
    factId: 'F-op_error_seguimiento_ee',
    name: 'Error en seguimiento de EE o en solicitud vía Flokzu',
    description: 'Error en el seguimiento de EE o en la solicitud de gestión vía Flokzu.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(17, '5.9.e', 'N-100')],
    requiredBy: ['R-OP-E'],
    satisfiableBy: ['TICKET', 'TEXT', 'DATABASE'],
    whyItMatters: 'N-100: CV operativa.',
  }),
  def({
    factId: 'F-op_discrepancia_paquete',
    name: 'Discrepancia del 100 % del paquete de venta',
    description: 'Discrepancia del 100 % del paquete de venta.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(17, '5.9.f', 'N-101')],
    requiredBy: ['R-OP-F'],
    satisfiableBy: ['PDF', 'DATABASE', 'TEXT'],
    whyItMatters: 'N-101: discrepancia total da CANCELACION_VENTA (sin el calificativo «operativa»). AMB-LOG-05.',
  }),
  def({
    factId: 'F-op_error_es_proceso_no_asesor',
    name: 'El error es del proceso y no del asesor',
    description: 'El error es del proceso y no del asesor.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(17, '5.9.f', 'N-101')],
    requiredBy: ['R-OP-F'],
    satisfiableBy: ['TICKET', 'TEXT'],
    whyItMatters: 'N-101 exige que el error sea del proceso, no del asesor.',
  }),
  def({
    factId: 'F-op_error_validacion_bo',
    name: 'Error en validación de venta por Back Office',
    description: 'Error en la validación de venta por parte de Back Office.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(17, '5.9.g', 'N-102')],
    requiredBy: ['R-OP-G'],
    satisfiableBy: ['TICKET', 'DATABASE', 'TEXT'],
    whyItMatters: 'N-102: CV operativa, y es el cruce con el motivo M1 de G-13 (error en el paquete de inscripción).',
  }),
  def({
    factId: 'F-op_actualizacion_producto_sin_comunicacion',
    name: 'Actualización de producto sin capacitación ni comunicación',
    description: 'Actualización de producto sin capacitación o comunicación formal a Operaciones por RRHH.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(8, '5.1.c', 'N-48')],
    requiredBy: ['R-OP-H'],
    satisfiableBy: ['TICKET', 'TEXT', 'PDF'],
    whyItMatters: 'N-48: CV operativa.',
  }),

  // -------------------------------------------------------------------------
  // Quórum (§3.10)
  // -------------------------------------------------------------------------

  def({
    factId: 'F-quorum_no_alcanzado',
    name: 'El programa no alcanzó el quórum mínimo',
    description: 'El programa no alcanzó el mínimo de estudiantes para su apertura.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(17, '5.11', 'N-106')],
    requiredBy: ['R-CAUSAL-QUORUM'],
    satisfiableBy: ['DATABASE', 'ACADEMIC_RECORD'],
    whyItMatters: 'N-106: innegable junto con el rechazo de la alternativa.',
  }),
  def({
    factId: 'F-grupo_no_abierto',
    name: 'El grupo no se abrió',
    description: 'El grupo no llegó a abrirse.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(18, '5.11', 'N-111')],
    requiredBy: ['R-CAUSAL-QUORUM'],
    satisfiableBy: ['DATABASE', 'ACADEMIC_RECORD'],
    whyItMatters: 'N-111: grupo no abierto sustenta la causal de quórum.',
  }),
  def({
    factId: 'F-evidencia_alternativa_reprogramacion',
    name: 'Existe alternativa de reprogramación',
    description: 'Se ofreció y documentó una alternativa de reprogramación.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(17, '5.11', 'N-108')],
    requiredBy: ['R-CAUSAL-QUORUM'],
    satisfiableBy: ['WRITTEN_INTERACTION', 'TEXT', 'DATABASE'],
    whyItMatters: 'N-108: la solicitud puede hacerse antes o después del inicio; la fecha no limita el criterio.',
  }),
  def({
    factId: 'F-estudiante_rechaza_alternativa',
    name: 'El estudiante rechaza la alternativa',
    description: 'El estudiante no acepta la reprogramación.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(18, '5.11', 'N-110')],
    requiredBy: ['R-CAUSAL-QUORUM'],
    satisfiableBy: ['STUDENT_STATEMENT', 'AUDIO', 'TEXT'],
    whyItMatters: 'N-110: sin aceptación, la solicitud se gestiona como CV.',
  }),

  // -------------------------------------------------------------------------
  // Documentos de ingreso (§3.13)
  // -------------------------------------------------------------------------

  def({
    factId: 'F-documento_grado_previo_ausente',
    name: 'No existe documento que acredite el grado previo',
    description: 'El estudiante no cuenta con documento que acredite el grado previo.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(10, '5.7.a', 'N-59')],
    requiredBy: ['R-DOC-A-BREAK'],
    satisfiableBy: ['PDF', 'IMAGE', 'ACADEMIC_RECORD'],
    whyItMatters: 'N-59: obliga a entregar carta manifiesto.',
  }),
  def({
    factId: 'F-carta_manifiesto_firmada',
    name: 'Carta manifiesto firmada',
    description: 'La carta manifiesto fue firmada por el estudiante.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(10, '5.7.a', 'N-59')],
    requiredBy: ['R-DOC-A-BREAK'],
    satisfiableBy: ['PDF', 'IMAGE'],
    whyItMatters: 'N-59 exige firma autógrafa con fecha compromiso.',
  }),
  def({
    factId: 'F-estudiante_no_puede_entregar',
    name: 'El estudiante declara que no podrá entregar en plazo',
    description: 'En la carta manifiesto el estudiante dice que no podrá entregar en plazo.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(11, '5.7.a', 'N-60')],
    requiredBy: ['R-DOC-A-BREAK'],
    satisfiableBy: ['PDF', 'IMAGE', 'STUDENT_STATEMENT'],
    whyItMatters: 'N-60: esa declaración convierte el caso en CANCELACION_VENTA.',
  }),
  def({
    factId: 'F-evidencia_bo_no_acredita_grado',
    name: 'BO valida que no se acredita el grado previo',
    description:
      'Back Office valida que el estudiante no acredita el grado previo requerido, incluido D53 con convenio firmado.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(11, '5.7.b', 'N-63')],
    requiredBy: ['R-DOC-B'],
    satisfiableBy: ['PDF', 'DATABASE', 'TICKET'],
    whyItMatters: 'N-63: da CANCELACION_VENTA por invasión de ciclo.',
  }),
  def({
    factId: 'F-creditos_no_avalan_100',
    name: 'El historial no avala el 100 % de los créditos',
    description: 'El historial no avala el 100 % de los créditos, o no hay constancia de término o examen único.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(12, '5.7.c', 'N-66')],
    requiredBy: [],
    satisfiableBy: ['ACADEMIC_RECORD', 'PDF'],
    whyItMatters:
      'N-66 enuncia un requisito sin declarar desenlace si no se cumple. AMB-GAP-02: ninguna regla cierra con este hecho.',
  }),

  // -------------------------------------------------------------------------
  // Escalamiento (§3.14)
  // -------------------------------------------------------------------------

  def({
    factId: 'F-mejora_continua_no_emite',
    name: 'Mejora Continua no logra emitir definición',
    description: 'El proceso de Mejora Continua no logró emitir una definición.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(2, '2.2', 'N-13')],
    requiredBy: ['R-ESCALAMIENTO-N13'],
    satisfiableBy: ['TICKET', 'TEXT', 'DATABASE'],
    whyItMatters: 'N-13: el escalamiento a Auditoría de Cancelaciones es el desenlace.',
  }),
  def({
    factId: 'F-nueva_iniciativa',
    name: 'La cancelación deriva de una nueva iniciativa',
    description: 'La cancelación deriva de una nueva iniciativa institucional.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(3, '2.2', 'N-14')],
    requiredBy: ['R-ESCALAMIENTO-N14'],
    satisfiableBy: ['TEXT', 'PDF'],
    whyItMatters: 'N-14: escalar a Dictaminación.',
  }),
  def({
    factId: 'F-otra_politica_lineamiento',
    name: 'La respuesta se vincula a otra política o lineamiento',
    description: 'La respuesta del estudiante se vincula a otra política o lineamiento.',
    dataType: 'BOOLEAN',
    sourceRefs: [primary(15, '5.7', 'N-89')],
    requiredBy: ['R-ESCALAMIENTO-N89'],
    satisfiableBy: ['TEXT', 'STUDENT_STATEMENT'],
    whyItMatters: 'N-89: escalar a Dictaminación.',
  }),

  // -------------------------------------------------------------------------
  // Phase 1.5 — identidad, campus, tipo de ingreso (Glosario)
  // -------------------------------------------------------------------------

  def({
    factId: 'F2-es_nuevo_ingreso',
    name: 'Alumno de nuevo ingreso',
    description: 'Alumno que se inscribe por primera vez en un ciclo académico.',
    dataType: 'BOOLEAN',
    sourceRefs: [glossary(6, 'Alumno', 'G-01')],
    requiredBy: ['R-D53-APLICA', 'R-CV-DEF-ALCANCE'],
    satisfiableBy: ['SIU', 'ACADEMIC_RECORD', 'DATABASE'],
    whyItMatters:
      'Predicado de alcance de la definición de CV de G-13 y requisito de aplicabilidad de D53-01.',
  }),
  def({
    factId: 'F2-tipo_ingreso',
    name: 'Tipo de ingreso',
    description: 'Regular, dictamen técnico, reingreso, equivalencia o revalidación.',
    dataType: 'ENUM',
    domain: ['REGULAR', 'DICTAMEN_TECNICO', 'REINGRESO', 'EQUIVALENCIA', 'REVALIDACION'],
    sourceRefs: [glossary(28, 'Clasificación de alumnos', 'G-22')],
    requiredBy: ['R-D53-APLICA', 'R-D53-EXCLUIDO'],
    satisfiableBy: ['SIU', 'DATABASE', 'ACADEMIC_RECORD'],
    whyItMatters:
      'D53-01 (p.2) limita D53 a Regular y Dictamen técnico. XDC-06: NO es lo mismo que F2-estatus_alumno_regular.',
  }),
  def({
    factId: 'F2-estatus_alumno_regular',
    name: 'Estatus alumno regular',
    description: 'Estatus de alumno regular según las condiciones de trayectoria del Glosario.',
    dataType: 'BOOLEAN',
    sourceRefs: [glossary(6, 'Alumno', 'G-03')],
    requiredBy: [],
    satisfiableBy: ['SIU', 'DATABASE'],
    whyItMatters:
      'XDC-06: es un ESTATUS y no un TIPO. El motor no debe fusionarlo con F2-tipo_ingreso == REGULAR.',
  }),
  def({
    factId: 'F2-decision_35',
    name: 'Decisión 35',
    description: 'Situación de la decisión 35 en el expediente del alumno.',
    dataType: 'ENUM',
    domain: ['ACEPTADO', 'NO_ACEPTADO', 'PREADMITIDO', 'NO_APLICA'],
    sourceRefs: [glossary(24, 'Alumno', 'G-18')],
    requiredBy: ['R-D53-EXCLUIDO', 'R-D35-TARDE'],
    satisfiableBy: ['SIU', 'DATABASE'],
    whyItMatters:
      'G-18: D35 = ACEPTADO («antes decisión 35»). El mismo campo codifica PREADMITIDO para el caso D53.',
  }),
  def({
    factId: 'F2-decision_53_preadmitido',
    name: 'Decisión 53 en estado PREADMITIDO',
    description: 'El alumno está en decisión 53 con estado PREADMITIDO en SIU.',
    dataType: 'BOOLEAN',
    sourceRefs: [glossary(24, 'Alumno', 'G-18')],
    requiredBy: ['R-D53-APLICA'],
    satisfiableBy: ['SIU', 'DATABASE'],
    whyItMatters:
      'G-18 (p.24): D53 = PREADMITIDO, «falta el antecedente académico del nivel anterior», etiqueta SIU «EN VALIDACIÓN».',
  }),
  def({
    factId: 'F2-campus',
    name: 'Campus del alumno',
    description: 'Campus de residencia: México o LATAM.',
    dataType: 'ENUM',
    domain: ['MEXICO', 'LATAM'],
    sourceRefs: [glossary(24, 'Alumno', 'G-20')],
    requiredBy: ['R-D53-COMPROMISO-OK', 'R-D53-COMPROMISO-FALTA'],
    satisfiableBy: ['SIU', 'DATABASE', 'ACADEMIC_RECORD'],
    whyItMatters:
      'G-20 prueba que existe diferenciación por campus. Solo D53 declara divergencia textual: AMB-CON-05.',
  }),
  def({
    factId: 'F2-cc_acepta_tc',
    name: 'El alumno acepta los términos y condiciones en SIU',
    description: 'El alumno aceptó los términos y condiciones en el SIU (compromiso documental en México).',
    dataType: 'BOOLEAN',
    sourceRefs: [d53(5, '5.3.2.1', 'D53-13')],
    requiredBy: ['R-D53-COMPROMISO-OK', 'R-D53-COMPROMISO-FALTA'],
    satisfiableBy: ['SIU', 'PDF', 'IMAGE'],
    whyItMatters: 'D53-13 (p.5): en México el compromiso documental es la aceptación de T&C en SIU.',
  }),
  def({
    factId: 'F2-cc_obligatoria_latam',
    name: 'Carta compromiso cargada en SIU (LATAM)',
    description: 'La carta compromiso obligatoria fue cargada en el SIU antes de la inscripción (LATAM).',
    dataType: 'BOOLEAN',
    sourceRefs: [d53(3, '5.1.7', 'D53-07'), d53(5, '5.3.2', 'D53-12')],
    requiredBy: ['R-D53-COMPROMISO-OK', 'R-D53-COMPROMISO-FALTA'],
    satisfiableBy: ['PDF', 'IMAGE', 'SIU'],
    whyItMatters: 'D53-07 (p.3): en LATAM la carta compromiso es obligatoria.',
  }),
  def({
    factId: 'F2-cc_firmada_manuscrita_tinta_azul',
    name: 'Carta compromiso firmada manuscrita en tinta azul',
    description: 'La carta compromiso fue firmada de manera manuscrita en tinta azul.',
    dataType: 'BOOLEAN',
    sourceRefs: [d53(5, '5.3.2', 'D53-11')],
    requiredBy: ['R-D53-COMPROMISO-OK', 'R-D53-COMPROMISO-FALTA'],
    satisfiableBy: ['PDF', 'IMAGE'],
    whyItMatters: 'D53-11 (p.5): requisito de formalización de la carta compromiso.',
  }),
  def({
    factId: 'F2-cc_cargada_siu_antes_inscripcion',
    name: 'Carta compromiso cargada en SIU antes de la inscripción',
    description: 'La carta compromiso fue cargada en el SIU antes del proceso de inscripción.',
    dataType: 'BOOLEAN',
    sourceRefs: [d53(5, '5.3.2', 'D53-12')],
    requiredBy: ['R-D53-COMPROMISO-OK', 'R-D53-COMPROMISO-FALTA'],
    satisfiableBy: ['SIU', 'PDF'],
    whyItMatters: 'D53-12 (p.5): la carga debe ser previa a la inscripción.',
  }),
  def({
    factId: 'F2-cc_termino_meses',
    name: 'Término de la carta compromiso en meses',
    description: 'Término declarado para la carta compromiso.',
    dataType: 'NUMBER',
    sourceRefs: [glossary(24, 'Alumno', 'G-19'), d53(5, '5.3.2', 'D53-12')],
    requiredBy: ['R-D53-COMPROMISO-OK', 'R-D53-COMPROMISO-FALTA'],
    satisfiableBy: ['PDF', 'TEXT'],
    whyItMatters:
      'XDC-02: 2 meses (G-19) contra ≤6 meses (D53-12). El motor NO fija el plazo.',
  }),
  def({
    factId: 'F2-d53_aplica',
    name: 'D53 aplica a este alumno',
    description: 'El alumno cumple el supuesto de aplicabilidad de la Decisión 53.',
    dataType: 'BOOLEAN',
    sourceRefs: [d53(2, '5.1.1', 'D53-01')],
    requiredBy: ['R-D53-APLICA'],
    satisfiableBy: ['SIU', 'DATABASE'],
    whyItMatters: 'Punto de entrada del subárbol D53 (NODO-D53-01).',
  }),
  def({
    factId: 'F2-d53_excluido',
    name: 'El alumno está excluido de D53 por tipo de ingreso',
    description: 'Reingreso, equivalencia o revalidación: D53 no aplica.',
    dataType: 'BOOLEAN',
    sourceRefs: [d53(2, '5.1.1', 'D53-01')],
    requiredBy: ['R-D53-EXCLUIDO'],
    satisfiableBy: ['SIU', 'DATABASE', 'ACADEMIC_RECORD'],
    whyItMatters:
      'D53-01 (p.2) excluye reingreso, equivalencia y revalidación. Su documentación se rige por el primario 5.7.c.',
  }),
  def({
    factId: 'F2-d53_resp_backoffice',
    name: 'El documento D53 lo gestiona Back Office',
    description: 'El documento D53 se gestiona desde la venta por Back Office.',
    dataType: 'BOOLEAN',
    sourceRefs: [d53(2, '5.1.2', 'D53-02'), d53(2, '5.1.3', 'D53-03')],
    requiredBy: [],
    satisfiableBy: ['DATABASE'],
    whyItMatters:
      'D53-02/D53-03 (p.2): desde la venta responde Back Office; desde el viernes previo al inicio, Éxito Estudiantil. No altera el desenlace.',
  }),
  def({
    factId: 'F2-d53_decision_mantiene',
    name: 'La decisión D53 se mantiene pese a la entrega',
    description: 'Entregar el documento NO cambia la decisión D53; sólo su clasificación.',
    dataType: 'BOOLEAN',
    sourceRefs: [d53(3, '5.1.8', 'D53-08')],
    requiredBy: ['R-D53-INVARIANTE'],
    // No hay evidencia que acredite un invariante: D53-08 lo fija, no lo
    // comprueba. La lista vacía es deliberada y va marcada como tal.
    satisfiableBy: [],
    normativeInvariant: true,
    whyItMatters:
      'D53-08 (p.3) invariante: la decisión se mantiene y sólo cambia la clasificación a «D53 con expediente completo». Prohíbe derivar «ya entregó ⇒ ya no es D53».',
  }),
  def({
    factId: 'F2-d53_expediente_completo',
    name: 'Expediente D53 completo',
    description: 'El expediente documental de D53 está completo.',
    dataType: 'BOOLEAN',
    sourceRefs: [d53(4, '5.2.2', 'D53-10')],
    requiredBy: ['R-D53-EXPEDIENTE'],
    satisfiableBy: ['PDF', 'IMAGE', 'SIU'],
    whyItMatters:
      'D53-10 (p.4): si al finalizar el bimestre el expediente no está completo, la baja es definitiva. XDC-05 impide verificar el conjunto de documentos.',
  }),
  def({
    factId: 'F2-d53_supera_50',
    name: 'El alumno supera el 50 % de avance curricular',
    description: 'El alumno alcanzó o superó el 50 % de avance curricular.',
    dataType: 'BOOLEAN',
    sourceRefs: [d53(3, '5.1.4', 'D53-04')],
    requiredBy: ['R-D53-RELOJ-6M', 'R-D53-RELOJ-50'],
    satisfiableBy: ['ACADEMIC_RECORD', 'SIU'],
    whyItMatters:
      'D53-04 (p.3): el 50 % de avance curricular dispara la baja documental. AMB-TEM-07: D53-05 dice que el 50 % «no es fija».',
  }),
  def({
    factId: 'F2-d53_meses_desde_ingreso',
    name: 'Meses transcurridos desde el ingreso',
    description: 'Meses transcurridos desde el ingreso del alumno.',
    dataType: 'NUMBER',
    sourceRefs: [d53(3, '5.1.6', 'D53-06')],
    requiredBy: ['R-D53-RELOJ-6M', 'R-D53-RELOJ-50'],
    satisfiableBy: ['SIU', 'DATABASE'],
    whyItMatters: 'D53-06 (p.3): 6 meses desde el ingreso. XDC-03 lo ancla distinto de G-08.',
  }),
  def({
    factId: 'F2-baja_falta_docs_6meses',
    name: 'Baja por falta de documentos a los 6 meses',
    description: 'Se agotó el plazo de 6 meses sin completar la documentación.',
    dataType: 'BOOLEAN',
    sourceRefs: [d53(3, '5.1.6', 'D53-06')],
    requiredBy: ['R-D53-RELOJ-6M', 'R-D53-RELOJ-50'],
    satisfiableBy: ['DATABASE', 'SIU'],
    whyItMatters: 'D53-06 (p.3): una de las dos formas de agotar el reloj documental.',
  }),
  def({
    factId: 'F2-d53_bimestre_cierre_superado',
    name: 'Se superó el bimestre de cierre',
    description: 'La entrega se dio después del bimestre de cierre de aula.',
    dataType: 'BOOLEAN',
    sourceRefs: [d53(3, '5.1.9', 'D53-09')],
    requiredBy: ['R-D53-REINGRESO'],
    satisfiableBy: ['DATABASE', 'SIU'],
    whyItMatters:
      'D53-09 (p.3): entrega en el mismo bimestre del cierre NO es reingreso; después, sí lo es. Coherente con G-11 (p.9).',
  }),
  def({
    factId: 'F2-d53_reingreso_si_entrega_mismo_bimestre',
    name: 'La entrega en el mismo bimestre no constituye reingreso',
    description: 'La entrega dentro del mismo bimestre del cierre de aula no es reingreso.',
    dataType: 'BOOLEAN',
    sourceRefs: [d53(3, '5.1.9', 'D53-09'), glossary(9, 'Alumno', 'G-11')],
    requiredBy: ['R-D53-REINGRESO'],
    satisfiableBy: [],
    whyItMatters: 'D53-09 (p.3) y G-11 (p.9) coinciden: reingreso exige tras al menos un periodo con baja.',
  }),
  def({
    factId: 'F2-d53_apocrifo_sospecha',
    name: 'Se sospecha documento apócrifo',
    description: 'Hay inconsistencia documental que permite clasificar como posible apócrifo.',
    dataType: 'BOOLEAN',
    sourceRefs: [d53(4, '5.1.15', 'D53-15')],
    requiredBy: ['R-D53-APOCRIFO'],
    satisfiableBy: ['PDF', 'IMAGE', 'TICKET'],
    whyItMatters:
      'D53-15 (p.4): clasificar como posible apócrifo e iniciar dictaminación externa ante la dependencia que lo expidió.',
  }),
  def({
    factId: 'F2-d53_cierre_aula_3a_semana_bimestre',
    name: 'Cierre de aula: miércoles de la semana 3 del bimestre',
    description: 'Fecha de cierre de aula dentro del bimestre.',
    dataType: 'DATE',
    sourceRefs: [d53(4, '5.2.2', 'D53-11')],
    requiredBy: ['R-D53-EXPEDIENTE'],
    satisfiableBy: ['DATABASE'],
    whyItMatters:
      'D53-11 (p.4). XDC-04: la duración del bimestre no está declarada, así que la fecha no es computable.',
  }),
  def({
    factId: 'F2-ciclo',
    name: 'Ciclo académico',
    description: 'Ciclo académico vigente del alumno.',
    dataType: 'ENUM',
    sourceRefs: [glossary(29, 'Temporalidad', 'G-29')],
    requiredBy: [],
    satisfiableBy: ['SIU', 'ACADEMIC_RECORD'],
    whyItMatters: 'G-29 (p.29): ciclo de 14 semanas. XDC-04 lo contradice con el bimestre de 26 semanas.',
  }),
  def({
    factId: 'F2-periodo',
    name: 'Periodo bimestral',
    description: 'Periodo (bimestre) vigente dentro del ciclo.',
    dataType: 'ENUM',
    sourceRefs: [glossary(30, 'Temporalidad', 'G-30')],
    requiredBy: [],
    satisfiableBy: ['SIU', 'ACADEMIC_RECORD'],
    whyItMatters: 'G-30 (p.30): periodo es la parte bimestral del ciclo.',
  }),
  def({
    factId: 'F2-riesgo_de_baja',
    name: 'Alumno en riesgo de baja',
    description: 'El alumno está en riesgo de baja por el proceso de retención.',
    dataType: 'BOOLEAN',
    sourceRefs: [glossary(21, 'Permanencia', 'G-16')],
    requiredBy: ['R-RET-01'],
    satisfiableBy: ['DATABASE', 'TICKET'],
    whyItMatters: 'G-16 (p.21): también es entrada al proceso de retención, igual que la manifestación de baja.',
  }),
  def({
    factId: 'F2-manifiesto_baja',
    name: 'El alumno manifiesta decisión de baja',
    description: 'El alumno manifiesta su decisión de darse de baja.',
    dataType: 'BOOLEAN',
    sourceRefs: [glossary(21, 'Permanencia', 'G-14')],
    requiredBy: ['R-RET-01'],
    satisfiableBy: ['STUDENT_STATEMENT', 'AUDIO', 'TEXT', 'WRITTEN_INTERACTION'],
    whyItMatters: 'G-14 (p.21): es la CAUSA del proceso de retención, no su desenlace.',
  }),
  def({
    factId: 'F2-decide_continuar',
    name: 'El alumno decide continuar',
    description: 'Tras la gestión de retención, el alumno decide continuar.',
    dataType: 'BOOLEAN',
    sourceRefs: [glossary(21, 'Permanencia', 'G-15')],
    requiredBy: ['R-RET-03'],
    satisfiableBy: ['STUDENT_STATEMENT', 'AUDIO', 'TEXT'],
    whyItMatters:
      'G-15 (p.21): ESTE es el desenlace «retención». Invierte la lectura de Phase 1: la retención no es la causa de la baja, es su resultado.',
  }),
  def({
    factId: 'F-cv-motivo',
    name: 'Motivo declarado de cancelación de venta',
    description: 'Motivo de la CV según la taxonomía cerrada de G-13 (p.7).',
    dataType: 'ENUM',
    domain: ['ERROR_PAQUETE_INSCRIPCION', 'NO_SE_LOCALIZA_NO_INGRESA', 'YA_NO_ESTA_INTERESADO'],
    sourceRefs: [glossary(7, 'Alumno', 'G-13')],
    requiredBy: ['R-CV-DEF'],
    satisfiableBy: ['STUDENT_STATEMENT', 'TEXT', 'WRITTEN_INTERACTION'],
    whyItMatters:
      'G-13 declara 3 motivos exhaustivos que mapean 1:1 a ramas ya inventariadas del primario. NODO-CV-DEF.',
  }),

  // -------------------------------------------------------------------------
  // Hechos derivados por el motor
  // -------------------------------------------------------------------------
  //
  // No son afirmaciones extraídas de evidencia: los calcula `facts/derive.ts`.
  // Se catalogan para que su procedencia sea resoluble — la traza debe poder
  // responder de dónde salió cada hecho que consultó una regla, y un hecho sin
  // entrada en el catálogo cortaría esa cadena en `TRACE_EVERY_DECISION`.
  //
  // `sourceRefs` vacío a propósito: no derivan de un enunciado normativo, sino
  // de otro hecho. Su procedencia está en `Fact.provenance`, no aquí.

  def({
    factId: 'F-nivel-academico',
    name: 'Nivel académico del caso',
    description:
      'Nivel académico tomador de `EvidenceContext.nivelAcademico` y expuesto como hecho para que las reglas puedan discriminar por nivel.',
    dataType: 'ENUM',
    domain: ['LICENCIATURA', 'POSGRADO', 'EJECUTIVA', 'ALIANZA', 'DIPLOMADO'],
    sourceRefs: [],
    requiredBy: ['R-ILOC'],
    satisfiableBy: ['SIU', 'DATABASE'],
    whyItMatters:
      'Sin este derivado, las reglas que discriminan por nivel quedarían permanentemente en UNKNOWN y serían normativas muerta.',
  }),
  def({
    factId: 'F-sin-actividad-nivel',
    name: 'Sin actividad en el nivel del caso (normalizado)',
    description:
      'Derivado del hecho de actividad del nivel, con la polaridad que declara la fuente. Para Licenciatura es el propio hecho; para Posgrado, Alianza y Diplomado es su negación.',
    dataType: 'BOOLEAN',
    sourceRefs: [
      primary(12, '5.8.a', 'N-70'),
      primary(12, '5.8.a', 'N-71'),
      primary(13, '5.8.a', 'N-72'),
      primary(13, '5.8.a', 'N-73'),
    ],
    requiredBy: ['R-ILOC'],
    satisfiableBy: ['SIU', 'DATABASE'],
    whyItMatters:
      'Normaliza los cuatro enunciados de actividad a un solo sentido positivo. La inversión se lee del catálogo (activityPolarity), no del evaluador: es lo que preserva AMB-LOG-02.',
  }),
  def({
    factId: 'F-con-actividad-nivel',
    name: 'Con actividad en el nivel del caso (normalizado)',
    description:
      'Negación de `F-sin-actividad-nivel`. Complemento del derivado anterior.',
    dataType: 'BOOLEAN',
    sourceRefs: [
      primary(12, '5.8.a', 'N-70'),
      primary(12, '5.8.a', 'N-71'),
      primary(13, '5.8.a', 'N-72'),
      primary(13, '5.8.a', 'N-73'),
    ],
    requiredBy: [],
    satisfiableBy: ['SIU', 'DATABASE'],
    whyItMatters:
      'Permite que la contraevidencia de 5.8.a se evalúe contra un único sentido, sin repetir la inversión por nivel.',
  }),
] as const;

/** Índice de definiciones por `factId`. */
const DEFINITION_INDEX: ReadonlyMap<string, FactDefinition> = new Map(
  FACT_DEFINITIONS.map((definition) => [definition.factId, definition]),
);

/** Definición de un hecho. Lanza si el hecho no existe en el catálogo. */
export function factDefinition(factId: string): FactDefinition {
  const found = DEFINITION_INDEX.get(factId);
  if (!found) {
    throw new RangeError(
      `Hecho ${factId} no existe en el catálogo. Añadirlo es un cambio de modelo normativo, no un default.`,
    );
  }
  return found;
}

/** ¿El hecho está en el catálogo? */
export function isKnownFact(factId: string): boolean {
  return DEFINITION_INDEX.has(factId);
}

/** Todos los `factId` del catálogo, en orden estable. */
export function allFactIds(): string[] {
  return FACT_DEFINITIONS.map((definition) => definition.factId).sort();
}

/**
 * Hecho de actividad aplicable al nivel académico, con su polaridad.
 *
 * Es la función que preserva `AMB-LOG-02`: quien llama no decide la polaridad,
 * la lee del catálogo.
 */
export function activityFactForLevel(
  level: 'LICENCIATURA' | 'POSGRADO' | 'EJECUTIVA' | 'ALIANZA' | 'DIPLOMADO',
): FactDefinition {
  const map = {
    LICENCIATURA: 'F-actividad_licenciatura',
    POSGRADO: 'F-actividad_posgrado',
    EJECUTIVA: 'F-actividad_posgrado',
    ALIANZA: 'F-actividad_alianza',
    DIPLOMADO: 'F-actividad_diplomado',
  } as const;
  return factDefinition(map[level]);
}

/** Definiciones de hechos exigidas por un conjunto de reglas. */
export function definitionsForRules(ruleIds: readonly string[]): FactDefinition[] {
  const wanted = new Set(ruleIds);
  return FACT_DEFINITIONS.filter((definition) =>
    definition.requiredBy.some((ruleId) => wanted.has(ruleId)),
  );
}

export { ANY_EVIDENCE };
