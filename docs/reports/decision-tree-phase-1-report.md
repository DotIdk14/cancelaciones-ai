# Reporte — Decision Tree Phase 1: Extracción Normativa

**Proyecto:** Cancelaciones AI
**Fase:** Decision Tree Phase 1 — Extracción normativa
**Fuente normativa:** `GDM_GAM_PRD_MLG_003` — Procedimiento Deserción de Estudiantes
**Versión de la fuente:** `5` · **Publicación:** `14/09/2026` · **Páginas:** `26`
**SHA-256 de la fuente:** `71faf64634805b1b4820132cdfcc1304d740ff00d1e9573dd850222c9496c7d2`
**Resultado de fase:** `COMPLETE_WITH_BLOCKERS`
**Frontera del motor:** `AUDIT_ENGINE_NOT_IMPLEMENTED` — **sin cambios**

---

## 1. Resumen ejecutivo

Fase 1 construyó la base de conocimiento normativa **exclusivamente** desde el
PDF autoritativo, sin derivation de código, reportes o casos históricos. Se
transcribieron **139 enunciados normativos** de las 26 páginas, se definieron
**125 hechos** con cita, y se diseñó un árbol de **19 ramas** con 6 desenlaces y
4 filtros de prevalencia.

**El hallazgo principal no es el volumen, sino el bloqueo:** la fuente contiene
**28 ambigüedades**, de las cuales **14 son bloqueantes**. La fuente define
**7 umbrales temporales distintos sin orden de prevalencia**, contiene una
contradicción de polaridad en 3 de 4 niveles de programa, y **delega su flujo
oficial a un diagrama de Lucidchart que no está en el PDF**.

**Conclusión:** la base normativa de Fase 1 es completa y trazable, pero **no es
suficiente para construir un motor determinista**. Un motor construido ahora
produciría decisiones correctas por azar en las ramas ambigüedas.

---

## 2. Entregables

| # | Archivo | Contenido | Estado |
|---|---|---|---|
| 1 | `docs/policy-v2/source-lock.md` | Bloqueo de fuente, hash, procedencia, copias candidatas | `LOCKED` |
| 2 | `docs/policy-v2/normative-inventory.md` | 139 enunciados transcritos con página verificada | `INVENTORY_COMPLETE` |
| 3 | `docs/policy-v2/fact-catalog.md` | 125 hechos, 4 centinelas, reglas de conexión | `FACT_CATALOG_COMPLETE` |
| 4 | `docs/policy-v2/decision-tree.md` | 19 ramas, 6 desenlaces, 4 filtros, 3 valores | `TREE_SPECIFIED` |
| 5 | `docs/policy-v2/ambiguities.md` | 28 ambigüedades, 14 bloqueantes | `AMBIGUITIES_RECORDED` |
| 6 | `docs/policy-v2/coverage-matrix.md` | Cobertura por sección, 10 huecos declarados | `COVERAGE_MEASURED` |
| 7 | `docs/phase-prompts/decision-tree-phase-2.md` | Prompt de Fase 2 | `GENERATED_NOT_EXECUTED` |
| 8 | `docs/reports/decision-tree-phase-1-report.md` | Este reporte | `COMPLETE_WITH_BLOCKERS` |

---

## 3. Source Lock

| Verificación | Resultado |
|---|---|
| Código visible en el documento | `GDM_GAM_PRD_MLG_003` en **26/26** páginas |
| Versión visible | `5` en **26/26** páginas |
| Fecha de publicación visible | `14/09/2026` en **26/26** páginas |
| Paginación impresa | `Página: N de 26`, verificada en las 26 |
| SHA-256 del archivo | `71faf646…96c7d2` |
| Contenido = blob en `HEAD` | **PASS** (byte-idéntico) |
| Copias candidatas en conflicto | **0** |
| Versiones divergentes del mismo código | **0** |

**Resultado: `AUTHORITATIVE_NORMATIVE_SOURCE_VERIFIED`.** No aplica
`BLOCKED: AUTHORITATIVE_NORMATIVE_SOURCE_NOT_VERIFIED`.

### 3.1 Hallazgo de procedencia `D-SL-01`

