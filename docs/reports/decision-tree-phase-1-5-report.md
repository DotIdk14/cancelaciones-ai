# Decision Tree Phase 1.5 — Available Normative Source Integration

**Estado: `READY_FOR_OWNER_REVIEW`**
**Frontera normativa: `AUDIT_ENGINE_NOT_IMPLEMENTED` — sin cambios**
**Phase 1 congelada en `4f6fad7` — no modificada**
**Rule Engine V2: NO implementado · Phase 2: NO ejecutada**

---

## 1. Alcance de esta fase

Phase 1 trabajó con **una** fuente normativa y cerró con `COMPLETE_WITH_BLOCKERS`
y **14** ambigüedades bloqueantes. Esta fase re-evalúa esas 14 (y las 14 no
bloqueantes) usando **las 3 fuentes disponibles**:

| # | Archivo exacto | Bytes | Págs | SHA-256 |
|---|---|---|---|---|
| 1 | `GDM_GAM_PRD_MLG_003  PROCEDIMIENTO DESERCIÓN DE ESTUDIANTES.docx.pdf` | 464649 | 26 | `71faf64634805b1b4820132cdfcc1304d740ff00d1e9573dd850222c9496c7d2` |
| 2 | `GDM_GAM_PRD_MXL_008 Procedimiento D53 .docx.pdf` | 196357 | 8 | `49c30482571ebce425d5ff217584c1b390d7c0986f4e93ce033c98df4ee7c383` |
| 3 | `Glosario de operación escolar.pdf` | 318337 | 30 | `de15e50b4faa6919fb4b7de25cf9bb5e6ee538348b8657ba38d8a48e9463e9f5` |

El directorio `normative/` contiene **exactamente 3 archivos**. No hay un
cuarto documento, ni copias candidatas, ni subdirectorios.

**La fuente 1 no cambió:** su SHA-256 es idéntico al congelado en Phase 1. Los
139 enunciados del primario y sus 28 ambigüedades **no se reescribieron**.

### 1.1 Discrepancia de nombre — registrada, no corregida

La instrucción nombra la fuente 1 como `…ESTUDIANTES.pdf`; en disco es
`…ESTUDIANTES.docx.pdf`. Mismo tamaño, mismo hash, mismo título embebido. **No se
renombró**: el nombre `.docx.pdf` es el canónico desde `4f6fad7` y lo referencian
otros documentos del repositorio. La discrepancia es de **nombre**, no de
contenido.

### 1.2 Advertencia sobre conteo de páginas

`file` reporta «8 page(s)» para los tres PDF. Es una **heurística errónea** de
`libmagic` para este corpus. El conteo autoritativo es `pdfinfo`: **26 / 8 / 30**.
Todas las citas de esta fase usan `pdfinfo`.

---

## 2. Lo que las fuentes nuevas resolvieron

### 2.1 Definiciones: 14 solicitadas, todas localizadas

| Término solicitado | Resuelto | Cita exacta |
|---|---|---|
| cancelación de venta | **Sí** | `G-13`, p.7 — «proceso para alumnos de nuevo ingreso… primeras 2 semanas del ciclo o… antes de su inicio de clases» + 3 motivos |
| baja | **Sí** | `G-06` p.6 (estatus base) + **8 variantes**: definitiva `G-07`, por adeudo, por documentos apócrifos, **por falta de documentos** `G-08`, por inactividad `G-09`, temporal `G-10` |
| alumno de nuevo ingreso | **Sí** | `G-01`, p.6 — «registrado por primera vez en un plan de estudios» |
| retención | **Sí** | `G-15`, p.21 — «cierre del proceso de retención en el cual el alumno **decide continuar**» |
| ciclo | **Sí** | `G-29`, p.29 — 14 semanas; sufijos 41/42/43 |
| periodo | **Sí** | `G-30`, p.30 — «parte bimestral de un ciclo» |
| tipo de ingreso | **Sí** | `G-22`, p.28 — 4 tipos con criterio cada uno |
| D35 / accepted | **Sí** | `G-18`, p.24 — «ACEPTADO: cumple con la documentación digital y criterios de ingreso completos (antes decisión 35)» |
| D53 / preadmitted | **Sí** | `G-18`, p.24 — «PREADMITIDO: falta el antecedente académico del nivel anterior (decisión 53); en SIU se visualiza con la etiqueta "EN VALIDACIÓN"» |
| reingreso | **Sí** | `G-11`, p.9 — «después de tener al menos un periodo con estatus de baja» |
| equivalencia | **Sí** | `G-38`, p.23 |
| revalidación | **Sí** | `G-37`, p.23 |
| carta compromiso | **Parcial** | `G-19`, p.24 — «término de dos meses» → **conflicta** con D53 |
| campus | **Sí** | `G-20`, p.24 — «unidad de configuración que permite diferenciar las distintas reglas de operación» |

