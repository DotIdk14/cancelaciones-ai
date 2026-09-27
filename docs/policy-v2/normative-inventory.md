# Inventario Normativo — GDM_GAM_PRD_MLG_003

**Fase:** Decision Tree Phase 1 — Extracción normativa
**Fuente única:** `normative/GDM_GAM_PRD_MLG_003  PROCEDIMIENTO DESERCIÓN DE ESTUDIANTES.docx.pdf`
**SHA-256:** `71faf64634805b1b4820132cdfcc1304d740ff00d1e9573dd850222c9496c7d2`
**Documento:** `GDM_GAM_PRD_MLG_003` · **Versión:** `5` · **Publicación:** `14/09/2026` · **Páginas:** `26`
**Estado:** `INVENTORY_COMPLETE` (transcripción; sin interpretación)

---

## 0. Convenciones de transcripción

Este inventario **transcribe**, no interpreta, no resume y no fusiona
(`rebuild-decision-tree-phase-1.md`, Task 1). Todo enunciado normativo aparece
con su identificador de sección tal como está impreso en el PDF.

| Convención | Regla aplicada |
|---|---|
| `verbatim` | Texto tal como aparece en el PDF, sin correcciones ortográficas ni de redacción |
| Saltos de línea | Unificados en espacio simple dentro de un mismo enunciado |
| Caracteres de ancho cero | `` eliminado (no altera el texto) |
| Viñetas `●` `○` | Preservadas como jerarquía de incisos |
| Erratas del original | **Preservadas** y marcadas en la nota de transcripción |
| Páginas | Tomadas del encabezado impreso `Página: N de 26` |
| Enunciados que cruzan página | Se citan ambas páginas: `N→N+1` |

### 0.1 Erratas y defectos del original preservados

Estas erratas están en la fuente. **No se corrigen**; se registran para que
ninguna implementación las interprete como documento distinto.

| ID | Ubicación | Texto en el original | Nota |
|---|---|---|---|
| `TR-01` | 1. Objetivo, p.1 | «Gestionar de manera efectiva» | Literal del original |
| `TR-02` | 5.2.a, p.3 | «Contar con un mínimo de 16 llamadas» | Literal; el original empieza la oración con infinitivo |
| `TR-03` | 5.2.d, p.3 | «mismo lapso de tiempo o con el intervalo de tiempo corto establecido para este efecto» | El inciso queda truncado: no fija el valor del intervalo |
| `TR-04` | 5.6.d, p.9 | «posible promesa no omplda» | Errata de tipeo en el original |
| `TR-05` | 5.8.a, p.13 | «Mejora Contnua» | Errata de tipeo en el original |
| `TR-06` | 5.2.f, p.4 | «+52 1 55 9088 8548» | Distinto de los números de 5.2.g; ver `AMB-NUM-01` |
| `TR-07` | 5.9.a, p.16 | Inciso termina con carácter de control sin punto | Literal |
| `TR-08` | 5.1.b, p.2 | «lunes a viernes..» | Doble punto en el original |

### 0.2 Catálogo de tipos usado

| Tipo | Significado |
|---|---|
| `condition` | Establece una condición cuya satisfacción habilita o bloquea un desenlace |
| `exception` | Excluye o altera la aplicación de otra regla |
| `counterevidence` | Evidencia whose absence or presence negates a condition |
| `requirement` | Obligación de acción o de recuento |
| `definition` | Define un término usado como condición |
| `procedure` | Regula el flujo y la responsabilidad de una gestión |
| `temporal` | Fija una ventana, plazo o duración en el tiempo |
| `scope` | Delimita el ámbito de aplicación del procedimiento |
| `indicator` | Métrica de medición, no condición de decisión |

`depends_on` referencia **secciones del propio documento** que modifican,
limitan, prevailen o anteceden al enunciado. Las dependencias a documentos
externos se marcan `EXT` y se registran en `ambiguities.md`.

---

## 1. Objetivo (p.1) — `scope`

| ID | Sección | Página | Tipo | Enunciado |
|---|---|---|---|---|
| `N-01` | `1` | 1 | `scope` | «Gestionar de manera efectiva las solicitudes de cancelación de ventas, priorizando la validación y análisis de cada caso para la correcta toma de decisiones, así como el intento de retención de los alumnos. Esto se realizará asegurando que los responsables realicen las actividades necesarias y cumplan con las políticas establecidas, con el fin de minimizar errores y mejorar la experiencia del estudiante.» |

`depends_on`: ninguno. Es propósito del procedimiento; no genera condición.

---

## 2. Alcance (p.1) — `scope`

| ID | Sección | Página | Tipo | Enunciado |
|---|---|---|---|---|
| `N-02` | `2` | 1 | `scope` | «El presente proceso abarca desde el contacto inicial con el alumno para atender y analizar su solicitud de cancelación, hasta la ejecución final de la misma en los sistemas institucionales. Incluye todas las etapas de validación, análisis y seguimiento de la solicitud, así como las acciones de retención del alumno, la gestión y resguardo de evidencias, y la aplicación de los ajustes correspondientes en los sistemas involucrados.» |
| `N-03` | `2` | 1 | `scope` | «Las responsabilidades asociadas a este proceso recaen en las áreas de Ventas, Servicios Escolares, Éxito estudiantil, Mejora Continua, Back Office y Finanzas.» |
| `N-04` | `2` | 1 | `scope` | «Estas políticas son aplicables a todos los equipos que reciban, gestionen o den seguimiento a solicitudes de "Cancelación de Venta", tanto en México como en LATAM.» |

`N-04` fija el ámbito geográfico: MX y LATAM. Relevante para `5.6.e` (p.9).

---

## 3. Glosario (pp.1→2) — `definition`

| ID | Sección | Página | Tipo | Enunciado | `depends_on` |
|---|---|---|---|---|---|
| `N-05` | `3` (glosario de operación escolar) | 1 | `definition` | «Glosario de operación escolar» | `EXT-01` |
| `N-06` | `3` (Invasión de ciclo) | 1 | `definition` | «Invasión de ciclo: La invasión de nivel educativo, comúnmente conocida como violación de ciclo, se genera a partir de que las instituciones educativas que pertenecen al sistema educativo nacional, no cumplen con la secuencia propedéutica entre niveles educativos que establece el artículo 37 de la Ley General de Educación.» | — |
| `N-07` | `3` (Deserción) | 2 | `definition` | «Deserción: Se define como el proceso en el cual un estudiante interrumpe o abandona sus estudios dentro de un periodo específico establecido por la institución. En este contexto, se considerarán casos de deserción todas aquellas cancelaciones de ventas o bajas realizadas durante el periodo comprendido entre la fecha de inicio del ciclo y hasta 30 días hábiles posteriores al inicio del ciclo.» | — |

**Divergencia registrada:** `N-07` (p.2, glosario) define deserción con
**30 días hábiles**; `N-26` (5.12.b, p.18) la define con **30 días** sin
calificar. Ver `AMB-DEF-01`. `N-07` es la definición del glosario y
`N-26` la del indicador; ambas se conservan sin unificar.

---

## 4. Dueño de Proceso (p.2) — `definition`

| ID | Sección | Página | Tipo | Enunciado |
|---|---|---|---|---|
| `N-08` | `4` | 2 | `definition` | «Mejora continua» (dueño del proceso) |

---

## 5. Políticas de Negocio

### 5.1 Notificaciones de cancelaciones de venta (pp.2→3)

| ID | Sección | Página | Tipo | Enunciado | `depends_on` |
|---|---|---|---|---|---|
| `N-09` | `5.1.a` | 2 | `requirement` | «La notificación de Cancelación de venta al Área de Gestión de Matrícula será a través de un proceso de flokzu (CANCELACIÓN DE VENTAS [CAVE])» | — |
| `N-10` | `5.1.b` | 2 | `temporal` | «El proceso de cancelación de venta, deberá ser aplicado a través de Flokzu y tendrá una duración total de 72 horas, contadas a partir de la notificación formal de la cancelación por parte del equipo de Mejora Continua. Durante este periodo, el caso permanecerá en gestión.» | `N-09` |
| `N-11` | `5.1.b` | 2 | `temporal` | «El área de Gestión de Matrícula contará con un plazo de 48 horas para realizar la réplica correspondiente. Posteriormente, el equipo de CV dispondrá de las 24 horas restantes para analizar la información y proceder con la determinación final de la cancelación de la venta.» | `N-10` |
| `N-12` | `5.1.b` | 2 | `temporal` | «Este plazo se calculará considerando una jornada laboral de cinco días hábiles, de lunes a viernes.» | `N-10`, `N-11` |
| `N-13` | `5.1.c` | 2→3 | `procedure` | «Cuando el área de Mejora Continua no logre emitir una definición sobre el caso, este será remitido al área de Auditoría de Cancelaciones de Venta, responsable de determinar el estatus final del estudiante, ya sea como cancelación de venta o baja definitiva, con base en los soportes y fundamentos del caso.» | — |
| `N-14` | `5.1` (Caso de atención especial) | 3 | `procedure` | «Casos sujetos a dictaminación: Cuando la cancelación de una venta derive de una nueva iniciativa, será necesario realizar un análisis detallado e investigación del caso, con el fin de contar con los elementos suficientes para emitir una dictaminación.» | `N-13` |
| `N-15` | `5.1.d` | 3 | `temporal` | «Las Cancelaciones de venta solo se podrán solicitar durante las primeras 2 semanas después de la fecha de inicio.» | `N-04` |
| `N-16` | `5.1.e` | 3 | `procedure` | «El equipo de EE deberá compartir, de forma programada, la base de registros correspondientes a ilocalizables y estudiantes sin ingreso a aula los días viernes de la semana 1, con el equipo de GM, para su correspondiente gestión y seguimiento.» | `N-33`, `N-45` |
| `N-17` | `5.1.f` | 3 | `procedure` | «El equipo de Mejora continua realizará un segundo intento de contactación a los registros clasificados como ilocalizables dentro de las 24 horas posteriores a la creación del ticket en Flokzu. Como parte del proceso, se generará una notificación automática por correo electrónico, con el objetivo de asegurar el seguimiento y la trazabilidad del caso.» | `N-16`, `N-09` |

**Conflicto de plazo detectado:** `N-15` fija la ventana de solicitud de CV en
«primeras 2 semanas después de la fecha de inicio»; `5.3.a.III` (p.4) fija el
límite de solicitud en «el primer domingo del inicio del ciclo»; `5.3.c`
(p.5) obliga a baja tras 20 días; `5.8.a` (p.12) fija el límite de ilocalizable
en «domingo de la semana dos». Registrado en `AMB-TEM-01` a `AMB-TEM-04`.

### 5.2 Intentos de contacto mínimos al estudiante (pp.3→4)

