# Catálogo de Hechos — GDM_GAM_PRD_MLG_003 v5

**Fase:** Decision Tree Phase 1 — Extracción normativa
**Fuente:** `GDM_GAM_PRD_MLG_003` v5, `14/09/2026`, SHA-256 `71faf646…96c7d2`
**Estado:** `FACT_CATALOG_COMPLETE` (diseño; sin implementación de motor)

---

## 0. Principio rector: hechos ≠ condiciones

Este catálogo separa **dos capas** que el motor retirado mezclaba:

| Capa | Qué es | Quién lo produce | Dónde vive |
|---|---|---|---|
| **Hecho** (`fact`) | Un hecho atómico, observable y verificable extraído de la evidencia | IA / extracción (`AI_EXTRACTS`) | Evidencia con procedencia |
| **Condición** (`condition`) | Una expresión normativa que combina hechos con umbrales y ventanas | Motor normativo (`POLICY_ENGINE_DECIDES`) | Base normativa |

**Regla dura:** la IA **no** decide. Clasifica, transcribe y estructura. Un hecho
nunca lleva el desenlace. Una condición nunca se "extrae" de la IA.

**Regla dura:** `UNKNOWN_IS_NOT_FALSE`. Todo hecho tiene tres estados:

- `TRUE` — hay evidencia positiva y verificable
- `FALSE` — hay evidencia negativa y verificable
- `UNKNOWN` — no hay evidencia suficiente en ninguna dirección

`UNKNOWN` **nunca** colapsa a `FALSE`. La ausencia de evidencia es
`UNKNOWN`, y `UNKNOWN` se propaga al agregador.

---

## 1. Anatomía de un hecho

```ts
interface NormativeFactV1 {
  id: string;                    // estable, derivado del tipo de evidencia
  label: string;                 // descripción en español
  valueKind: 'boolean' | 'count' | 'date' | 'enum' | 'text' | 'percentage';
  unit?: string;                 // 'llamadas', 'interacciones', 'días'
  // Procedencia obligatoria: un hecho sin procedencia no es utilizable
  provenance: {
    evidenceRef: string;         // id de la evidencia que lo sustenta
    sourceSystem: 'I6' | 'Inconcert' | 'SIU' | 'Flokzu' | 'Jira' | 'AulaVirtual'
                                | 'OficinaVirtual' | 'Telefonia' | 'CRM' | 'otro';
    observedAt: string;          // ISO-8601
    extractedBy: 'ai' | 'humano';
  };
  evaluation: 'TRUE' | 'FALSE' | 'UNKNOWN';
  unknownReason?: string;        // obligatorio si evaluation === 'UNKNOWN'
}
```

**Invariante:** `evaluation === 'UNKNOWN'` **exige** `unknownReason`. No se
permite `UNKNOWN` sin motivo explícito, porque un `UNKNOWN` sin causa es
indistinguible de un bug de extracción.

---

## 2. Códigos de Sentinel y su semántica

Para distinguir «no aplica» de «no se sabe», el catálogo define centinelas
explícitos. Esto es lo que impide que `UNKNOWN` se degrade a `FALSE`:

| Centinela | Significado | Ejemplo |
|---|---|---|
| `NOT_APPLICABLE` | La condición no es pertinente a este caso | «intentos de contacto» cuando el caso es `5.11` falta de quórum, donde el estudiante nunca ingressó |
| `NOT_OBSERVED` | Se buscó la evidencia y no existe | No hay registro en I6 de la llamada de validación |
| `PENDING` | La gestión está en curso, aún no cumple ni incumple | Ticket Flokzu abierto hace 12 h dentro de la ventana de 72 h |
| `NOT_EXTRACTABLE` | La evidencia es inaccesible para la extracción | Audio en medio no oficial no cargado a sistemas oficiales (`N-51`) |

> `NOT_APPLICABLE` es el más delicado: se usa cuando la **norma** excluye el
> caso, no cuando falta información. Ejemplo normativo: `N-93` excluye los
> canales College y Upselling de la causal 5.9.a. En un caso College,
> `fact_error_servicios_escolares_d35` es `NOT_APPLICABLE`, no `UNKNOWN`.

---

## 3. Hechos temporales (ventanas como datos de primera clase)

El documento define muchas ventanas. Se modelan como **datos con cita**, nunca
como números sueltos en código (`rebuild-decision-tree-phase-1.md`, Task 3).

| Hecho | Descripción | Cita | Unidad |
|---|---|---|---|
| `F-ciclo_fecha_inicio` | Fecha de inicio de ciclo del estudiante | `5.3.a` p.4 | fecha |
| `F-fecha_solicitud` | Fecha de la solicitud de cancelación | `5.1.d` p.3 | fecha |
| `F-dias_desde_inicio` | Días transcurridos desde el inicio de ciclo hasta la solicitud | derivado de `5.3.c` p.5 | días |
| `F-semana_ciclo` | Semana de ciclo en que se ubica la solicitud (1 o 2) | `5.2.c` p.3 | enum |
| `F-dentro_ventana_2_semanas` | ¿La solicitud cae en las primeras 2 semanas tras el inicio? | `N-15` p.3 | boolean |
| `F-antes_del_inicio` | ¿La solicitud es previa a la fecha de inicio? | `N-27` p.4 | boolean |
| `F-dia_semana_solicitud` | Día de la semana de la solicitud (lun–dom) | `N-29` p.4 | enum |
| `F-habil_1_20_dias` | ¿Transcurridos 1–20 días desde el inicio? | `N-35` p.5 | boolean |
| `F-mas_20_dias` | ¿Transcurridos más de 20 días desde el inicio? | `N-35` p.5 | boolean |
| `F-dentro_semana_3` | ¿Dentro de la semana 3 posterior al inicio? | `N-103` p.17 | boolean |
| `F-antes_domingo_semana_2` | ¿Antes del domingo de la semana 2? | `N-68` p.12 | boolean |

### 3.1 Conflictos temporales que el motor NO puede resolver solo

