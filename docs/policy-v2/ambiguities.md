# Registro de Ambigüedades — GDM_GAM_PRD_MLG_003 v5

**Fase:** Decision Tree Phase 1 — Extracción normativa
**Fuente:** `GDM_GAM_PRD_MLG_003` v5, `14/09/2026`, SHA-256 `71faf646…96c7d2`
**Estado:** `AMBIGUITIES_RECORDED` — **28 ambigüedades registradas, 14 bloqueantes**

> **Regla aplicada:** ninguna ambigüedad se resuelve por la lectura más
> plausible, por default, ni por inferencia técnica. Cada una se registra con su
> ubicación exacta, las lecturas que la fuente **sí** soporta, y el estado que
> el motor debe adoptar. Conforme a `rebuild-decision-tree-phase-1.md`: «Do not
> resolve ambiguity by choosing the most likely reading.»

---

## 0. Clasificación y conteo

| Clase | Cantidad | IDs |
|---|---|---|
| `CONTRADICTION` — la fuente se contradice | 4 | `AMB-CON-01`…`04` |
| `PRECEDENCE` — falta la regla de prevalencia | 6 | `AMB-TEM-01`…`06` |
| `EXTERNAL` — depende de documento no incluido | 5 | `AMB-EXT-01`…`05` |
| `UNDERSPECIFIED_LOGIC` — falta la conectiva | 2 | `AMB-LOG-01`, `AMB-LOG-04` |
| `POLARITY` — riesgo de inversión de sentido | 3 | `AMB-LOG-02`, `03`, `05` |
| `MISSING_THRESHOLD` — falta un valor numérico | 3 | `AMB-NUM-01`…`03` |
| `GAP` — el documento enuncia sin concluir | 3 | `AMB-GAP-01`…`03` |
| `REFERENCE_DRIFT` — desalineación de referencias internas | 1 | `AMB-REF-01` |
| `DEFINITION_DIVERGENCE` — doble definición del mismo término | 1 | `AMB-DEF-01` |
| **Total** | **28** | |

**Las 14 ambigüedades bloqueantes** (cada una cambia el resultado de una rama
del árbol, por lo que el motor no puede ser determinista sin resolverlas):

`AMB-CON-01`, `AMB-CON-02`, `AMB-CON-03`, `AMB-CON-04`, `AMB-NUM-01`,
`AMB-NUM-02`, `AMB-LOG-01`, `AMB-LOG-04`, `AMB-TEM-01`, `AMB-TEM-02`,
`AMB-TEM-06`, `AMB-EXT-01`, `AMB-EXT-02`, `AMB-EXT-04`.

---

## 1. Contradicciones internas

### `AMB-CON-01` — Falta de retención vs. solicitud previa al inicio

| | |
|---|---|
| **Clase** | `CONTRADICTION` / `PRECEDENCE` |
| **Ubicaciones** | `N-33` (5.3.b, p.5) vs `N-27` (5.3.a.I, p.4) |
| **Estado** | `REQUIRES_OWNER_DECISION` |

**Texto A** (`N-27`, p.4): «Si el estudiante solicita no continuar con sus
estudios, **previo a la fecha de inicio**, aplica cancelación de venta.»

**Texto B** (`N-33`, p.5): «En caso de **no realizarse el proceso de retención**…
la solicitud deberá gestionarse como **baja**, sin que la fecha de inicio ni la
aplicación de D35 o D53 **afecten dicha determinación**.»

**Lecturas que la fuente soporta:**

1. `N-33` prevalece (su cláusula «sin que la fecha de inicio… afecten» es
   explícita): el caso termina en `BAJA`.
2. `N-27` prevalece por ser anterior en el texto y por pertainir a un supuesto
   más específico (solicitud previa al inicio): el caso termina en
   `CANCELACION_VENTA`.
3. Ambos aplican y el resultado depende de si hubo retención → indeterminate sin
   evidencia de retención.

**Por qué no se resuelve en Fase 1:** el documento no contiene regla de
prevalencia entre incisos hermanos del mismo apartado. Elegir la lectura 1 o la
2 es una decisión normativa, no técnica.

**Pregunta para el Owner:** ¿`N-33` prevalece sobre `N-27` cuando coinciden?

---

### `AMB-CON-02` — Doble ruta de escalamiento en el mismo inciso

| | |
|---|---|
| **Clase** | `CONTRADICTION` |
| **Ubicación** | `N-57` y `N-58` (5.6.f, p.10) — **mismo inciso, dos párrafos** |
| **Estado** | `REQUIRES_OWNER_DECISION` |

**Texto A** (`N-57`, p.10): «…las áreas de **Dictaminación, Éxito Estudiantil,
Cancelaciones y Backoffice colaborarán conjuntamente** para evaluar y determinar
si es apropiado clasificar la situación como una baja o una cancelación de venta.»

**Texto B** (`N-58`, p.10): «…el caso será **escalado al área de Mejora
Continua**, quien evaluará los antecedentes y determinará si corresponde
clasificar la situación como una baja o una cancelación de venta.»

**Lecturas soportadas:**

1. `N-58` es la redacción vigente y `N-57` es residuo de una versión anterior no
   eliminada.