| ID | Sección | Página | Tipo | Enunciado | `depends_on` |
|---|---|---|---|---|---|
| `N-18` | `5.2.a` | 3 | `requirement` | «Contar con un mínimo de 16 llamadas (Al menos dos diarias en horarios diferentes, con al menos 6 horas de diferencia) durante las próximas dos semanas posteriores a su fecha de inicio.» | `N-19`, `N-20` |
| `N-19` | `5.2.b` | 3 | `requirement` | «Contar con un mínimo de 6 interacciones por medios escritos y en diferentes horarios durante las próximas dos semanas posteriores a su fecha de inicio.» | `N-18` |
| `N-20` | `5.2.c` | 3 | `requirement` | «La cantidad total de interacciones requeridas deberá distribuirse de acuerdo con la siguiente proporción, priorizando la gestión durante la primera semana: ● Semana1: 70% del total de interacciones requeridas. ● Semana 2: 30% del total de interacciones requeridas.» | `N-18`, `N-19` |
| `N-21` | `5.2.d` | 3→4 | `exception` | «Cuando se realice una acción de 2 o más llamadas en un mismo lapso de tiempo o con el intervalo de tiempo corto establecido para este efecto, estas marcaciones serán consideradas como una sola interacción para efectos del cumplimiento de la gestión realizada por el equipo de Éxito Estudiantil.» | `N-18` |
| `N-22` | `5.2.e` | 4 | `requirement` | «Para los estudiantes que ingresen posteriormente al inicio de clases y hasta el miércoles de la semana 1, el equipo de Éxito Estudiantil deberá realizar un mínimo de 3 llamadas telefónicas por día.» | `N-18` |
| `N-23` | `5.2.f` | 4 | `procedure` | «Los intentos de contacto para estas interacciones se realizará mediante el número (+52 1 55 9088 8548). En caso de existir alguna modificación, cambio o incorporación de nuevos números de contacto, el equipo de EE será responsable de notificar oportunamente a todas las áreas impactadas.» | `N-24` |
| `N-24` | `5.2.g` | 4 | `definition` | «Gúmeros actualmente habilitados: ● +52 1 55 8977 0707 / +52 1 55 8977 0700 – MX ● +52 1 55 9252 2986 – LATAM» | `N-23` |
| `N-25` | `5.2.h` | 4 | `requirement` | «La asignación de la base de estudiantes a cada agente de B1 será responsabilidad del equipo de Éxito Estudiantil. En consecuencia, el equipo será responsable de garantizar el cumplimiento del porcentaje de cobertura y/o del número de llamadas establecido en la presente política.» | `N-18`, `N-20` |

**Contradicción numérica registrada:** `N-24` declara tres números «actualmente
habilitados» para el mismo propósito que `N-23`, y ninguno coincide con el
número citado en `N-23`. Ver `AMB-NUM-01`.

`N-18` y `N-19` no declaran explícitamente si se requiere **ambos** mínimos o
alguno de los dos. Ver `AMB-LOG-01`.

### 5.3 A solicitud del Estudiante (pp.4→6)

| ID | Sección | Página | Tipo | Enunciado | `depends_on` |
|---|---|---|---|---|---|
| `N-26` | `5.3.a` (en-tête) | 4 | `condition` | «Sin importar el motivo por el cual el estudiante solicite la suspensión de sus estudios, el proceso se definirá en función a la fecha de inicio de ciclo y el estatus del alumno de acuerdo a lo siguiente:» | — |
| `N-27` | `5.3.a.I` | 4 | `condition` | «Si el estudiante solicita no continuar con sus estudios, previo a la fecha de inicio, aplica cancelación de venta.» | `N-26` |
| `N-28` | `5.3.a.II` | 4 | `condition` | «Si se realiza posterior al inicio de clases se considera baja en caso de que el proceso de retención no sea efectivo y esta sea a solicitud del estudiante.» | `N-26` |
| `N-29` | `5.3.a.III` | 4 | `condition` | «Si la decisión 35 o 53 se proporciona después de la fecha de inicio (lunes, martes y miércoles) se podrá proceder con la cancelación de venta al término de la primera semana de clases, se tendrá como límite de solicitud el primer domingo del inicio del ciclo.» | `N-26` |
| `N-30` | `5.3.a.IV` | 5 | `condition` | «En caso de que el estudiante solicite no continuar previo a su inicio en los tiempos estipulados anteriormente y cuente con evidencia de su solicitud aplicará cancelación de venta ( previa notificación a su asesor).» | `N-26`, `N-27` |
| `N-31` | `5.3.a.V` | 5 | `condition` | «Si el estudiante cuenta con la decisión 35 en tiempo y forma, procederá como un proceso de retención que debe ser gestionado por el equipo de Gestión de Éxito Estudiantil.» | `N-26` |
| `N-32` | `5.3.b` | 5 | `requirement` | «De acuerdo con los escenarios establecidos en los numerales "II al IV" del presente documento, y cualquiera que sea el motivo por el cual el estudiante manifieste su intención de suspender su proceso de estudios, se deberá ejecutar un proceso de retención, presentando estrategias de permanencia acordes con la causa de deserción. En caso de que el estudiante no acepte dichas estrategias, procederá la cancelación de la venta o la baja, según corresponda.» | `N-28`, `N-29`, `N-30` |
| `N-33` | `5.3.b` | 5 | `condition` | «En caso de no realizarse el proceso de retención, entendido como las gestiones de contacto con el estudiante para identificar los motivos de su solicitud, atender objeciones y presentar alternativas académicas, administrativas o financieras que promuevan su permanencia, la solicitud deberá gestionarse como baja, sin que la fecha de inicio ni la aplicación de D35 o D53 afecten dicha determinación.» | `N-32` |
| `N-34` | `5.3.b` | 5 | `requirement` | «Adicionalmente, en caso de que no exista gestión de retención por ninguna de las áreas involucradas, se deberá aplicar la sanción correspondiente a ambas áreas por incumplimiento del proceso.» | `N-33` |
| `N-35` | `5.3.c` | 5 | `temporal` | «Todo estudiante podrá solicitar cambios o ajustes hasta un día antes del inicio de ciclo (carga de materias curriculares). Dichas solicitudes deberán ser gestionadas por el área de Gestión de Éxito Estudiantil o Gestión de Matrícula, según corresponda. Una vez iniciado el ciclo, los cambios o ajustes podrán evaluarse conforme a las disposiciones institucionales vigentes; sin embargo, transcurridos 20 días desde la fecha de inicio del ciclo, cualquier solicitud deberá gestionarse como baja, debido a que el estudiante habrá devengado un mes de servicio.» | `N-39` |
| `N-36` | `5.3.d` | 5→6 | `condition` | «En el escenario de tener que realizar algún ajuste administrativo ya sea a solicitud del estudiante y/o por error de inscripción, el área que reciba la solicitud debe realizar el trámite correspondiente, sin importar la semana del bimestre, aplica cancelación de venta o baja, solo si el estudiante por este motivo desea y expresa de manera tácita el no querer continuar.» | `N-35`, `N-40` |
| `N-37` | `5.3.d` | 6 | `condition` | «Casos de ajustes por el estudiante, aplicará durante los próximos 20 días después de la fecha de inicio: ● Inscripción al estudiante en un programa incorrecto (cambio de programa) ● Paquete promocional incorrecto (ajuste de paquete) ● Ciclo de inicio erróneo (cambio de ciclo de inicio) ● Error en asignación de campus (cambio de campus y transferencia de saldo)» | `N-36` |
| `N-38` | `5.3.e` | 6 | `condition` | «En caso de que se haya realizado el proceso de bienvenida y el estudiante ya tuvo actividad (ingreso al aula regular y fue contactado), si este solicita la baja se considerará como proceso de retención.» | `N-45` |

**Vigencia cruzada registrada:** `N-35` (p.5) marca el umbral de 20 días;
`5.11` (p.24) en Control de Cambios menciona «las fechas estipuladas 20 días»;
`5.4.g` (p.6) usa el mismo umbral. `5.3.d` (p.6) lo reitera como «próximos 20
días después de la fecha de inicio». `N-29` (p.4) fija un límite distinto
(«primer domingo»). Ver `AMB-TEM-02`.

**Conflicto de dirección registrado:** `N-33` (p.5) establece que la **falta de
retención** obliga a **baja**, sin importar fecha de inicio. `N-27`
(`5.3.a.I`, p.4) establece **cancelación de venta** para solicitud previa al
inicio. Si un caso reúne ambos hechos, el documento ofrece dos desenlaces
distintos y no declara prevalencia. Ver `AMB-CON-01`.

### 5.4 Cambios de ciclo (pp.6→7)

| ID | Sección | Página | Tipo | Enunciado | `depends_on` |
|---|---|---|---|---|---|
| `N-39` | `5.4.f` | 6 | `condition` | «Los cambios de ciclo para estudiantes con revalidación o equivalencia que tengan, error de inscripción y queden inscritos en bloques intermedios debería aplicar el cambio de ciclo correcto sin afectación a baja y en caso donde el estudiante no autorice el cambio de ciclo aplicará la cancelación de venta.» | `N-35` |
| `N-40` | `5.4.g` | 6 | `procedure` | «Para cualquier cambio de ciclo que se solicite por Gestión de Éxito Estudiantil como estrategia de retención en las fechas estipuladas 20 días o con Vo Bo (cambio de ciclo especial), debe gestionarse conforme al Proceso de Retención, tomando en cuenta las políticas financieras actuales del costo de los cambios de ciclo. Además: ● Se deberán seguir las reglas de cambio de ciclo documentadas en el archivo GCE_GCE_PRD_MXL_001 Cambio de ciclo y Fecha. ● Para validar los costos relacionados con estos cambios, se deberá ingresar a la plataforma SIU, en el apartado Reglamento/Misión/Visión Institucional, seleccionar el listado de precios y descargar el documento correspondiente. En este apartado también se podrán consultar las políticas financieras y los términos y condiciones aplicables.» | `N-35`, `EXT-02` |
| `N-41` | `5.4.h` | 7 | `condition` | «Si el cambio de ciclo se gestiona antes del inicio de clases por Gestión de Matrícula o Gestión de Éxito Estudiantil, aplica como cancelación de venta. Si, tras realizarse el cambio de ciclo, en el siguiente inicio de ciclo no se logra localizar al estudiante o este no ingresa, también aplica como cancelación de venta.» | `N-39`, `N-46` |
| `N-42` | `5.4.h` | 7 | `exception` | «Sin embargo, si el cambio de ciclo es gestionado por Gestión de Éxito Estudiantil a partir del inicio de clases y, al llegar la fecha de inicio del nuevo ciclo, el estudiante no ingresa, deberá realizarse el procedimiento de retención correspondiente. En este caso, la solicitud no aplicará como cancelación de venta.» | `N-41` |

`N-41` y `N-42` son el par condición/excepción más explícito del documento: la
misma hipótesis (no ingresar en el nuevo ciclo) produce desenlace distinto
según quién gestionó el cambio y si fue antes o después del inicio. Se modelan
como `condition` + `exception`, nunca como un solo descriptor.

### 5.5 Error de Inscripción (p.7)

| ID | Sección | Página | Tipo | Enunciado | `depends_on` |
|---|---|---|---|---|---|
| `N-43` | `5.5.a` | 7 | `requirement` | «Gestión de Matrícula o Gestión de Éxito Estudiantil será responsable de aplicar los ajustes a estudiantes matriculados (fecha límite 20 días desde la fecha de inicio del Estudiante).» | `N-35` |
| `N-44` | `5.5.a` | 7 | `condition` | «En caso de que no proceda ninguno de los trámites anteriormente descritos o que la solicitud se encuentre fuera del plazo establecido para la gestión de ajustes, esta deberá gestionarse como Mejora continua Asimismo, el equipo de Cancelaciones de Venta deberá contactar al estudiante para ofrecerle la alternativa de una segunda inscripción.» | `N-43` |