Al iniciar la fase se detectó una discrepancia de nombre en el working tree:
Git versionaba `normative/GDM_GAM_PRD_MLG_003  PROCEDIMIENTO DESERCIÓN DE
ESTUDIANTES.docx.pdf` y el disco tenía el mismo archivo sin `.docx`
(rename no stageado, marcado `D` + `??`).

**Verificación:** el blob en `HEAD` y el archivo en disco son **byte-idénticos**
(mismo SHA-256 `71faf646…96c7d2`, mismo tamaño `464649`).

**Resolución:** se restauró el nombre canónico versionado, **sin alterar un
solo byte**. El nombre canónico es referenciado por
`docs/reports/clean-slate-audit-report.md:7` y por
`docs/phase-prompts/rebuild-decision-tree-phase-1.md:25`; el título embebido del
PDF es `…ESTUDIANTES.docx`, lo que explica el sufijo.

**Working tree quedó limpio.** El PDF no fue modificado, re-generado ni
re-exportado. El sufijo `.docx` forma parte de la identidad de procedencia y no
debe eliminarse sin decisión del Owner.

---

## 4. Trabajo normativo realizado

### 4.1 Transcripción

| Métrica | Valor |
|---|---|
| Páginas leídas | 26/26 |
| Enunciados normativos | 139 |
| `condition` | 46 |
| `requirement` | 26 |
| `temporal` | 19 |
| `procedure` | 16 |
| `definition` | 12 |
| `indicator` | 9 |
| `scope` | 4 |
| `exception` | 4 |
| `counterevidence` | 3 |
| Apartados de Política de Negocio | 15 (5.1 a 5.15) |
| Erratas del original preservadas | 9 (`TR-01`…`TR-09`) |

Los conteos por tipo fueron **verificados por parsing** sobre las 139 filas.
Suman 139 sin residuo.

### 4.2 Erratas del documento preservadas

No se corrigieron, conforme a `TRACE_EVERY_DECISION` y a la regla de no alterar la
fuente. Las más relevantes:

| ID | Ubicación | Texto en el original |
|---|---|---|
| `TR-03` | 5.2.d, p.3 | «intervalo de tiempo corto establecido para este efecto» — el inciso **queda truncado**: no fija el valor |
| `TR-04` | 5.6.d, p.9 | «posible promesa no omplda» |
| `TR-06` | 5.2.f, p.4 | `+52 1 55 9088 8548` — no figura entre los números de 5.2.g |
| `TR-09` | 5.9.c, p.16 | «falta de activation» (`ct` en inglés) |

### 4.3 Desenlaces derivados

La fuente establece **5 desenlaces distintos**, no un conjunto cerrado:

| Desenlace | Enunciados |
|---|---|
| `CANCELACION_VENTA` | 18 |
| `BAJA` | 6 |
| `CANCELACION_VENTA_OPERATIVA` | 8 |
| `CANCELACION_MATRICULA` (solo Mystery Shopper) | 1 |
| `RETENCION` (sin desenlace de salida propio) | 6 |
| `DICTAMINACION` | 4 |

Más dos estados de **detención** que no son desenlaces del documento:
`REQUIRES_OWNER_DECISION` y `REQUIRES_HUMAN_REVIEW`.

> Un motor que implemente un enum de 3 outcomesaría incorrecto en 3 de 5
> desenlaces. El motor legacy fell short precisamente aquí.

---

## 5. Hallazgos normativos principales

### 5.1 Siete umbrales temporales sin orden de prevalencia

| Umbral | Cita | Efecto |
|---|---|---|
| 2 semanas post-inicio | `N-15` p.3 | Límite de solicitud de CV |
| Primer domingo del ciclo | `N-29` p.4 | Límite con D35/D53 tardía |
| 20 días post-inicio | `N-35` p.5 | Cualquier solicitud → baja |
| Domingo de semana 2 | `N-68` p.12 | Límite de ilocalizable |
| Semana 3 post-inicio | `N-103` p.17 | Cierre financiero; estatus inmutable |
| 30 días hábiles | `N-07` p.2 | Deserción (glosario) |
| 30 días | `N-114` p.18 | Deserción (indicador) |

**Solo uno declara prevalencia explícita:** `N-112` (p.18) — «La fecha de
solicitud no limitará la aplicación de este criterio» — y únicamente para la
causal de quórum (`AMB-TEM-03`).

