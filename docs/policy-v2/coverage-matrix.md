# Matriz de Cobertura — GDM_GAM_PRD_MLG_003 v5

**Fase:** Decision Tree Phase 1 — Extracción normativa
**Fuente:** `GDM_GAM_PRD_MLG_003` v5, `14/09/2026`, SHA-256 `71faf646…96c7d2`
**Estado:** `COVERAGE_MEASURED` — la matriz **nombra sus propios huecos**

> Una matriz de cobertura que no declara lo que no cubre es propaganda, no
> trazabilidad. Esta matriz enumera explícitamente cada hueco. Conforme a
> `rebuild-decision-tree-phase-1.md`, Task 5: «rules with no case (explicit gaps,
> not silently omitted)».

---

## 1. Definición de estados de cobertura

| Estado | Significado |
|---|---|
| `COVERED` | El enunciado tiene hechos, condiciones y rama de decisión modeladas |
| `COVERED_NODECISION` | El enunciado está transcrito y tiene hechos, pero **no** participa en el árbol (indicadores, definiciones, responsabilidades) |
| `PARTIAL` | Parte del enunciado está cubierta; falta un elemento |
| `NOT_COVERED` | El enunciado **no** pudo transcribirse porque su contenido está fuera del PDF |
| `BLOCKED` | Cubierto en diseño, pero bloqueado por una ambigüedad que requiere decisión del Owner |

**Regla:** no se declara `COVERED` un enunciado que tenga hechos pero cuya rama
esté bloqueada por `REQUIRES_OWNER_DECISION`. Eso es `BLOCKED`.

---

## 2. Cobertura por sección del documento

| Sección | Título | Página | Enunciados | Estado | Bloqueantes | Observación |
|---|---|---|---|---|---|---|
| `1` | Objetivo | 1 | 1 | `COVERED_NODECISION` | — | Propósito; no genera condición |
| `2` | Alcance | 1 | 3 | `COVERED_NODECISION` | — | Ámbito MX/LATAM sí se usa (`N-56`) |
| `3` | Glosario | 1→2 | 3 | `PARTIAL` | `AMB-EXT-01` | Glosario de operación escolar ausente |
| `4` | Dueño de Proceso | 2 | 1 | `COVERED_NODECISION` | — | Identifica área propietaria |
| `5.1` | Notificaciones de CV | 2→3 | 9 | `COVERED` | `AMB-TEM-01` | Flujo de 72 h modelado |
| `5.2` | Intentos de contacto mínimos | 3→4 | 8 | `BLOCKED` | `AMB-LOG-01`, `AMB-NUM-01`, `AMB-NUM-02`, `AMB-NUM-03` | Conectiva y umbrales no declarados |
| `5.3` | A solicitud del estudiante | 4→6 | 13 | `BLOCKED` | `AMB-CON-01`, `AMB-CON-04`, `AMB-TEM-02` | Escenarios I–V + retención obligatoria |
| `5.4` | Cambios de ciclo | 6→7 | 4 | `COVERED` | `AMB-EXT-02` | Par condición/excepción explícito |
| `5.5` | Error de inscripción | 7 | 2 | `PARTIAL` | `AMB-GAP-03` | Enuncia gestión sin desenlace final |
| `5.6` | Promesa de venta no cumplida | 7→10 | 14 | `BLOCKED` | `AMB-CON-02`, `AMB-CON-03` | Doble ruta de escalamiento + conflicto restrictivo/expansivo |
| `5.7` | Entrega de documentos | 10→12 | 9 | `PARTIAL` | `AMB-GAP-02`, `AMB-EXT-03`, `AMB-EXT-04` | `N-66` sin desenlace; Anexos ausentes |
| `5.8` | Estudiantes ilocalizables | 12→15 | 24 | `BLOCKED` | `AMB-LOG-04` | Mayor densidad normativa del documento |
| `5.9` | Cancelaciones operativas | 15→17 | 13 | `PARTIAL` | `AMB-LOG-05`, `AMB-TEM-01` | 7 sub-causales; `OP-F` clasifica distinto |
| `5.10` | Mystery Shopper | 17 | 1 | `COVERED` | — | Filtro de canal de primer nivel |
| `5.11` | Falta de quórum | 17→18 | 7 | `COVERED` | — | Única prevalencia temporal declarada |
| `5.12` | Indicador CV y Bajas | 18→19 | 5 | `COVERED_NODECISION` | `AMB-TEM-05` | Indicador; no participa en el árbol |
| `5.13` | Soporte de evidencias Flokzu | 19 | 2 | `COVERED_NODECISION` | — | Requisito de evidencia, no condición |
| `5.14` | Solicitud de evidencias | 19→20 | 3 | `COVERED_NODECISION` | — | SLA; no decisional |
| `5.15` | Atención de solicitudes | 20→21 | 8 | `COVERED_NODECISION` | — | SLA; no decisional |
| `6` | Descripción de Actividades | 21 | 1 | `NOT_COVERED` | `AMB-EXT-02` | **Contenido en Drive externo** |
| `7` | Diagrama de Flujo | 21 | 1 | `NOT_COVERED` | `AMB-EXT-02` | **Imagen referenciada, no incluida** |
| `8` | Indicadores | 21→22 | 4 | `COVERED_NODECISION` | — | 4 indicadores con fórmula |
| `9` | Anexos | 22 | 2 | `NOT_COVERED` | `AMB-EXT-03`, `04`, `05` | **8 anexos referenciados, 0 incluidos** |
| `10` | Documentos de Referencia | 22 | 1 | `NOT_COVERED` | `AMB-EXT-01`…`05` | **3 documentos externos** |
| `11` | Control de Cambios | 23→26 | 5 | `COVERED_NODECISION` | `AMB-REF-01` | Historial; no cita norma |