2. Ambos son aplicables: primero escala a Mejora Continua y luego la decisión se
   toma en el comité de cuatro áreas.
3. Ambos son aplicables en paralelo, con el resultado del comité como salida.

**Por qué no se resuelve:** las dos frases son contiguas en el mismo inciso y
describen la misma situación. El documento no indica relación entre ellas.

**Pregunta para el Owner:** ¿cuál es la ruta de escalamiento vigente para casos
de promesa no cumplida fuera de plazo?

---

### `AMB-CON-03` — Restricción vs. expansión de la promesa no cumplida

| | |
|---|---|
| **Clase** | `CONTRADICTION` / `PRECEDENCE` |
| **Ubicaciones** | `N-46` (p.8) vs `N-52` (p.9) |
| **Estado** | `REQUIRES_OWNER_DECISION` |

**Texto A** (`N-46`, p.8): «Esta causal aplicará **únicamente cuando** el
estudiante manifieste de forma explícita su decisión de no continuar, indicando
que dicha decisión deriva de las promesas no cumplidas, **y además** rechace
beneficios adicionales, tales como estrategias de retención o la aplicación de
ajustes correctivos.»

**Texto B** (`N-52`, p.9): «**Si no se cuenta con las evidences debidamente
registradas** en los sistemas oficiales, se procederá a aplicar la cancelación de
la venta bajo el criterio de promesa de venta no cumplida.»

**Conflicto:** `N-46` exige **tres** requisitos; `N-52` no exige ninguno de ellos
y se activa por la mera ausencia de evidencia. Un caso con información errónea
acreditada, sin rechazo de beneficios y sin evidencias en sistema oficial
satisface `N-52` pero no `N-46`.

**Lecturas soportadas:**

1. `N-46` es el criterio principal; `N-52` es un supuesto adicional
   (subsidiaria) que aplica solo si además se cumplen los requisitos de `N-46`.
2. `N-52` es un criterio autónomo e independiente.
3. `N-52` es una penalización al asesor por falta de registro, no una causal de
   CV.

**Pregunta para el Owner:** ¿`N-52` requiere también cumplir `N-46`?

---

### `AMB-CON-04` — «De manera tácita» y «o baja, según corresponda»

| | |
|---|---|
| **Clase** | `CONTRADICTION` |
| **Ubicaciones** | `N-36` (p.6), `N-78` (p.13) |
| **Estado** | `REQUIRES_OWNER_DECISION` |

**Texto** (`N-36`, pp.5→6): «aplica cancelación de venta **o** baja, solo si el
estudiante por este motivo desea y **expresa de manera tácita** el no querer
continuar.»

Dos defectos en una sola frase:

1. **«expresa de manera tácita»** es autocontradictorio: lo tácito es lo no
   expresado. El documento no define cómo se verifica una expresión tácita ni qué
   evidencia la acredita.
2. **«cancelación de venta o baja»** no declara el criterio que distingue una de
   otra. El mismo texto aparece en `N-78` (p.13): «aplica cancelación de venta o
   baja **según corresponda**».

**Lecturas soportadas:**

1. La distinción es temporal: CV antes del inicio, baja después (derivada de
   `N-27`/`N-28`).
2. La distinción es por existencia de retención (derivada de `N-32`/`N-33`).
3. La distinción es por calidad de la evidencia (derivada de `N-36`: si existe
   expression de no continuar).

**Por qué no se resuelve:** las tres son inferencias plausibles y el documento no
elige. La lectura 1 y la 3 pueden moreover dar resultados distintos en el mismo
caso.

**Pregunta para el Owner:** ¿qué criterio separa `CANCELACION_VENTA` de `BAJA` en
los casos de ajuste administrativo, y qué evidencia acredita la «expresión
tácita»?

---

## 2. Umbrales numéricos faltantes

### `AMB-NUM-01` — Número de contacto contradictorio

| | |
|---|---|
| **Clase** | `MISSING_THRESHOLD` / `CONTRADICTION` |
| **Ubicaciones** | `N-23` (5.2.f, p.4) vs `N-24` (5.2.g, p.4) |
| **Estado** | `REQUIRES_OWNER_DECISION` |

**Texto A** (`N-23`, p.4): «Los intentos de contacto para estas interacciones se
realizará mediante el número (**+52 1 55 9088 8548**).»

**Texto B** (`N-24`, p.4): «Gúmeros actualmente habilitados: ● +52 1 55 8977 0707 /
+52 1 55 8977 0700 – MX ● +52 1 55 9252 2986 – LATAM.»

Dos problemas: (a) el número de `N-23` **no figura** entre los «actualmente
habilitados» de `N-24`; (b) `N-24` declara **tres** números para un propósito
(`N-23`) que especifica **uno**.

**Lecturas soportadas:**

1. `N-23` fija el número principal y `N-24` lista alternativas por región.
2. `N-24` es la lista vigente y `N-23` quedó obsoleto.
3. Ambos vigentes: el asesor puede usar cualquiera, y `N-23` es el predeterminado.

**Consecuencia si no se resuelve:** un motor no puede verificar «el intento de
contacto se realizó mediante el número correcto», porque no existe un número
correcto único.

**Pregunta para el Owner:** ¿cuál es el número vigente y cuál es la relación con
los tres de `5.2.g`?