### 5.2 Polaridad invertida en 3 de 4 niveles de programa

`5.8.a` (pp.12→13) define la actividad académica por nivel con la **misma
estructura sintáctica** pero polaridad opuesta:

| Nivel | Redacción | Polaridad real |
|---|---|---|
| Licenciatura | «**Haber** seleccionado la modalidad…» | positiva |
| Posgrado/Ejecutiva | «**No haber** registrado participación en foros» | **negativa** |
| Licenciaturas de alianzas | «**No haber** ingresado a ninguna asignatura» | **negativa** |
| Diplomados | «**No haber** registrado participación en foros» | **negativa** |

**Riesgo de implementación:** una bandera única
`actividad_academica = TRUE` invertiría el resultado en tres de cuatro niveles:
un posgrado activo se clasificaría como ilocalizable.

**Mitigación definida:** la polaridad se declara en la **definición del hecho**,
nunca en el `if` del evaluador. Cada nivel tiene hechos separados. Registrado
como `AMB-LOG-02`, con test obligatorio en el prompt de Fase 2.

### 5.3 `N-33` es la regla que más desenlaces cierra

> «En caso de no realizarse el proceso de retención… la solicitud deberá
> gestionarse como **baja**, **sin que la fecha de inicio ni la aplicación de D35
> o D53 afecten dicha determinación**» (p.5).

Contradice a `N-27` (p.4), que establece CV para solicitud previa al inicio. El
documento no declara prevalencia → `AMB-CON-01`, **bloqueante**.

### 5.4 Dos contradicciones internas en causales de CV

| Conflicto | Citas |
|---|---|
| `N-46` **restringe** la promesa no cumplida a 3 requisitos; `N-52` la **expande** a «sin evidencias → CV» | p.8 vs p.9 (`AMB-CON-03`) |
| `5.6.f` declara **dos rutas de escalamiento distintas** en el mismo inciso | `N-57` vs `N-58`, ambas p.10 (`AMB-CON-02`) |

### 5.5 El flujo oficial del proceso está fuera de la fuente

Las secciones 6 (Descripción de Actividades) y 7 (Diagrama de Flujo) remiten a un
enlace de Drive y a una imagen `.png` en Lucidchart (p.21). **El diagrama de
flujo no está en el PDF.**

El árbol de Fase 1 se reconstruyó **solo** con el texto de las páginas 1–20. No
se infirió ninguna arista de un archivo ausente. Registrado como `GAP-COV-01` /
`AMB-EXT-02`, y es **el hueco de cobertura más grave de la fase**.

### 5.6 Ocho anexos referenciados, ninguno incluido

De la sección 9 (p.22). Los de mayor impacto: **Anexo 1 (matriz de
validaciones)**, probablemente la segunda fuente más relevante de reglas después
del cuerpo del documento; **Anexo 5 (D53)**, del que depende toda la rama
`CAUSAL-D53`; y **Anexos 2 y 4 (estrategias de retención)**, sin los cuales
`F-estrategias_presentadas` no es verificable.

---

## 6. Cobertura

| Métrica | Valor |
|---|---|
| Enunciados transcritos | 139/139 (100 %) |
| Enunciados con página verificada | 139/139 (100 %) |
| Enunciados `COVERED` | 30 (22 %) |
| Enunciados `BLOCKED` | 59 (42 %) |
| Enunciados `PARTIAL` | 25 (18 %) |
| Enunciados `COVERED_NODECISION` | 39 (28 %) |
| Enunciados `NOT_COVERED` | 5 (4 %) |
| Hechos con cita normativa | 125/125 (100 %) |
| Enunciados que sostienen una rama | 49 (35 %) |
| Ramas con cita | 19/19 (100 %) |
| Secciones con cobertura completa | 26/26 clasificadas |
| Cobertura de anexos | 0/10 |
| Cobertura de documentos externos | 0/3 |
| Golden cases | 0 (por diseño) |

### 6.1 Diez huecos declarados