### 5.6 Promesa de venta NO cumplida (pp.7→10)

| ID | Sección | Página | Tipo | Enunciado | `depends_on` |
|---|---|---|---|---|---|
| `N-45` | `5.6.a` | 7 | `condition` | «Se considerará cancelación de venta por promesa no cumplida cuando se acredite que, durante el proceso de inscripción gestionado por el área de Gestión de Matrícula, se proporcionó al estudiante información errónea, falsa, tendenciosa o no alineada con las características reales del programa adquirido.» | — |
| `N-46` | `5.6.a` | 8 | `condition` | «Esta causal aplicará únicamente cuando el estudiante manifieste de forma explícita su decisión de no continuar, indicando que dicha decisión deriva de las promesas no cumplidas, y además rechace beneficios adicionales, tales como estrategias de retención o la aplicación de ajustes correctivos.» | `N-45`, `N-32` |
| `N-47` | `5.6.a` | 8 | `procedure` | «En caso de existir un antecedente de validación por BO, dicha interacción deberá ser considerada como punto de partida para el análisis y determinación de la cancelación de la venta.» | `N-45` |
| `N-48` | `5.6.a` | 8 | `condition` | «En caso de presentarse actualizaciones relacionadas con el producto que no cuenten con un proceso formal de capacitación o comunicación hacia Operaciones por parte de RRHH, estas deberán ser clasificadas y gestionadas como una CV operativa.» | `N-45`, `N-59` |
| `N-49` | `5.6.b` | 8 | `requirement` | «Para que lo anterior sea comprobable, toda interacción del área de Gestión de Matrícula debe estar documentada y validada conforme al inciso "c" de este apartado.» | `N-45`, `N-50` |
| `N-50` | `5.6.c` | 8 | `counterevidence` | «No se considerará una cancelación de venta cuando exista evidencia de que el área de Gestión de Validación realizó la interacción correspondiente con el estudiante. Dicha interacción deberá estar obligatoriamente registrada en el sistema de tipificaciones de la Universidad e incluir, dentro del speech de confirmación de venta, la comunicación clara sobre la importancia de revisar los términos y condiciones (costos, políticas y reglas institucionales).» | `N-45`, `N-49` |
| `N-51` | `5.6.c` (lineamientos) | 8 | `requirement` | «● Toda interacción con el estudiante debe quedar registrada en el sistema de CRM institucional (I6). ● No está permitido compartir evidencias de interacción (como grabaciones o audios) a través de correos electrónicos personales u otros medios no oficiales, en cumplimiento con las políticas de protección de datos. ● Las evidencias de gestión deberán almacenarse en los sistemas oficiales de la Universidad, como Inconcert u otras plataformas autorizadas. ● En caso de que alguna interacción ocurra por un medio no oficial, será obligatorio documentar y cargarla posteriormente en los sistemas institucionales correspondientes.» | `N-50` |
| `N-52` | `5.6.c` (Criterio de incumplimiento) | 9 | `condition` | «Si no se cuenta con las evidencias debidamente registradas en los sistemas oficiales, se procederá a aplicar la cancelación de la venta bajo el criterio de promesa de venta no cumplida.» | `N-50`, `N-51` |
| `N-53` | `5.6.c` (caso particular) | 9 | `exception` | «En el caso particular en que el estudiante cuente con una validación de venta completa, sin incidencias y debidamente registrada en los sistemas oficiales, pero manifieste de forma expresa su intención de darse de baja, la operación deberá clasificarse como baja.» | `N-50`, `N-52` |
| `N-54` | `5.6.d` | 9 | `condition` | «Si previo a la fecha de inicio de ciclo, el Asesor de Gestión de Matrícula tiene conocimiento de alguna solicitud por parte del estudiante con relación a no continuar y lo induce a seleccionar la modalidad de evaluación, se aplica como cancelación de venta, lo anterior se podrá detectar en la llamada de validación de venta o llamada de bienvenida, en caso de proceder a una cancelación de venta se debe de contar con las evidencias que identifiquen la situación de posible promesa no omplda.» | `N-27`, `N-52` |
| `N-55` | `5.6.d` (Nota) | 9 | `requirement` | «Nota: En caso de requerir evidencia de los canales de terceros también deben de compartir información a Utel del proceso de venta de terceros. (Exponente Digital y/o cualquier otro)» | `N-51` |
| `N-56` | `5.6.e` | 9→10 | `condition` | «Para las ventas a través de los países de latam, dentro del speech de ventas debe quedar evidencia que el estudiante fue informado del proceso de convalidación de su título al término de sus estudios, además de que deberá comunicar que el contenido de sus materias estarán apegados al país de origen (México). En caso de no contar con evidencia de la comunicación de estos puntos y el estudiante no deseé continuar se procederá como cancelación de venta.» | `N-04`, `N-50` |
| `N-57` | `5.6.f` | 10 | `procedure` | «En situaciones excepcionales que superen los plazos establecidos para las cancelaciones de venta, pero donde el estudiante pueda demostrar que su solicitud se basa en una promesa de venta no cumplida, deberá respaldar esta afirmación con pruebas documentadas, como correos electrónicos, grabaciones de audio o capturas de pantalla de conversaciones de WhatsApp. Estas pruebas deben evidenciar que, durante la generación de la inscripción por parte del área de Gestión de Matrícula, se proporcionó información de manera incorrecta, falsa, tendenciosa o que no se ajusta a la realidad del programa adquirido por el estudiante. En este contexto, las áreas de Dictaminación, Éxito Estudiantil, Cancelaciones y Backoffice colaborarán conjuntamente para evaluar y determinar si es apropiado clasificar la situación como una baja o una cancelación de venta.» | `N-15`, `N-45` |
| `N-58` | `5.6.f` | 10 | `procedure` | «En casos excepcionales que excedan los plazos establecidos para las cancelaciones de venta, el estudiante deberá presentar evidencia que respalde una posible promesa de venta no cumplida, tales como correos electrónicos, grabaciones o conversaciones. Cuando la evidencia demuestre que se proporcionó información incorrecta, incompleta o inconsistente respecto al programa adquirido, el caso será escalado al área de Mejora Continua, quien evaluará los antecedentes y determinará si corresponde clasificar la situación como una baja o una cancelación de venta.» | `N-15`, `N-45` |

**Contradicción interna registrada:** `N-57` y `N-58` están en el **mismo
inciso** (`5.6.f`, p.10) y describen la misma situación excepcional con
**dos rutas de escalamiento distintas**: `N-57` deriva la evaluación conjunta en
«Dictaminación, Éxito Estudiantil, Cancelaciones y Backoffice»; `N-58` escala a
«Mejora Continua». No se declara cuál prevalece. Ver `AMB-CON-02`.

### 5.7 Entrega de Documentos (pp.10→12)

| ID | Sección | Página | Tipo | Enunciado | `depends_on` |
|---|---|---|---|---|---|
| `N-59` | `5.7.a` | 10 | `requirement` | «En caso de no contar con el documento que acredite el grado de estudios previo, el estudiante deberá entregar una carta manifiesto debidamente diligenciada, en la que se completen los campos requeridos y se incluya firma autógrafa de puño y letra, así como la fecha compromiso para la entrega del documento correspondiente» | `EXT-01` |
| `N-60` | `5.7.a` | 11 | `condition` | «Si durante la llamada de gestión del asesor de Gestión Matricula, el estudiante manifiesta que no podrá entregar el documento dentro del plazo establecido en dicha carta, se procederá con la cancelación de la venta.» | `N-59` |
| `N-61` | `5.7.b` | 11 | `requirement` | «Es obligación del Asesor de Gestión de Matrícula mencionar que la entrega de documentación física es obligatoria, para los casos donde la regla de negocio lo requiera o en caso de que la Secretaría de Educación Pública (SEP) lo solicite en algún momento de su vida escolar, la evidencia de esta mención debe de encontrarse en la interacción del cierre de venta.» | `N-51` |
| `N-62` | `5.7.c` | 11 | `requirement` | «Equivalencia y revalidación: Es obligación del Asesor de Gestión de Matrícula mencionar que la entrega de documentación física es obligatoria y la realización de pago del trámite de acuerdo a las políticas financieras vigentes, la evidencia de esta mención debe de encontrarse en la interacción del cierre de venta. Para validar los costos relacionados con éstos, se deberá ingresar a la plataforma SIU, en el apartado Reglamento/Misión/Visión Institucional, seleccionar el listado de precios y descargar el documento correspondiente. En este apartado también se podrán consultar las políticas financieras y los términos y condiciones aplicables.» | `N-61` |
| `N-63` | `5.7.d` | 11 | `condition` | «En caso de que el estudiante no tenga certeza de contar con el nivel académico requerido para ingresar a un programa UTEL, el Asesor de Venta deberá informarle sobre las implicaciones de una invasión de ciclo. Si durante la validación documental realizada por Back Office se determina que el estudiante no acredita el grado académico previo requerido, el caso deberá gestionarse como cancelación de venta por invasión de ciclo, incluyendo a los estudiantes con ingreso bajo esquema D53 que hayan firmado su convenio. Para minimizar estos casos, Éxito Estudiantil deberá dar seguimiento a la entrega y validación documental de los estudiantes D53 durante sus primeras dos semanas a partir de su fecha de inicio.» | `N-06`, `N-67` |
| `N-64` | `5.7.e` | 11 | `condition` | «Si en el bimestre 1 o inicial ya tiene calificaciones, por ningún motivo podrá ser considerado como cancelación de venta y deberá ser considerado como una baja, debido al devengamiento del servicio. Esto incluye cualquier tipo de información, como tema de convalidación, etc.» | — |
| `N-65` | `5.7.f` | 12 | `definition` | «Los documentos necesarios para la matriculación se encuentran relacionados en el Anexo 1. Documentos de Ingreso Estudiantes.» | `EXT-03` |
| `N-66` | `5.7.g` | 12 | `requirement` | «El estudiante deberá contar por lo menos con un historial que avale el 100% de créditos, una constancia de término o acreditación de examen único.» | `N-59` |
| `N-67` | `5.7.h` | 12 | `requirement` | «En los casos en que la matriculación dependa de requisitos evaluados mediante la Decisión 53, se deberá cumplir con lo estipulado en el documento "Anexo 5. Políticas y Normas Aplicables a la Decisión 53". Esto incluye la validación de la política y la correcta verificación de los requisitos de ingreso para proceder con la entrega de documentos» | `EXT-04` |

`N-64` es la regla de **prevalencia por devengamiento** y opera como
`counterevidence` frente a cualquier causal de CV: si hay calificaciones en el
bimestre 1, el desenlace es baja. Se modela como excepción de prioridad alta
en el árbol, no como una condición más.

### 5.8 Estudiantes Ilocalizables (pp.12→15)