| Constantes en conflicto | Cita | Efecto |
|---|---|---|
| `2 semanas` post-inicio | `N-15` p.3 | límite de solicitud de CV |
| `primer domingo del inicio del ciclo` | `N-29` p.4 | límite de solicitud cuando hay D35/D53 |
| `20 días` post-inicio | `N-35` p.5 | toda solicitud → baja |
| `domingo de la semana dos` | `N-68` p.12 | límite de ilocalizable |
| `semana 3` post-inicio | `N-103` p.17 | cierre financiero, estatus inmutable |
| `30 días hábiles` post-inicio | `N-07` p.2 | definición de deserción (glosario) |
| `30 días` post-inicio | `N-114` p.18 | definición de deserción (indicador) |

**Ninguno de estos siete umbrales coincide con los demás.** El motor **no**
elige entre ellos. Ver `AMB-TEM-01`…`AMB-TEM-05` y la tabla de prevalencia en
`decision-tree.md`. La resolución requiere decisión del Owner.

---

## 4. Hechos de recuento y umbral

Todos los umbrales numéricos del documento, con su cita. **Ninguno se escribe
como constante en código.**

| Hecho | Descripción | Umbral normativo | Cita |
|---|---|---|---|
| `F-llamadas_realizadas` | Llamadas telefónicas realizadas por EE | 16 mínimo en 2 semanas | `N-18` p.3 |
| `F-llamadas_por_dia` | Llamadas por día | ≥2 diarias, horarios distintos, ≥6 h de diferencia | `N-18` p.3 |
| `F-interacciones_escritas` | Interacciones por medios escritos | 6 mínimo en 2 semanas | `N-19` p.3 |
| `F-distribucion_semana_1` | % de interacciones en semana 1 | 70 % | `N-20` p.3 |
| `F-distribucion_semana_2` | % de interacciones en semana 2 | 30 % | `N-20` p.3 |
| `F-llamadas_rango_estudiante` | Llamadas/día para ingreso posterior al inicio hasta miércoles de semana 1 | 3 mínimo por día | `N-22` p.4 |
| `F-marcaciones_colapsadas` | Llamadas en mismo lapso, contadas como una | 2+ = 1 interacción | `N-21` pp.3→4 |
| `F-cobertura_agente` | % de cobertura asignado al agente B1 | definido por EE | `N-25` p.4 |
| `F-ingresos_plataforma` | Ingresos a la plataforma en fechas distintas | 3 mínimo | `N-70` p.12 |
| `F-permanencia_minima` | Permanencia por acceso (licenciaturas) | 10 minutos | `N-70` p.12 |
| `F-asignaturas_activas` | Asignaturas activas del estudiante | ≥1 para aplicar contraevidencia | `N-74` p.13 |
| `F-meses_desde_inscripcion` | Meses desde la inscripción (para SLA de evidencias) | 90 días (corte) | `N-121` p.20 |
| `F-devengo_1_mes` | ¿Devengó un mes de servicio? | 20 días | `N-35` p.5 |
| `F-porcentaje_paquete` | % del paquete de venta confirmado en la llamada | 100 % | `N-101` p.17 |
| `F-calificaciones_bimestre_1` | ¿Tiene calificaciones en bimestre 1? | cualquier = baja | `N-64` p.11 |
| `F-creditos_acreditados` | % de créditos avalados | 100 % | `N-66` p.12 |
| `F-quorum_no_alcanzado` | ¿El programa no alcanzó el mínimo de estudiantes? | sí/no | `N-106` pp.17→18 |

### 4.1 `F-marcaciones_colapsadas` — el umbral que el documento no fija

`N-21` (pp.3→4) dice: «2 o más llamadas en un mismo lapso de tiempo **o con el
intervalo de tiempo corto establecido para este efecto**». El documento **no
establece** ese intervalo. `N-18` da 6 h de separación para el cómputo normal de
llamadas, pero `N-21` usa un umbral distinto y no(numérico). El motor **no puede
asumir 6 h**. Se registra `AMB-NUM-02`: el valor del intervalo requiere decisión
del Owner. Hasta entonces `F-marcaciones_colapsadas` es `UNKNOWN` salvo que la
evidencia permita contar por otros medios.

---

## 5. Hechos de estado y estatus

| Hecho | Descripción | Valores posibles | Cita |
|---|---|---|---|
| `F-estatus_estudiante` | Estatus del alumno | enumerable (por definir) | `N-26` p.4 |
| `F-tiene_decision_35` | ¿Cuenta con D35? | sí/no/desconocido | `N-31` p.5 |
| `F-tiene_decision_53` | ¿Cuenta con D53? | sí/no/desconocido | `N-67` p.12 |
| `F-decision_tiempo_forma` | ¿D35/D53 en tiempo y forma? | sí/no | `N-31` p.5 |
| `F-d35_posterior_al_inicio` | ¿D35/D53 proporcionada después del inicio? | sí/no | `N-29` p.4 |
| `F-ciclo_revalidacion_equivalencia` | ¿Estudiante con revalidación o equivalencia? | sí/no | `N-39` p.6 |
| `F-bloques_intermedios` | ¿Inscrito en bloques intermedios? | sí/no | `N-39` p.6 |
| `F-proceso_bienvenida_realizado` | ¿Se realizó el proceso de bienvenida? | sí/no | `N-38` p.6 |
| `F-ingreso_aula_regular` | ¿Ingresó al aula regular? | sí/no | `N-38` p.6 |
| `F-fue_contactado` | ¿Fue contactado? | sí/no | `N-38` p.6 |
| `F-nivel_academico` | Nivel (Licenciatura, Posgrado, Ejecutiva, Alianza, Diplomado) | enum | `N-70`…`N-73` pp.12→13 |
| `F-pais_venta` | País de la venta | MX / LATAM | `N-04` p.1, `N-56` pp.9→10 |
| `F-canal_venta` | Canal de venta | MysteryShopper / College / Upselling / otro | `N-93` p.16, `N-105` p.17 |
| `F-tipo_ajuste` | Tipo de ajuste solicitado | programa / paquete / ciclo / campus | `N-37` p.6 |
| `F-ajuste_por_error_inscripcion` | ¿Ajuste por error de inscripción? | sí/no | `N-36` pp.5→6 |

---

## 6. Hechos de evidencia y trazabilidad

Estos son los hechos que el motor utiliza para decidir, y que dependen
directamente de la existencia de evidencia. Son el corazón de
`UNKNOWN_IS_NOT_FALSE`.

