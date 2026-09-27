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

---

# Phase 1.5 — Re-evaluación con fuentes disponibles

> **Phase 1 preservado.** Las secciones 0–9 anteriores (28 ambigüedades) describen
> el estado con **una sola fuente** y **no se modifican**. Commit: `4f6fad7`.
> Esta sección es la re-evaluación con las 3 fuentes bloqueadas.
>
> **Regla aplicada sin excepción:** ninguna ambigüedad se resolvió eligiendo la
> lectura más plausible. Cada `RESOLVED_BY_NEW_SOURCE` cita el texto exacto que
> la cierra. Donde el texto no cierra la ambigüedad, se conserva el estado.

## 10. Resumen de la re-evaluación

| ID | Estado Phase 1 | Estado Phase 1.5 | Cambio |
|---|---|---|---|
| `AMB-CON-01` | `REQUIRES_OWNER_DECISION` | `STILL_REQUIRES_OWNER_DECISION` | — |
| `AMB-CON-02` | `REQUIRES_OWNER_DECISION` | `STILL_REQUIRES_OWNER_DECISION` | — |
| `AMB-CON-03` | `REQUIRES_OWNER_DECISION` | `STILL_REQUIRES_OWNER_DECISION` | — |
| `AMB-CON-04` | `REQUIRES_OWNER_DECISION` | `PARTIALLY_RESOLVED` | ▲ |
| `AMB-NUM-01` | `REQUIRES_OWNER_DECISION` | `STILL_REQUIRES_OWNER_DECISION` | — |
| `AMB-NUM-02` | `REQUIRES_OWNER_DECISION` | `STILL_REQUIRES_OWNER_DECISION` | — |
| `AMB-NUM-03` | no bloqueante | `NON_BLOCKING` | = |
| `AMB-LOG-01` | `REQUIRES_OWNER_DECISION` | `STILL_REQUIRES_OWNER_DECISION` | — |
| `AMB-LOG-02` | no bloqueante | `NON_BLOCKING` (con evidencia nueva) | ▲ |
| `AMB-LOG-03` | no bloqueante | `NON_BLOCKING` | = |
| `AMB-LOG-04` | `REQUIRES_OWNER_DECISION` | `STILL_REQUIRES_OWNER_DECISION` | — |
| `AMB-LOG-05` | no bloqueante | `NON_BLOCKING` | = |
| `AMB-TEM-01` | `REQUIRES_OWNER_DECISION` | `CROSS_DOCUMENT_CONFLICT` | ▲ |
| `AMB-TEM-02` | `REQUIRES_OWNER_DECISION` | `STILL_REQUIRES_OWNER_DECISION` | — |
| `AMB-TEM-03` | resoluble | `RESOLVED_BY_NEW_SOURCE` | ▲ |
| `AMB-TEM-04` | no bloqueante | `NON_BLOCKING` | = |
| `AMB-TEM-05` | no bloqueante | `STILL_REQUIRES_OWNER_DECISION` | ▲ |
| `AMB-TEM-06` | `REQUIRES_OWNER_DECISION` | `STILL_REQUIRES_OWNER_DECISION` | — |
| `AMB-EXT-01` | `REQUIRES_OWNER_DECISION` | `PARTIALLY_RESOLVED` | ▲ |
| `AMB-EXT-02` | `REQUIRES_OWNER_DECISION` | `DEFERRED_UNAVAILABLE_SOURCE` | ▲ |
| `AMB-EXT-03` | no bloqueante | `DEFERRED_UNAVAILABLE_SOURCE` | ▲ |
| `AMB-EXT-04` | `REQUIRES_OWNER_DECISION` | `PARTIALLY_RESOLVED` | ▲ |
| `AMB-EXT-05` | `REQUIRES_OWNER_DECISION` | `PARTIALLY_RESOLVED` | ▲ |
| `AMB-GAP-01` | no bloqueante | `NON_BLOCKING` | = |
| `AMB-GAP-02` | no bloqueante | `NON_BLOCKING` | = |
| `AMB-GAP-03` | no bloqueante | `NON_BLOCKING` | = |
| `AMB-REF-01` | documental | `NON_BLOCKING` | = |
| `AMB-DEF-01` | no bloqueante | `STILL_REQUIRES_OWNER_DECISION` | ▲ |