### 2.2 D53: 16 reglas que en Phase 1 no eran ejecutables

| Requisito de la instrucción | Estado | Cita |
|---|---|---|
| D53 applicability | **Resuelto** | `D53-01`, p.2 — solo nuevo ingreso tipo Regular o Dictamen técnico |
| regular vs dictamen técnico | **Resuelto** | `D53-01` — ambos **sí** son elegibles para D53 |
| reingreso/equivalencia/revalidación exclusions | **Resuelto** | `D53-01` — «No aplica para: Reingresos. Equivalencias. Revalidación» |
| six-month rule | **Resuelto con conflicto de anclaje** | `D53-04`/`D53-06`/`G-08` |
| 50% curricular-progress rule | **Resuelto con conflicto de vigencia** | `D53-04` (≤6 meses **o** 50%), `D53-05` (el 50% «no es fija»…) |
| carta compromiso requirements | **Parcial** | `D53-12` (manuscrita tinta azul, ≤6 meses, cargada en SIU antes de inscripción), `D53-13` (México: T&C) |
| document collection responsibility | **Resuelto** | `D53-02` (Back Office hasta viernes previo), `D53-03` (pasa a EE) |
| closure/baja timing | **Resuelto con conflicto de granularidad** | `D53-10`, `D53-11` (miércoles semana 3 del bimestre) |
| Mexico vs LATAM behavior | **Resuelto** | `D53-06`/`D53-07`, `D53-12`/`D53-13` — divergencia **declarada** |
| evidencia vs regla | **Resuelto** | `D53-08` — entregar el documento **no** cambia la decisión, solo la clasificación |

### 2.3 Hallazgo que confirma un riesgo de Phase 1

`5.8.a` (p.12) lista, para **posgrados y ejecutivas**, «**No haber** registrado
participación en foros» como criterio de **contacto efectivo**. Pero `5.8.i`
(p.14) establece que para posgrado el ingreso válido requiere «**Evidenciar
participación** en el foro de presentación». **El primario se contradice consigo
mismo.** Se documenta; no se resuelve.

### 2.4 Hallazgo sobre la polaridad de retención

El Glosario separa tres conceptos que Phase 1 trataba como uno:
**causa** = `F2-manifesto_baja` / `F2-riesgo_de_baja` · **proceso** =
`F2-proceso_retencion` · **desenlace** = `F2-decide_continuar` («Retención: cierre
del proceso… en el cual el alumno decide continuar»). Confirma que la retención
es un **resultado**, no una condición de entrada.

---

## 3. Lo que NO se resolvió — 9 conflictos entre documentos

Ningún conflicto se resolvió eligiendo la lectura más plausible. Todos
preservan ambas lecturas.