---

### `AMB-NUM-02` — Intervalo de colapso de marcaciones no definido

| | |
|---|---|
| **Clase** | `MISSING_THRESHOLD` |
| **Ubicación** | `N-21` (5.2.d, pp.3→4) |
| **Estado** | `REQUIRES_OWNER_DECISION` — **bloqueante** |

**Texto** (`N-21`, pp.3→4): «Cuando se realice una acción de 2 o más llamadas en un
mismo lapso de tiempo **o con el intervalo de tiempo corto establecido para este
efecto**, estas marcaciones serán consideradas como una sola interacción para
efectos del cumplimiento de la gestión realizada por el equipo de Éxito
Estudiantil.»

**El intervalo no está establecido en ninguna parte del documento.** El inciso
remite a un valor que el propio documento nunca define. La única cifra de
separación existente es «al menos 6 horas de diferencia» (`N-18`, p.3), pero
`N-18` regula el cómputo de llamadas y `N-21` regula el colapso de marcaciones:
son gateways distintos.

**Lecturas soportadas:**

1. El intervalo es 6 horas (tomar `N-18` como referencia).
2. El intervalo es menor que 6 horas (el «intervalo corto» sería un umbral
   distinto del mínimo ordinario).
3. El intervalo es un valor operativo definido fuera de este documento.

**Por qué no se resuelve:** asumir 6 h es inventar un valor. Además, la lectura 2
implicaría un umbral **adicional** no citado, lo que affectaría el conteo de las
16 llamadas mínimas.

**Consecuencia:** sin este valor, `F-marcaciones_colapsadas` no es calculable y el
cumplimiento de `N-18` (16 llamadas) tampoco.

**Pregunta para el Owner:** ¿cuál es el intervalo que colapsa 2+ marcaciones en
una sola interacción?

---

### `AMB-NUM-03` — Porcentaje de cobertura no definido

| | |
|---|---|
| **Clase** | `MISSING_THRESHOLD` |
| **Ubicación** | `N-25` (5.2.h, p.4) |
| **Estado** | `REQUIRES_OWNER_DECISION` |

**Texto** (`N-25`, p.4): «el equipo será responsable de garantizar el cumplimiento
del **porcentaje de cobertura** y/o del número de llamadas establecido en la
presente política.»

El porcentaje de cobertura **no aparece** en ninguna parte de la política. La
misma frase reaparece en `N-91` (p.15): «no cumpla con el **número o
porcentaje** de interacciones establecido».

**Lecturas soportadas:**

1. El porcentaje de cobertura es una métrica de EE, no normativa, y no debe
   verificarse por el motor.
2. Existe un valor en un anexo o política no incluida.

**Consecuencia:** `N-91` declara que el incumplimiento del requisito de gestión
**no se acredita**, pero si el porcentaje no es verificable, solo la rama del
número de llamadas es evaluable.

**Pregunta para el Owner:** ¿el porcentaje de cobertura es una obligación
verificable y cuál es su valor?

---

## 3. Lógica_connectiva no especificada

### `AMB-LOG-01` — ¿`AND` u `OR` entre llamadas y escritos?

| | |
|---|---|
| **Clase** | `UNDERSPECIFIED_LOGIC` |
| **Ubicaciones** | `N-18` (p.3) y `N-19` (p.3) |
| **Estado** | `REQUIRES_OWNER_DECISION` — **bloqueante** |

**Texto** (`N-18`, p.3): «Contar con un mínimo de **16 llamadas**…»

**Texto** (`N-19`, p.3): «Contar con un mínimo de **6 interacciones por medios
escritos**…»

Ambos usan «Contar con un mínimo de», sin conectiva. La sección se titula
«Intentos de contacto **mínimos** al estudiante» y `N-20` habla del «**total** de
interacciones requeridas» distribuido 70/30, lo que sugiere un total único
combinado; pero nada lo declara.

**Lecturas soportadas:**

1. `AND`: se requieren 16 llamadas **y** 6 escritos.
2. `OR`: basta con 16 llamadas **o** 6 escritos.
3. `AND` con umbrales independientes: 22 interacciones totales, con ambos mínimos
   exigidos.

**Por qué no se resuelve:** las lecturas 1 y 3 son numéricamente distintas
(22 vs 22, pero con criterio de cumplimiento distinto) y la 2 es más laxa. Un caso con 16
llamadas y 0 escritos cumple la 2 y falla la 1.

**Consecuencia:** determina si un estudiante con 16 llamadas y sin escrito es
`RETENCION` o incumplimiento.

**Pregunta para el Owner:** ¿los mínimos de llamadas y de interacciones escritas
se acumulan o son alternativos?

---

### `AMB-LOG-02` — Polaridad invertida en la actividad académica

| | |
|---|---|
| **Clase** | `POLARITY` |
| **Ubicaciones** | `N-70` (p.12) vs `N-71` (p.13), `N-72` (p.13), `N-73` (p.13) |
| **Estado** | Guardarraíl de diseño (no bloqueante si se implementa correctamente) |

Los cuatro criterios de actividad académica por nivel usan la misma estructura
de viñeta, pero tres están redactados en forma **negativa**:

| Nivel | Texto | Polaridad |
|---|---|---|
| Licenciaturas | «**Haber** seleccionado la modalidad de evaluación…» | positiva |
| Posgrados y Ejecutivas | «**No haber** registrado participación en foros…» | **negativa** |
| Licenciaturas de alianzas | «**No haber** ingresado a ninguna asignatura…» | **negativa** |
| Diplomados | «**No haber** registrado participación en foros…» | **negativa** |

**Riesgo:** una implementación con una bandera única
`actividad_academica = TRUE` interpretaría «No haber registrado participación»
como «registró participación», invirciendo el resultado en tres de cuatro
niveles: un posgrado activo se clasificaría como ilocalizable y un posgrado
ausente como localizado.

**Mitigación definida en Fase 1:** la polaridad se declara en la **definición**
del hecho (`F-actividad_posgrado` = `TRUE` significa *no* registrado), nunca en el
código del evaluador. Cada nivel tiene hechos separados.

**Pregunta para el Owner:** ¿se confirma que la lectura negativa de `N-71`,
`N-72` y `N-73` es intencional, o se trata de un error de redacción que debería
ser positiva como `N-70`?

---

### `AMB-LOG-03` — Forma verbal pasiva en el caso de canal

| | |
|---|---|
| **Clase** | `POLARITY` |
| **Ubicación** | `N-105` (5.10, p.17) |
| **Estado** | No bloqueante |

**Texto:** «Todas las ventas que ingresen a través del canal de Mystery Shopper
aplican como: "cancelación de matrícula", aplicadas por parte del equipo de
Servicios Escolares, no impacta el indicador de cancelaciones de venta.»

La construcción «**aplican** como» es pasiva e impersonal: no enuncia una regla
condicional sino una clasificación de canal. Además, `N-105` no está incluida en
la lista de 5.9, aunque `N-93` sí excluye explícitamente otros canales
(College, Upselling).

**Riesgo:** un motor que busque la lista de exclusiones de 5.9 no encontrará
Mystery Shopper, porque no está en 5.9.

**Mitigación:** `N-105` se modela como filtro de canal de primer nivel
(`decision-tree.md` §1.2), no como causal de 5.9.

---

### `AMB-LOG-04` — Conectiva de los criterios de contacto efectivo

| | |
|---|---|
| **Clase** | `UNDERSPECIFIED_LOGIC` |
| **Ubicaciones** | `N-69` (p.12) vs `N-83`…`N-89` (pp.14→15) |
| **Estado** | `REQUIRES_OWNER_DECISION` — **bloqueante** |

**Texto A** (`N-69`, p.12): «se considerará que existe **contacto efectivo**
cuando el estudiante haya **ingresado a la Oficina Virtual o** cuando se
identifique evidencia de actividad académica conforme a alguno de los siguientes
supuestos».

**Texto B** (`N-83`, p.14): «Para que un contacto sea considerado como efectivo,
deberá **cumplir con los siguientes criterios**: i)… vi)…» — seis criterios
conversacionales, sin conectiva.

Los dos bloques describen el mismo concepto con criterios **distintos**:
- `N-69`: ingreso a Oficina Virtual **o** actividad académica (criterio laxo,
  verificable por sistema).
- `5.8.h`: seis requisitos conversacionales (contacto con titular, interacción
  relacionada, objetivo informado, ciclo informado, identidad, datos), todos
  verificables solo por análisis de la conversación.

**Lecturas soportadas:**

1. `N-69` y `5.8.h` son criterios **alternativos**: basta con cumplir uno.
2. `5.8.h` **reemplaza** a `N-69` para el contacto humano; `N-69` aplica a
   automatizaciones.
3. Se requieren **ambos**: ingreso/actividad **y** los seis criterios.

**Consecuencia:** las lecturas 1 y 3 dan resultados opuestos para el caso «el
estudiante ingresó a la plataforma pero la conversación fue un mensaje unanswered
sin contenido».

**Por qué no se resuelve:** el documento presenta ambos como definiciones de la
misma etiqueta («contacto efectivo») sin conciliarlos.

**Pregunta para el Owner:** ¿`5.8.h` sustituye, complementa o alterna con el
criterio de `N-69`?

---

### `AMB-LOG-05` — `OP-F` clasifica distinto que el resto de 5.9

| | |
|---|---|
| **Clase** | `POLARITY` |
| **Ubicación** | `N-101` (5.9.f, p.17) vs `N-92` (5.9, p.16) |
| **Estado** | No bloqueante, pero afecta indicadores |

`N-92` (p.16) declara: «Se considerará cancelación de venta **operativa** en los
siguientes casos», y los incisos a–g lo desarrollan. `N-101` (5.9.f, p.17) concluye: «aplicará
**cancelación de venta**», sin el calificativo **operativa**.

**Lecturas soportadas:**

1. Es una omisión de redacción; `OP-F` también es operativa.
2. `OP-F` es intencionadamente **no operativa** porque el error es del proceso de
   validación, no del asesor ni del equipo.

**Consecuencia si no se resuelve:** un caso de discrepancia de paquete impactaría
el indicador del equipo en lugar de ser neutro, o viceversa.

**Pregunta para el Owner:** ¿5.9.f es cancelación de venta operativa o
cancelación de venta ordinaria?

---