| ID | Sección | Página | Tipo | Enunciado | `depends_on` |
|---|---|---|---|---|---|
| `N-68` | `5.8.a` | 12 | `condition` | «Un estudiante será considerado ilocalizable y podrá aplicar para una cancelación de venta cuando no se logre establecer ningún contacto efectivo individual, de acuerdo con la regla de intentos definida en el numeral 5.2, durante los procesos de validación, matriculación y/o bienvenida realizados por las áreas de Gestión de Matrícula, Back Office y/o Éxito Estudiantil, ya sea mediante gestiones directas o a través de las automatizaciones institucionales habilitadas (Voicebot, Chatbot u otras herramientas de contacto), hasta la segunda semana posterior al inicio de clases (fecha límite: domingo de la semana dos).» | `N-18`, `N-19`, `N-20`, `N-77` |
| `N-69` | `5.8.a` | 12 | `definition` | «Para efectos de este criterio, se considerará que existe contacto efectivo cuando el estudiante haya ingresado a la Oficina Virtual o cuando se identifique evidencia de actividad académica conforme a alguno de los siguientes supuestos:» | `N-68` |
| `N-70` | `5.8.a` (Licenciaturas) | 12 | `condition` | «● Licenciaturas ○ Haber seleccionado la modalidad de evaluación en al menos una asignatura activa. ○ En caso de no contar aún con calificaciones registradas, haber realizado al menos tres ingresos a la plataforma en fechas distintas, registrando una permanencia mínima de 10 minutos en cada acceso.» | `N-69` |
| `N-71` | `5.8.a` (Posgrados y Ejecutivas) | 12→13 | `condition` | «● Posgrados y Ejecutivas: ○ No haber registrado participación en foros en ninguna asignatura activa.» | `N-69` |
| `N-72` | `5.8.a` (Licenciaturas de alianzas) | 13 | `condition` | «● Licenciaturas de alianzas: ○ No haber ingresado a ninguna asignatura activa.» | `N-69` |
| `N-73` | `5.8.a` (Diplomados) | 13 | `condition` | «● Diplomados: ○ No haber registrado participación en foros en ninguna asignatura activa.» | `N-69` |
| `N-74` | `5.8.a` (Notas) | 13 | `counterevidence` | «● Si el estudiante cursa varias asignaturas y en al menos una registra ingreso o selección de modalidad (según corresponda a su nivel), no aplica cancelación de venta.» | `N-70`, `N-71`, `N-72`, `N-73` |
| `N-75` | `5.8.a` (Notas) | 13 | `counterevidence` | «● Si existe cualquier contacto con el estudiante durante la gestión de Gestión de Matrícula, Mejora Contnua o Dictaminación, el caso no se considerará ilocalizable.» | `N-68` |
| `N-76` | `5.8.b` | 13 | `procedure` | «Mitigación de cancelaciones por ilocalizable: Para reducir cancelaciones por estatus de ilocalizable, el equipo de Éxito Estudiantil (EE) podrá solicitar apoyo a Gestión de Matrícula para lograr contacto con el estudiante. Una vez establecido el contacto, se deberá transferir por conferencia a EE, quien continuará la gestión de retención.» | `N-68` |
| `N-77` | `5.8.c` | 13 | `requirement` | «Los intentos mínimos de contacto realizados por Éxito Estudiantil (EE) deberán efectuarse conforme a lo establecido en el numeral 5.2. Intentos de contacto mínimos al estudiante, asegurando la distribución de las interacciones entre la primera y segunda semana, así como que cada intento incluya el seguimiento correspondiente y las indicaciones claras al estudiante sobre el proceso de ingreso al aula.» | `N-18`, `N-19`, `N-20` |
| `N-78` | `5.8.d` | 13 | `condition` | «En los casos que el Estudiante fue contactado en el proceso de validación y/o bienvenida Éxito estudiantil y adicional se comprueba que no ha ingresado al Aula Virtual, y si en la llamada el estudiante solicita realizar cambio de ciclo este se debe aplicar y si el Estudiante en el nuevo ciclo desiste nuevamente de su ingreso aplica cancelación de venta o baja según corresponda.» | `N-39`, `N-41`, `N-42` |
| `N-79` | `5.8.e` | 14 | `requirement` | «casos especiales de localizados pero sin ingreso al aula: Si se genera contacto por parte del área de Gestión de Matrícula, deberán tomarse las siguientes acciones para activar al estudiante: ● Indicarle que será transferido al área de Éxito Estudiantil (EE) para recibir soporte en el ingreso a su aula o, si es posible, brindarle directamente las instrucciones necesarias para ingresar y activarse. ● Confirmar y actualizar en sistema los datos de contacto, como números telefónicos y correos electrónicos, en caso de cambios. ● Proporcionar al estudiante las ligas de contacto disponibles para Éxito Estudiantil (EE), incluyendo las oficinas virtuales asignadas al área. ● Notificar formalmente al equipo de Éxito Estudiantil, mediante correo electrónico, los datos de contacto actualizados del estudiante, su disponibilidad y cualquier información relevante para su seguimiento y activación.» | `N-68` |
| `N-80` | `5.8.e` | 14 | `condition` | «Si el área de Gestión de Matrícula no realiza estas acciones, la solicitud aplicará como cancelación de venta.» | `N-79` |
| `N-81` | `5.8.f` | 14 | `procedure` | «Si el estudiante ilocalizable contacta al Asesor de Ventas y solicita no continuar, el Asesor de Ventas debe canalizar de inmediato al equipo de Gestión de Éxito Estudiantil, los cuáles realizarán el procesos dependiendo de los tiempos estipulados para la decisión 35 (proceso de retención o cancelación de venta).» | `N-31` |
| `N-82` | `5.8.g` | 14 | `condition` | «Si el estudiante tiene como única interacción el contacto con el BOT/Asistente Virtual sin tener contacto con un Gestor de Éxito Estudiantil, se debe analizar las acciones realizadas por ambos equipos. Si se verifica que ambos equipos llevaron a cabo sus respectivas gestiones, los casos se considerarán como baja/cancelación "Operativa" sin impacto en ninguno de los dos equipos, contabilizando únicamente en el indicador general.» | `N-18`, `N-68` |
| `N-83` | `5.8.h` (en-tête) | 14 | `definition` | «Criterios de Contacto Efectivo: Para que un contacto sea considerado como efectivo, deberá cumplir con los siguientes criterios:» | `N-69` |
| `N-84` | `5.8.h.i` | 14 | `condition` | «El contacto debe ser con el titular, por medio escrito, llamando o bot (estudiante registrado en la universidad).» | `N-83` |
| `N-85` | `5.8.h.ii` | 15 | `condition` | «Para que una conversación sea considerada efectiva, debe existir una interacción relacionada con la consulta realizada, ya sea mediante respuestas, cuestionamientos, aclaraciones o seguimiento al tema planteado, según corresponda en cada caso.» | `N-83` |
| `N-86` | `5.8.h.iii` | 15 | `requirement` | «Se debe informar el objetivo de la llamada y el motivo del contacto.» | `N-83` |
| `N-87` | `5.8.h.iv` | 15 | `requirement` | «El estudiante debe recibir información clara sobre su ciclo de inicio, identificar qué el contacto es por parte de la universidad y confirmar sus datos personales.» | `N-83` |
| `N-88` | `5.8.h.v` | 15 | `condition` | «Si el estudiante manifiesta su decisión de no continuar, se deberá proceder conforme a las reglas establecidas en el procedimiento.» | `N-83`, `N-26` |
| `N-89` | `5.8.h.vi` | 15 | `procedure` | «Si la respuesta del estudiante está vinculada con otra política o lineamiento de cancelación, el caso deberá escalarse o gestionarse según lo estipulado en ese lineamiento.» | `N-83`, `EXT-05` |
| `N-90` | `5.8.i` | 15 | `condition` | «Criterio de ingresos al aula (posgrado): Para que el ingreso al aula en programas de posgrado sea considerado válido, el estudiante deberá: 1. Ingresar al aula virtual, asegurando su acceso a la plataforma. 2. Evidenciar participación en el foro de presentación, demostrando su actividad académica dentro del curso. 3. Si el estudiante cumple con alguno de los criterios establecidos en los puntos 1 y 2 después de la creación del ticket de Cancelación de Venta (CV), deberá contar con evidencia de contacto por parte de Ventas y Éxito Estudiantil; en caso contrario, procederá como cancelación de venta.» | `N-09` |
| `N-91` | `5.8.j` | 15 | `condition` | «En caso de que el equipo de Éxito Estudiantil no cumpla con el número o porcentaje de interacciones establecido, y no exista una causa operativa debidamente documentada que justifique dicho incumplimiento, no podrá considerarse acreditado el requisito de gestión de contacto correspondiente.» | `N-18`, `N-19`, `N-20`, `N-25` |

**Dirección lógica opuesta registrada:** `N-70` a `N-73` describen, para cada nivel,
la **evidencia que-credita** contacto efectivo. `N-71` y `N-73` están redactadas
en forma **negativa** («No haber registrado participación en foros»), es decir,
la condición satisfecha es la **ausencia** de actividad. Una lectura ingénua
invierte el resultado. Se preserva la redacción exacta y se marca
`AMB-LOG-02` como riesgo de inversión de polaridad.

### 5.9 Cancelaciones operativas (pp.15→17)