| ID | Conflicto | Las versiones en pugna |
|---|---|---|
| `XDC-01` | **Ventana de CV** | Primario `N-25` p.6: 2 semanas **después** del inicio. Glosario `G-13` p.7: 2 semanas **del ciclo** **o** antes del inicio. D53 `D53-17` p.6: **primer mes**. Agravante: primario p.17 declara el estatus CV↔baja **irreversible tras la semana 3** → la ventana de D53 (≈semana 4) es inalcanzable. |
| `XDC-02` | **Plazo de carta compromiso** | Glosario `G-19` p.24: **2 meses**. D53 `D53-12` p.5: **≤ 6 meses**. |
| `XDC-03` | **Anclaje de los 6 meses** | `G-08` p.6: desde el **inicio del primer ciclo académico**. `D53-06` p.3: **desde su ingreso**. |
| `XDC-04` | **Duración de bimestre** | `G-29` p.29: ciclo 14 semanas. `G-30` p.30: periodo = parte bimestral → 7 semanas. `G-31` p.29: bimestre = 7+6+4+9 = **26 semanas** (contradice al mismo Glosario). Primario `N-114` p.18: **30 días**. D53 `D53-16` p.6: **primer bimestre** / tercer mes. |
| `XDC-05` | **Expediente completo** | `G-23` p.26 define el conjunto; el **contenido** está en Anexo 1 (primario) y Anexo 1 (D53 `D53-23`) — ambos no disponibles → no determinable. |
| `XDC-06` | **«Alumno regular» vs «Regular»** | `G-03` p.6 = estatus de trayectoria. `G-22` p.28 = tipo de ingreso. D53 `D53-01` usa el sentido de tipo. No son el mismo hecho. |
| `XDC-07` | **Alumno futuro** | `G-02` p.6 (espera inicio) vs `G-13` p.7 (CV por no iniciar) vs primario 5.9.a p.16 (CV operativa no aplica a College/Upselling por ser «estudiantes futuros»). |
| `XDC-08` | **«Contacto»** | `G-27` p.14 = lead de CRM. Primario 5.8.h p.14 = interacción con el titular del estudiante. No se fusionan. |
| `XDC-09` | **Carta manifiesto vs compromiso** | Primario `N-59` p.10 «carta manifiesto» (sin plazo). D53 `D53-12` p.5 «carta compromiso» (≤6 m). Glosario `G-19` p.24 «carta compromiso» (2 m). Identidad no establecida. |

### 3.1 Ambigüedades de Phase 1 que las fuentes nuevas no tocaron

`AMB-CON-01` (`N-33` vs `N-27`) · `AMB-CON-02` (doble ruta 5.6.f) ·
`AMB-CON-03` (`N-46` vs `N-52`) · `AMB-NUM-01` (número de contacto) ·
`AMB-NUM-02` (intervalo de colapso) · `AMB-LOG-01` (`AND`/`OR` llamadas-escritos) ·
`AMB-LOG-04` (5.8.h vs `N-69`) · `AMB-TEM-02` (alcance de «cualquier solicitud») ·
`AMB-TEM-06` (primer domingo vs domingo semana 2).

**Verificado: 0 números de teléfono en el Glosario y en D53** → `AMB-NUM-01`
sigue sin resolver. **Verificado: ninguno de los dos documentos menciona
«promesa de venta no cumplida»** → `AMB-CON-03` intacto.

---

## 4. Balance de la re-evaluación