## 4. Precedencia entre reglas

### `AMB-TEM-01` — Siete umbrales temporales sin prevalencia

| | |
|---|---|
| **Clase** | `PRECEDENCE` |
| **Estado** | `REQUIRES_OWNER_DECISION` — **bloqueante** |

| Umbral | Cita | Efecto |
|---|---|---|
| 2 semanas post-inicio | `N-15` p.3 | Límite de solicitud de CV |
| Primer domingo del ciclo | `N-29` p.4 | Límite con D35/D53 tardía |
| 20 días post-inicio | `N-35` p.5 | Cualquier solicitud → baja |
| Domingo de semana 2 | `N-68` p.12 | Límite de ilocalizable |
| Semana 3 post-inicio | `N-103` p.17 | Cierre financiero e irreversibilidad |
| 30 días hábiles | `N-07` p.2 | Definición de deserción (glosario) |
| 30 días | `N-114` p.18 | Definición de deserción (indicador) |

Nueve días naturales separan los umbrales 1 y 3; 15 días separan el 2 y el 4. El
documento **no declara** el orden de prevalencia entre ellos, salvo dos casos
aislados (`N-112` sobre `N-15` para quórum).

**Consecuencia:** para una solicitud entre el segundo domingo y el día 20, el
motor no sabe si aplica CV (2 semanas), CV (ilocalizable) o baja (20 días).

**Pregunta para el Owner:** ¿cuál es el orden de prevalencia de los umbrales
temporales?

---

### `AMB-TEM-02` — Alcance de «cualquier solicitud» en `N-35`

| | |
|---|---|
| **Clase** | `PRECEDENCE` |
| **Ubicación** | `N-35` (5.3.c, p.5) |
| **Estado** | Decisión técnica restringida, requiere confirmación |

**Texto** (`N-35`, p.5): «…transcurridos 20 días desde la fecha de inicio del
ciclo, **cualquier solicitud** deberá gestionarse como baja».

El término «cualquier solicitud» sugiere alcance universal, lo que haría
prevalecer `N-35` sobre `N-15` (2 semanas) y sobre `N-29` (primer domingo). Pero
`N-15` y `N-29` son **anteriores** en el documento y regulan específicamente la
solicitud de CV, mientras que `N-35` se ubica en un inciso sobre **cambios y
ajustes**.

**Lecturas soportadas:**

1. `N-35` es universal: tras 20 días, todo es baja.
2. `N-35` se limita a solicitudes de cambio/ajuste (su contexto), y las
   causales de CV conservan sus propios plazos.

**Consecuencia:** la lectura 1 deja sin efecto práctica `5.8` (ilocalizable) y
`5.9` (operativas) en su ventana de 2–3 semanas, lo que sería un cambio
sustancial del proceso.

**Pregunta para el Owner:** ¿«cualquier solicitud» incluye las solicitudes de
cancelación de venta por causal de negocio?

---

### `AMB-TEM-03` — Prevalencia de `N-112` sobre `N-15`

| | |
|---|---|
| **Clase** | `PRECEDENCE` |
| **Ubicaciones** | `N-112` (p.18) vs `N-15` (p.3) |
| **Estado** | **Resoluble por lectura** — se registra por completitud |

`N-112` (p.18) dice: «La fecha de solicitud **no limitará la aplicación de este
criterio**». Es la **única** prevalencia temporal declarada de forma explícita
en todo el documento. Se aplica a la causal de falta de quórum
(`CAUSAL-QUORUM`) con `overrideTemporal`.

**Se registra** para que la excepción no se pierda y para que no se extienda por
analogía a otras causales sin decisión del Owner.

---

### `AMB-TEM-04` — `N-15` no exceptúa a los canales especiales

| | |
|---|---|
| **Clase** | `PRECEDENCE` |
| **Ubicaciones** | `N-15` (p.3) vs `N-93` (p.16) |
| **Estado** | No bloqueante |

`N-15` (p.3) establece el límite de 2 semanas **sin excepciones**. Pero `N-93`
(p.16) excluye canales College y Upselling de 5.9.a, y `N-105` (p.17) clasifica
Mystery Shopper fuera de CV. El documento no declara si el límite de `N-15`
aplica a esos canales.

**Pregunta para el Owner:** ¿el límite temporal de 2 semanas aplica a los
canales con tratamiento especial?

---

### `AMB-TEM-05` — Deserción: 30 días hábiles vs. 30 días

| | |
|---|---|
| **Clase** | `PRECEDENCE` / `CONTRADICTION` |
| **Ubicaciones** | `N-07` (3, p.2) vs `N-114` (5.12.b, p.18) |
| **Estado** | No bloqueante para el árbol; sí para el indicador |

**Texto A** (`N-07`, p.2, glosario): «…cancelaciones de ventas o bajas realizadas
durante el periodo comprendido entre la fecha de inicio del ciclo y hasta **30
días hábiles** posteriores al inicio del ciclo.»

**Texto B** (`N-114`, p.18, indicador): «…cancelaciones de ventas o bajas
realizadas dentro del periodo comprendido entre la fecha de inicio del ciclo y
hasta **30 días** posteriores al inicio de ciclo.»

Una definición usa **días hábiles**, la otra **días naturales**. La diferencia
es de aproximadamente 6 días calendario.

