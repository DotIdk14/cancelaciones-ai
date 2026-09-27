# Source Lock — GDM_GAM_PRD_MLG_003

**Fase:** Decision Tree Phase 1 — Extracción normativa
**Estado:** `LOCKED`
**Propietario de la fuente normativa:** Owner (UTEL)
**Invariante aplicado:** `POLICY_IS_IMMUTABLE`, `ONLY_OWNER_PROVIDED_POLICY_SOURCES`, `HISTORICAL_CASES_ARE_NOT_POLICY`, `LEGACY_IS_NOT_POLICY`

---

## 1. Fuente autorizada

| Campo | Valor | Origen del dato |
|---|---|---|
| Ruta canónica | `normative/GDM_GAM_PRD_MLG_003  PROCEDIMIENTO DESERCIÓN DE ESTUDIANTES.docx.pdf` | Ruta versionada en Git |
| SHA-256 | `71faf64634805b1b4820132cdfcc1304d740ff00d1e9573dd850222c9496c7d2` | `sha256sum` sobre el archivo |
| Tamaño | `464649` bytes | `pdfinfo` / `stat` |
| Páginas | `26` | `pdfinfo` (`Pages: 26`) y paginación impresa `Página: N de 26` |
| Versión de PDF | PDF 1.4 | `pdfinfo` |
| Cifrado | No | `pdfinfo` (`Encrypted: no`) |
| Título embebido | `GDM_GAM_PRD_MLG_003  PROCEDIMIENTO DESERCIÓN DE ESTUDIANTES.docx` | `pdfinfo` (`Title`) |
| Fecha de publicación | `14/09/2026` | Encabezado impreso, páginas 1–26 |
| Versión del documento | `5` | Encabezado impreso `Versión : 5`, páginas 1–26 |
| Clasificación | `Documento Interno. Restringida reproducción fuera de la organización` | Pie de página, páginas 1–26 |

### 1.1 Identidad verificada en el contenido

El encabezado de control de documentos se repite de forma idéntica en las 26 páginas
y es la evidencia de identidad, no el nombre de archivo:

```
Control de documentos
Código: GDM_GAM_PRD_MLG_003
Versión : 5
Fecha publicación: 14/09/2026
Página: N de 26
```

- **Código de documento:** `GDM_GAM_PRD_MLG_003` (presente en las 26 páginas)
- **Versión:** `5` (presente en las 26 páginas)
- **Fecha de publicación:** `14/09/2026` (presente en las 26 páginas)
- **Autenticidad de versión:** la última fila de `11. Control de Cambios` (páginas 25–26)
  registra `05 | 14/09/2026`, lo que confirma que la Versión 5 corresponde a la
  publicación del 14/09/2026.

**Resultado: `AUTHORITATIVE_NORMATIVE_SOURCE_VERIFIED`.** No aplica
`BLOCKED: AUTHORITATIVE_NORMATIVE_SOURCE_NOT_VERIFIED`.

---

## 2. Procedencia del archivo (hallazgo D-SL-01)

Al iniciar la fase se detectó una discrepancia de nombre en el working tree:

- Git versionaba `normative/GDM_GAM_PRD_MLG_003  PROCEDIMIENTO DESERCIÓN DE ESTUDIANTES.docx.pdf`
- El working tree tenía `normative/GDM_GAM_PRD_MLG_003  PROCEDIMIENTO DESERCIÓN DE ESTUDIANTES.pdf`
  (sin `.docx`), marcado como ` D` + `??` (rename no stageado)

**Verificación de contenido:** el blob en `HEAD` y el archivo en disco son
**byte-idénticos**.

```
git cat-file -p "HEAD:normative/...docx.pdf" | sha256sum
  -> 71faf64634805b1b4820132cdfcc1304d740ff00d1e9573dd850222c9496c7d2
sha256sum normative/...docx.pdf
  -> 71faf64634805b1b4820132cdfcc1304d740ff00d1e9573dd850222c9496c7d2
```

**Resolución aplicada:** se restauró el nombre canónico versionado
(`...docx.pdf`), sin alterar un solo byte del contenido. Justificación:

1. `PRESERVE_EVIDENCE_PROVENANCE` — el nombre canónico es la ruta de procedencia
   referenciada por la evidencia existente.
2. `docs/reports/clean-slate-audit-report.md` (línea 7) declara la fuente
   normativa como `normative/GDM_GAM_PRD_MLG_003  PROCEDIMIENTO DESERCIÓN DE ESTUDIANTES.docx.pdf`;
   aceptar el rename rompería esa referencia.
3. `docs/phase-prompts/rebuild-decision-tree-phase-1.md` (línea 25) fija la misma
   ruta con `.docx.pdf` como única fuente normativa.
4. El título embebido del PDF es `...ESTUDIANTES.docx`, lo que explica el origen
   del sufijo `.docx.pdf` (exportación PDF desde un `.docx`).

**Estado tras la corrección:** working tree limpio. El PDF no fue modificado, ni
re-generado, ni re-exportado, ni re-cifrado. El sufijo `.docx` forma parte de la
identidad de procedencia y no debe eliminarse sin una decisión del Owner.

---

## 3. Verificación de ausencia de otras copias

Búsqueda de candidatos adicionales por código y por nombre en todo el repositorio:

| Búsqueda | Resultado |
|---|---|
| `**/*GDM_GAM_PRD_MLG_003*` | 1 archivo: el PDF canónico |
| Archivos `.pdf` / `.docx` en `normative/` | 1 archivo: el PDF canónico |
| Otras versiones del mismo código en el repo | Ninguna |

**No hay copias candidatas en conflicto.** No se identificaron versiones
divergentes (v1–v4) del mismo código en el repositorio, por lo que no aplica
`REQUIRES_OWNER_DECISION` por conflicto de versiones.

Documentos con el prefijo `GDM_GAM_PRD_MLG_003` citados dentro del propio PDF
(ninguno está en el repositorio, por lo que son **referencias normativas
externas**, no fuentes de Fase 1):

| Código citado | Título según el PDF | Citado en |
|---|---|---|
| `GCE_GCE_PRD_MXL_001` | Cambio de ciclo y Fecha | Páginas 6 y 22 |
| `GDM_GAM_PRO_MXL_001` | Proceso Gestión de admisión y matricula | Página 22 |
| `GDM_GAM_PRD_MXL_008` | Procedimiento D53 | Página 22 |

Estas referencias se registran en `ambiguities.md` (`AMB-EXT-01`) porque el
procedimiento delega reglas a documentos que no están incluidos en la fuente
autorizada de Fase 1.

---

## 4. Fuentes explícitamente excluidas como normativa

Conforme a `ONLY_OWNER_PROVIDED_POLICY_SOURCES` y `LEGACY_IS_NOT_POLICY`, las
siguientes rutas **no** pueden aportar reglas, criterios ni condiciones en Fase 1:

| Ruta / familia | Razón de exclusión |
|---|---|
| `docs/legacy/**` | Práctica histórica y reinterpretaciones no normativas. `TEMPLATE_IS_NOT_POLICY`, `HISTORICAL_CASES_ARE_NOT_POLICY` |
| `docs/legacy/non-normative-policy-interpretations/**` | Interpretaciones no normativas por definición |
| `docs/ai/**` | Salida de IA: `AI_EXTRACTS`, la IA no redacta política |
| Reportes previos (`docs/reports/**`, salvo los de fase) | Evidencia de proceso, no fuente normativa |
| `apps/web/src/server/policy-engine/**` (retirado) | Motor retirado: `DO_NOT_DUPLICATE_IMPLEMENTATIONS` |
| `Dictamen.pdf` | `CANONICAL_REPORT_TEMPLATE` es plantilla de salida, no política |
| Internet / fuentes públicas | `ONLY_OWNER_PROVIDED_POLICY_SOURCES` |
| Casos históricos (CaVe) | `HISTORICAL_CASES_ARE_NOT_POLICY` |

`docs/reports/clean-slate-audit-report.md` y
`docs/phase-prompts/rebuild-decision-tree-phase-1.md` sí se consultaron, pero
únicamente para validar la **ruta** y la **identidad** de la fuente y el
alcance de la fase, nunca para derivar política.