**Totales por estado:**

| Estado | Secciones | Enunciados |
|---|---|---|
| `COVERED` | 4 | 30 |
| `BLOCKED` | 4 | 59 |
| `PARTIAL` | 3 | 25 |
| `COVERED_NODECISION` | 11 | 39 |
| `NOT_COVERED` | 4 | 5 |
| **Total** | **26** | **139** — verificado por parsing |

---

## 3. Cobertura de los desenlaces

| Desenlace | Enunciados | Estado | Observación |
|---|---|---|---|
| `CANCELACION_VENTA` | 18 | `COVERED` | Ramas: ciclo-A, promesa, quórum, D53-doc, ilocalizable |
| `BAJA` | 6 | `COVERED` | Filtro de devengo (`N-64`) + `N-33` + `N-53` + `N-98` |
| `CANCELACION_VENTA_OPERATIVA` | 8 | `PARTIAL` | `AMB-LOG-05` en `OP-F` |
| `CANCELACION_MATRICULA` | 1 | `COVERED` | Solo canal Mystery Shopper |
| `RETENCION` | 6 | `COVERED` | Sin desenlace de salida propio; se resuelve en `N-32` |
| `DICTAMINACION` | 4 | `PARTIAL` | `AMB-CON-02` en 5.6.f |
| `REQUIRES_OWNER_DECISION` | derivado | `COVERED` | 14 ambigüedades mapeadas |
| `REQUIRES_HUMAN_REVIEW` | derivado | `COVERED` | Por `UNKNOWN` propagado |

**Ningún desenlace queda sin modelar.** La fuente no establece ningún desenlace
adicional; si la lista crece, es porque apareció una ambigüedad nueva, no porque
se inventó una categoría.

---

## 4. Huecos declarados (cobertura NO alcanzada)

Estos huecos son **intencionales y explícitos**. Ninguno se rellenó por
inferencia.

### 4.1 `GAP-COV-01` — El flujo oficial del proceso está fuera del PDF

| | |
|---|---|
| **Sección** | `6` (Descripción de Actividades) y `7` (Diagrama de Flujo) |
| **Páginas** | 21 |
| **Causa** | El documento remite a un enlace de Drive y a una imagen `.png` hosted en Lucidchart |
| **Impacto** | La **secuencia de decisión completa** vive fuera de la fuente bloqueada. El árbol de Fase 1 se reconstruyó solo con el texto de las páginas 1–20. |
| **Lo que NO se hizo** | No se infirieron aristas, orden de etapas ni rutas de un archivo ausente. |
| **Ambigüedad** | `AMB-EXT-02` |
| **Estado** | `NOT_COVERED` — requiere que el Owner incorpore el diagrama a la fuente |

**Este es el hueco de cobertura más grave de la fase.** Cualquier etapa del
proceso que solo exista en el diagrama es desconocida para el árbol.