**Lecturas soportadas:** (a) el glosario es preciso y el indicador es abreviado;
(b) el indicador es correcto y el glosario tiene error; (c) son definiciones
distintas para contextos distintos.

**Consecuencia:** el mismo caso puede computarse en un indicador y no en otro.

**Pregunta para el Owner:** ¿la deserción se cuenta en días hábiles o naturales?

---

### `AMB-TEM-06` — Solapamiento entre el primer domingo y el domingo de semana 2

| | |
|---|---|
| **Clase** | `PRECEDENCE` |
| **Ubicaciones** | `N-29` (p.4) vs `N-68` (p.12) vs `N-35` (p.5) |
| **Estado** | `REQUIRES_OWNER_DECISION` |

El «primer domingo del inicio del ciclo» (`N-29`) cierra la semana 1; el
«domingo de la semana dos» (`N-68`) cierra la semana 2. **No son el mismo día** y
por tanto no se contradicen textualmente. Lo que el documento no declara:

1. Para un caso situado entre ambos domingos, ¿gobierna el límite de `N-29`
   (semana 1) o el de `N-68` (semana 2)?
2. ¿`N-29`, más estricto que `N-15`, es una excepción a este o un error de
   redacción?
3. ¿El umbral de 20 días de `N-35` trunca ambos límites?

**Consecuencia:** un caso en el segundo día de la semana 2 tiene dos ventanas
aplicables y ninguna regla de orden.

**Pregunta para el Owner:** ¿cuál límite temporal aplica a cada causal dentro de
la ventana de 2 semanas?

---

## 5. Dependencias externas no disponibles

### `AMB-EXT-01` — Glosario de operación escolar no incluido

| | |
|---|---|
| **Clase** | `EXTERNAL` |
| **Ubicación** | `N-05` (3, p.1) |
| **Estado** | `REQUIRES_OWNER_DECISION` — **bloqueante** |

**Texto** (`N-05`, p.1): «Glosario de operación escolar» — se enuncia como
definición importante para el entendimiento de las políticas, pero **no se
incluye** en el documento.

**Impacto:** la definición de «invasión de ciclo» (`N-06`, p.1) remite a este
glosario. Los términos del glosario no pueden verificarse.

**Pregunta para el Owner:** ¿se puede incorporar el Glosario de operación escolar
a la fuente normativa bloqueada?

---

### `AMB-EXT-02` — Diagrama de flujo y descripción de actividades ausentes

| | |
|---|---|
| **Clase** | `EXTERNAL` |
| **Ubicaciones** | `N-131` (6, p.21), `N-132` (7, p.21) |
| **Estado** | `REQUIRES_OWNER_DECISION` — **bloqueante, hueco más grave** |

**Texto** (`N-131`, p.21): «La descripción de las actividades está disponible en
el siguiente **enlace de Drive**».

**Texto** (`N-132`, p.21): «Diagrama de flujo se encuentra disponible en el
siguiente **Link**: …png. Lucidchart document».

**El flujo oficial del proceso vive fuera del PDF.** La sección 6 (actividades) y
la sección 7 (diagrama) son precisamente las que contienen la secuencia de
decisión.

**Impacto:** el árbol de `decision-tree.md` se reconstruyó **exclusivamente**
desde el texto de las páginas 1–26. Cualquier etapa del flujo que solo exista en
el diagrama es **desconocida** para esta fase. No se infiere ninguna arista de un
archivo ausente.

**Consecuencia de cobertura:** la sección 7 del documento tiene cobertura
`NOT_COVERED` en `coverage-matrix.md`. Es el hueco más relevante de Fase 1.

**Pregunta para el Owner:** ¿el diagrama de flujo y la descripción de actividades
pueden incorporarse a la fuente normativa? Sin ellos, la cobertura del flujo
oficial es estructuralmente incompleta.

---

### `AMB-EXT-03` — Carta manifiesto sin formato especificado

| | |
|---|---|
| **Clase** | `EXTERNAL` |
| **Ubicación** | `N-59` (5.7.a, p.10) |
| **Estado** | `REQUIRES_OWNER_DECISION` |

`N-59` (p.10) exige una «carta manifiesto debidamente diligenciada, en la que se
completen **los campos requeridos**». El documento no lista esos campos ni
remite a un anexo que los contenga. La sección 9 (p.22) lista «Anexo 1. matriz de
validaciones» y «Anexo 1. Documentos de Ingreso Estudiantes», ninguno de los
cuales se identifica como el formato de la carta.

**Consecuencia:** no se puede verificar si una carta cumple «los campos
requeridos».

**Pregunta para el Owner:** ¿dónde se define el formato de la carta manifiesto?

---

### `AMB-EXT-04` — Anexo 5 (Decisión 53) no incluido

| | |
|---|---|
| **Clase** | `EXTERNAL` |
| **Ubicaciones** | `N-67` (5.7.h, p.12), `N-31` (5.3.a.V, p.5), `N-29` (5.3.a.III, p.4) |
| **Estado** | `REQUIRES_OWNER_DECISION` |

`N-67` (p.12) obliga a cumplir el «Anexo 5. Políticas y Normas Aplicables a la
Decisión 53». El anexo no está en el PDF. `N-29` y `N-31` operan con la
«decisión 53» y la «decisión 35» sin definir estos conceptos más allá de su uso.