**Balance:** 1 `RESOLVED_BY_NEW_SOURCE` · 5 `PARTIALLY_RESOLVED` · 13
`STILL_REQUIRES_OWNER_DECISION` · 2 `DEFERRED_UNAVAILABLE_SOURCE` · 7
`NON_BLOCKING` · 0 cerradas por inferencia.

## 11. Detalle de cada resolución

### `AMB-CON-04` — `PARTIALLY_RESOLVED`

- **Fuente → página → sección:** Glosario p.7, «Alumno / Cancelación de venta»
  (`G-13`).
- **Lectura soportada:** «proceso para **alumnos de nuevo ingreso** […] se
  solicita dentro de las primeras 2 semanas del ciclo o cuando sea solicitado por
  el alumno antes de su inicio de clases, p. ej.: por error en su paquete de
  inscripción; no se localiza al alumno y no ingresa al Aula; ya no está
  informado en iniciar».
- **Qué resuelve:** la CV tiene un **predicado de alcance** (nuevo ingreso) y una
  **taxonomía cerrada de 3 motivos**. Los 3 motivos mapean 1:1 a ramas ya
  inventariadas del primario. La ambigüedad «qué separa CV de baja en ajuste
  administrativo» **no** se cierra: «de manera tácita» (`N-56`, p.10) y «o baja,
  según corresponda» siguen sin criterio de selección.
- **Afecta:** hechos `F2-es_nuevo_ingreso`; nodos `NODO-CV-DEF`,
  `NODO-CV-PAQUETE`, `NODO-CV-ILOC`, `NODO-CV-NO-CONT`.
- **Residual:** `REQUIRES_OWNER_DECISION` sobre el estándar probatorio de «tácita».

### `AMB-TEM-01` — `CROSS_DOCUMENT_CONFLICT` (antes `REQUIRES_OWNER_DECISION`)

Siete umbrales temporales sin prevalencia Follows re-clasificado porque las fuentes
nuevas **añaden** umbrales y crean colisiones verificables. Ver `XDC-01` y
`XDC-04`. El carácter de la ambigüedad cambió: ya no es solo «falta un orden de
prevalencia», es «las fuentes se contradicen sobre la ventana».

### `AMB-TEM-03` — `RESOLVED_BY_NEW_SOURCE`

- **Ubicación original:** prevalencia de `N-112` sobre `N-15`.
- **Resolución:** no requiere fuente nueva. `N-112` declara su propia excepción, y
  Phase 1 ya la había marcado resoluble. Phase 1.5 la confirma y la **sella**:
  la exclusión de `N-15` para el caso de quórum está en el propio enunciado, no
  necesita inferencia. → `RESOLVED_BY_NEW_SOURCE` por el texto del primario,
  verificado de nuevo contra p.18 (`5.11`).

### `AMB-TEM-05` — `STILL_REQUIRES_OWNER_DECISION` (sube de no bloqueante)

- **Verificación:** el Glosario **no define «deserción»**. Búsqueda de cadenas:
  0 coincidencias en las 30 páginas.
- **Consecuencia:** la divergencia `N-07` («30 días **hábiles**», p.2) vs
  `N-114` («30 días», p.18) **persiste** y las fuentes nuevas no aportan nada.
- **Cambio de severidad:** pasa a `STILL_REQUIRES_OWNER_DECISION` explícita
  porque el Owner debe confirmar que la divergencia es intencional (indicador vs
  glosario) o un error. Fase 1 la había marcado no bloqueante por afectarse solo
  al indicador; se mantiene no bloqueante para el árbol pero se documenta como
  decisión abierta.

### `AMB-EXT-01` — `PARTIALLY_RESOLVED`

- **Resuelto:** el documento existe y está bloqueado (SHA-256
  `de15e50b…63e9f5`, 30 p.). El primario §3 (p.1) lo invoca, y D53 §3 (p.1) lo
  invoca también. La dependencia documental está satisfecha.
- **Corrección de la premisa de Phase 1:** `AMB-EXT-01` afirmaba que «invasión
  de ciclo» remitía al Glosario. **Falso:** el primario **define** «invasión de
  ciclo» en su propia §3 (p.1, `N-06`), y el Glosario **no** contiene ese
  término. La definición nunca dependió del Glosario.