---

## 5. Método de extracción y verificación de páginas

| Paso | Herramienta | Resultado |
|---|---|---|
| Extracción de texto | `pdftotext -layout` | `full.txt` + `page-1.txt` … `page-26.txt` |
| Verificación de paginación | Encabezado impreso `Página: N de 26` | Coincide con el índice físico del PDF en las 26 páginas |
| Lectura | Las 26 páginas leídas íntegras | Sin páginas omitidas |
| Assets no textuales | `7. Diagrama de Flujo` (página 21) | Imagen referenciada por nombre, no embebida como texto → `AMB-EXT-02` |

**Regla de citación aplicada en todos los entregables de Fase 1:**

```
documento → versión → sección impresa → página PDF verificada
GDM_GAM_PRD_MLG_003 → 5 → p.ej. 5.3.a.II → p.ej. 4
```

La página se toma **del encabezado impreso de la página donde el texto reside**,
no de una estimación ni de la numeración interna del PDF. Cuando una sección
arranca en una página y su contenido continúa en la siguiente, se citan ambas
páginas.

---

## 6. Frontera de la fase

Este source lock habilita el análisis normativo de las páginas 1–26. **No
habilita** implementación de motor. Se mantiene vigente:

- `apps/web/src/server/audit-engine/boundary.ts` → `AUDIT_ENGINE_NOT_IMPLEMENTED`
- `apps/web/src/server/audit-engine/http.ts` → HTTP 501
- `apps/web/src/app/api/audits/[auditId]/audit/route.ts` → frontera de auditoría

Fase 1 produce **datos y citas**, no un evaluador en runtime.

---

## 7. Resumen del lock

| Verificación | Estado |
|---|---|
| Ruta canónica en Git | PASS |
| SHA-256 del archivo | PASS (`71faf646…96c7d2`) |
| Contenido = blob en `HEAD` | PASS (byte-idéntico) |
| Código visible en el documento | PASS (`GDM_GAM_PRD_MLG_003`, 26/26 páginas) |
| Versión visible en el documento | PASS (`5`, 26/26 páginas) |
| Fecha de publicación visible | PASS (`14/09/2026`, 26/26 páginas) |
| Paginación verificada | PASS (26/26) |
| Copias candidatas en conflicto | PASS (0) |
| Working tree limpio | PASS |
| PDF modificado | NO (0 bytes alterados) |

**Decisión: `SOURCE_LOCK_CONFIRMED`.** Fase 1 puede continuar con el inventario
normativo.

---

# Phase 1.5 — Ampliación del lock a 3 fuentes

> **Estado de Phase 1 preservado.** Las secciones 1–7 anteriores describen la
> fuente única con la que se ejecutó Phase 1 y **no se modifican**. Esta sección
> se añade y solo describe lo que Phase 1.5 aporta. Commit de Phase 1: `4f6fad7`.

## 8. Verificación del directorio

Directorio verificado: `/home/idk/Escritorio/cancelaciones-ai/normative/`
— existe. Contiene **exactamente 3 archivos**. No se encontró ningún cuarto
documento, ni copias candidatas adicionales, ni subdirectorios.

| # | Archivo exacto en disco | Bytes | Páginas | SHA-256 |
|---|---|---|---|---|
| 1 | `GDM_GAM_PRD_MLG_003  PROCEDIMIENTO DESERCIÓN DE ESTUDIANTES.docx.pdf` | 464649 | 26 | `71faf64634805b1b4820132cdfcc1304d740ff00d1e9573dd850222c9496c7d2` |
| 2 | `GDM_GAM_PRD_MXL_008 Procedimiento D53 .docx.pdf` | 196357 | 8 | `49c30482571ebce425d5ff217584c1b390d7c0986f4e93ce033c98df4ee7c383` |
| 3 | `Glosario de operación escolar.pdf` | 318337 | 30 | `de15e50b4faa6919fb4b7de25cf9bb5e6ee538348b8657ba38d8a48e9463e9f5` |

**Fuente 1 sin cambios.** El SHA-256 del primario es **idéntico** al congelado en
Phase 1 (`71faf646…96c7d2`). La base normativa de Phase 1 permanece válida y no
requiere re-verificación de sus 139 enunciados.