### 4.2 `GAP-COV-02` — Ocho anexos referenciados, ninguno incluido

| Anexo | Citado en | Enunciados que dependen | Estado |
|---|---|---|---|
| Anexo 1. matriz de validaciones | p.22 | — | `NOT_COVERED` |
| Anexo 2. Matriz Estrategias de Retención | p.22 | `N-32`, `N-46` | `NOT_COVERED` (`AMB-EXT-05`) |
| Anexo 3. flujo y botones en flokzu | p.22 | `N-09`, `N-17` | `NOT_COVERED` |
| Anexo 4. Matriz Estrategias de Retención - Copiloto Ventas | p.22 | `N-32` | `NOT_COVERED` (`AMB-EXT-05`) |
| Anexo 5. Políticas y Normas Aplicables a la Decisión 53 | p.22 | `N-67`, `N-63` | `NOT_COVERED` (`AMB-EXT-04`) |
| Anexo 6. oficinas virtuales | p.22 | `N-79` | `NOT_COVERED` |
| Anexo 7. Flokzu Cancelacion de ventas OPM | p.22 | `N-105` | `NOT_COVERED` |
| Anexo 8 Manual de levantamiento de tickets de CV | p.22 | `N-09` | `NOT_COVERED` |
| Anexo 1. Documentos de Ingreso Estudiantes | p.22 | `N-65`, `N-59` | `NOT_COVERED` (`AMB-EXT-03`) |
| Anexo 7. Matriz de identificación para casos extemporáneos | p.22 | `N-57`, `N-58` | `NOT_COVERED` |

**Ninguna regla de la Matriz de validaciones (Anexo 1) pudo extraerse.** Es
probablemente la fuente más relevante de reglas de validación después del
cuerpo del documento, y está ausente.

### 4.3 `GAP-COV-03` — Tres documentos de referencia externos

| Documento | Citado en | Enunciados dependientes |
|---|---|---|
| `GCE_GCE_PRD_MXL_001` Cambio de ciclo y Fecha | pp.6, 22 | `N-40` |
| `GDM_GAM_PRO_MXL_001` Proceso Gestión de admisión y matricula | p.22 | `N-65` (Anexo 1 de ese proceso) |
| `GDM_GAM_PRD_MXL_008` Procedimiento D53 | p.22 | `N-67`, `N-63`, `N-31`, `N-29` |

`ONLY_OWNER_PROVIDED_POLICY_SOURCES` impide usar fuentes de internet para
completarlas. No se buscó ninguna.

### 4.4 `GAP-COV-04` — Glosario de operación escolar

`N-05` (p.1) lo enuncia como definición importante para el entendimiento de las
políticas, pero no se incluye. La definición de invasión de ciclo (`N-06`) remite
a él.

### 4.5 `GAP-COV-05` — `N-66` sin consecuencia normativa

El inciso enuncia un requisito (100% de créditos) y no declara desenlace. No se
puede construir la rama. Ver `AMB-GAP-02`.

### 4.6 `GAP-COV-06` — `N-44` sin desenlace de salida

`N-44` (p.7) escala a Mejora Continua y ofrece segunda inscripción, pero no
declara qué ocurre si el estudiante rechaza. Ver `AMB-GAP-03`.

### 4.7 `GAP-COV-07` — `N-34` sin sanción especificada

La sanción por falta de retención no está definida ni se identifican las «ambas
áreas». `F-sancion_aplicada` queda permanentemente `UNKNOWN`. Ver `AMB-GAP-01`.

### 4.8 `GAP-COV-08` — Casos de prueba (golden cases) no construidos

Conforme a `HISTORICAL_CASES_ARE_NOT_POLICY` y a la Task 4 del prompt de fase
 («Build golden cases **only** from the source»), **no se construyó ningún caso de
prueba en Fase 1**.

**Razón:** los golden cases requieren resolver las 14 ambigüedades bloqueantes.
Un caso construido sobre `AMB-TEM-01` (siete umbrales sin prevalencia) tendría
que elegir un umbral, y esa elección sería política, no derivable de la fuente.

**Estado:** `NOT_COVERED` por diseño. Los casos se construirían al inicio de Fase
2, **después** de que el Owner resuelva las ambigüedades.

### 4.9 `GAP-COV-09` — Enunciados con connectivity indeterminada