**Impacto:** toda la rama `CAUSAL-D53` es inejecutable sin el Anexo 5, y el
significado de «decisión 35 en tiempo y forma» (`N-31`) queda indefinido.

**Pregunta para el Owner:** ¿pueden incorporarse el Anexo 5 y la definición de
«decisión 35 en tiempo y forma»?

---

### `AMB-EXT-05` — Estrategias de retención no especificadas

| | |
|---|---|
| **Clase** | `EXTERNAL` |
| **Ubicaciones** | `N-32` (p.5), `N-46` (p.8) |
| **Estado** | `REQUIRES_OWNER_DECISION` |

`N-32` (p.5) exige «presentando estrategias de permanencia acordes con la causa
de deserción», pero las estrategias están en «Anexo 2. Matriz Estrategias de
Retención» y «Anexo 4. Matriz Estrategias de Retención - Copiloto Ventas», ninguno
incluido.

`N-46` (p.8) exige que el estudiante «rechace beneficios adicionales, tales como
estrategias de retención o la aplicación de ajustes correctivos». Sin la matriz
de estrategias no se puede verificar si el rechazo fue fundado.

**Consecuencia:** `F-estrategias_presentadas` y `F-estudiante_acepta_estrategia`
no son verificables contra la norma.

**Pregunta para el Owner:** ¿pueden incorporarse los Anexos 2 y 4?

---

## 6. Enunciados sin conclusión normativa

### `AMB-GAP-01` — Sanción por falta de retención no especificada

| | |
|---|---|
| **Clase** | `GAP` |
| **Ubicación** | `N-34` (5.3.b, p.5) |
| **Estado** | `REQUIRES_OWNER_DECISION` |

**Texto** (`N-34`, p.5): «Adicionalmente, en caso de que no exista gestión de
retención por ninguna de las áreas involucradas, se deberá aplicar **la sanción
correspondiente** a **ambas áreas** por incumplimiento del proceso.»

La fuente no especifica (a) cuál es la sanción, (b) quiénes son «ambas áreas» (el
inciso previo menciona GM, EE y otras, pero no dos en concreto).

**Consecuencia:** `F-sancion_aplicada` queda permanentemente en `UNKNOWN` con
`unknownReason: 'sanción no especificada en la fuente'`. No es implementable como
condición.

**Pregunta para el Owner:** ¿cuál es la sanción y a qué áreas aplica?

---

### `AMB-GAP-02` — `N-66` enuncia un requisito sin consecuencia

| | |
|---|---|
| **Clase** | `GAP` |
| **Ubicación** | `N-66` (5.7.g, p.12) |
| **Estado** | `REQUIRES_OWNER_DECISION` |

**Texto** (`N-66`, p.12): «El estudiante deberá contar por lo menos con un
historial que avale el **100% de créditos**, una constancia de término o
acreditación de examen único.»

El inciso enuncia un **deber** y no declara el desenlace si no se cumple. No dice
«se procede con cancelación de venta» ni «se rechaza la matriculación».

**Comparación:** los incisos vecinos sí declaran desenlace — `N-60` (p.11) «se
procederá con la cancelación de la venta»; `N-63` (p.11) «deberá gestionarse como
cancelación de venta por invasión de ciclo». `N-66` es la excepción.

**Consecuencia:** un estudiante sin 100% de créditos no tiene desenlace asignado
por la fuente.

**Pregunta para el Owner:** ¿qué ocurre cuando el estudiante no avala el 100% de
los créditos?

---

### `AMB-GAP-03` — `N-44` enuncia gestión sin desenlace de cancelación

| | |
|---|---|
| **Clase** | `GAP` |
| **Ubicación** | `N-44` (5.5.a, p.7) |
| **Estado** | No bloqueante |

**Texto** (`N-44`, p.7): «En caso de que no proceda ninguno de los trámites
anteriormente descritos o que la solicitud se encuentre fuera del plazo
establecido para la gestión de ajustes, esta deberá gestionarse **como Mejora
continua**. Asimismo, el equipo de Cancelaciones de Venta deberá contactar al
estudiante para ofrecerle la alternativa de una **segunda inscripción**.»

El inciso define una gestión (escalar a Mejora Continua + ofrecer segunda
inscripción) pero **no declara** el desenlace final si el estudiante rechaza la
segunda inscripción. El camino de salida no existe en la fuente.

**Consecuencia:** el caso puede quedar sin desenlace tras el rechazo de la
segunda inscripción.

**Pregunta para el Owner:** ¿cuál es el desenlace si el estudiante rechaza la
segunda inscripción?

---

## 7. Deriva de referencias internas

### `AMB-REF-01` — Control de Cambios cita un apartado que cambió de número

| | |
|---|---|
| **Clase** | `REFERENCE_DRIFT` |
| **Ubicación** | Control de Cambios, versión `02` (pp.23→24) |
| **Estado** | Solo documental — no altera la norma vigente |

**Texto** (p.24, Control de Cambios v02): «Se incorpora el **item 5.11**, que
aclara el indicador de deserción y su impacto.»