### 8.1 Discrepancia de nombre de archivo — registrada, no corregida

La instrucción de Phase 1.5 enumera la fuente 1 como
`GDM_GAM_PRD_MLG_003  PROCEDIMIENTO DESERCIÓN DE ESTUDIANTES.pdf`.
**El archivo en disco se llama `…ESTUDIANTES.docx.pdf`.** Mismo tamaño, mismo
SHA-256, mismo título embebido (`…ESTUDIANTES.docx`).

Se registra la discrepancia y **no se renombra el archivo**: el nombre `.docx.pdf`
es el canónico desde `4f6fad7` y lo referencian
`docs/reports/clean-slate-audit-report.md`. Renombrarlo sería un cambio de
proveniencia no solicitado. La discrepancia es de **nombre de archivo**, no de
contenido: el documento verificado es el intendedido.

### 8.2 Advertencia sobre el conteo de páginas

`file` reporta «8 page(s)» para los tres PDF. Es una **heurística incorrecta** de
`libmagic` para este corpus. El conteo autoritativo es el de `pdfinfo`:
26 / 8 / 30. Toda referencia de página en Phase 1.5 usa `pdfinfo`.

## 9. Identidad verificada en el contenido de cada fuente

| Atributo | Fuente 1 (primario) | Fuente 2 (D53) | Fuente 3 (Glosario) |
|---|---|---|---|
| Código | `GDM_GAM_PRD_MLG_003` | `GDM_GAM_PRD_MXL_008` | — (sin código) |
| Título | Procedimiento Deserción de Estudiantes | Procedimiento D53 | Glosario de operación escolar |
| Versión | 5 | 1 | — (sin versión) |
| Fecha publicación | 14/09/2026 | 08/09/2025 | — (sin fecha propia) |
| Páginas | 26 de 26 | 8 de 8 | 30 |
| Control de documentos | sí, 26/26 pág. | sí, 8/8 pág. | no |
| Cifrado | no | no | no |
| Versión PDF | 1.4 | 1.4 | 1.4 |
| Clasificación | «Documento Interno. Restringida reproducción fuera de la organización» | «Documento Interno. Restringida reproducción fuera de la organización» | no declara |

**Los tres documentos son de uso interno restringido.** No se reproduce contenido
de terceros ni datos personales en los artefactos de `docs/policy-v2/`.

**Fuentes 2 y 3 no declaran versión ni fecha propia.** El Glosario marca
fechas por *término* («Definición actualizada 04-09-2025», «Término adicionado
24-04-2026»), no una fecha de versión del documento. La fecha más reciente
detectada en el Glosario es **24-04-2026**; en D53, el control de cambios registra
**08/08/2025** como fecha de creación.

**No se puede establecer «newer wins»** entre estas fuentes: D53 y Glosario no
declaran precedencia alguna, y el primario tampoco declara una respecto a ellos
(ver §10).

## 10. Relaciones entre documentos — declaradas por los propios documentos

Estas relaciones **están enunciadas en el texto**; no fueron inferidas.

| Relación | Evidencia textual | Efecto |
|---|---|---|
| Primario → D53 | Primario §10 «Documentos de Referencia» (p.22) lista «GDM_GAM_PRD_MXL_008 Procedimiento D53» | El primario **sí** invoca al D53. Confirma que D53 es fuente normativa de apoyo legítima. |
| Primario → Glosario | Primario §3 «Glosario» (p.1) lista «Glosario de operación escolar» | El primario **sí** invoca al Glosario como fuente de definiciones. |
| D53 → Glosario | D53 §3 «Glosario» (p.1) remite a un enlace cuyo archivo adjunto visible es «GLOSARIO DE OPERACIÓN ESCOLAR» (p.2) | D53 **sí** invoca al Glosario. |
| Primario → GCE_GCE_PRD_MXL_001, GDM_GAM_PRO_MXL_001 | Primario §10 (p.22) | **No disponibles** en el directorio → `DEFERRED_UNAVAILABLE_SOURCE`. |

### 10.1 Lo que estas relaciones NO establecen