Cuatro reglas tienen la connectiva sin declarar y no pueden evaluarse:

| Enunciado | Falta | Ambigüedad |
|---|---|---|
| `N-18` + `N-19` | ¿`AND` u `OR` entre llamadas y escritos? | `AMB-LOG-01` |
| `N-83`…`N-89` (5.8.h) | ¿`AND` u `OR` entre los 6 criterios de contacto? | `AMB-LOG-04` |
| `N-69` vs 5.8.h | ¿Sustituye, complementa o alterna? | `AMB-LOG-04` |
| `N-21` | Valor del intervalo de colapso | `AMB-NUM-02` |

### 4.10 `GAP-COV-10` — Enunciados con desenlace no determinado

Tres enunciados conducen a «cancelación de venta **o** baja, según corresponda»
sin declarar el criterio de selección:

| Enunciado | Página | Ambigüedad |
|---|---|---|
| `N-36` | 6 | `AMB-CON-04` |
| `N-78` | 13 | `AMB-CON-04` |
| `N-103` | 17 | `AMB-TEM-01` |

---

## 5. Cobertura de los hechos

| Categoría | Hechos | Cada uno con cita `N-xx` | Verificable sin documentos externos |
|---|---|---|---|
| Temporales | 11 | Sí | Sí |
| Recuento/umbral | 17 | Sí | Parcial (`AMB-NUM-02` deja 1 no calculable) |
| Estado/estatus | 15 | Sí | Parcial (D53 requiere Anexo 5) |
| Evidencia | 38 | Sí | Sí |
| Retención | 8 | Sí | No (`AMB-EXT-05`: estrategias no especificadas) |
| Promesa de venta | 8 | Sí | Sí |
| Cancelación operativa | 13 | Sí | Sí |
| Cambio de ciclo | 8 | Sí | Sí |
| SLA (no decisionales) | 7 | Sí | Sí |
| **Total** | **125** | **125/125** | — |

**125 de 125 hechos** tienen al menos una cita normativa. Ninguno se inventó.

---

## 6. Trazabilidad: enunciado → rama

Verificación de que cada rama del árbol nombra su fuente.

| Rama | Enunciados que la sostienen | Cita de página | Estado |
|---|---|---|---|
| Filtro devengo | `N-64` | p.11 | `COVERED` |
| Filtro canal | `N-105` | p.17 | `COVERED` |
| Filtro incidencia | `N-95`, `N-96`, `N-98` | p.16 | `COVERED` |
| Filtro retención | `N-33`, `N-34` | p.5 | `BLOCKED` (`AMB-CON-01`) |
| Regla temporal rectora | `N-35` | p.5 | `BLOCKED` (`AMB-TEM-02`) |
| `CAUSAL-V` | `N-36`, `N-37` | pp.5→6 | `BLOCKED` (`AMB-CON-04`) |
| `CAUSAL-EE` | `N-43`, `N-44` | p.7 | `PARTIAL` (`AMB-GAP-03`) |
| `CAUSAL-CICLO-A` | `N-41`, `N-39` | pp.6→7 | `COVERED` |
| `CAUSAL-CICLO-B` | `N-42` | p.7 | `COVERED` |
| `CAUSAL-PROMESA` | `N-45`, `N-46`, `N-52` | pp.7→9 | `BLOCKED` (`AMB-CON-03`) |
| `CAUSAL-ILOC` | `N-68`, `N-70`…`N-75` | pp.12→13 | `BLOCKED` (`AMB-LOG-04`) |
| `CAUSAL-ILOC-ESPECIAL` | `N-79`, `N-80` | p.14 | `COVERED` |
| `CAUSAL-BOT` | `N-82` | p.14 | `COVERED` |
| `CAUSAL-OPERATIVA` | `N-92`…`N-102` | pp.16→17 | `PARTIAL` (`AMB-LOG-05`) |
| `CAUSAL-QUORUM` | `N-106`…`N-112` | pp.17→18 | `COVERED` |
| `CAUSAL-ILOC-SOLIC` | `N-81` | p.14 | `COVERED` (delega desenlace) |
| `CAUSAL-D53` | `N-67` | p.12 | `BLOCKED` (`AMB-EXT-04`) |
| `CAUSAL-ILOC-DOC` | `N-59`, `N-60`, `N-63`, `N-66` | pp.10→12 | `PARTIAL` |
| `ESCALAMIENTO` | `N-13`, `N-14`, `N-57`, `N-58`, `N-89` | pp.2→3, 10, 15 | `BLOCKED` (`AMB-CON-02`) |
| **Total ramas** | — | — | **19** |

