# Clean Slate Audit Report

**Fecha:** 2026-09-26
**Rama:** `feature/policy-foundation-remediation`
**HEAD:** `bc30182`
**Baseline previo:** `9479d979ae10ab1a2db9b1071cb64e7b0c8d60e1`
**Fuente normativa:** `normative/GDM_GAM_PRD_MLG_003  PROCEDIMIENTO DESERCIÓN DE ESTUDIANTES.docx.pdf`

---

## 1. Resumen ejecutivo

Se retiró por completo el motor normativo legacy y se estableció una frontera
explícita. La aplicación ya no puede emitir dictámenes, resoluciones ni
decisiones de deserción, y falla de forma ruidosa cuando se le pide hacerlo.

**Arquitectura vigente:**

```
INFRAESTRUCTURA VÁLIDA
  → Evidence ingestion
  → [NO AUDIT ENGINE]
  → AUDIT_ENGINE_NOT_IMPLEMENTED
```

Lo que queda es la parte del sistema que la V2 necesita y que no depende de
interpretar la norma: ingesta de evidencia con hashes y procedencia,
procesamiento, transcripción, extracción determinista de hechos observables,
comments manuales, autorización y descarga de documentos ya generados.

Lo que se eliminó: las reglas, el razonador, el grafo de evidencia, la
comparación IA vs humano, la reconciliación, la adjudicación, la generación de
dictamen, la evidencia artificial, el modo demo y 15 de 30 módulos de
infraestructura normativa.

**Resultado de gates:** `typecheck` PASS · `lint` PASS · `test` PASS (114) · `build` PASS (23 rutas).

---

## 2. Objetivo y alcance

Retirar el motor normativo legacy completo sin fabricar una V2 normativa a
partir de sus restos, y sin que la ausencia del motor pueda confundirse con
"no hay nada que auditar".

**Fuera de alcance (explícitamente no se hizo):**

- No se migraron reglas, thresholds, outcomes, clasificaciones ni citas del legacy.
- No se modificó topología ni historial de migraciones (decisión D3).
- No se construyó el árbol de decisión V2.
- No se publicaron tags ni se hizo force-push.

---

## 3. La frontera

### 3.1 Definición

`apps/web/src/server/audit-engine/boundary.ts`

| Elemento | Valor |
|---|---|
| Código de error | `AUDIT_ENGINE_NOT_IMPLEMENTED` |
| HTTP status | `501` |
| Fuente normativa declarada | `GDM_GAM_PRD_MLG_003` |
| Capacidades declaradas | `normative-evaluation`, `decision-trace`, `evidence-assessment`, `human-comparison`, `adjudication`, `report-snapshot`, `dictamen-generation`, `fact-run-freeze` |

`assertAuditEngineOperational()` **siempre lanza**. No existe ruta alternativa,
ni fallback, ni degradación a resultado vacío. El error no expone `outcome`,
`decisionStatus` ni `suggestedOutcome`, de modo que no puede interpretarse como
una condición normativa falsa (`UNKNOWN_IS_NOT_FALSE`).

`apps/web/src/server/audit-engine/http.ts` traduce el error a 501. Cualquier
otro error se vuelve a lanzar sin enmascarar.

### 3.2 Por qué existe el endpoint explícito

`POST /api/audits/[auditId]/audit` existe para que la ausencia del motor sea
ruidosa. Sin él, una petición de auditoría tras el retiro habría devuelto 404,
indistinguible de un caso sin expediente. Ahora responde 501 con código,
capacidad y fuente normativa.

### 3.3 Verificación

Tests dedicados en `boundary.test.ts` (6) y `http.test.ts` (3) cubren: el
código de error, la fuente normativa, el conjunto de capacidades, el lanzamiento
incondicional, la ausencia de campos normativos y la traducción a 501 sin
ocultar errores ajenos.

---

## 4. Qué se eliminó

### 4.1 Módulos