- **Lo que el Glosario sí resuelve:** 40 definiciones, incluidas todas las
  solicitadas en la instrucción — CV, baja (8 variantes), alumno de nuevo ingreso,
  retención, ciclo, periodo, tipo de ingreso, D35/accepted, D53/preadmitted,
  carta compromiso, campus, cierre de aula, reingreso, revalidación, equivalencia,
  expediente escolar.
- **Lo que NO resuelve:** «deserción» e «invasión de ciclo» **no están** en el
  Glosario.

### `AMB-EXT-02` — `DEFERRED_UNAVAILABLE_SOURCE`

- Flujo del primario §7 (p.21, Lucidchart/Drive): no disponible.
- **Hallazgo nuevo `D-EXT-02`:** D53 §6 (p.7) también tiene un «Diagrama de
  Flujo» en un enlace externo no disponible. **Dos** flujos oficiales ausentes.
- Clasificado `DEFERRED_UNAVAILABLE_SOURCE` por instrucción de Phase 1.5. **No
  bloquea esta fase.** Estructuralmente, la cobertura del flujo oficial sigue
  incompleta.

### `AMB-EXT-03` — `DEFERRED_UNAVAILABLE_SOURCE` + conflicto nuevo

- El «formato de la carta manifiesto» (`N-59`, 5.7.a, p.10) sigue sinAnnex
  («Anexo 1. matriz de validaciones», no incluido) → `DEFERRED_UNAVAILABLE_SOURCE`.
- **Nuevo `XDC-09`:** la fuente primaria habla de **«carta manifiesto»**
  (`N-59`, p.10) con «fecha compromiso» sin plazo; D53 habla de **«carta
  compromiso»** (`D53-12`, p.5) con plazo ≤ 6 meses; el Glosario define «carta
  compromiso» con **2 meses** (`G-19`, p.24). No se establece si «carta
  manifiesto» y «carta compromiso» son el mismo instrumento. No se decide.

### `AMB-EXT-04` — `PARTIALLY_RESOLVED`

- **Resuelto por D53 (`GDM_GAM_PRD_MXL_008`, invocado por el primario §10):**
  - Definición de D53 / PREADMITIDO: «falta el antecedente académico del nivel
    anterior; en SIU se visualiza con la etiqueta "EN VALIDACIÓN"» (`G-18`, p.24).
  - Definición de D35 / ACEPTADO: «cumple con la documentación digital y criterios
    de ingreso completos» (`G-18`, p.24); y «Alumno (MA) […] cuenta con decisión
    35» (`G-05`, p.6).
  - Regla de 6 meses: `D53-04`, `D53-06` (México), `D53-07` (LATAM), `G-08`.
  - Regla del 50%: `D53-04` (≤ 6 meses **o** 50% avance) y `D53-05` (la regla del
    50% **no es fija** y se pretende reducir hasta que el plazo de 6 meses sea el
    operativo).
  - Carta compromiso: `D53-07`, `D53-12` (Latam obligatoria), `D53-13` (México por
    T&C en SIU).
  - Responsable de recolección documental: `D53-02` (Back Office hasta el viernes
    previo) y `D53-03` (pasa a Éxito Estudiantil).
  - Cierre/baja: `D53-10` (50% → cierre de aula; fin de bimestre sin expediente →
    baja definitiva), `D53-11` (miércoles semana 3; bajas al cierre de bimestre).
  - Exclusiones reingreso/equivalencia/revalidación: `D53-01` (p.2) — «No aplica
    para: Reingresos. Equivalencias. Revalidación».
  - Regular vs dictamen técnico: `D53-01` — ambos son tipos de ingreso de nuevo
    ingreso a los que D53 **sí** aplica.
  - México vs LATAM: divergencia explícita `D53-06`/`D53-07` y
    `D53-12`/`D53-13`.
  - Persistencia de la decisión: `D53-08` — entregar el documento **no** cambia
    la decisión D53, solo la clasificación.
  - Tipo de ingreso (4 tipos): `G-22` (p.28); cambio de tipo: `G-21` (p.24).