**19 ramas, 19 conjuntos de citas.** Ninguna rama existe sin enunciado que la
sostenga; ningún enunciado con desenlace quedó sin rama.

**Alcance de la tabla:** la §6 cita **49 enunciados** que sostienen directamente
una rama (39 explícitos + los rangos `N-70…N-75` y `N-92…N-102`, que suman 10).
Los enunciados de contraevidencia, requisito y definición que apoyan a esas
mismas ramas —por ejemplo `N-50`…`N-56` en `CAUSAL-PROMESA`, `N-91` en
`CAUSAL-ILOC`— se citan en `decision-tree.md` y en `fact-catalog.md`, no en esta
tabla, para evitar duplicar la misma referencia en dos lugares.

---

## 7. Métricas de cobertura

| Métrica | Valor | Interpretación |
|---|---|---|
| Enunciados transcritos | 139/139 | 100 % de las páginas leídas |
| Enunciados con página verificada | 139/139 | 100 % |
| Enunciados que sostienen una rama (§6, rangos expandidos) | 49 | 35 % — el resto es indicador, SLA, contraevidencia o requisito |
| Enunciados `COVERED` | 30 | |
| Enunciados `BLOCKED` | 59 | 42 % — bloqueados por ambigüedad |
| Enunciados `PARTIAL` | 25 | 18 % |
| Enunciados `COVERED_NODECISION` | 39 | 28 % — correctos por diseño |
| Enunciados `NOT_COVERED` | 5 | 4 % — contenido fuera del PDF |
| Hechos con cita | 125/125 | 100 % |
| Ramas con cita | 19/19 | 100 % |
| Ambigüedades bloqueantes | 14 | requieren decisión del Owner |
| Golden cases | 0 | por diseño (`GAP-COV-08`) |
| Cobertura de anexos | 0/10 | contenido ausente |
| Cobertura de referencias externas | 0/3 | contenido ausente |

---

## 8. Honestidad de la cobertura

Declaro explícitamente lo que esta matriz **no** acredita:

1. **No acredita que el árbol esté completo.** El 42 % de los enunciados está
   `BLOCKED` y la sección 7 del documento (el flujo oficial) tiene cobertura
   `NOT_COVERED`. El árbol es una **reconstrucción textual** de las páginas 1–20,
   no el flujo oficial.
2. **No acredita corrección.** Fase 1 transcribe y organiza. Si la transcripción
   tiene un error, la cobertura lo heredará. La verificación fue contra el texto
   extraído del PDF, no contra el documento impreso.
3. **No hay validación cruzada.** Ningún enunciado fue contrastado con un caso
   histórico, **deliberadamente**, porque `HISTORICAL_CASES_ARE_NOT_POLICY` y
   porque hacerlo habría introducido política no normativa.
4. **No hay casos de prueba.** `GAP-COV-08` explica por qué.
5. **No hay motor.** Nada de este documento es ejecutable. La frontera
   `AUDIT_ENGINE_NOT_IMPLEMENTED` sigue vigente.

---

## 9. Conclusión de cobertura

| Criterio de salida de Fase 1 | Estado |
|---|---|
| Cada enunciado normativo transcrito con cita verificable | **PASS** |
| Cada enunciado clasificado en un estado de cobertura | **PASS** |
| Los huecos nombrados explícitamente | **PASS** |
| Ningún hueco rellenado por inferencia | **PASS** |
| Hechos sin inventar | **PASS** |
| Ramas sin enunciado que las sostenga | **PASS** (0) |
| Motor determinista construible en este estado | **FAIL** — 14 ambigüedades bloqueantes |

**Veredicto: la base normativa de Fase 1 está completa y trazable, pero NO es
suficiente para construir el motor.** Las 14 ambigüedades bloqueantes deben
resolverse con decisiones del Owner antes de que la Fase 2 pueda producir un
resultado determinista. Este es el resultado correcto: un motor determinista
construido sobre ambigüedades no resueltas produciría decisiones correctas por
azar.