| Módulo | Motivo |
|---|---|
| `packages/policy-engine/` | Motor completo: 3 reglas, reasoner, contratos normativos |
| `apps/web/src/server/policy/` | `evaluation`, `reasoner`, `evidence-graph`, `evidence-interpreter`, `frozen-fact-run`, `blind-audit` |
| `apps/web/src/server/rules/` | CRUD de reglas y requisitos de evidencia |
| `apps/web/src/server/comparison/` | Baseline y comparación IA vs dictamen humano |
| `apps/web/src/server/reconciliation/` | Análisis de discrepancias |
| `apps/web/src/server/adjudication/` | Adjudicación final |
| `apps/web/src/server/dictamen/service.ts` | Generación, aprobación y selección de evidencia del dictamen |
| `apps/web/src/server/human-decision/extract.ts` | Extracción y verificación de claims humanos |
| `apps/web/src/server/human-decision/pdf.ts` | Extracción PDF usada solo por el anterior |
| `apps/web/src/server/local-demo.ts` | Sembraba una evaluación normativa falsa |
| `apps/web/src/server/policy/blind-audit.ts` | Caso sintético con resultado inventado |
| `packages/domain/src/policy-outcome.ts` | Outcomes `CANCELACION_*` |
| `packages/domain/src/decision-trace.ts` | Traza de decisión normativa |
| `packages/domain/src/policy-foundation.ts` | Mezclaba infra con `ShadowPolicyResult` |

### 4.2 Vocabulario normativo legacy

Criterio aplicado: si un símbolo no tenía consumidores runtime, se eliminaba;
si cumplía función de infraestructura, se conservaba **reasignado a un archivo
honesto**.

**Eliminado por no tener consumidores:**

`HumanClaimClassification`, `HumanClaim`, `ComparisonStatus`, `DiscrepancyType`,
`FinalAdjudicationType`, `EngineRun`, `AIUsage`,
`AuditComparison(Record|Row)`, `FinalAdjudication(Record|Row)`,
`HumanReviewRecord`, `HumanDecisionExtract*`, `ReportSnapshot*`,
`ShadowPolicyResult`.

**Conservado como infraestructura:**

| Original | Nuevo hogar | Razón |
|---|---|---|
| `FactState`, `ExtractionMethod` | `fact-contracts.ts` | Estado epistémico y método de extracción |
| `FactProvenanceV1`, `ExtractedFactV1`, `ExtractionToolOutputV1` | `fact-contracts.ts` | Procedencia verificable |
| `canonicalizeV1`, `canonicalFingerprintV1` | `fact-contracts.ts` | Sellado determinista |
| `blind-evidence-sanitizer` | `server/evidence/` | Saneamiento de evidencia, no regla |

`policy-foundation.ts` se dividió: se conservó la parte de contratos de hechos y
se descartó `ShadowPolicyResult`, que declaraba un resultado de política
declarativa no autoritativa.

### 4.3 Jobs

Cuatro de los siete handlers ahora fallan via `assertAuditEngineOperational()`:
`AUDIT_EVALUATION`, `REPORT_GENERATION`, `HUMAN_DECISION_EXTRACTION`,
`AI_RECONCILIATION`.

`FACT_EXTRACTION` **ya no encadena evaluación normativa**: congela el fact run y
termina. Se eliminaron los enqueuers `enqueueAuditEvaluation` y
`enqueueReportGeneration`, y `updateAuditStatus` dejó de usarse porque nada
puede marcar una auditoría como `COMPLETED`.

### 4.4 UI

- 10 componentes normativos eliminados.
- Workspace reescrito: pestañas `motor` / `carga` / `comentarios`.
- Nuevo panel `AuditEngineInspector` que muestra el pipeline disponible y dónde
  se detiene, con el estado real (`AUDIT_ENGINE_NOT_IMPLEMENTED`).
- El botón de dictamen pasa a "Sin documento" deshabilitado cuando no existe,
  con explicación en el `title`.
- Lista de auditorías: se eliminó la columna `Resultado` y los filtros
  `Resultado` / `Política`.
- 10 tipos client-only eliminados de `components/types.ts` (152 → 40 líneas).

---

## 5. Inventario de rutas

Se distinguen tres unidades, como exige el criterio de aceptación.

| Unidad | Baseline `9479d979` | Estado final | Δ |
|---|---|---|---|
| **Archivos `route.ts`** | 32 | 23 | −9 |
| **Patrones URL** | 32 | 23 | −9 |
| **Métodos HTTP** | 49 | 34 | −15 |