| Hecho | Descripción | Cita |
|---|---|---|
| `F-evidencia_i6_registrada` | ¿Interacción registrada en CRM I6? | `N-51` p.8 |
| `F-evidencia_tipificaciones` | ¿Registrada en sistema de tipificaciones? | `N-50` p.8 |
| `F-speech_terminos_condiciones` | ¿Speech incluye comunicación de términos y condiciones? | `N-50` p.8 |
| `F-evidencia_sistema_oficial` | ¿Evidencia almacenada en sistema oficial (Inconcert/autorizado)? | `N-51` p.8 |
| `F-evidencia_medio_no_oficial_cargada` | ¿Interacción por medio no oficial fue cargada después? | `N-51` p.8 |
| `F-evidencia_correo_personal` | ¿Evidencia compartida por correo personal? (prohibido) | `N-51` p.8 |
| `F-cierre_venta_mencion_documentacion` | ¿Mención de documentación física en cierre de venta? | `N-61` p.11 |
| `F-cierre_venta_mencion_equiv_reval` | ¿Mención de equivalencia/revalidación + pago en cierre? | `N-62` p.11 |
| `F-evidencia_flokzu_campo` | ¿Evidencia cargada en campo "Evidencias" de Flokzu? | `N-119` p.19 |
| `F-evidencia_captura_pantalla` | ¿Captura de pantalla adjunta (medio escrito)? | `N-118` p.19 |
| `F-evidencia_resultado_llamada` | ¿Resultado de llamada documentado? | `N-118` p.19 |
| `F-evidencia_bo_validacion` | ¿ antecedente de validación por BO? | `N-47` p.8 |
| `F-validacion_venta_completa` | ¿Validación de venta completa, sin incidencias? | `N-53` p.9 |
| `F-evidencia_bo_no_acredita_grado` | ¿BO determinó que no acredita grado previo? | `N-63` p.11 |
| `F-carta_manifiesto_firmada` | ¿Carta manifiesto con firma autógrafa y fecha? | `N-59` p.10 |
| `F-carta_manifiesto_fecha_compromiso` | ¿Existe fecha compromiso de entrega? | `N-59` p.10 |
| `F-estudiante_no_puede_entregar` | ¿Estudiante dice que no podrá entregar en plazo? | `N-60` p.11 |
| `F-evidencia_alternativa_reprogramacion` | ¿Se ofreció alternativa de reprogramación? | `N-110` p.18 |
| `F-estudiante_rechaza_alternativa` | ¿Rechaza la alternativa? | `N-111` p.18 |
| `F-grupo_no_abierto` | ¿El grupo no fue aperturado por falta de quórum? | `N-109` p.18 |
| `F-evidencia_ticket_jira` | ¿Incidencia con ticket Flokzu y/o Jira? | `N-97` p.16 |
| `F-canalizado_a_ee` | ¿Área operativa canalizó a Éxito Estudiantil? | `N-99` p.16 |
| `F-notificado_a_ee` | ¿Se notificó a Éxito Estudiantil? | `N-99` p.16 |
| `F-acciones_activacion_gm` | ¿GM realizó las 4 acciones de activación? | `N-79` p.14 |
| `F-traspaso_conferencia_a_ee` | ¿Se transfirió por conferencia a EE? | `N-76` p.13 |
| `F-causa_operativa_documentada` | ¿Existe causa operativa documentada del incumplimiento? | `N-91` p.15 |

### 6.1 Contacto efectivo (criterios `5.8.h`)

`N-83` (p.14) declara seis criterios. Se modelan **individualmente** porque
`N-69` (p.12) los usa como criterio de ilocalizable, y cada uno puede estar
satisfecho por separado.

| Hecho | Criterio | Cita |
|---|---|---|
| `F-ce_titular` | Contacto con el titular (registrado en la universidad) | `N-84` p.14 |
| `F-ce_medio` | Medio: escrito, llamada o bot | `N-84` p.14 |
| `F-ce_interaccion_relacionada` | Hubo respuesta, cuestionamiento, aclaración o seguimiento | `N-85` p.15 |
| `F-ce_objetivo_informado` | Se informó objetivo de la llamada y motivo | `N-86` p.15 |
| `F-ce_ciclo_informado` | Se informó ciclo de inicio | `N-87` p.15 |
| `F-ce_identidad_universidad` | Se identificó como contacto de la universidad | `N-87` p.15 |
| `F-ce_datos_confirmados` | Confirmó sus datos personales | `N-87` p.15 |
| `F-ce_decision_no_continuar` | Manifestó decisión de no continuar | `N-88` p.15 |

**Regla de agregación de contacto efectivo:** el documento **no** declara si los
seis criterios son `AND` u `OR`. `N-69` (p.12) introduce un criterio distinto y
**más laxo** (ingreso a Oficina Virtual **o** actividad académica), mientras
`5.8.h` (pp.14→15) detalla seis requisitos conversacionales. La relación entre
ambos bloques no está especificada. Registrado como `AMB-LOG-04`. El motor no
decide la conectiva.

### 6.2 Ingreso a aula por nivel — tres polaridades distintas

Este es el punto más delicado del catálogo, porque el documento usa la
**misma estructura sintáctica** para los cuatro niveles pero con polaridad
opuesta:

| Nivel | Enunciado | Condición que acredita contacto | Cita |
|---|---|---|---|
| Licenciaturas | «Haber seleccionado la modalidad de evaluación en al menos una asignatura activa» | **POSITIVA** (hay actividad) | `N-70` p.12 |
| Licenciaturas | «haber realizado al menos tres ingresos a la plataforma… 10 minutos» | **POSITIVA** (hay actividad) | `N-70` p.12 |
| Posgrados y Ejecutivas | «**No** haber registrado participación en foros en ninguna asignatura activa» | **NEGATIVA** (no hay actividad) | `N-71` pp.12→13 |
| Licenciaturas de alianzas | «**No** haber ingresado a ninguna asignatura activa» | **NEGATIVA** (no hay actividad) | `N-72` p.13 |
| Diplomados | «**No** haber registrado participación en foros en ninguna asignatura activa» | **NEGATIVA** (no hay actividad) | `N-73` p.13 |

**Consecuencia de diseño obligatoria:** un motor que implemente estas reglas con
una única bandera `actividad_academica` invertería el resultado en tres de los
cuatro niveles. Por eso cada nivel tiene **hechos separados** y la inversión de
polaridad está explícita en la definición, no en el código:

| Hecho | Polaridad | Cita |
|---|---|---|
| `F-actividad_posgrado` | `TRUE` = NO registró foros (es decir, ilocalizable) | `N-71` |
| `F-actividad_alianza` | `TRUE` = NO ingresó a asignatura (es decir, ilocalizable) | `N-72` |
| `F-actividad_diplomado` | `TRUE` = NO registró foros (es decir, ilocalizable) | `N-73` |
| `F-actividad_licenciatura` | `TRUE` = SÍ seleccionó modalidad / SÍ ingresó (es decir, localizado) | `N-70` |

Registrado como `AMB-LOG-02` (riesgo de inversión de polaridad). La
implementación futura debe exponer la polaridad en la definición del hecho, no
en un `if`.

### 6.3 `N-74` — contraevidencia de nivel superior

«Si el estudiante cursa varias asignaturas y en al menos una registra ingreso o
selección de modalidad (según corresponda a su nivel), **no aplica cancelación de
venta**» (p.13).

Este enunciado **anula** la causal de ilocalizable con una sola evidencia
positiva, cualquiera que sea el nivel. Precede a `5.8.a` en el texto y es
inequívoco. Se modela como `counterevidence` de prioridad alta, no como una
condición más.

---

## 7. Hechos de retención

El documento insiste en que la retención no es opcional. `N-33` (p.5) es la
regla más dura: **la falta de retención obliga a baja**, sin importar fecha ni
D35/D53.

| Hecho | Descripción | Cita |
|---|---|---|
| `F-retencion_realizada` | ¿Se ejecutó proceso de retención? | `N-32` p.5 |
| `F-retencion_por_ausencia` | Retención definida como: contacto para identificar motivos, atender objeciones, presentar alternativas académicas/administrativas/financieras | `N-33` p.5 |
| `F-estrategias_presentadas` | ¿Se presentaron estrategias acordes a la causa? | `N-32` p.5 |
| `F-alternativas_academicas` | ¿Se presentó alternativa académica? | `N-33` p.5 |
| `F-alternativas_administrativas` | ¿Se presentó alternativa administrativa? | `N-33` p.5 |
| `F-alternativas_financieras` | ¿Se presentó alternativa financiera? | `N-33` p.5 |
| `F-estudiante_acepta_estrategia` | ¿Aceptó las estrategias? | `N-32` p.5 |
| `F-cambio_ciclo_como_retencion` | ¿El cambio de ciclo se usó como estrategia de retención? | `N-40` p.6 |

### 7.1 La penalización por falta de retención

`N-34` (p.5): «se deberá aplicar la sanción correspondiente a ambas áreas por
incumplimiento del proceso». El documento **no especifica** la sanción, ni las
áreas (dice «ambas» sin nombrarlas en el inciso). Se registra como hecho
`F-sancion_aplicada` = `UNKNOWN` con `unknownReason: 'sanción no especificada en
la fuente'`. Registrado como `AMB-GAP-01`.

---

## 8. Hechos de promesa de venta no cumplida

| Hecho | Descripción | Cita |
|---|---|---|
| `F-promesa_informacion_erronea` | ¿Se proporcionó información errónea/falsa/tendenciosa/no alineada? | `N-45` p.7 |
| `F-promesa_por_operaciones_rh` | ¿Hubo actualización de producto sin capacitación/comunicación formal a Operaciones por RRHH? | `N-48` p.8 |
| `F-promesa_decision_explicita` | ¿El estudiante manifiesta explícitamente que su decisión deriva de promesas no cumplidas? | `N-46` p.8 |
| `F-promesa_rechaza_beneficios` | ¿Rechaza beneficios adicionales (retención o ajustes correctivos)? | `N-46` p.8 |
| `F-promesa_evidencia_externa` | ¿Evidencia externa (correo, audio, WhatsApp) prueba la promesa? | `N-57` p.10 |
| `F-promesa_por_bo_indujo_modalidad` | ¿GM indujo a seleccionar modalidad de evaluación? | `N-54` p.9 |
| `F-validacion_realizada_por_gv` | ¿Gestión de Validación realizó la interacción? | `N-50` p.8 |
| `F-latam_convalidacion_evidencia` | ¿Speech LATAM evidencia convalidación + contenido a México? | `N-56` pp.9→10 |

### 8.1 La condición más restrictiva del documento

`N-46` (p.8) exige **cuatro** cosas simultáneamente para promesa de venta:
1. información errónea acreditada (`N-45`)
2. decisión explícita del estudiante **derivada** de la promesa (`N-46`)
3. rechazo de beneficios adicionales (`N-46`)

Con Connectivas: `(1) AND (2) AND (3)`. Si cualquiera falla, la causal de
promesa no cumplida **no** aplica, y el caso puede caer en otra causal. Este es
el único lugar del documento donde la conjunción es explícita por estructura
gramatical («únicamente cuando… y además…»).

**Conflicto con `N-52`** (p.9): si no hay evidencias en sistemas oficiales, se
procede a CV bajo promesa no cumplida. `N-52` **no** exige los tres requisitos de
`N-46`. Es decir: `N-46` restringe, `N-52` expande. El documento no declara
relación. Registrado como `AMB-CON-03`.

---

## 9. Hechos de cancelación operativa

| Hecho | Descripción | Cita |
|---|---|---|
| `F-op_error_servicios_escolares_d35` | ¿BO/Servicios Escolares otorgó D35 a quien no cumple perfil? | `N-93` p.16 |
| `F-op_canal_no_excluido` | ¿El canal es College o Upselling? (excluye 5.9.a) | `N-93` p.16 |
| `F-op_error_finanzas` | ¿Error administrativo de Finanzas/Cobranza ajeno a inscripción? | `N-94` p.16 |
| `F-op_error_afectacion_experiencia` | ¿El error generó afectación en la experiencia del estudiante? | `N-94` p.16 |
| `F-op_incidencia_sistema` | ¿Hay incidencia en Aula Virtual / SIU / otro? | `N-95` p.16 |
| `F-op_incidencia_resuelta` | ¿La incidencia tiene evidencia (Flokzu y/o Jira)? | `N-97` p.16 |
| `F-op_incidencia_espresion_baja` | ¿El estudiante manifiesta desertar por la incidencia? | `N-98` p.16 |
| `F-op_falta_canalizacion` | ¿El área operativa no canalizó ni notificó a EE? | `N-99` p.16 |
| `F-op_error_seguimiento_ee` | ¿Error en seguimiento de EE o en solicitud vía Flokzu? | `N-100` p.17 |
| `F-op_discrepancia_paquete` | ¿Confirmación del paquete ≠ 100 % del documento de venta? | `N-101` p.17 |
| `F-op_error_es_asesor` | ¿El error es del proceso, no del asesor? | `N-101` p.17 |
| `F-op_error_validacion_bo` | ¿Error en validación de venta por BO? | `N-102` p.17 |
| `F-op_quorum_responsabilidad_gm` | ¿Gestión de quórum es responsabilidad de GM? | `N-107` p.18 |