- **NO resuelto — residual `DEFERRED_UNAVAILABLE_SOURCE`:** el primario 5.7.h
  (`N-67`, p.12) delega los requisitos D53 al «**Anexo 5. Políticas y Normas
  Aplicables a la Decisión 53**», que **no está disponible** y **no es** el
  procedimiento D53 (son documentos distintos). El conjunto de documentos
  obligatorios está en el Anexo 1 de D53 (`D53-23`), tampoco disponible. Y
  «decisión 35 **en tiempo y forma**» (`N-31`, 5.3.a.V, p.5) sigue sin
  definición de «en tiempo y forma» aunque sepamos qué es D35.

### `AMB-EXT-05` — `PARTIALLY_RESOLVED`

- **Resuelto:** el Glosario define el concepto de retención en tres piezas
  (`G-14` proceso, `G-15` desenlace, `G-16` riesgo de baja, p.21) y `G-17` el
  Semáforo/AR. Esto **confirma** que la «retención» es un **desenlace**, no una
  causa — corroborando el hallazgo de Phase 1.
- **NO resuelto:** las **matrices de estrategias** (Anexo 2 «Matriz Estrategias
  de Retención» y Anexo 4 «… Copiloto Ventas», primario §9, p.22) siguen
  ausentes → `DEFERRED_UNAVAILABLE_SOURCE` para la verificación de
  `F-estrategias_presentadas`.

### `AMB-LOG-02` — `NON_BLOCKING`, con evidencia nueva

- **No resuelta** por las fuentes nuevas (no definen la polaridad de `5.8.a`).
- **Evidencia nueva aportada al Owner:** el propio primario se contradice. `5.8.a`
  (p.12) lista, para **Posgrados y Ejecutivas**, «**No haber** registrado
  participación en foros» como criterio de **contacto efectivo**; pero `5.8.i`
  (p.14) establece que para posgrado el ingreso válido al aula requiere
  «**Evidenciar participación** en el foro de presentación». La polaridad de
  `5.8.a` es lo inverso de `5.8.i`. Se **documenta**; no se resuelve.

## 12. Conflictos entre documentos — `XDC-01` … `XDC-09`

Cada conflicto **preserva ambas lecturas** y ninguna se resuelve por plausibilidad.

### `XDC-01` — Ventana de cancelación de venta: tres definiciones incompatibles

| Fuente | Página | Texto | Ventana |
|---|---|---|---|
| Primario `N-25` | 6 (5.1.d) | «Las Cancelaciones de venta solo se podrán solicitar durante las primeras 2 semanas **después de la fecha de inicio**.» | 2 sem **post**-inicio |
| Glosario `G-13` | 7 | «dentro de las primeras 2 semanas **del ciclo** **o** cuando sea solicitado por el alumno **antes de su inicio de clases**» | 2 sem del ciclo **o** pre-inicio |
| D53 `D53-17` | 6 (5.4.1.1) | «Una cancelación de venta se aplica cuando el estudiante es dado de baja durante el **primer mes** de ingreso por motivos ajenos a la decisión D53.» | 1 mes (≈sem 4) |

**Agravante declarado en el primario** (p.17, 5.9 «Consideración sobre tiempos»):
«Una vez concluido este plazo [semana 3 posterior al inicio del ciclo], **no será
posible revertir el estatus de cancelación de venta a baja, ni de baja a
cancelación de venta**.» La ventana de D53 (primer mes ≈ semana 4) cae **después**
de un punto de irreversibilidad declarado por el primario.

**Efecto:** las tres ventanas no son reconciliables sin arbitramento. Primario y
Glosario son mayormente compatibles (2 semanas; el pre-inicio del Glosario lo
cubre el primario en 5.3.a.I `N-26`, p.4). **D53 es incompatible** con la
irreversibilidad de la semana 3. Estado: `CROSS_DOCUMENT_CONFLICT`.
Afecta: `NODO-CV-DEF`, ramas CV por ilocalizable, por no-continuar, por error de
paquete, y toda rama D53 que termine en CV.

### `XDC-02` — «Carta compromiso»: 2 meses (Glosario) vs ≤ 6 meses (D53)

| Fuente | Página | Plazo |
|---|---|---|
| Glosario `G-19` | 24 | «un término de **dos meses**» |
| D53 `D53-12` | 5 | «una fecha límite […] **no mayor a 6 meses**» |