### 5.1 Rutas eliminadas — 10 archivos, 17 métodos

| Ruta | Métodos | Motivo |
|---|---|---|
| `/api/audits/[id]/policy` | GET, POST | Motor |
| `/api/audits/[id]/policy/[engineRunId]` | GET | Motor |
| `/api/audits/[id]/fact-runs` | GET, POST | Motor |
| `/api/audits/[id]/fact-reviews` | GET, POST | Motor |
| `/api/audits/[id]/evidence-selection` | GET, PUT | Entrada de dictamen |
| `/api/rules` | GET, POST | CRUD de reglas |
| `/api/rules/[ruleId]` | PATCH | CRUD de reglas |
| `/api/rules/evidence-requirements` | GET, POST | Requisitos normativos |
| `/api/rules/evidence-requirements/[requirementId]` | PATCH, DELETE | Requisitos normativos |
| `/api/dev/synthetic-case` | POST | Evidencia artificial |

### 5.2 Rutas convertidas en 501 — 11 archivos, 18 métodos

| Ruta | Métodos | Capacidad reportada |
|---|---|---|
| `/api/audits/[id]/audit` | POST | `normative-evaluation` *(nueva)* |
| `/api/audits/[id]/comparison` | GET, POST | `evidence-assessment` |
| `/api/audits/[id]/adjudication` | GET, POST | `adjudication` |
| `/api/audits/[id]/reconciliation` | GET, POST | `human-comparison` |
| `/api/audits/[id]/human-review` | GET, POST | `human-comparison` |
| `/api/audits/[id]/human-decision` | GET, POST | `human-comparison` |
| `/api/audits/[id]/human-decision/extract` | GET, POST | `human-comparison` |
| `/api/audits/[id]/report-snapshot` | GET, POST | `report-snapshot` |
| `/api/audits/[id]/dictamen/draft` | POST | `dictamen-generation` |
| `/api/audits/[id]/dictamen/final` | POST | `dictamen-generation` |
| `/api/audits/[id]/dictamen/approve` | POST | `dictamen-generation` |

Verificado método a método contra el baseline: **no se perdió ningún método
HTTP**. La única diferencia es `human-decision/extract`, que ganó un `GET`
también en 501.

### 5.3 Rutas de entrega conservadas — 16 métodos

Ingesta y lectura, ninguna decisión: descarga de evidencia, listado de
auditorías, detalle, creación, comentarios, jobs, evidences, events, runs,
dictamen (listado), descarga de documento, health, auth refresh, login.

`/api/audits/[id]/human-decision` es borderline: reporta 501 porque su
propósito original era la comparación, pero la ingesta del documento humano
sigue viva como server action (`uploadHumanDecisionDocument`).

---

## 6. Correcciones de trazabilidad a la fuente

**Corrección respecto a un conteo previo erróneo: 1 de 3 citas es correcta, no 0 de 3.**

| Sección | Página en código | Página en fuente | Estado |
|---|---|---|---|
| 5.2.a | 3 | 3 | ✅ Correcta |
| 5.7.e | 9 | 11 | ❌ Error de 2 páginas |
| 5.8.a | 9 | 12 | ❌ Error de 3 páginas |

Estas páginas procedían de comentarios del código legacy, que es exactamente
la fuente no confiable que este fase está retirando. **Deben
re-verificarse contra el PDF antes de que la V2 las use como ground truth.**

---

## 7. PII

### 7.1 Estado en HEAD

**No hay PII real en el working tree.** Búsqueda exhaustiva de emails,
teléfonos, nombres y matrícula: 0 coincidencias reales.

Clasificación de los falsos positivos encontrados:

| Hallazgo | Archivo | Clasificación |
|---|---|---|
| `UTEL-2026-001` | `docs/legacy/reports/cave-30591-blind-e2e-report.md` | Matrícula sintética, no PII |
| `+525589770707` y otros | `apps/web/src/server/reporting/template-layout.json` | Contactos institucionales fijos de la plantilla oficial del dictamen |
| `9xxxxxxxx` (20 archivos) | Migraciones y docs legacy | Versiones de migración (`20260926183000`), no PII |