### 9.1 `N-95` — la única `exception` que **desactiva** una causal

`N-95` (p.16) es la excepción más fuerte: «**No aplicará** la política
operativa de cancelación cuando la falta de activación, acceso o continuidad
del estudiante sea consecuencia de una incidencia identificada en el Aula
Virtual, SIU u otros sistemas». Es decir, una incidencia de sistema **desactiva**
`5.9` completa, y el caso se gestiona como retención/contención (`N-96`), salvo
que el estudiante exprese deserción, en cuyo caso es **baja** (`N-98`).

Este es un caso donde `UNKNOWN` es crítico: si no sabemos si hubo incidencia de
sistema, **no** podemos aplicar la operativa. `UNKNOWN` en `F-op_incidencia_sistema`
→ el caso **no** es CV operativa por falta de fundamento; y tampoco puede
declararse ajeno. Se resuelve `REQUIRES_HUMAN_REVIEW` o `REQUIRES_OWNER_DECISION`
según la política de la fase siguiente.

---

## 10. Hechos de cambio de ciclo (pp.6→7)

| Hecho | Descripción | Cita |
|---|---|---|
| `F-cambio_ciclo_gestionado_por` | ¿Quién gestiona? (GM / EE / otro) | `N-41`, `N-42` p.7 |
| `F-cambio_ciclo_antes_del_inicio` | ¿Se gestionó antes del inicio de clases? | `N-41` p.7 |
| `F-cambio_ciclo_vo_bo` | ¿Con Vo Bo (cambio especial)? | `N-40` p.6 |
| `F-cambio_ciclo_autorizado` | ¿El estudiante autorizó el cambio? | `N-39` p.6 |
| `F-cambio_ciclo_nuevo_no_ingresa` | ¿En el nuevo ciclo no ingresa? | `N-41`, `N-42` p.7 |
| `F-cambio_ciclo_no_localizable` | ¿En el siguiente ciclo no se logra localizar? | `N-41` p.7 |
| `F-cambio_ciclo_20_dias` | ¿Gestionado en fechas de 20 días? | `N-40` p.6 |
| `F-cambio_ciclo_desiste_nuevamente` | ¿Desiste de ingresar en el nuevo ciclo? | `N-78` p.13 |

`N-41` / `N-42` (p.7) forman el par condición/excepción:
- `F-cambio_ciclo_antes_del_inicio = TRUE` → **CV** (`N-41`)
- `F-cambio_ciclo_antes_del_inicio = FALSE` Y gestionado por EE → **retención, NO CV** (`N-42`)

---

## 11. Hechos de SLA y tiempos de respuesta

| Hecho | Descripción | Umbral | Cita |
|---|---|---|---|
| `F-sla_etapa` | Etapa actual de atención | enum | `N-123` p.20 |
| `F-sla_horas_acumuladas` | Horas hábiles acumuladas en la etapa | contador | `N-124` p.20 |
| `F-sla_recibida_habil` | ¿Recibida en día hábil? | sí/no | `N-127` p.20 |
| `F-sla_pausada` | ¿Pausada por información adicional? | sí/no | `N-130` p.21 |
| `F-sla_requiere_dictamen` | ¿Requiere dictaminación? (suma 48 h) | sí/no | `N-128` pp.20→21 |
| `F-ev_respuesta_mc` | Tiempo de respuesta de Mejora Continua | 24 h (<90d) / 72 h (>90d) | `N-121` p.20 |
| `F-ev_respuesta_ventas` | Tiempo de respuesta de Ventas | 24 h | `N-122` p.20 |

Los SLA son `temporal`/`procedure`, **no** condiciones de desenlace. No
participan en el árbol de decisión; participan en trazabilidad operativa.

---

## 12. Conteo y estado del catálogo

| Categoría | Cantidad |
|---|---|
| Hechos temporales (ventanas) — §3 | 11 |
| Hechos de recuento/umbral — §4 | 17 |
| Hechos de estado/estatus — §5 | 15 |
| Hechos de evidencia y trazabilidad — §6 (total) | 38 |
| — de los cuales contacto efectivo `5.8.h` — §6.1 | 8 |
| — de los cuales actividad por nivel — §6.2 | 4 |
| — de los cuales contraevidencia `N-74` — §6.3 | 1 |
| Hechos de retención — §7 | 8 |
| Hechos de promesa de venta — §8 | 8 |
| Hechos de cancelación operativa — §9 | 13 |
| Hechos de cambio de ciclo — §10 | 8 |
| Hechos de SLA, no decisionales — §11 | 7 |
| **Total hechos decisionales** (excluye §11) | **118** |
| **Total hechos definidos** | **125** |
| Hechos referenciados solo en prosa (`F-sancion_aplicada`) | 1 |
| **Total identificadores `F-` en el documento** | **126** |

> Conteos verificados por parsing sobre las filas de tabla. Los 7 hechos de SLA
> se declaran no decisionales de forma explícita para que la fase siguiente no
> los convierta en condiciones por error. Cada hecho decisional tiene al menos
> una cita `N-xx` que lo origina.

---

## 13. Reglas de conexión (declaradas, no inventadas)

Estas reglas se documentan aquí para que la fase siguiente las implemente
literalmente. No son invenciones: son la estructura lógica que el texto declara
o que deja indeterminada (marcada).