| ID | Sección | Página | Tipo | Enunciado | `depends_on` |
|---|---|---|---|---|---|
| `N-92` | `5.9` (en-tête) | 16 | `definition` | «Se considerará cancelación de venta operativa en los siguientes casos:» | — |
| `N-93` | `5.9.a` | 16 | `condition` | «Error de Servicios Escolares en la validación del perfil o documentación: Cuando, por un error de Servicios Escolares, se otorgue una "Decisión 35" a un estudiante que no cumpla con el perfil o la documentación mínima necesaria para su inscripción. No aplica para los canales de venta College y Upselling, debido a que estos contemplan inscripciones de estudiantes futuros.» | `N-31` |
| `N-94` | `5.9.b` | 16 | `condition` | «Error administrativo de Finanzas o Cobranza: Cuando exista un error administrativo atribuible a las áreas de Finanzas o Cobranza, ajeno al proceso de inscripción u onboarding, como la falta de aplicación o reflejo de pagos, ajustes o promociones, y este genere una afectación en la experiencia del estudiante que motive su decisión de no continuar.» | `N-26` |
| `N-95` | `5.9.c` | 16 | `exception` | «Incidencias en sistemas institucionales: No aplicará la política operativa de cancelación cuando la falta de activation, acceso o continuidad del estudiante sea consecuencia de una incidencia identificada en el Aula Virtual, SIU u otros sistemas institucionales involucrados en la activación académica.» | `N-92` |
| `N-96` | `5.9.c` | 16 | `requirement` | «En estos casos, será responsabilidad de Éxito Estudiantil reportar la incidencia al área responsable, dar seguimiento hasta su resolución y mantener la comunicación y contención con el estudiante durante el periodo de atención, procurando garantizar la continuidad de su servicio.» | `N-95` |
| `N-97` | `5.9.c` | 16 | `requirement` | «La incidencia deberá contar con la evidencia correspondiente y podrá ser respaldada mediante tickets en Flokzu y/o Jira.» | `N-95` |
| `N-98` | `5.9.c` | 16 | `condition` | «En caso de que el estudiante manifieste expresamente su intención de desertar como consecuencia de la incidencia, la solicitud deberá gestionarse como una solicitud de baja.» | `N-95` |
| `N-99` | `5.9.d` | 16 | `condition` | «Falta de canalización de una solicitud de cancelación: Cuando un estudiante tenga contacto con el área operativa y manifieste su intención de realizar una cancelación de venta, el área operativa deberá canalizarlo con Éxito Estudiantil para su atención. En caso de que el área operativa no realice la transferencia ni notifique a Éxito Estudiantil, el caso se considerará como cancelación de venta operativa.» | `N-92` |
| `N-100` | `5.9.e` | 17 | `condition` | «Error de seguimiento de Éxito Estudiantil: Cuando exista una solicitud del estudiante relacionada con un ajuste por un motivo personal y, derivado de un error en el seguimiento que corresponde realizar a Éxito Estudiantil, o en la solicitud de gestión a las áreas correspondientes vía Flokzu, se identifique una falla en el proceso que afecte la atención del caso.» | `N-99` |
| `N-101` | `5.9.f` | 17 | `condition` | «Error en la validación del paquete de venta: La confirmación del paquete de venta durante la llamada de validación deberá corresponder al 100 % de lo establecido en el documento de venta. Cuando exista una discrepancia y el estudiante solicite expresamente la cancelación como consecuencia de dicho error, aplicará cancelación de venta, siempre que se determine que el error corresponde al proceso de validación de la venta y no al asesor.» | `N-45` |
| `N-102` | `5.9.g` | 17 | `condition` | «Error de validación por parte de Back Office: Cuando se identifique un error en la validación de la venta realizado por el equipo de Back Office (BO) y este genere una solicitud de cancelación por parte del estudiante, el caso deberá gestionarse como cancelación de venta operativa.» | `N-47` |
| `N-103` | `5.9` (Consideración sobre tiempos) | 17 | `temporal` | «El equipo financiero tendrá como plazo hasta la semana 3 posterior al inicio del ciclo para realizar la cancelación del saldo y determinar el estatus correspondiente como cancelación de venta o baja, según aplique.» | `N-35` |
| `N-104` | `5.9` (Consideración sobre tiempos) | 17 | `temporal` | «Una vez concluido este plazo, no será posible revertir el estatus de cancelación de venta a baja, ni de baja a cancelación de venta.» | `N-103` |

**Nota de errata en `N-95`:** el original dice «falta de activation» con `ct` en
inglés (ver `TR-01`–`TR-08`; se añade `TR-09`).

| ID | Ubicación | Texto en el original |
|---|---|---|
| `TR-09` | 5.9.c, p.16 | «falta de activation, acceso o continuidad» |

### 5.10 Mystery Shopper (p.17)

| ID | Sección | Página | Tipo | Enunciado | `depends_on` |
|---|---|---|---|---|---|
| `N-105` | `5.10` | 17 | `condition` | «Todas las ventas que ingresen a través del canal de Mystery Shopper aplican como: "cancelación de matrícula", aplicadas por parte del equipo de Servicios Escolares, no impacta el indicador de cancelaciones de venta.» | `N-27` |

`N-105` introduce un **tercer desenlace** distinto de cancelación de venta y
baja: «cancelación de matrícula». Es un caso de exclusión por canal, no una
causal. `N-93` ya excluye explícitamente los canales College y Upselling, pero
`N-105` no está en la lista de 5.9. Se registra como desenlace de canal en
`decision-tree.md` y en `AMB-LOG-03` por la forma «aplican como».

### 5.11 Falta de quórum (pp.17→18)

| ID | Sección | Página | Tipo | Enunciado | `depends_on` |
|---|---|---|---|---|---|
| `N-106` | `5.11.a` | 17→18 | `condition` | «Aplica cuando un programa ofertado por UTEL no alcanza el número mínimo de estudiantes requerido para la apertura de grupo y el estudiante no acepta una reprogramación para una futura fecha de inicio.» | — |
| `N-107` | `5.11.b` | 18 | `procedure` | «En estos casos, procederá la cancelación de venta, considerando que la gestión del quórum y la apertura del grupo son responsabilidad de Gestión de Matrícula, mediante la ejecución y seguimiento de las acciones necesarias para garantizar el inicio oportuno del programa.» | `N-106` |
| `N-108` | `5.11.c` | 18 | `temporal` | «La solicitud podrá realizarse antes o después de la fecha de inicio, ya que el estudiante puede identificar esta situación al no contar con materias inscritas o al no haber tenido un inicio académico efectivo.» | `N-106` |
| `N-109` | `5.11` (Consideración 1) | 18 | `condition` | «Aplica únicamente cuando el grupo no haya sido aperturado por falta de quórum.» | `N-106` |
| `N-110` | `5.11` (Consideración 2) | 18 | `requirement` | «Deberá existir evidencia de que se ofreció al estudiante una alternativa de reprogramación o cambio de fecha de inicio.» | `N-106` |
| `N-111` | `5.11` (Consideración 3) | 18 | `condition` | «Si el estudiante rechaza la alternativa propuesta, procederá la cancelación de venta.» | `N-110` |
| `N-112` | `5.11` (Consideración 4) | 18 | `temporal` | «La fecha de solicitud no limitará la aplicación de este criterio, siempre que se confirme que el estudiante no inició actividades académicas debido a la falta de apertura del grupo.» | `N-109` |

`N-108` y `N-112` **expresamente disregardan** el límite de 2 semanas de `N-15`.
Es la excepción temporal más clara del documento y debe prevalecer sobre
`N-15` para esta causal. Ver `AMB-TEM-03` (el documento no declara la
prevalencia; se infiere del tenor de "no limitará").

### 5.12 Indicador de Cancelación de Venta y Bajas (Primer Mes) (pp.18→19)

| ID | Sección | Página | Tipo | Enunciado | `depends_on` |
|---|---|---|---|---|---|
| `N-113` | `5.12.a` | 18 | `indicator` | «Los equipos de Ventas (Gestión de matrícula), Planning MX, Cancelaciones de Venta, Back Office y Éxito Estudiantil (EE - B1) deberán integrar el indicador de Cancelación de Venta y Bajas (Primer Mes) en sus mediciones.» | — |
| `N-114` | `5.12.b` | 18 | `indicator` | «Deserción: Se considerarán como casos de deserción todas aquellas cancelaciones de ventas o bajas realizadas dentro del periodo comprendido entre la fecha de inicio del ciclo y hasta 30 días posteriores al inicio de ciclo.» | `N-07` |
| `N-115` | `5.12.c` | 18→19 | `indicator` | «Impacto del indicador de deserción: El indicador de deserción se compone de la sumatoria del porcentaje de cancelaciones de ventas y el porcentaje de bajas mensuales.» | `N-114` |
| `N-116` | `5.12.d` | 19 | `indicator` | «Este indicador afectará las métricas y resultados de todos los equipos mencionados, quienes deberán monitorear y reportar su desempeño en relación con este parámetro.» | `N-113` |
| `N-117` | `5.12.e` | 19 | `indicator` | «En su primera fase, este indicador impactará a todos los agentes de los diferentes equipos. Para el personal administrativo (staff), que ya incluye las cancelaciones de venta en sus mediciones, este indicador también deberá incorporar la retención de Éxito Estudiantil (EE) como parte de sus evaluaciones.» | `N-113` |

`N-113` a `N-117` son `indicator`, **no** `condition`. No participan en el
árbol de decisión. Se incluyen para trazabilidad y para que la cobertura
declare explícitamente su exclusión del árbol.

### 5.13 Soporte de Evidencias para solicitudes en Flokzu (p.19)

| ID | Sección | Página | Tipo | Enunciado | `depends_on` |
|---|---|---|---|---|---|
| `N-118` | `5.13` | 19 | `requirement` | «La evidencia requerida deberá corresponder al medio de interacción utilizado con el estudiante. ● Interacciones por medios escritos: Se deberá registrar una descripción clara del caso y adjuntar evidencia de la gestión realizada y su resultado, mediante una captura de pantalla del sistema o canal de contacto utilizado. ● Interacciones telefónicas: Se deberá documentar la gestión realizada, incluyendo el resultado de la llamada, y adjuntar la evidencia disponible en el sistema de contacto correspondiente.» | `N-51` |
| `N-119` | `5.13` | 19 | `requirement` | «Toda la información y evidencias relacionadas con la gestión deberán registrarse en Flokzu, dentro del campo "Evidencias", asegurando que permitan validar la atención brindada y sustentar la solicitud procesada.» | `N-09`, `N-118` |

### 5.14 Solicitud de evidencias al área de Mejora Continua o ventas (pp.19→20)

| ID | Sección | Página | Tipo | Enunciado | `depends_on` |
|---|---|---|---|---|---|
| `N-120` | `5.14` | 19 | `procedure` | «Las solicitudes de evidencias se harán al área de Mejora Continua o Ventas solo cuando estas evidencias no estén disponibles en la plataforma de I6, sino en otras plataformas o en conversaciones a través de números personales del asesor de ventas.» | `N-51` |
| `N-121` | `5.14.a` | 20 | `temporal` | «Tiempo de Respuesta del Área de Mejora Continua: El área de Mejora continua tendrá un tiempo máximo de 24 horas para compartir evidencias en casos de inscripciones con menos de 90 días. Para inscripciones mayores a 90 días, el tiempo máximo será de 72 horas, ya que será necesario solicitar dichas evidencias al equipo de TI.» | `N-120` |
| `N-122` | `5.14.b` | 20 | `temporal` | «Tiempo de Respuesta del Área de Ventas: El área de Ventas tendrá un tiempo máximo de 24 horas para compartir las evidencias solicitadas.» | `N-120` |

### 5.15 Atención de solicitudes (pp.20→21)

| ID | Sección | Página | Tipo | Enunciado | `depends_on` |
|---|---|---|---|---|---|
| `N-123` | `5.15` (tabla SLA) | 20 | `temporal` | «Recepción, análisis y gestión inicial — Mejora Continua — 48 h; Gestión / validación correspondiente — Gestión de Matrícula — 48 h; Dictaminación, cuando aplique — Dictaminación — 48 h; Gestión financiera — Finanzas — 24 h; Gestión escolar — Servicios Escolares — 24 h» | `N-10`, `N-11` |
| `N-124` | `5.15` | 20 | `temporal` | «Las solicitudes relacionadas con Cancelación de Venta (CV) serán atendidas conforme a los siguientes Acuerdos de Nivel de Servicio (SLA), considerando únicamente días y horas hábiles» | `N-123` |
| `N-125` | `5.15.a` | 20 | `temporal` | «Los tiempos comenzarán a contabilizarse a partir de la recepción de la solicitud, siempre que ésta cuente con la información necesaria para su atención.» | `N-124` |
| `N-126` | `5.15.b` | 20 | `temporal` | «Los SLA se contabilizan en horas hábiles, de lunes a viernes.» | `N-124` |
| `N-127` | `5.15.c` | 20 | `temporal` | «Las solicitudes recibidas durante fines de semana o días inhábiles comenzarán a contabilizar su SLA a partir del siguiente día hábil a las 8:00 a.m.» | `N-124`, `N-126` |
| `N-128` | `5.15.d` | 20→21 | `temporal` | «Cuando una solicitud requiera dictaminación, el tiempo correspondiente se adicionará al flujo de atención.» | `N-123`, `N-14` |
| `N-129` | `5.15.e` | 21 | `temporal` | «El tiempo total de atención dependerá de las etapas que correspondan a cada caso. No todas las solicitudes requieren pasar por todas las etapas.» | `N-123` |
| `N-130` | `5.15.f` | 21 | `temporal` | «En caso de que la solicitud requiera información o documentación adicional por parte del área solicitante, el tiempo de atención podrá pausarse hasta contar con la información necesaria.» | `N-125` |