Los teléfonos de `template-layout.json` provienen de la plantilla oficial del
propietario y se conservan como parte de la entrega documental.

### 7.2 Deuda histórica — NO resuelta

La PII real (nombre, email, teléfono) **sigue en el historial de Git**.

- `c4f6abe` eliminó `migrations/20260924170500_finish-audit-48680.sql`, un data
  dump con 0 statements DDL y 16 `INSERT` que contenía datos de contacto.
- `d64783f` saneó el nombre de estudiante del reporte legacy.

Sanear HEAD no reescribe historia. Mientras exista el tag local
`pre-cleanslate-9479d97` → `9479d979`, esos blobs son alcanzables.

**Acción pendiente, coordinada con el propietario:** `git filter-repo` para
reescribir historia y luego eliminar o recrear el tag. No se hizo force-push.

---

## 8. Base de datos

**Decisión D3 respetada:** no se modificó topología ni historial de migraciones.
Las únicas acciones sobre `migrations/` fueron la eliminación del data dump con
PII y la corrección de un typo en un comentario.

### 8.1 Bloqueadores de reproducibilidad

El baseline de DB **no es reproducible desde el repositorio**. Tres hallazgos,
en orden de impacto:

**a) `policy_source_registry` no existe en ninguna migración.**

```
tablas creadas en migraciones: 37
tablas usadas en código:       20
fantasmas (usadas sin CREATE TABLE): policy_source_registry
```

`apps/web/src/server/jobs/handlers.ts` la lee en `resolveRegisteredPolicySourceId()`
para sellar el fact run. Si la tabla no existe, el sellado falla con
`POLICY_SOURCE_NOT_REGISTERED`. La tabla solo existe en el DEV, creada fuera de
banda.

**b) `persist_policy_evaluation_v1` no está versionada, pero se le conceden permisos.**

`migrations/20260926183000_integrity-gate-engine-write-boundary.sql:64` ejecuta
`GRANT EXECUTE ON FUNCTION public.persist_policy_evaluation_v1(...)` sobre una
función que ninguna migración crea. Es el **primer punto de fallo** de un
rebuild secuencial.

> Nota: con el motor retirado, esta migración es ahora irrelevante para la
> aplicación. No se modificó por D3, pero debe considerarse candidata a
> neutralización en una fase posterior, aprobada por el propietario.

**c) Hueco en el ledger de migraciones.**

Entre `20260925090800` y `20260926090000` faltan 6 versiones que constan en el
ledger del backend y no están en el repo:

```
20260925120000  20260925140000  20260925150000
20260925160000  20260925161000  20260925200000
```

### 8.2 Objetos vivos ausentes

| Objeto | Tipo | Estado |
|---|---|---|
| `policy_source_registry` | tabla | Sin `CREATE TABLE` |
| `audit_evaluation_envelopes` | tabla | Sin `CREATE TABLE` |
| `ai_decision_snapshots` | tabla | Sin `CREATE TABLE` |
| `freeze_fact_run_v1` | RPC | Referenciada, no creada |
| `create_derived_fact_run_v1` | RPC | Ausente |
| `long_integrity_hash` | columna | Ausente |
| `long_effective_fingerprint` | columna | Ausente |

**Ninguno de estos objetos es usado por el código de aplicación tras el retiro
del motor**, salvo `policy_source_registry` (solo lectura, para sellado de
procedencia). El impacto se limita a reproducibilidad, no a correctitud.

> Un `CREATE TABLE` adicional detectado en las migraciones para
> `ai_decision_snapshots` no existe; la tabla se referencia en 0 migraciones.

### 8.3 Recomendación

Ninguna acción de DB debe tomarse en esta fase. La reconciliación del baseline
requiere una decisión del propietario sobre si las 6 migraciones faltantes se
recuperan del backend o si el baseline se redefine. Eso es una fase separada.

---

## 9. Documentación

83 documentos movidos a `docs/legacy/`, con advertencias en
`docs/legacy/README.md` y
`docs/legacy/non-normative-policy-interpretations/README.md`.