| Regla | Connectiva | Soporte textual | Estado |
|---|---|---|---|
| `N-46` promesa | `(A) AND (B) AND (C)` | «únicamente cuando… y además rechace» | explícita |
| `N-68` ilocalizable | `NOT(contacto_efectivo) AND (dentro_ventana)` | «cuando no se logre establecer ningún contacto… hasta la segunda semana» | explícita |
| `N-74` contraevidencia | `IF actividad_en_alguna_asignatura THEN NOT CV` | «en al menos una… no aplica CV» | explícita |
| `N-75` contraevidencia | `IF cualquier_contacto THEN NOT ilocalizable` | «si existe cualquier contacto… no se considerará» | explícita |
| `N-33` falta de retención | `IF NOT retencion THEN baja` | «en caso de no realizarse… deberá gestionarse como baja» | explícita |
| `N-99` falta de canalización | `IF NOT (canalizado OR notificado) THEN CV_operativa` | «en caso de que no realice… se considerará» | explícita |
| `N-80` falta de activación GM | `IF NOT acciones_gm THEN CV` | «si el área… no realiza estas acciones, aplicará como CV» | explícita |
| `N-91` incumplimiento EE | `IF (NOT interacciones) AND (NOT causa_documentada) THEN NO_acreditado` | «y no exista una causa operativa… no podrá considerarse acreditado» | explícita |
| `N-64` devengo | `IF calificaciones_bim1 THEN baja (always)` | «por ningún motivo podrá ser considerado como CV» | explícita |
| `5.8.h` contacto efectivo | `?` | seis criterios, sin conectiva declarada | **INDETERMINADA** → `AMB-LOG-04` |
| Prevalencia entre `N-46` y `N-52` | `?` | ambos «aplican» / «no aplica» | **INDETERMINADA** → `AMB-CON-03` |
| Prevalencia entre `N-33` y `N-27` | `?` | uno dice CV, otro baja | **INDETERMINADA** → `AMB-CON-01` |
| Escalamiento `5.6.f` | `?` | `N-57` vs `N-58` rutas distintas | **INDETERMINADA** → `AMB-CON-02` |
| Umbral de colapso de llamadas | `?` | intervalo no especificado | **INDETERMINADA** → `AMB-NUM-02` |

Las reglas marcadas **INDETERMINADA** son las que la fase siguiente debe
escalar como `REQUIRES_OWNER_DECISION`. El motor **no** las resuelve por
defecto, por default, ni por la lectura más plausible.

# Phase 1.5 — Hechos derivados de las fuentes de apoyo

> **Phase 1 preservado.** Los `F-##` de §3–§11 describen el primario y **no se
> modifican**. Los IDs siguientes son nuevos y trazan a `G-##` / `D53-##`.
>
> **Regla de evidencia mantenida:** un hecho de evidencia puede probar un hecho
> que una regla normativa exige. La evidencia **nunca** crea ni completa una regla.
> Ningún hecho de esta sección axioma una regla. Si un hecho no está sustentado por
> evidencia, queda `UNKNOWN` y la rama que lo consume no puede cerrarse.

## 14. Hechos de identidad y estatus documental (Glosario)

| Hecho | Nombre | Tipo | Fuente | Regla que lo origina | Valores / dominio | Unknown |
|---|---|---|---|---|---|---|
| `F2-es_nuevo_ingreso` | Primera vez registrado en un plan de estudios | `derived` | `G-01` (p.6) | Glosario, Definición de alumno de nuevo ingreso | `TRUE` / `FALSE` / `UNKNOWN` | `UNKNOWN` si SIU no lo expone |
| `F2-es_alumno_futuro` | Inscrito con expediente digital en SIU y en espera de fecha de inicio | `derived` | `G-02` (p.6) | Glosario, Definición de alumno futuro | `TRUE` / `FALSE` / `UNKNOWN` | `UNKNOWN` |
| `F2-es_alumno_ma` | Persona inscrita con matrícula vigente (cuenta con decisión 35) | `derived` | `G-05` (p.6) | Glosario, Definición de alumno (MA) | `TRUE` / `FALSE` / `UNKNOWN` | `UNKNOWN` |
| `F2-estatus_alumno_regular` | Documentación completa ∧ al corriente de colegiaturas ∧ sin reprobar ∧ sin baja previa | `derived` | `G-03` (p.6) | Glosario, Definición de alumno regular | `TRUE` / `FALSE` / `PARTIAL` / `UNKNOWN` | `PARTIAL` si solo se conoce 1–3 de las 4 condiciones |
| `F2-estatus_alumno_irregular` | No entregó documentos ∧ cuenta con adeudo ∧ ha reprobado ∧ ha solicitado baja en su vida universitaria | `derived` | `G-04` (p.6) | Glosario, Definición de alumno irregular | `TRUE` / `FALSE` / `PARTIAL` / `UNKNOWN` | `PARTIAL` si solo se conoce 1–3 de las 4 condiciones |
| `F2-decision_35` | Decisión 35 / ACEPTADO | `raw` | `G-18` (p.24) | Glosario, Decisión en la solicitud | `ACEPTADO` / `RECHAZADO` / `VUELTA_A_VENTA` / `CANCELADO` / `PREADMITIDO` / `UNKNOWN` | `UNKNOWN` si no hay decisión en SIU |
| `F2-decision_53_preadmitido` | PREADMITIDO: falta el antecedente académico del nivel anterior; etiqueta SIU «EN VALIDACIÓN» | `derived` | `G-18` (p.24) | Glosario, Decisión en la solicitud | `TRUE` / `FALSE` / `UNKNOWN` | `UNKNOWN` |
| `F2-tipo_ingreso` | Forma en que acredita su nivel de estudios previo | `raw` | `G-22` (p.28) | Glosario, Tipo de ingreso | `REGULAR` / `EQUIVALENCIA` / `REVALIDACION` / `DICTAMEN_TECNICO` / `UNKNOWN` | `UNKNOWN` |
| `F2-carta_compromiso_vencimiento` | Fecha límite comprometida para entregar el expediente escolar | `raw` | `G-19` (p.24) | Glosario, Carta compromiso | `DATE` / `UNKNOWN` | `UNKNOWN` |
| `F2-campus` | Unidad de configuración que diferencia reglas por país de residencia | `raw` | `G-20` (p.24) | Glosario, Campus | `MEXICO` / `LATAM` / `UNKNOWN` | `UNKNOWN` |