Verificado contra el original (p.20): los incisos `5.15.a` y `5.15.c` están
redactados en el PDF sin artefactos de extracción. No existe errata en ninguno
de los dos.


---

## 6. Descripción de Actividades (p.21) — `EXT`

| ID | Sección | Página | Tipo | Enunciado |
|---|---|---|---|---|
| `N-131` | `6` | 21 | `procedure` | «La descripción de las actividades está disponible en el siguiente enlace de Drive: GDM_GAM_PRD_MLG_003 PROCEDIMIENTO DESERCIÓN DE ESTUDIANTES» |

**No transcribible.** El contenido está en un Drive externo no incluido en el
PDF. La secuencia de actividades del proceso **no es derivable de la fuente
autorizada de Fase 1**. Registrado como `AMB-EXT-02`.

---

## 7. Diagrama de Flujo (p.21) — `EXT`

| ID | Sección | Página | Tipo | Enunciado |
|---|---|---|---|---|
| `N-132` | `7` | 21 | `procedure` | «Diagrama de flujo se encuentra disponible en el siguiente Link: GDM_GAM_PRD_MLG_003 PROCEDIMIENTO DESERCIÓN DE ESTUDIANTES.png. Lucidchart document» |

**No transcribible.** El diagrama es una imagen referenciada por nombre, no
contenido textual del PDF. No se infiere ninguna arista del árbol de decisión a
partir de un archivo ausente. Registrado como `AMB-EXT-02`. Este es el hueco
de cobertura más relevante: el flujo oficial del proceso vive fuera del
documento bloqueado.

---

## 8. Indicadores (pp.21→22) — `indicator`

| ID | Sección | Página | Tipo | Nombre | Descripción | Fórmula | Periodicidad |
|---|---|---|---|---|---|---|---|
| `N-133` | `8` | 21 | `indicator` | Cancelaciones de Ventas Aceptadas sin Evidencia | «solicitudes de cancelación de ventas aceptadas sin evidencia compartida.» | «Número de cancelaciones aceptadas sin evidencia» | Mensual |
| `N-134` | `8` | 22 | `indicator` | Cancelaciones de Ventas Aceptadas con Evidencia | «solicitudes de cancelación de ventas aceptadas con evidencia adecuada» | «Número de cancelaciones aceptadas con evidencia» | Mensual |
| `N-135` | `8` | 22 | `indicator` | Cancelaciones de Ventas Aceptadas por Tiempo | «solicitudes de cancelación de ventas aceptadas por extemporaneidad» | «Número de cancelaciones aceptadas por extemporaneidad» | Mensual |
| `N-136` | `8` | 22 | `indicator` | Porcentaje de Canceladas | «Porcentaje de solicitudes de cancelación de ventas que fueron canceladas» | «(Número de solicitudes canceladas/ Número total de solicitudes) x 100» | Mensual |

Todos son `indicator`. No participan en el árbol de decisión.

---

## 9. Anexos (p.22) — `EXT`

| ID | Sección | Página | Tipo | Enunciado |
|---|---|---|---|---|
| `N-137` | `9` | 22 | `definition` | «● Anexo 1. matriz de validaciones ● Anexo 2. Matriz Estrategias de Retención ● Anexo 3. flujo y botones en flokzu ● Anexo 4. Matriz Estrategias de Retención - Copiloto Ventas ● Anexo 5. Políticas y Normas Aplicables a la Decisión 53 ● Anexo 6. oficinas virtuales ● Anexo 7. Flokzu Cancelacion de ventas OPM ● Anexo 8 Manual de levantamiento de tickets de Cancelación de Venta» |
| `N-138` | `9` | 22 | `definition` | «Anexos Proceso gestion admision y matricula ● Anexo 1. Documentos de Ingreso Estudiantes ● Anexo 7. Matriz de identificación para casos extemporáneos» |

**Ocho anexos referenciados, ninguno incluido en el PDF.** Impacto directo:
`N-59` (carta manifiesto) depende del **formato** del documento no incluido
(`AMB-EXT-03`); `N-65` (documentos de matriculación) depende del Anexo 1 no
incluido; `N-67` (D53) depende del Anexo 5 no incluido; `N-32` (estrategias de
retención) depende de los Anexos 2 y 4 no incluidos.

---

## 10. Documentos de Referencia (p.22) — `EXT`

| ID | Sección | Página | Tipo | Enunciado |
|---|---|---|---|---|
| `N-139` | `10` | 22 | `definition` | «● GCE_GCE_PRD_MXL_001 Cambio de ciclo y Fecha ● GDM_GAM_PRO_MXL_001 Proceso Gestión de admisión y matricula ● GDM_GAM_PRD_MXL_008 Procedimiento D53» |

Los tres están fuera del repositorio y fuera del PDF. Registrado como
`AMB-EXT-01` a `AMB-EXT-05`.

---

## 11. Control de Cambios (pp.23→26) — `procedure`

| Versión | Fecha | Descripción del cambio | Página |
|---|---|---|---|
| `01` | 26/09/2024 | Creación del documento | 23 |
| `02` | 19/02/2025 | El procedimiento cambia de nombre de Cancelación de Ventas a Deserción de Estudiantes debido a la unificación del KPI de cancelación y bajas de venta. Se actualizan las reglas de acuerdo con esta unificación, impactando a las áreas de Éxito Estudiantil y BackOffice. Se sustituye el término Onboarding por Bienvenida y Gestión de Onboarding por Gestión de Matrícula. Se agregan los Anexos 5 y 6 para complementar el procedimiento. Se incorpora el item 5.11, que aclara el indicador de deserción y su impacto. Actualización de matriz de procesos y flujo | 23→24 |
| `03` | 22/05/2026 | Integración de nuevas reglas de negocio, validaciones y criterios operativos. Se incorporaron criterios para la gestión de estudiantes ilocalizables, contacto efectivo y cancelaciones operativas. Actualización de los tiempos de atención, respuesta y aplicación por área responsable. Integración de nuevas reglas de negocio, validaciones y criterios operativos. Unificación de acciones entre CV y Helpdesk a Mejora continua | 24→25 |
| `04` | 23/06/2026 | Incorporación de criterios para la gestión de estudiantes ilocalizables, contacto efectivo y cancelaciones operativas. Actualización de los tiempos de atención, respuesta y aplicación por área responsable. Integración de nuevas reglas de negocio, validaciones y criterios operativos. Unificación de acciones entre CV y Helpdesk a Mejora continua. Integración del Manual de levantamiento de tickets de Cancelación de Venta. Integración del Procedimiento D53 | 25→26 |
| `05` | 14/09/2026 | 5.2: Actualización de reglas y criterios para los intentos mínimos de contacto. 5.8: Ajuste de criterios para la gestión y acreditación de estudiantes ilocalizables. 5.9: Integración de criterios para incidencias en sistemas institucionales y cancelaciones operativas. 5.15: Redefinición de SLAs de respuesta | 26 |

**Discrepancia de Control de Cambios registrada:** la fila de la versión `02`
indica que el indicador de deserción se incorporó como «item 5.11», pero en el
cuerpo de la Versión 5 el indicador de deserción está en **5.12** y **5.11** es
«Falta de quórum». La numeración de la versión 3+ reordenó los apartados sin
actualizar la descripción del cambio histórico. Ver `AMB-REF-01`. Esto no altera
la norma vigente (5.12) pero confirma que **la numeración de sección del
historial no es estable** y no debe usarse para citar.

---

## 12. Estadísticas del inventario

| Métrica | Valor |
|---|---|
| Enunciados normativos transcritos | 139 |
| De los cuales `condition` | 46 |
| De los cuales `requirement` | 26 |
| De los cuales `temporal` | 19 |
| De los cuales `procedure` | 16 |
| De los cuales `definition` | 12 |
| De los cuales `indicator` | 9 |
| De los cuales `scope` | 4 |
| De los cuales `exception` | 4 |
| De los cuales `counterevidence` | 3 |
| Secciones del documento inventariadas | 11 (1 a 11) |
| Incisos de Política de Negocio inventariados | 5.1 a 5.15 (15 apartados) |
| Páginas leídas | 26 de 26 |
| Enunciados no transcribibles (`EXT`) | 6 secciones (1 glosario, 6 actividades, 7 diagrama, 9 anexos, 10 referencias) |
| Enunciados derivados de documentos externos | `N-05`, `N-40`, `N-59`, `N-65`, `N-67`, `N-89` |
| Erratas del original preservadas | 9 (`TR-01`…`TR-09`) |
| Ambigüedades detectadas | 28 (14 bloqueantes, ver `ambiguities.md`) |

> Los conteos por tipo fueron verificados por parsing sobre las 139 filas del
> documento. Suman 139 sin residuo.

**Balance de outcomes posible del documento (sin decidir prevalencia):**

| Desenlace | Enunciados que lo establecen |
|---|---|
| Cancelación de venta | `N-27`, `N-30`, `N-39`, `N-41`, `N-45`, `N-46`, `N-52`, `N-54`, `N-56`, `N-60`, `N-63`, `N-68`, `N-80`, `N-90`, `N-101`, `N-102`, `N-107`, `N-111` |
| Baja | `N-28`, `N-33`, `N-35`, `N-53`, `N-64`, `N-98` |
| Cancelación de venta operativa | `N-48`, `N-82`, `N-92`, `N-93`, `N-94`, `N-99`, `N-100`, `N-102` |
| Cancelación de matrícula (canal) | `N-105` |
| Dictaminación / escalamiento | `N-13`, `N-14`, `N-58`, `N-89` |
| Sin desenlace de CV/baja (retención obligatoria) | `N-31`, `N-32`, `N-38`, `N-42`, `N-76`, `N-79` |

El documento establece **cinco** desenlaces distintos, no un conjunto cerrado de
tres. Cualquier motor futuro debe derivar su catálogo de esta tabla y no de
ninguna lista heredada.

---

# Phase 1.5 — Inventario de las fuentes de apoyo

> **Phase 1 preservado.** Los `N-01`…`N-139` anteriores describen el primario
> `GDM_GAM_PRD_MLG_003` v5 y **no se modifican**. Commit: `4f6fad7`.
>
> Los enunciados nuevos usan **espacio de ID propio** para que la procedencia sea
> inequívoca: `G-##` = Glosario, `D53-##` = Procedimiento D53. No se renumeran los
> `N-##` porque un `G-01` no es un enunciado del primario.
>
> Clasificación: `definition` (define), `condition` (si…entonces), `requirement`
> (obligación), `temporal` (ventana/plazo), `procedure` (acción), `scope`
> (alcance), `exception` (excepción), `indicator` (medición),
> `counterevidence` (impide un desenlace).

## 13. Fuente 3 — Glosario de operación escolar (`G-##`)