Los errores demostrados del legacy (semántica de outcomes, rama
`NON-LICENCIATURA` inexistente, ventana temporal ausente, agregación `UNKNOWN`
defectuosa, cobertura ~7%) quedan documentados como **práctica histórica, no
normativa**.

`HISTORICAL_CASES_ARE_NOT_POLICY` y `LEGACY_IS_NOT_POLICY` se mantienen: la
documentación en cuarentena no puede citarse como criterio.

---

## 10. Waves y commits

| # | Commit | Alcance |
|---|---|---|
| 1 | `5e110a5` | Cuarentena de docs, archivos muertos, 7 componentes UI |
| 2 | `c4f6abe` | Eliminación del data dump con PII |
| 3 | `d64783f` | Sanitización del nombre en reporte legacy |
| 4 | `64220cd` | `domain`: contratos de hechos vs vocabulario normativo |
| 5 | `807e4d5` | `db`: 5 repositorios de resultados normativos |
| 6 | `7b498da` | Frontera `AUDIT_ENGINE_NOT_IMPLEMENTED` + endpoint explícito |
| 7 | `bc30182` | `web`: retiro del motor legacy y sus consumidores |

**Protección:** tag local lightweight `pre-cleanslate-9479d97` → `9479d979`,
no publicado en `origin`.

---

## 11. Verificación final

| Gate | Resultado |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm lint` (`--max-warnings=0`) | PASS |
| `pnpm test` | PASS — 114 tests |
| `pnpm build` | PASS — 23 rutas |

Distribución de tests: `domain` 13 · `db` 8 · `reporting` 26 · `web` 67.
Baseline previo: 227 tests. La reducción corresponde a tests del motor retirado
y a tests que afirmaban un pipeline normativo que ya no existe.

**Búsquedas de ausencia de runtime legacy — 0 coincidencias en todos los casos:**

`runPolicyEngine` · `policy-engine` · `PolicyEvaluation` · `ShadowPolicyResult` ·
`CANCELACION_MATRICULA` · `NON_LICENCIATURA` · `evaluatedRules` ·
`reconciliation/service` · `local-demo` · `adjudication/service` ·
`comparison-blind` · `dictamen/service`

**Coincidencias intencionales conservadas:**

- `CANCELACION_VENTA` en `extraction/contracts.test.ts` — test **negativo** que
  verifica que la capa de extracción no puede emitir un outcome normativo.
  `AI_EXTRACTS` como invariante ejecutable.
- `policy_source_registry` en `handlers.ts` — lectura de procedencia de la fuente
  del propietario (`ONLY_OWNER_PROVIDED_POLICY_SOURCES`).
- `decision-trace` en `boundary.ts` — nombre de una capacidad futura declarada.
- Tablas normativas en tests — las aserciones ahora verifican que quedan **vacías**.

---

## 12. Riesgos residuales

| Riesgo | Severidad | Mitigación actual |
|---|---|---|
| PII en historial Git | **Alta** | Tag local preserva la referencia. Requiere `filter-repo` coordinado |
| Baseline de DB no reproducible | Media | Documentado. No bloquea la operación actual |
| `policy_source_registry` sin migración | Media | Rompe el sellado de fact runs en un entorno rebuilt |
| Tests reducidos de 227 a 114 | Baja | Justificado: se retiraron asserts de comportamiento normativo inexistente |
| Páginas de cita sin re-verificar | Media | Marcado explícitamente en §6 |

---

## 13. No implementado

Conforme a la decisión de no derivar la V2 del legacy, **no se implementó**:

- Árbol de decisión normativo.
- Reglas, condiciones, outcomes ni clasificaciones.
- Agregación de condiciones, ventanas temporales, contrapruebas.
- Traza de decisión y citación a la fuente.
- Verificación de claims humanos.
- Generación o aprobación de dictamen.
- Cualquier constante normativa en código.

La V2 debe derivarse **exclusivamente** de
`GDM_GAM_PRD_MLG_003`, con el motor como puro, determinista, testeable y
desacoplado de React, Next.js, InsForge, OpenRouter, AssemblyAI, filesystem y HTTP.

Siguiente fase: `docs/phase-prompts/rebuild-decision-tree-phase-1.md`.