**Conector crítico en `F2-estatus_alumno_regular` e `F2-estatus_alumno_irregular`:
ambos son conjunciones de 4 condiciones.** La fuente usa «y» de forma
enumerativa. La lectura `AND` de las cuatro es la que el texto sostiene; **cualquier
atribución de `OR` sería inventada**. Aun así, si solo se conocen 3 de 4
condiciones el valor es `PARTIAL`, no `FALSE`
(`UNKNOWN_IS_NOT_FALSE`).

**`F2-campus` es el único hecho que fundamenta la bifurcación México/LATAM del
árbol.** El Glosario establece que *existe* una unidad de configuración que
diferencia reglas por país, pero **no** declara qué reglas difieren. La
diferencia concreta se toma de `D53-06`/`D53-07` y `D53-12`/`D53-13`, que sí la
declaran. `AMB-CON-05` permanece abierta para el resto de ramas.

## 15. Hechos temporales de la baja documental (D53 + Glosario)

| Hecho | Nombre | Tipo | Fuente | Regla que lo origina | Valores / dominio | Unknown |
|---|---|---|---|---|---|---|
| `F2-d53_meses_desde_ingreso` | Meses transcurridos desde el ingreso | `derived` | `D53-06` (p.3) | D53 5.1.6 | `0..N` | `UNKNOWN` si no hay fecha de ingreso |
| `F2-d53_50_avance` | Porcentaje de avance curricular | `derived` | `D53-04` (p.3), `D53-10` (p.4) | D53 5.1.4, 5.2.2 | `0..100` | `UNKNOWN` |
| `F2-d53_supera_50` | ¿Superó el 50% de avance curricular? | `derived` | `D53-10` (p.4) | D53 5.2.2 | `TRUE` / `FALSE` / `UNKNOWN` | `UNKNOWN` |
| `F2-d53_expediente_completo` | Expediente escolar completo | `derived` | `D53-10` (p.4), `G-23` (p.26) | D53 5.2.2, Glosario Expediente escolar | `TRUE` / `FALSE` / `UNKNOWN` | `UNKNOWN` |
| `F2-d53_bimestre_cierre_superado` | ¿Se cerró el bimestre sin expediente completo? | `derived` | `D53-10` (p.4) | D53 5.2.2 | `TRUE` / `FALSE` / `UNKNOWN` | `UNKNOWN` |
| `F2-cierre_aula_3a_semana_bimestre` | Cierre de aula: miércoles de la semana 3 del bimestre | `temporal` | `D53-11` (p.4) | D53 5.2.3 | `DATE` | `UNKNOWN` |
| `F2-baja_falta_docs_6meses` | 6 meses desde el inicio del primer ciclo académico | `temporal` | `G-08` (p.6) | Glosario, Baja por falta de documentos | `DATE` | `UNKNOWN` |
| `F2-bti_2_periodos_sin_aula` | No ingresó al Aula Virtual durante 2 periodos previos | `derived` | `G-09` (p.6) | Glosario, Baja por inactividad (BTI) | `TRUE` / `FALSE` / `UNKNOWN` | `UNKNOWN` |
| `F2-ciclo` | Sufijo de ciclo: 41 (sep-dic), 42 (ene-abr), 43 (may-ago); 14 semanas | `raw` | `G-29` (p.29) | Glosario, Ciclo | `41` / `42` / `43` / `UNKNOWN` | `UNKNOWN` |
| `F2-periodo` | Parte bimestral de un ciclo | `derived` | `G-30` (p.30) | Glosario, Periodo | `DATE_RANGE` / `UNKNOWN` | `UNKNOWN` |

### 15.1 Anclajes de reloj que NO coinciden entre documentos

Los dos plazos de 6 meses **no comparten anclaje**:

| Regla | Anclaje textual | Hecho de reloj |
|---|---|---|
| `G-08` (p.6) | «6 meses posteriores al **inicio del primer ciclo académico**» | `F2-baja_falta_docs_6meses` |
| `D53-06` (p.3) | «6 meses **desde su ingreso**» | `F2-d53_meses_desde_ingreso` |

Para un alumno D53 que se reinscribe a mitad de ciclo o cambia de ciclo
(`N-28`…`N-33`), los dos relojes **no coinciden**. Se conservan ambos como
hechos separados y **no** se unifican → `XDC-03`.

## 16. Hechos de la carta compromiso — dos instrumentos, tres plazos

| Hecho | Nombre | Tipo | Fuente | Regla | Valores | Unknown |
|---|---|---|---|---|---|---|
| `F2-cc_firmada_manuscrita_tinta_azul` | Carta firmada a mano en tinta azul | `raw` | `D53-12` (p.5) | D53 5.3.2 | `TRUE` / `FALSE` / `UNKNOWN` | `UNKNOWN` |
| `F2-cc_cargada_siu_antes_inscripcion` | Carta cargada en SIU antes de formalizar la inscripción | `raw` | `D53-12` (p.5) | D53 5.3.2 | `TRUE` / `FALSE` / `UNKNOWN` | `UNKNOWN` |
| `F2-cc_termino_meses` | Plazo comprometido | `raw` | `G-19` (p.24) vs `D53-12` (p.5) | Glosario Carta compromiso / D53 5.3.2 | `2` (Glosario) / `<=6` (D53) / `UNKNOWN` | `UNKNOWN` |
| `F2-cc_obligatoria_latam` | Carta compromiso obligatoria para LATAM | `requirement` | `D53-07` (p.3) | D53 5.1.7 | `TRUE` para `LATAM` | n/a |
| `F2-cc_mecanismo_mexico` | Compromiso en México = aceptación de T&C en SIU | `requirement` | `D53-13` (p.5) | D53 5.3.2.1 | `T_AND_C` para `MEXICO` | n/a |
| `F2-cc_acepta_tc` | Aceptó Términos y Condiciones en SIU | `raw` | `D53-13` (p.5), `G-34` (p.24) | D53 5.3.2.1, Glosario Estatus de inscripción | `TRUE` / `FALSE` / `UNKNOWN` | `UNKNOWN` |

**`F2-cc_termino_meses` es el punto de conflicto `XDC-02`: el Glosario fija
«dos meses» y D53 fija «no mayor a 6 meses».** El dominio del hecho queda
**INDETERMINADO**; el motor no puede emitir un valor por defecto. Requiere
`OWNER_DECISION`.