`GAP-COV-01` flujo oficial fuera del PDF · `GAP-COV-02` anexos ausentes ·
`GAP-COV-03` documentos de referencia externos · `GAP-COV-04` glosario de
operación escolar · `GAP-COV-05` `N-66` sin consecuencia normativa ·
`GAP-COV-06` `N-44` sin desenlace de salida · `GAP-COV-07` `N-34` sin sanción
especificada · `GAP-COV-08` golden cases no construidos ·
`GAP-COV-09` conectivas indeterminadas · `GAP-COV-10` desenlaces no determinados.

---

## 7. Ambigüedades: 28 registradas, 14 bloqueantes

| Clase | Cantidad | IDs |
|---|---|---|
| `CONTRADICTION` | 4 | `AMB-CON-01`…`04` |
| `PRECEDENCE` | 6 | `AMB-TEM-01`…`06` |
| `EXTERNAL` | 5 | `AMB-EXT-01`…`05` |
| `UNDERSPECIFIED_LOGIC` | 2 | `AMB-LOG-01`, `AMB-LOG-04` |
| `POLARITY` | 3 | `AMB-LOG-02`, `03`, `05` |
| `MISSING_THRESHOLD` | 3 | `AMB-NUM-01`…`03` |
| `GAP` | 3 | `AMB-GAP-01`…`03` |
| `REFERENCE_DRIFT` | 1 | `AMB-REF-01` |
| `DEFINITION_DIVERGENCE` | 1 | `AMB-DEF-01` |

**Las 14 bloqueantes** impiden construir un motor determinista:
`AMB-CON-01`, `02`, `03`, `04`, `AMB-NUM-01`, `AMB-NUM-02`, `AMB-LOG-01`,
`AMB-LOG-04`, `AMB-TEM-01`, `AMB-TEM-02`, `AMB-TEM-06`, `AMB-EXT-01`,
`AMB-EXT-02`, `AMB-EXT-04`.

Cada una está documentada con el texto exacto de la fuente, las **lecturas que la
fuente sí soporta**, y una pregunta concreta al Owner. **Ninguna se resolvió por
la lectura más plausible**, conforme a la instrucción de la Task 4 del prompt de
fase.

---

## 8. Restricciones respetadas

| Invariante | Estado | Evidencia |
|---|---|---|
| `POLICY_IS_IMMUTABLE` | OK | El PDF no fue modificado; hash verificado antes y después |
| `ONLY_OWNER_PROVIDED_POLICY_SOURCES` | OK | No se consultó ninguna fuente externa |
| `HISTORICAL_CASES_ARE_NOT_POLICY` | OK | 0 casos de `docs/legacy/` usados; 0 golden cases |
| `LEGACY_IS_NOT_POLICY` | OK | 0 reglas derivadas de código o reportes legacy |
| `TEMPLATE_IS_NOT_POLICY` | OK | `Dictamen.pdf` no fue usado como fuente |
| `AI_EXTRACTS` | OK | Fase 1 no implementa IA; solo transcripción y clasificación |
| `POLICY_ENGINE_DECIDES` | OK | No se implementó motor |
| `UNKNOWN_IS_NOT_FALSE` | OK | Diseñado y documentado; sin implementar |
| `TRACE_EVERY_DECISION` | OK | 139/139 enunciados con documento, versión, sección y página |
| `PRESERVE_EVIDENCE_PROVENANCE` | OK | Hash y ruta canónica preservados; rename revertido |
| `OPERATIONAL_PRECEDENCE_IS_NOT_POLICY` | OK | §7 de `decision-tree.md` separa precedencia; 0 decisiones del Owner en Fase 1 |
| `DO_NOT_DUPLICATE_IMPLEMENTATIONS` | OK | 0 código de motor creado |
| `INSPECT_BEFORE_IMPLEMENTING` | OK | Las 26 páginas leídas antes de redactar |
| `NO_PII_IN_GIT` | OK | 0 datos personales; solo nombres de rol del Control de Cambios |
| `CANONICAL_REPORT_TEMPLATE` | OK | No se generó Dictamen; `Dictamen.pdf` intacto |

### 8.1 Lo que Fase 1 NO hizo

- No implementó motor, evaluador, outcomes en runtime ni scoring
- No implementó confianza, scoring ni probabilities de desenlace
- No modificó la base de datos ni creó migraciones
- No tocó `apps/web/src/server/audit-engine/`
- No mezcló IA con la definición de reglas
- No construyó casos de prueba
- No resuelve ninguna ambigüedad por inferencia
- No generó ni sustituyó el `Dictamen.pdf`