Ninguno de los tres documentos declara **precedencia normativa**. En concreto:

- Que el primario liste D53 en «Documentos de Referencia» **no** significa que D53
  prevalezca sobre el primario, ni que el primario ceda ante él.
- La **transitividad de referencia** (primario → D53 → Glosario) **no** se
  convierte en transitividad de autoridad: que D53 cite al Glosario no hace que el
  Glosario prevalezca sobre el primario.
- No se aplica «newer wins» (Glosario 24-04-2026 > D53 08/09/2025 > primario
  14/09/2026), ni «more specific wins», ni «primary PDF wins».

Por lo tanto **toda divergencia entre las tres se registra como
`CROSS_DOCUMENT_CONFLICT` y se preservan ambas lecturas**, sin elegir una.

## 11. Fuentes referenciadas y NO disponibles (dentro del alcance de 3 documentos)

La incorporación de las fuentes 2 y 3 **no cierra** los huecos externos. Cada
documento disponible tiene sus propias dependencias ausentes:

| Documento | Referencia ausente | Ubicación | Estado |
|---|---|---|---|
| Primario | 8 anexos + 2 anexos del proceso de admisión (p.22) | §9 | `DEFERRED_UNAVAILABLE_SOURCE` |
| Primario | Anexo 5 «Políticas y Normas Aplicables a la Decisión 53» | §9, citado en 5.7.h (p.12) | `DEFERRED_UNAVAILABLE_SOURCE` |
| Primario | Anexo 1 «Documentos de Ingreso Estudiantes» | §9, citado en 5.7.f (p.12) | `DEFERRED_UNAVAILABLE_SOURCE` |
| Primario | Diagrama de flujo Lucidchart + enlace de Drive | §7 (p.21) | `DEFERRED_UNAVAILABLE_SOURCE` |
| Primario | GCE_GCE_PRD_MXL_001, GDM_GAM_PRO_MXL_001 | §10 (p.22) | `DEFERRED_UNAVAILABLE_SOURCE` |
| **D53** | **Anexo 1 «Mesa de trabajo D53»** | §7 (p.7) | `DEFERRED_UNAVAILABLE_SOURCE` |
| **D53** | **Anexo 2 «Dashboard D53»** | §5.1.10 (p.4) | `DEFERRED_UNAVAILABLE_SOURCE` |
| **D53** | **Reglas de revisión de documentos (Anexo 1 «Validación de documentos Utel») — el conjunto de documentos obligatorios** | §5.2.1 (p.4) | `DEFERRED_UNAVAILABLE_SOURCE` |
| **D53** | **Diagrama de flujo «D53»** | §6 (p.7) | `DEFERRED_UNAVAILABLE_SOURCE` |

**Hallazgo nuevo `D-EXT-02`:** tras Phase 1.5 existen **dos** flujos oficiales
ausentes, no uno: el del primario (§7) y el del propio D53 (§6). La cobertura del
flujo oficial es estructuralmente incompleta en **ambas** fuentes.

## 12. Resumen del lock ampliado

| Verificación | Estado |
|---|---|
| Directorio `normative/` existe | PASS |
| Archivos presentes | PASS (3, exactos) |
| SHA-256 calculado por archivo | PASS (3/3) |
| Fuente 1 sin cambios respecto a Phase 1 | PASS (hash idéntico) |
| Identidad (código/versión/fecha) leída del contenido | PASS (3/3) |
| Paginación verificada con `pdfinfo` | PASS (26 + 8 + 30) |
| Relaciones entre documentos con base textual | PASS (3 documentadas) |
| Precedencia normativa inventada | **NO** (0 reglas inventadas) |
| Fuente ajena a `normative/` usada como autoridad | **NO** (0) |
| Archivo renombrado | **NO** (0) |
| Documento disponible modificado | **NO** (0 bytes) |

**Decisión: `SOURCE_LOCK_CONFIRMED_3_SOURCES`.** Las 3 fuentes están bloqueadas
por SHA-256 y son utilizables como autoridad normativa. Las ausencias siguen
siendo `DEFERRED_UNAVAILABLE_SOURCE` y no bloquean Phase 1.5.