| ID | Phase 1 | Phase 1.5 |
|---|---|---|
| `AMB-CON-01` | `REQUIRES_OWNER_DECISION` | `STILL_REQUIRES_OWNER_DECISION` |
| `AMB-CON-02` | `REQUIRES_OWNER_DECISION` | `STILL_REQUIRES_OWNER_DECISION` |
| `AMB-CON-03` | `REQUIRES_OWNER_DECISION` | `STILL_REQUIRES_OWNER_DECISION` |
| `AMB-CON-04` | `REQUIRES_OWNER_DECISION` | `PARTIALLY_RESOLVED` ▲ |
| `AMB-NUM-01` | `REQUIRES_OWNER_DECISION` | `STILL_REQUIRES_OWNER_DECISION` |
| `AMB-NUM-02` | `REQUIRES_OWNER_DECISION` | `STILL_REQUIRES_OWNER_DECISION` |
| `AMB-NUM-03` | no bloqueante | `NON_BLOCKING` |
| `AMB-LOG-01` | `REQUIRES_OWNER_DECISION` | `STILL_REQUIRES_OWNER_DECISION` |
| `AMB-LOG-02` | no bloqueante | `NON_BLOCKING` (evidencia nueva) |
| `AMB-LOG-03` | no bloqueante | `NON_BLOCKING` |
| `AMB-LOG-04` | `REQUIRES_OWNER_DECISION` | `STILL_REQUIRES_OWNER_DECISION` |
| `AMB-LOG-05` | no bloqueante | `NON_BLOCKING` |
| `AMB-TEM-01` | `REQUIRES_OWNER_DECISION` | `CROSS_DOCUMENT_CONFLICT` ▲ |
| `AMB-TEM-02` | `REQUIRES_OWNER_DECISION` | `STILL_REQUIRES_OWNER_DECISION` |
| `AMB-TEM-03` | resoluble | `RESOLVED_BY_NEW_SOURCE` ▲ |
| `AMB-TEM-04` | no bloqueante | `NON_BLOCKING` |
| `AMB-TEM-05` | no bloqueante | `STILL_REQUIRES_OWNER_DECISION` ▲ |
| `AMB-TEM-06` | `REQUIRES_OWNER_DECISION` | `STILL_REQUIRES_OWNER_DECISION` |
| `AMB-EXT-01` | `REQUIRES_OWNER_DECISION` | `PARTIALLY_RESOLVED` ▲ |
| `AMB-EXT-02` | `REQUIRES_OWNER_DECISION` | `DEFERRED_UNAVAILABLE_SOURCE` ▲ |
| `AMB-EXT-03` | no bloqueante | `DEFERRED_UNAVAILABLE_SOURCE` ▲ |
| `AMB-EXT-04` | `REQUIRES_OWNER_DECISION` | `PARTIALLY_RESOLVED` ▲ |
| `AMB-EXT-05` | `REQUIRES_OWNER_DECISION` | `PARTIALLY_RESOLVED` ▲ |
| `AMB-GAP-01/02/03` | no bloqueante | `NON_BLOCKING` |
| `AMB-REF-01` | documental | `NON_BLOCKING` |
| `AMB-DEF-01` | no bloqueante | `STILL_REQUIRES_OWNER_DECISION` ▲ |

**Balance:** 1 `RESOLVED_BY_NEW_SOURCE` · 5 `PARTIALLY_RESOLVED` · 13
`STILL_REQUIRES_OWNER_DECISION` · 2 `DEFERRED_UNAVAILABLE_SOURCE` · 7
`NON_BLOCKING`. **3 ambigüedades nuevas** (`AMB-TEM-07`, `AMB-CON-05`,
`AMB-CON-06`).

### 4.1 Una reducción de bloqueo que no es real

El conteo bruto de bloqueantes baja de 14 a 13. **La reducción efectiva es de
1.** El resto viene de reclasificar 4 ambigüedades como
`DEFERRED_UNAVAILABLE_SOURCE` (fuera de alcance por instrucción de la fase) y 7
como `NON_BLOCKING` — reclasificaciones, no resoluciones. Las tres ambigüedades de
contradicción más difíciles siguen intactas.

---

## 5. Artefactos actualizados

| Archivo | Cambio | Modifica Phase 1? |
|---|---|---|
| `source-lock.md` | +§8–12: 3 fuentes, hashes, identidad, relaciones, ausencias | **No** — §1–7 intactos |
| `normative-inventory.md` | +§13–15: 40 `G-##`, 25 `D53-##`, 2 erratas | **No** — `N-01`…`N-139` intactos |
| `fact-catalog.md` | +§14–20: 36 hechos `F2-` | **No** — 125 hechos `F-` intactos |
| `decision-tree.md` | +§10–15: 8 nodos D53, 3 de retención, 1 de CV, 4 conflictos | **No** — `NODO-*` intactos |
| `ambiguities.md` | +§10–14: re-clasificación, 9 XDC, 3 ambigüedades nuevas | **No** — §0–9 intactos |
| `coverage-matrix.md` | +§10–15: cobertura agregada, impacto en 10 huecos | **No** — §1–9 intactos |
| `decision-tree-phase-1-5-report.md` | nuevo | — |

**Totales verificados por parsing:** 40 filas `G-##` · 25 filas `D53-##` · 36 IDs
`F2-` · 125 IDs `F-` (base) · 9 secciones `XDC-##`.