Afecta: `F2-cc_termino_meses` (dominio `INDETERMINADO`), `NODO-D53-04`, la baja
por falta de documentos y el calendario de `D53-06`/`D53-07`. Ningún documento
establece precedencia. `OWNER_DECISION`.

### `XDC-03` — Anclaje del plazo de 6 meses

| Fuente | Página | Anclaje |
|---|---|---|
| Glosario `G-08` | 6 | «6 meses posteriores al **inicio del primer ciclo académico**» |
| D53 `D53-06` | 3 | «6 meses **desde su ingreso**» |

Para alumnos que cambian de ciclo o se reinscriben a mitad de ciclo, los relojes
difieren. `OWNER_DECISION`.

### `XDC-04` — «Primer bimestre» / «ciclo» / «30 días»: duraciones incompatibles

| Concepto | Fuente | Valor declarado |
|---|---|---|
| Ciclo | `G-29` (p.29) | 14 semanas |
| Periodo | `G-30` (p.30) | «parte **bimestral** de un ciclo» → 7 semanas |
| Bimestre (Licenciatura) | `G-31` (p.29) | 7+6+4+9 = **26 semanas** ⚠ contradice el ciclo de 14 |
| Deserción (indicador) | `N-114` (p.18) | 30 días tras inicio de ciclo |
| Baja D53 (México) | `D53-06` (p.3) | 6 meses desde ingreso |
| Comisión D53 | `D53-16` (p.6) | «primer bimestre» / «a partir del tercer mes» |
| Cierre de aula D53 | `D53-11` (p.4) | miércoles semana 3 **del bimestre** |

La unidad «bimestre» del primario y de D53 **no tiene duración declarada** por
ninguna fuente disponible, y el Glosario se contradice a sí mismo (14 vs 26
semanas). No se puede alinear «primer bimestre» con «30 días» ni con «semana 3».
`OWNER_DECISION`.

### `XDC-05` — «Expediente completo»: conjunto de documentos no disponible

Glosario `G-23` (p.26) define «expediente escolar» como conjunto; D53 `D53-10`
exige «expediente completo» para la baja; pero **el conjunto de documentos
obligatorios** está en el Anexo 1 de D53 (`D53-23`, no disponible) y en el Anexo 1
del primario (Anexo 1 «Documentos de Ingreso Estudiantes», `N-66`, no
disponible). Sin esos anexos, «¿está completo el expediente?» **no es
determinable** → `DEFERRED_UNAVAILABLE_SOURCE` con efecto bloqueante local sobre
`NODO-D53-05`.

### `XDC-06` — «Alumno regular» (estatus) vs «Regular» (tipo de ingreso)

Glosario `G-03` (p.6) define «Alumno regular» como un **estatus** (4 condiciones
de trayectoria) mientras `G-22` (p.28) usa «Regular» como **tipo de ingreso**.
D53 `D53-01` habla de «nuevo ingreso (tipo regular o dictamen técnico)» — el
sentido de **tipo**. El primario no usa «alumno regular» ni «alumno irregular».
No hay colisión *textual* entre documentos, pero hay **colisión de término dentro
del Glosario**; el motor no debe tratar ambos como el mismo hecho.
`F2-estatus_alumno_regular` ≠ `F2-tipo_ingreso == REGULAR`. No se resuelve.

### `XDC-07` — «Alumno futuro» y la CV de quien no inicia

Glosario `G-02` (p.6) define «alumno futuro» como quien espera la fecha de inicio
de ciclo; `G-13` (p.7) incluye como motivo de CV «no se localiza al alumno y no
ingresa al Aula». El primario 5.9.a (p.16) dice que los canales College y
Upselling «contemplan inscripciones de **estudiantes futuros**» y que la CV
operativa **no aplica** para ellos. Tensión documental menor: el estatus de
«futuro» interactúa con la CV de ilocalizable. No se resuelve sin saber la
relación exacta entre «futuro» y la ventana de 2 semanas. `OWNER_DECISION`
(menor).

### `XDC-08` — «Contacto»: lead vs. contacto efectivo con el alumno

Glosario `G-27` (p.14) define «Contacto» como **registro de lead** con respuesta
(CRM). El primario 5.8.h (p.14) usa «contacto efectivo» como **interacción con el
estudiante**del titular. `G-28` «Incidencias» = marcaciones automáticas que
impiden el contacto. El término «contacto» tiene **dos significados distintos**
en fuentes distintas sin que ninguna declare la equivalencia. El motor no debe
fusionarlos. No se resuelve.