---

## 9. Frontera del motor

`AUDIT_ENGINE_NOT_IMPLEMENTED` permanece vigente. Archivos intactos:

| Archivo | Estado |
|---|---|
| `apps/web/src/server/audit-engine/boundary.ts` | sin cambios |
| `apps/web/src/server/audit-engine/http.ts` | sin cambios (HTTP 501) |
| `apps/web/src/app/api/audits/[auditId]/audit/route.ts` | sin cambios |

Fase 1 produjo **datos y citas**, no un evaluador en runtime.

---

## 10. Verificación

| Verificación | Resultado |
|---|---|
| 26 páginas leídas | PASS |
| 139 enunciados transcritos con página verificada | PASS |
| 125 hechos con cita normativa | PASS |
| 19 ramas con cita | PASS |
| 8 entregables producidos | PASS |
| Enunciados que sostienen una rama con fuente citada | PASS (0 huérfanos) |
| Hechos sin cita normativa | PASS (0) |
| Ambigüedades resueltas por inferencia | PASS (0) |
| Constructos legacy reintroducidos | PASS (0) |
| Contaminación de texto en entregables | PASS (0, verificado) |
| Working tree limpio | PASS |
| `typecheck` / `lint` / `test` / `build` | PASS (ver §11) |
| Frontera `AUDIT_ENGINE_NOT_IMPLEMENTED` | PASS |

---

## 11. Gates

| Gate | Resultado |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm test` | PASS — 114 tests |
| `pnpm build` | PASS |
| Escaneo de PII en artefactos de Fase 1 | PASS — 0 hallazgos |
| Las 4 puertas del clean slate | PASS — sin cambios |

---

## 12. Conclusión

Fase 1 está **completa con bloqueadores**:

**Logrado**
- Fuente normativa verificada y bloqueada con hash y procedencia
- 139 enunciados transcritos con página verificada uno a uno
- 125 hechos definidos, todos con cita normativa
- Árbol de 19 ramas con 4 filtros de prevalencia y 6 desenlaces
- Lógica de tres valores y 4 centinelas diseñada y especificada
- 28 ambigüedades documentadas con preguntas concretas al Owner
- 10 huecos de cobertura nombrados, ninguno rellenado por inferencia
- Frontera del motor intacta

**Pendiente de decisión del Owner**
- 14 ambigüedades bloqueantes
- Incorporación de 5 documentos ausentes (diagrama de flujo, descripción de
  actividades, glosario, Anexo 5, anexos de retención)
- Orden de prevalencia de los 7 umbrales temporales
- Conectivas de `5.2` y `5.8.h`
- Criterio de distinción entre CV y baja en ajuste administrativo

**Recomendación:** no iniciar la implementación del motor hasta cerrar las 14
ambigüedades bloqueantes. Un motor determinista construido sobre ambigüedades no
resueltas no sería determinista en la práctica: produciría decisiones
correctas por azar en las ramas ambiguas, que es peor que un
`REQUIRES_OWNER_DECISION` explícito porque oculta el problema.

---

## 13. Referencias

| Documento | Ruta |
|---|---|
| Fuente normativa | `normative/GDM_GAM_PRD_MLG_003  PROCEDIMIENTO DESERCIÓN DE ESTUDIANTES.docx.pdf` |
| Source lock | `docs/policy-v2/source-lock.md` |
| Inventario normativo | `docs/policy-v2/normative-inventory.md` |
| Catálogo de hechos | `docs/policy-v2/fact-catalog.md` |
| Árbol de decisión | `docs/policy-v2/decision-tree.md` |
| Registro de ambigüedades | `docs/policy-v2/ambiguities.md` |
| Matriz de cobertura | `docs/policy-v2/coverage-matrix.md` |
| Prompt Fase 1 (ejecutado) | `docs/phase-prompts/rebuild-decision-tree-phase-1.md` |
| Prompt Fase 2 (generado) | `docs/phase-prompts/decision-tree-phase-2.md` |
| Frontera del motor | `apps/web/src/server/audit-engine/boundary.ts` |