SHA-256 `de15e50b…63e9f5` · 30 páginas · sin código, versión ni fecha propia.
Sección interna del documento entre paréntesis; la página es el índice PDF.

| ID | Sección (pág.) | p. | Tipo | Enunciado | Enlace |
|---|---|---|---|---|---|
| `G-01` | Alumno (6) | 6 | `definition` | «Alumno de nuevo ingreso: aquel que ha sido registrado por primera vez en un plan de estudios.» | `D53-01` |
| `G-02` | Alumno (6) | 6 | `definition` | «Alumno futuro: aquel que ya se encuentra inscrito, cuenta con expediente digital cargado en SIU y está en espera de la fecha de inicio de ciclo.» | `XDC-07` |
| `G-03` | Alumno (6) | 6 | `definition` | «Alumno regular: aquel que cumple con las características al tener su documentación completa, estar al corriente con sus colegiaturas, no haber reprobado materias y no haber solicitado baja.» | `XDC-06` |
| `G-04` | Alumno (6) | 6 | `definition` | «Alumno irregular: aquel que no ha entregado documentos, cuenta con adeudo, ha reprobado materias y ha solicitado baja en algún momento de su vida universitaria.» | `XDC-06` |
| `G-05` | Alumno (6) | 6 | `definition` | «Alumno (MA): persona inscrita en un plan de estudios con matrícula vigente (cuenta con decisión 35).» | `G-18` |
| `G-06` | Alumno (6) | 6 | `definition` | «Baja: estatus que inactiva los servicios ofrecidos por la institución al alumno.» | `D53-09` |
| `G-07` | Alumno (6) | 6 | `definition` | «Baja definitiva (BD): alumno que decide suspender de manera permanente sus estudios.» | `D53-10` |
| `G-08` | Alumno (6) | 6 | `definition` | «Baja por falta de documentos: transcurridos 6 meses posteriores al inicio del primer ciclo académico del alumno.» | `XDC-03` |
| `G-09` | Alumno (6) | 6 | `definition` | «Baja por inactividad (BTI): alumno que no ingresó al Aula Virtual durante dos periodos previos.» | `XDC-04` |
| `G-10` | Alumno (6) | 6 | `definition` | «Baja temporal (BT): alumno que decide suspender por un tiempo definido sus estudios.» | `G-11` |
| `G-11` | Alumno (7) | 9 | `definition` | «Reingreso: estatus de alumno que decide retomar su plan de estudios después de tener al menos un periodo con estatus de baja.» | `D53-13` |
| `G-12` | Alumno (7) | 9 | `definition` | «Reversión de baja: proceso a petición del alumno con un estatus de baja aplicado durante el periodo en curso y que solicita reactivar su matrícula.» | `AMB-CON-06` |
| `G-13` | Alumno (7) | 7 | `definition` | «Cancelación de venta (CV): proceso para alumnos de nuevo ingreso mediante el cual se inactiva su matrícula de acuerdo a los lineamientos, se solicita dentro de las primeras 2 semanas del ciclo o cuando sea solicitado por el alumno antes de su inicio de clases, p. ej.: por error en su paquete de inscripción; no se localiza al alumno y no ingresa al Aula; ya no está interesado en iniciar.» | `XDC-01` |
| `G-14` | Permanencia (20) | 21 | `definition` | «Proceso de retención: seguimiento a un alumno que ha manifestado su decisión de baja de la Universidad, en el cual el gestor académico le proporciona las estrategias necesarias (económicas, académicas, de tiempo, etc.) con el objetivo de lograr su permanencia académica.» | `AMB-LOG-02` |
| `G-15` | Permanencia (20) | 21 | `definition` | «Retención: cierre del proceso de retención en el cual el alumno decide continuar con su programa académico.» | `AMB-CON-04` |
| `G-16` | Permanencia (20) | 21 | `definition` | «Riesgo de baja: alumno que manifiesta la posibilidad de retirarse de la Universidad sin solicitarlo directamente, p. ej. comenta que perdió su empleo y no sabe si podrá continuar con sus estudios el siguiente bimestre.» | `G-14` |
| `G-17` | Permanencia (20) | 21 | `definition` | «Semáforo: indicador académico de un alumno de acuerdo a la calificación obtenida hasta el momento. Alto Riesgo (AR): alumno sin ingreso al Aula o que no presentó actividades. Riesgo Académico (RA): alumno en peligro de reprobar alguna de sus asignaturas. Sin Riesgo Académico (SRA): alumno con la calificación idónea en sus asignaturas.» | `N-69` |
| `G-18` | Servicios Escolares (23) | 24 | `definition` | «Decisión en la solicitud: se otorga al aspirante a partir de la validación de los requisitos que cubre su documentación digital, existen cuatro decisiones: ACEPTADO: cumple con la documentación digital y criterios de ingreso completos (antes decisión 35). RECHAZADO: falta algún requisito en la documentación (antes decisión 40). VUELTA A VENTA: ventas adjunta el requisito faltante para validar la documentación nuevamente (antes decisión 45). CANCELADO: registro cancelado para generar una nueva solicitud (antes decisión 50). PREADMITIDO: falta el antecedente académico del nivel anterior (decisión 53); en SIU se visualiza con la etiqueta de "EN VALIDACIÓN".» | `ERR-G-01` |
| `G-19` | Servicios Escolares (23) | 24 | `definition` | «Carta compromiso: documento institucional en el que el alumno se compromete a entregar su expediente escolar en un término de dos meses.» | `XDC-02` |
| `G-20` | Servicios Escolares (23) | 24 | `definition` | «Campus: unidad de configuración que permite diferenciar las distintas reglas de operación de los alumnos que residen en un país distinto a México, p. j. UTL (México), PER (Perú), COL (Colombia), etc. En México existe el campus UTS para Educación continua (Máster, Diplomado e Idiomas).» | `D53-12` |
| `G-21` | Servicios Escolares (23) | 24 | `definition` | «Cambio de tipo de ingreso: proceso por el cual se actualiza la forma de inscripción de un alumno de acuerdo a la documentación con la que acredita su grado previo de estudios, p. e. de Regular a Dictamen técnico; de Equivalencia a Regular, etc.» | `G-23` |
| `G-22` | Servicios Escolares (23) | 28 | `definition` | «Tipo de ingreso: clasificación asignada a un prospecto de acuerdo a la forma en que acredita su nivel de estudios previo, que determina los requisitos específicos y el proceso de admisión que debe seguir. Regular: alumno que cuenta con estudios previos en el sistema educativo nacional y cursa su plan de estudios de inicio a fin. Equivalencia: alumno con estudios previos dentro del Sistema Educativo Nacional y que desea equipararlos a un plan de estudios afín al de interés. Revalidación: alumno con estudios previos fuera del Sistema Educativo Nacional (en el extranjero) y que ameritan validez oficial, siempre y cuando sean equiparables con estudios realizados dentro de dicho sistema. Dictamen técnico: alumno con estudios previos en el extranjero que desea cursar un plan de estudios en la Universidad exclusivamente para adquirir conocimientos y no ejercerá en México.» | `D53-01` |
| `G-23` | Servicios Escolares (23) | 26 | `definition` | «Expediente escolar: conjunto de documentos personales y académicos entregados por el alumno o generados por la institución en relación con su trayectoria académica, el cual se encuentra en SIU, requerido para el registro del alumno ante la autoridad educativa y para dar validez oficial a sus estudios.» | `XDC-05` |
| `G-24` | Servicios Escolares (23) | 27 | `definition` | «Solicitud de autenticación del antecedente académico: proceso mediante el cual se solicita a la institución emisora de un certificado la confirmación de la autenticidad del antecedente académico entregado por un alumno.» | `G-18` |
| `G-25` | Servicios Escolares (23) | 27 | `definition` | «Segmentos de recolección: clasificación de alumnos sin expediente escolar completo, agrupados conforme a su porcentaje de avance curricular… Segmento 1: mayor al 50%. Segmento 2: del 40% al 50%. Segmento 3: del 31% al 39%. Segmento 4: del 0% al 30%.» | `D53-06` |
| `G-26` | Operación (18) | 18 | `definition` | «Cierre de aula: bloqueo de la plataforma educativa al alumno por incumplimiento de algún compromiso (pago de colegiatura, entrega de documentos).» | `D53-14` |
| `G-27` | Operación (18) | 14 | `definition` | «Contacto: son los registros de leads con los que se ha logrado alguna interacción y se logra tener una respuesta.» | `XDC-08` |
| `G-28` | Operación (18) | 14 | `definition` | «Incidencias: Marcaciones automáticas del sistema que impiden el contacto con el prospecto.» | `N-86` |
| `G-29` | Temporalidad (29) | 29 | `definition` | «Ciclo: fecha de inicio cuatrimestral establecido en el calendario escolar de la Universidad, tiene una duración de 14 semanas y se diferencia con el sufijo siguiente: 41 (septiembre-diciembre), 42 (enero-abril), 43 (mayo-agosto).» | `XDC-04` |
| `G-30` | Temporalidad (29) | 30 | `definition` | «Periodo: parte bimestral de un ciclo, es el tiempo durante el cual Utel imparte clases a los alumnos que cursan una o más asignaturas.» | `XDC-04` |
| `G-31` | Temporalidad (29) | 29 | `definition` | «Bloque: iniciación quincenal que se encuentra dentro de un periodo de impartición de cursos (bloque A, B, C, D). Licenciatura, duración de cada bimestre: Bloque A: 7 semanas. Bloque B: 6 semanas. Bloque C: 4 semanas. Bloque D: 9 semanas.» | `ERR-G-02` |
| `G-32` | Temporalidad (29) | 29 | `definition` | «Jornada académica: tiempo en el que el alumno cursa su plan de estudios de acuerdo al número de asignaturas cursadas por cuatrimestre. Completa: 3 años, 8 meses (2 asignaturas). Intensiva: 2 años, 8 meses (3 asignaturas). Súper Intensiva: 2 años, 2 meses (4 asignaturas). Reducida: 5 años + (1 asignatura).» | `ERR-G-02` |
| `G-33` | Gestión de matrícula (14) | 14 | `definition` | «Incidencias: Marcaciones automáticas del sistema que impiden el contacto con el prospecto.» | `G-28` |
| `G-34` | Servicios Escolares (23) | 25 | `definition` | «Estatus de inscripción… ASPIRANTE: persona que ya cuenta con el pago validado en el sistema, ha llenado la Solicitud de admisión y aceptado los Términos y Condiciones del Servicio Educativo, y se encuentra en espera de la validación de sus documentos digitales. ALUMNO: persona cuyos documentos digitales han sido validados y cumple con lo necesario para el ingreso.» | `D53-08` |
| `G-35` | Servicios Escolares (23) | 23 | `definition` | «Admisión: proceso dentro de SIU para verificar que el expediente de un aspirante es idóneo, que cuenta con el antecedente académico y que los documentos cumplen con las normas aplicables para ser alumno.» | `G-18` |
| `G-36` | Servicios Escolares (23) | 25 | `definition` | «Dictaminación: proceso institucional para corroborar que los elementos de forma y validez del certificado de estudios físico del alumno cumplen con los lineamientos establecidos para su registro, integración y resguardo.» | `D53-15` |
| `G-37` | Documentos/Trámites (10) | 13 | `definition` | «Revalidación de estudios: trámite mediante el cual la Dirección General de Acreditación, Incorporación y Revalidación (DGAIR) y la Dirección General del Bachillerato (DGB) otorgan validez oficial a aquellos estudios realizados fuera del Sistema Educativo Nacional, siempre y cuando sean equiparables con estudios realizados dentro de dicho sistema.» | `G-22` |
| `G-38` | Documentos/Trámites (10) | 11 | `definition` | «Equivalencia de estudios: Trámite mediante el cual la DGAIR declara equiparables entre sí los estudios realizados en una institución dentro del Sistema Educativo Nacional con un plan de estudios afín al de la Universidad.» | `G-22` |
| `G-39` | Documentos/Trámites (10) | 10 | `definition` | «Certificado de estudios (antecedente académico): Documento oficial que acredita el nivel educativo inmediato anterior al que el alumno desea ingresar dentro de la institución, el cual es un requisito obligatorio para integrar el expediente escolar y realizar el registro oficial.» | `G-18` |
| `G-40` | Temporalidad (29) | 30 | `definition` | «Nivel educativo… Máster: para México, un alumno que ha concluido su licenciatura y no cuenta con uno o más de los documentos obligatorios para ingresar en Maestría puede inscribirse en Máster para iniciar con el plan de estudios y posteriormente realizar el Cambio de Campus a Maestría.» | `D53-12` |