---

## 6. Validación

| Verificación | Resultado |
|---|---|
| Las 3 fuentes bloqueadas por SHA-256 | **PASS** (3/3) |
| Fuente 1 sin cambios respecto a Phase 1 | **PASS** (hash idéntico) |
| Directorio `normative/` contiene exactamente 3 archivos | **PASS** |
| Citas con página y sección exactas | **PASS** (`pdfinfo` + lectura página a página) |
| Fuente no disponible inferida | **NO** (0) |
| Diagrama o anexo reconstruido | **NO** (0) |
| Fuente no disponible solicitada | **NO** (0) |
| Precedencia entre documentos inventada | **NO** (0 reglas) |
| Ambigüedad resuelta por asunción | **NO** (0) |
| Documento de `docs/legacy/**` usado como autoridad | **NO** (0) |
| Nombres personales de controles de cambio copiados | **NO** (0) |
| Emails / CURP / RFC en los artefactos | **NO** (0) |
| Bloques de texto CJK no español | **NO** (0 tras corrección) |
| Código de motor añadido | **NO** (0 archivos) |
| `AUDIT_ENGINE_NOT_IMPLEMENTED` sin cambios | **PASS** |
| `pnpm typecheck` | **PASS** |
| `pnpm lint` | **PASS** |
| `pnpm test` | **PASS** — 114 (domain 13 · db 8 · reporting 26 · web 67) |
| `pnpm build` | **PASS** |
| `decision-tree-phase-2.md` ejecutado | **NO** |

---

## 7. Estado final

### `READY_FOR_OWNER_REVIEW`

**No es `READY_FOR_PHASE_2`.** Las 15 preguntas abiertas son determinantes y
ninguna de las 3 fuentes disponibles las responde. Un motor construido ahora
tendría que elegir entre lecturas incompatibles en cada una.

### Lo que esta fase sí consiguió

1. **14 definiciones normativas** que Phase 1 no tenía, con cita exacta.
2. **16 reglas D53** ejecutables: aplicabilidad, responsable, plazos, cierre,
   persistencia de la decisión, exclusión de reingreso/equivalencia/revalidación.
3. **Divergencia México/LATAM respaldada por texto** (`G-20` prueba el mecanismo;
   `D53-06`/`D53-07` y `D53-12`/`D53-13` la concretan).
4. **3 huecos de cobertura cerrados** (definiciones, formas de CV, reglas D53).
5. **Corrección de una premisa de Phase 1**: «invasión de ciclo» **no** dependía
   del Glosario — el primario la define en su §3 (p.1). El Glosario disponible no
   la contiene.

### Lo que esta fase no consiguió, y empeoró

1. **Los umbrales temporales empeoraron.** 2 documentos nuevos usan la misma
   terminología con duraciones distintas: ciclo 14 vs bimestre 26 vs periodo 7
   vs «30 días» vs «primer bimestre» vs «6 meses». De 7 umbrales sin prevalencia
   pasamos a 9 conflictos `XDC` en la misma familia.
2. **La ventana de CV pasó de 1 lectura a 3**, y una de ellas es incompatible con
   la irreversibilidad que el propio primario declara en la semana 3.
3. **Un hueco se empeoró**: el conjunto de documentos obligatorios sigue en
   anexos no disponibles, ahora referenciados por **dos** fuentes.
4. **Los flujos ausentes pasaron de 1 a 2**: el primario §7 y el propio D53 §6.
5. **El número de preguntas al Owner subió de 14 a 15.**

### Recomendación

No abrir Phase 2. Enviar las 15 preguntas al Owner como un bloque. La decisión
de mayor apalancamiento es `XDC-04` (duración del bimestre): resolverla
desbloquea la alineación de `XDC-01`, `XDC-02`, `XDC-03` y `AMB-TEM-07`, que son
cuatro de las quince.

`docs/phase-prompts/decision-tree-phase-2.md` **no se ejecutó** y no debe
ejecutarse hasta que al menos esas 15 preguntas tengan respuesta escrita.
