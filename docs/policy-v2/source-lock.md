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