### 13.1 Erratas del Glosario preservadas

| ID | Ubicación | Errata | Tratamiento |
|---|---|---|---|
| `ERR-G-01` | p.24, «Decisión en la solicitud» | Declara «cuatro decisiones» y enumera **cinco** (ACEPTADO, RECHAZADO, VUELTA A VENTA, CANCELADO, PREADMITIDO) | Se preserva. El conjunto de 5 se toma de la enumeración, que es la parte operativa. No se infiere cuál es el error. |
| `ERR-G-02` | p.29, «Bloque» y «Jornada académica» | «duración de cada bimestre» = 7+6+4+9 = **26 semanas**, incompatible con «Ciclo … 14 semanas» (`G-29`) del mismo documento. «Jornada académica» cuenta 2–4 asignaturas **por cuatrimestre**, mientras el bimestre tiene 4 bloques | Se preserva. `XDC-04`. **No** se normaliza a 14 ni se descarta. |

**No existe** en el Glosario definición de «invasión de ciclo» ni de «deserción».
Verificado por búsqueda de cadenas: 0 coincidencias. Esto **no** contradice al
primario, que define «invasión de ciclo» en su propia §3 (p.1, `N-06`); corrige
la premisa de `AMB-EXT-01` de Phase 1, que suponía esa dependencia.

## 14. Fuente 2 — Procedimiento D53 (`D53-##`)

SHA-256 `49c30482…7c383` · 8 páginas · versión 1 · publicación 08/09/2025.
Invocado por el primario §10 (p.22). Dueño de proceso: Planning de Negocio (§4, p.2).

| ID | Sección | p. | Tipo | Enunciado | Enlace |
|---|---|---|---|---|---|
| `D53-01` | 5.1.1 | 2 | `scope` | «Solo aplica para estudiantes de nuevo ingreso (tipo regular o dictamen técnico). No aplica para: Reingresos. Equivalencias. Revalidación.» | `G-01`, `G-22` |
| `D53-02` | 5.1.2 | 2 | `requirement` | «La gestión del documento será responsabilidad de Back Office desde el momento de la venta hasta el viernes anterior a la fecha de inicio de clases.» | `D53-03` |
| `D53-03` | 5.1.3 | 2 | `requirement` | «A partir del viernes anterior al inicio de clases, la responsabilidad pasa a Éxito Estudiantil.» | `D53-02` |
| `D53-04` | 5.1.4 | 3 | `temporal` | «Los estudiantes bajo la modalidad D53 cuentan con un plazo máximo de 6 meses, o hasta alcanzar el 50% de avance curricular, para entregar su certificado; de no cumplir con este requisito, deberán ser dados de baja.» | `XDC-04` |
| `D53-05` | 5.1.5 | 3 | `temporal` | «La regla del 50% de avance curricular no es fija y se pretende reducirla de manera parcial hasta lograr el objetivo de establecer un plazo máximo de 6 meses para proceder con la baja, en caso de que el alumno no entregue su certificado.» | `AMB-TEM-07` |
| `D53-06` | 5.1.6 | 3 | `temporal` | «Para estudiantes de México tras aceptar los términos y condiciones, y no completen la entrega de su documentación en un plazo máximo de 6 meses desde su ingreso, será dado de baja.» | `XDC-03` |
| `D53-07` | 5.1.7 | 3 | `requirement` | «Para estudiantes de Latam deben cargar obligatoriamente una carta compromiso en la que se compromete a completar su expediente; si no cumple con este requisito en un plazo máximo de 6 meses, será dado de baja.» | `XDC-02` |
| `D53-08` | 5.1.8 | 3 | `exception` | «La decisión D53 se mantiene sin cambios, incluso si el estudiante entrega su documento; en ese caso, únicamente se actualiza su clasificación a "D53 con expediente completo".» | `G-18` |
| `D53-09` | 5.1.9 | 3 | `definition` | «No se considera reingreso si el estudiante entrega el documento dentro del mismo bimestre en que se realizó el cierre de aula; solo se clasifica como reingreso cuando la entrega ocurre después de ese periodo.» | `G-11` |
| `D53-10` | 5.2.2 | 4 | `temporal` | «Identificar a los estudiantes que hayan superado el 50% de avance curricular e iniciar el proceso de cierre de aula. Si al finalizar el bimestre no se ha logrado recolectar el expediente completo, se deberá proceder con la baja definitiva del estudiante.» | `D53-04` |
| `D53-11` | 5.2.3 | 4 | `temporal` | «Las aulas se cierran el miércoles de la semana 3 del bimestre. Se aplican bajas a los alumnos cuyos documentos no fueron recolectados al cierre del bimestre.» | `G-26`, `XDC-04` |
| `D53-12` | 5.3.2 | 5 | `requirement` | «Cuando el estudiante no cuente con su expediente completo al momento de la inscripción, el asesor podrá gestionar una carta compromiso que deberá cumplir con las siguientes condiciones: Estar firmada de forma manuscrita, en tinta azul. Incluir una fecha límite para la entrega del documento, no mayor a 6 meses. Ser cargada en SIU antes de formalizar la inscripción.» | `XDC-02` |
| `D53-13` | 5.3.2.1 | 5 | `requirement` | «En el caso de los estudiantes de México, el compromiso de entregar su documentación en un plazo no mayor a seis meses se establece mediante la aceptación de los términos y condiciones en SIU al momento de su inscripción.» | `D53-07`, `XDC-02` |
| `D53-14` | 5.3.3 | 5 | `requirement` | «El asesor debe informar al prospecto sobre las implicaciones de ingresar con decisión 53, especialmente sobre el plazo máximo para regularizar su expediente y la posibilidad de baja automática.» | `D53-01` |
| `D53-15` | 5.2.3 (1.1.1) | 4 | `procedure` | «En caso de detectar alguna inconsistencia en el documento, este debe ser clasificado como posible apócrifo, y el área de gestoría interna debe iniciar el proceso de dictaminación externa con la dependencia que lo expidió.» | `G-36` |
| `D53-16` | 5.4.1 | 6 | `condition` | «El descuento en la comisión del asesor de ventas solo aplicará cuando haya cancelación de venta o la baja del estudiante ocurra durante el primer bimestre. A partir del tercer mes, si el alumno no completa su documentación, no se aplicará ningún descuento.» | `XDC-01` |
| `D53-17` | 5.4.1.1 | 6 | `definition` | «Una cancelación de venta se aplica cuando el estudiante es dado de baja durante el primer mes de ingreso por motivos ajenos a la decisión D53.» | `XDC-01` |
| `D53-18` | 5.4.1.2 | 6 | `exception` | «El descuento a la comisión aplica sin importar la causa de la baja si el alumno ingresó con D53, incluso si se retira por motivos personales, económicos o familiares.» | `D53-16` |
| `D53-19` | 5.4.2 | 6 | `requirement` | «A los gestores de venta que causen baja contractual de la universidad y tengan ventas D53 pendientes, se les descontará del finiquito la comisión previamente otorgada por dichas ventas.» | `D53-16` |
| `D53-20` | 5.4.3 | 6 | `procedure` | «El monto descontado depende de cómo fue comisionada la venta: Si se comisionó como "venta parcial" (50%), se descuenta solo ese 50%. Si se comisionó como venta completa, se descuenta el 100%.» | `D53-16` |
| `D53-21` | 2 (Alcance) | 1 | `scope` | «El proceso abarca desde la asignación de la decisión D53 hasta la posible cancelación o baja del estudiante, aplicando descuentos a las comisiones de ventas cuando sea necesario. Este procedimiento es aplicable en México y Latam.» | `G-20` |
| `D53-22` | 5.1.10 | 4 | `procedure` | «Para la visualización y monitoreo de las áreas involucradas, se cuenta con un dashboard del proceso… Anexo 2. Dashboard D53.» | `DEFERRED` |
| `D53-23` | 5.2.1 | 4 | `requirement` | «Es responsable de validar los documentos obligatorios, asegurando que cumplan con los requisitos establecidos en las reglas de revisión del Anexo 1. Validación de documentos Utel.» | `DEFERRED` |
| `D53-24` | 5.3.1 | 5 | `requirement` | «El asesor debe dar prioridad a obtener desde el inicio la documentación obligatoria completa, utilizando la decisión D53 únicamente como una medida excepcional y de último recurso.» | `D53-01` |
| `D53-25` | 5.1 | 1 | `requirement` | «En el siguiente link encontrarás el glosario con el listado de definiciones.» → archivo adjunto visible en p.2: «GLOSARIO DE OPERACIÓN ESCOLAR» | `G-##` |

**Nota de numeración:** el apartado `5.2.3` contiene un inciso numerado `1.1.1`
(secuencia interna del documento, no un error de transcripción). Se preserva la
etiqueta tal cual aparece.

## 15. Estadísticas del inventario ampliado

| Métrica | Phase 1 | Phase 1.5 |
|---|---|---|
| Enunciados del primario (`N-##`) | 139 | 139 (sin cambios) |
| Enunciados del Glosario (`G-##`) | — | 40 |
| Enunciados de D53 (`D53-##`) | — | 25 |
| **Total enunciados inventariados** | **139** | **204** |
| Fuentes normativas bloqueadas | 1 | **3** |
| Páginas leídas | 26 | **64** (26 + 8 + 30) |
| Ambigüedades | 28 | 28 re-clasificadas + 5 conflictos + 3 nuevas |
| Conflictos entre documentos | 0 | **8** (`XDC-01`…`XDC-08`) |
| Erratas del original preservadas | 9 | **11** (9 + `ERR-G-01` + `ERR-G-02`) |

> Los conteos por tipo de la columna Phase 1 fueron verificados por parsing en
> Phase 1 y **no se recalcularon**: la adición de fuentes no altera el conteo del
> primario. Los conteos `G-##` (40) y `D53-##` (25) fueron verificados por parsing
> sobre las filas añadidas.