En el cuerpo de la Versión 5 el indicador de deserción está en **5.12**
(`N-113`…`N-117`, pp.18→19) y **5.11** es «Falta de quórum» (`N-106`…`N-112`,
pp.17→18).

**Conclusión:** la numeración de los apartados se reordenó entre la versión 2 y
la versión 5 sin actualizar la descripción del cambio histórico.

**Consecuencia para Fase 1:** la numeración de sección **no es estable** entre
versiones. Toda cita debe incluir la **versión** además de la sección, conforme a
`documento → versión → sección → página`. Las referencias de Control de Cambios
no deben usarse para citar normas.

---

## 8. Divergencia de definición

### `AMB-DEF-01` — Doble definición de deserción

| | |
|---|---|
| **Clase** | `CONTRADICTION` |
| **Ubicaciones** | `N-07` (3, p.2) vs `N-114` (5.12.b, p.18) |
| **Estado** | No bloqueante; se documenta para trazabilidad |

Ambos enunciados definen «deserción» con el mismo sujeto y purpose pero
distinto cómputo: `N-07` (glosario) dice **30 días hábiles**; `N-114`
(indicador) dice **30 días**. Se registra en `AMB-TEM-05`.

**Decisión de Fase 1:** ambas definiciones se conservan **sin unificar**, cada
una con su cita. Unificar sería elegir una lectura sin base normativa. La regla
`N-07` aplica al glosario; `N-114`, al indicador. Para el **árbol de decisión** el
concepto de deserción **no es una condición** (es `indicator`), por lo que la
divergencia no afecta ningún desenlace.

---

## 9. Resumen de decisiones requeridas del Owner

| # | Ambigüedad | Pregunta | Bloquea Fase 2 |
|---|---|---|---|
| 1 | `AMB-CON-01` | ¿`N-33` prevalece sobre `N-27`? | **Sí** |
| 2 | `AMB-CON-02` | ¿Cuál ruta de escalamiento en 5.6.f? | **Sí** |
| 3 | `AMB-CON-03` | ¿`N-52` requiere cumplir `N-46`? | **Sí** |
| 4 | `AMB-CON-04` | ¿Qué separa CV de baja en ajuste administrativo? | **Sí** |
| 5 | `AMB-NUM-01` | ¿Cuál número de contacto vigente? | **Sí** |
| 6 | `AMB-NUM-02` | ¿Intervalo de colapso de marcaciones? | **Sí** |
| 7 | `AMB-NUM-03` | ¿Porcentaje de cobertura verificable? | No |
| 8 | `AMB-LOG-01` | ¿Llamadas y escritos: `AND` u `OR`? | **Sí** |
| 9 | `AMB-LOG-02` | ¿Se confirma la polaridad negativa en 3 niveles? | No |
| 9b | `AMB-LOG-03` | ¿Mystery Shopper se modela como filtro de canal? | No |
| 10 | `AMB-LOG-04` | ¿`5.8.h` sustituye, complementa o alterna con `N-69`? | **Sí** |
| 11 | `AMB-LOG-05` | ¿5.9.f es operativa o ordinaria? | No |
| 12 | `AMB-TEM-01` | ¿Orden de prevalencia de umbrales? | **Sí** |
| 13 | `AMB-TEM-02` | ¿«cualquier solicitud» incluye CV por causal? | **Sí** |
| 13b | `AMB-TEM-03` | Prevalencia ya declarada de `N-112` sobre `N-15` | No (resoluble) |
| 14 | `AMB-TEM-04` | ¿Límite de 2 semanas aplica a canales especiales? | No |
| 15 | `AMB-TEM-05` | ¿Deserción en días hábiles o naturales? | No |
| 16 | `AMB-TEM-06` | ¿Qué límite aplica en la ventana de 2 semanas? | **Sí** |
| 17 | `AMB-EXT-01` | ¿Incorporar Glosario de operación escolar? | **Sí** |
| 18 | `AMB-EXT-02` | ¿Incorporar diagrama de flujo y actividades? | **Sí** |
| 19 | `AMB-EXT-03` | ¿Formato de la carta manifiesto? | No |
| 20 | `AMB-EXT-04` | ¿Incorporar Anexo 5 y definición de D35? | **Sí** |
| 21 | `AMB-EXT-05` | ¿Incorporar Anexos 2 y 4 de retención? | No |
| 22 | `AMB-GAP-01` | ¿Cuál es la sanción por falta de retención? | No |
| 23 | `AMB-GAP-02` | ¿Desenlace si no avala 100% de créditos? | No |
| 24 | `AMB-GAP-03` | ¿Desenlace si rechaza segunda inscripción? | No |
| 25 | `AMB-REF-01` | Deriva de referencias en Control de Cambios | No (documental) |
| 26 | `AMB-DEF-01` | ¿Se unifica la doble definición de deserción? | No |

**Total ambigüedades registradas: 28.** Cada fila tiene su sección con el texto
de la fuente, las lecturas soportadas y la pregunta al Owner.

**Bloqueantes: 14.** Fase 2 no puede construir un motor determinista sin
resolverlas, porque cada una cambia el resultado de una rama del árbol. Ninguna
puede resolverse con un default de código: hacerlo sería una
`REQUIRES_OWNER_DECISION` encubierta.
