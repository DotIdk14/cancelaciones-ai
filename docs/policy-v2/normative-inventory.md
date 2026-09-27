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