**México y LATAM divergen de forma explícita y declarada** (`D53-07` vs
`D53-13`): en LATAM la carta compromiso es obligatoria; en México el compromiso se
establece por aceptación de T&C. Esta divergencia **está resuelta por la fuente** y
no requiere interpretación.

## 17. Hechos de retención — polaridad confirmada por la fuente

| Hecho | Nombre | Tipo | Fuente | Regla | Valores | Unknown |
|---|---|---|---|---|---|---|
| `F2-manifesto_baja` | El alumno manifestó su decisión de baja | `raw` | `G-14` (p.21) | Glosario, Proceso de retención | `TRUE` / `FALSE` / `UNKNOWN` | `UNKNOWN` |
| `F2-riesgo_de_baja` | Manifiesta posibilidad de retirarse sin solicitarlo | `raw` | `G-16` (p.21) | Glosario, Riesgo de baja | `TRUE` / `FALSE` / `UNKNOWN` | `UNKNOWN` |
| `F2-decide_continuar` | El alumno decidió continuar con su programa | `derived` | `G-15` (p.21) | Glosario, Retención | `TRUE` / `FALSE` / `UNKNOWN` | `UNKNOWN` |

### 17.1 Hallazgo de Phase 1.5 que confirma `AMB-LOG-02`

La definición de `F2-decide_continuar` proviene de «**Retención**: cierre del
proceso de retención en el cual el alumno **decide continuar**». Es decir:

- **Causa** = `F2-manifesto_baja` (el alumno *quiere* irse) o `F2-riesgo_de_baja`.
- **Desenlace** = `F2-decide_continuar` (el alumno *se queda*).

La fuente confirma que el nodo de retención del árbol es un **desenlace**, no una
condición de entrada. Esto **corrobora** el hallazgo de Phase 1 y **no** lo resuelve:
la ambigüedad de Phase 1 era la polaridad de los criterios de contacto de `5.8.a`,
que es un tema distinto. Ver `AMB-LOG-02`.

## 18. Hechos de D53 — persistencia de la decisión y exclusiones

| Hecho | Nombre | Tipo | Fuente | Regla | Valores | Unknown |
|---|---|---|---|---|---|---|
| `F2-d53_aplica` | ¿Aplica D53 a este estudiante? | `derived` | `D53-01` (p.2) | D53 5.1.1 | `TRUE` si nuevo ingreso ∧ tipo ∈ {Regular, Dictamen técnico}; `FALSE` si tipo ∈ {Equivalencia, Revalidación} o reingreso; `UNKNOWN` si el tipo no consta | `UNKNOWN` |
| `F2-d53_excluido` | Excluido por tipo: reingreso, equivalencia o revalidación | `derived` | `D53-01` (p.2) | D53 5.1.1 | `TRUE` / `FALSE` / `UNKNOWN` | `UNKNOWN` |
| `F2-d53_resp_backoffice` | Responsabilidad de gestión documental en Back Office | `derived` | `D53-02`, `D53-03` (p.2) | D53 5.1.2–5.1.3 | `TRUE` desde la venta hasta el viernes previo al inicio; `FALSE` desde ese viernes | `UNKNOWN` |
| `F2-d53_decision_mantiene` | La decisión D53 no cambia aunque entregue el documento | `exception` | `D53-08` (p.3) | D53 5.1.8 | `TRUE` (invariante) | n/a |
| `F2-d53_clasificacion_actualizada` | Clasificación → «D53 con expediente completo» | `derived` | `D53-08` (p.3) | D53 5.1.9 | `TRUE` / `FALSE` | n/a |
| `F2-d53_reingreso_si_entrega_mismo_bimestre` | Entrega dentro del mismo bimestre del cierre de aula **no** es reingreso | `counterevidence` | `D53-09` (p.3) | D53 5.1.9 | `TRUE` / `FALSE` | `UNKNOWN` |
| `F2-d53_apocrifo_sospecha` | Inconsistencia documental → posible apócrifo → dictaminación externa | `derived` | `D53-15` (p.4) | D53 5.2.3 (1.1.1) | `TRUE` / `FALSE` / `UNKNOWN` | `UNKNOWN` |

**`F2-d53_decision_mantiene` es una invariante, no un hecho variable.** Ningún
motor debe derivar «el estudiante ya entregó, luego deja de ser D53». El
único cambio permitido es el de **clasificación** (`F2-d53_clasificacion_actualizada`).

## 19. Hechos de cancelación de venta — taxonomía de motivos (Glosario)

`G-13` (p.7) define CV y **enumera tres motivos**: (a) error en su paquete de
inscripción; (b) no se localiza al alumno y no ingresa al Aula; (c) ya no está
interesado en iniciar. Los tres tienen correspondencia en ramas ya inventariadas
del primario: (a) `N-56`/`N-102` error de paquete; (b) `N-68`…`N-76` ilocalizable;
(c) `N-30`/`N-33` no continuar. La taxonomía **valida** la estructura del árbol; no
introduce ramas nuevas.

`G-13` añade además un **predicado de alcance** ausente del primario: la CV es
«proceso para **alumnos de nuevo ingreso**». Se refleja en `F2-es_nuevo_ingreso`
como condición necesaria, no suficiente.

## 20. Recuento ampliado del catálogo

| Categoría | Phase 1 | Phase 1.5 |
|---|---|---|
| Hechos decisionales (§3–§10) | 118 | 118 (sin cambios) |
| Hechos de SLA no decisionales (§11) | 7 | 7 (sin cambios) |
| **Total hechos definidos** | **125** | **125** (sin cambios) |
| Hechos nuevos de fuentes de apoyo (§14–§19) | — | **+36** |
| **Total hechos definidos (ampliado)** | **125** | **161** |
| Hechos con dominio `INDETERMINADO` por conflicto | 0 | **+2** (`F2-cc_termino_meses`, reloj de 6 meses) |

> Los 125 hechos de Phase 1 **no se modifican**: Phase 1.5 no reescribe el
> primario. Los 36 nuevos son verificables contra `G-##` y `D53-##`. Los conteos
> se verificaron por parsing sobre las filas de tabla (`36` IDs `F2-` únicos,
> `125` IDs `F-` únicos).