### `XDC-09` — «Carta manifiesto» vs «carta compromiso»

Detallado en `AMB-EXT-03`. Primario `N-59` (p.10) «carta manifiesto» (sin plazo);
D53 `D53-12` (p.5) «carta compromiso» (≤6 meses); Glosario `G-19` (p.24) «carta
compromiso» (2 meses). No se establece identidad entre los dos instrumentos. No
se resuelve.

## 13. Ambigüedades nuevas de Phase 1.5

| ID | Descripción | Estado |
|---|---|---|
| `AMB-TEM-07` | `D53-05` declara que la regla del 50% «no es fija» y se «pretende reducirla» hasta que el plazo de 6 meses sea el operativo. ¿Qué regla rige **hoy**? El texto es una **intención de reforma**, no una derogación. | `STILL_REQUIRES_OWNER_DECISION` |
| `AMB-CON-05` | `G-20` prueba que existe diferenciación por campus, pero **no** dice qué reglas difieren. Solo D53 declara una divergencia concreta. | `STILL_REQUIRES_OWNER_DECISION` |
| `AMB-CON-06` | `G-12` define «reversión de baja» (baja en el periodo en curso, reactivación) y `G-11` «reingreso» (tras ≥1 periodo con baja). El primario usa «baja» sin desambiguar cuál aplica a una reactivación dentro del mismo ciclo. | `STILL_REQUIRES_OWNER_DECISION` |

`AMB-TEM-07` es la más relevante: `D53-04` (6 meses **o** 50%) y `D53-05` (el 50%
«no es fija» y se reducirá) coexisten. Si la regla del 50% sigue vigente, la
baja puede ocurrir al 50% aunque no hayan pasado 6 meses; si ya no, solo a los 6
meses. El texto **no permite elegir**. `OWNER_DECISION`.

## 14. Preguntas al Owner tras Phase 1.5

Ordenadas por impacto en la Apertura de ramas:

| # | Pregunta | ID |
|---|---|---|
| 1 | ¿Cuál es la **ventana de CV**? (2 semanas post / 2 semanas ciclo o pre / primer mes D53) | `XDC-01` |
| 2 | ¿Qué **plazo** tiene la carta compromiso: 2 meses o 6 meses? | `XDC-02` |
| 3 | ¿El plazo de 6 meses se ancla al **ingreso** o al **inicio del primer ciclo**? | `XDC-03` |
| 4 | ¿Cuánto dura un **bimestre**? (7 vs 26 semanas vs 30 días vs 6 meses) | `XDC-04` |
| 5 | ¿El 50% de avance **sigue vigente** o ya solo aplica el plazo de 6 meses? | `AMB-TEM-07` |
| 6 | ¿Qué **documentos** forman el expediente completo? (Anexo 1, no disponible) | `XDC-05` |
| 7 | ¿«carta manifiesto» y «carta compromiso» son el mismo instrumento? | `XDC-09` |
| 8 | En `5.8.a`, ¿la polaridad negativa de 3 niveles es **error de redacción**? (`5.8.i` dice lo contrario) | `AMB-LOG-02` |
| 9 | ¿`N-46` prevalece sobre `N-52`? (sin cambio desde Phase 1) | `AMB-CON-03` |
| 10 | ¿Cuál ruta de escalamiento de `5.6.f`? (sin cambio) | `AMB-CON-02` |
| 11 | ¿`N-33` prevalece sobre `N-27`? (sin cambio) | `AMB-CON-01` |
| 12 | ¿Qué reglas, además de D53, difieren entre campus México y LATAM? | `AMB-CON-05` |
| 13 | ¿Cuál es el estándar probatorio de «de manera tácita»? | `AMB-CON-04` (residual) |
| 14 | ¿Qué es «decisión 35 **en tiempo y forma**»? | `AMB-EXT-04` (residual) |
| 15 | ¿La doble definición de deserción (30 días hábiles vs 30 días) es intencional? | `AMB-TEM-05` |

Las 12 primeras preguntas desbloquean ramas del árbol. Las preguntas 9–11 y 15
son las de Phase 1 que **no** se movieron.
