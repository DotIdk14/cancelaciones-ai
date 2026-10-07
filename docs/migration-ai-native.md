# Migración a arquitectura AI-Native

**Estado:** histórico/sustituido. No describe la arquitectura vigente.
**Rama de respaldo:** `backup/pre-ai-native` @ `52c6656`
**Objetivo original:** sustituir el motor normativo determinista. La ejecución
final NO usa agente con tools ni reviewer separado: la arquitectura vigente está
en `README.md`, `AGENTS.md` y `docs/ARCHITECTURE.md`.

> Este documento es el contrato de la migración. Cada sección dice qué se borra,
> qué se conserva, qué se reescribe y qué queda sin decidir.

---

## 0. Diagnóstico del estado previo

La auditoría del repositorio antes de migrar encontró que el producto **no
funcionaba**: la ruta real de auditoría estaba cerrada.

- `apps/web/src/server/audit-engine/boundary.ts:198` — `assertAuditEngineOperational`
  **siempre lanza**. 8 capacidades bloqueadas.
- 9 rutas API devolvían `501 AUDIT_ENGINE_NOT_IMPLEMENTED` sin ejecutar nada.
- `packages/rule-engine-v2` (65 reglas, 30 archivos de test, ~7 000 líneas) existía
  pero **nadie lo invocaba** desde una ruta real: sólo se importaban tipos.
- El pipeline real terminaba en `fact_extraction_runs.FROZEN` y se detenía
  (`apps/web/src/server/jobs/handlers.ts:233`).
- El heavyprompt de visión de `handlers.ts:111` es un `if/else` de un serializador
  de reglas: 14 `factType`, `sourceCompleteness` y warnings de paginación.
- 36 migraciones, de las cuales ~20 son del motor (`policy-foundation-immutability.sql`
  pesa 74 KB).
- 54 archivos de test / ~7 300 líneas, con asserts tautológicos confirmados
  (`audit-engine/boundary.test.ts:17-18` compara una constante consigo misma).

**Conclusión:** el problema reportado como "los casos terminan en INDETERMINADO" es
la manifestación visible de un sistema donde la decisión no existe. La migración no
parchea ese síntoma: elimina la maquinaria que lo producía.

---

## 1. Arquitectura objetivo

```
EVIDENCIAS
   ↓  preparación (transcripción / visión / texto, sólo lo que reduce costo)
AGENTE ANALISTA  (CaseAnalyst)
   ↓  tools: evidencia + policy retrieval
DICTAMEN PROPUESTO  (assessment estructurado, Zod)
   ↓
AGENTE REVISOR   (AuditReviewer)
   ↓  CONFIRMED | REJECTED (máx. 1 revisión del analista)
DICTAMEN FINAL
```

Paquetes:

| Ruta | Responsabilidad |
|---|---|
| `apps/web` | Next.js: UI, rutas API, auth, storage |
| `packages/shared` | Tipos, esquemas Zod, límites duros, logger, ids |
| `packages/db` | Repositorios: case, evidence, auditRun, toolExecution, auditResult |
| `packages/evidence` | Preparación de evidencia: sha256, texto, PDF→texto, imagen→visión, audio→AssemblyAI |
| `packages/ai` | `OpenRouterProvider`, `AssemblyAIProvider`, `CaseAnalyst`, `AuditReviewer`, tools, policy retrieval |
| `policy/` | Procedimiento V5 indexado: `manifest.json` + `sections/*.md` |

Fuera: `packages/domain`, `packages/reporting`, `packages/rule-engine-v2`.

---

## 2. DELETE

### 2.1 Paquetes completos

| Ruta | Motivo |
|---|---|
| `packages/rule-engine-v2/` | 65 reglas, 6 outcomes, cincoMayor-valued logic, grafo de nodos, XDC, ranking provisional, 30 tests. Es exactamente lo que se elimina. |
| `packages/domain/` | `fact-contracts.ts` (contratos de hechos del motor) + `canTransitionAuditStatus`/`canTransitionJobStatus` (25 estados). Se reemplaza por `packages/shared`. |
| `packages/reporting/` | Snapshot de dictamen, `computeSnapshotFingerprint`, `rulesFingerprint`, outcomes `CANCELACION_DE_VENTA`/`RETENCION` que no existen en el catálogo vigente. |

### 2.2 Módulos de `apps/web/src/server`

| Ruta | Motivo |
|---|---|
| `audit-engine/` | `boundary.ts` (205 líneas de precondiciones de una capacidad que no existe), `http.ts`, `evaluation-response.ts`. |
| `canonical-facts/` | Puente `legacy-mappings` → `build-context` → `rule-engine-v2`. No tiene consumidor desde una ruta real. |
| `extraction/` | `contracts.ts` (Zod con `forbiddenValueFields` que prohíbe `outcome` a la extracción), `evidence-reference-validation.ts`, `tools/extract-dates.ts`, `tools/extract-contact-attempts.ts`. Normalizadores creados para el rules engine. |
| `facts/extract.ts` | 159 líneas de regex sobre texto para producir `contact.callAttempts` / `sourceCompleteness` / `classroom.hasEvaluationMode`. Reemplazado por tools. |
| `human-decision/service.ts` | Subida de dictamen humano + `HUMAN_DECISION_DOCUMENT`. El baseline isolation que justificaba el rol desaparece con el fact run. |
| `reporting/` | `render.ts` (PDF de dictamen), `template.ts`, `layout.ts`, `authz.ts`. La generación de dictamen dependía del resultado normativo aprobado. |
| `jobs/handlers.ts` → `FACT_EXTRACTION`, `AUDIT_EVALUATION`, `REPORT_GENERATION`, `HUMAN_DECISION_EXTRACTION`, `AI_RECONCILIATION` | Handlers que sólo lanzan 501 o sellan fact runs que nadie lee. |

### 2.3 Rutas API

`adjudication/`, `audit/`, `comparison/`, `dictamen/` (5 rutas), `human-decision/`
(2), `human-review/`, `reconciliation/`, `report-snapshot/`, `runs/`.
Conservar y reescribir: `audits/[auditId]`, `audits/[auditId]/evidences`,
`audits/[auditId]/comments`, `audits/[auditId]/events`, `jobs/process`,
`evidences/[evidenceId]/download`, `auth/refresh`, `health/insforge`.

### 2.4 Tablas (vía migración)

`fact_extraction_runs`, `facts`, `fact_reviews`, `fact_run_frozen_snapshots`,
`canonical_fact_runs`, `canonical_fact_candidates`, `canonical_facts`,
`engine_runs`, `engine_rule_results`, `rules`, `rule_conditions`,
`evidence_requirements`, `rule_evaluations`, `policy_sources`,
`policy_source_registry`, `report_snapshots`, `dictamen_documents`,
`dictamen_versions`, `generated_pdfs`, `ai_decision_snapshots`,
`ai_usage`, `audit_comparisons`, `audit_evaluation_envelopes`,
`final_adjudications`, `human_decision_extracts`, `human_reviews`,
`audit_evidence_selection`, `provider_operations`, `speaker_assignments`,
`audit_temporal_context`, `extracted_facts`, `decision_runs`, `transcript_segments`,
`schema_baseline_v2_manifest`, y las funciones `freeze_fact_run_v1`,
`create_derived_fact_run_v1`.

Se conservan: `audits`, `evidences`, `audit_log`, `audit_manual_comments`, `jobs`,
`job_attempts`, `job_artifacts`, `profiles`, `auth.users`.

### 2.5 Documentación

`docs/legacy/` completo (100+ archivos), `docs/policy-v2/`, `docs/rule-engine-v2/`,
`docs/reports/`, `docs/phases/`, `docs/phase-prompts/`, `docs/adr/`,
`docs/architecture/` (reemplazado por el documento de arquitectura vigente),
`docs/ai/`, `docs/security/phase-*.md`, `docs/db/`, `docs/superpowers/`.

### 2.6 Tests

Los 30 tests de `rule-engine-v2`, `audit-engine/*`, `canonical-facts/*`,
`extraction/*`, `facts/extract.test.ts`, `packages/*/src/*.test.ts`,
`reporting/*`, `evaluation-view-model.test.ts`, `page.test.ts`.

### 2.7 Dependencias

`pdf-lib` (plantilla de dictamen), `@napi-rs/canvas`, `pdfjs-dist` (scripts de
render), `esbuild`. `@insforge/sdk` y `zod` se conservan.

### 2.8 Vocabulario prohibido en el código resulting

`policy-engine`, `rule-engine`, `policyEngine`, `ruleEngine`, `FactRun`,
`EngineRun`, `PolicyInput`, `RuleEvaluation`, `RuleCondition`, `RuleResult`,
`RuleTrace`, `sourceCompleteness`, `UNKNOWN_IS_NOT_FALSE`, `evaluateRules`,
`executeRule`, `policyEvaluation`, `INDETERMINADO`.

---

## 3. REWRITE

### 3.1 `packages/shared` — contratos

- `limits.ts`: `MAX_AGENT_STEPS = 12`, `MAX_TOOL_CALLS = 20`,
  `MAX_REVIEW_ROUNDS = 2`, `MAX_PROVIDER_ATTEMPTS = 2`,
  `PROVIDER_TIMEOUT_MS`, `AUDIO_POLL_MAX_ATTEMPTS`, `AUDIO_POLL_INTERVAL_MS`,
  `AUDIO_POLL_TIMEOUT_MS`.
- `audit-run.ts`: estados `CREATED | PROCESSING_EVIDENCE | ANALYZING | REVIEWING |
  COMPLETED | NEEDS_INPUT | FAILED`. Transiciones válidas. `TERMINAL_AUDIT_RUN_STATES`.
- `tool-execution.ts`: estados `PENDING | RUNNING | WAITING_EXTERNAL | SUCCEEDED |
  FAILED`. Campos de lifecycle: `createdAt, startedAt, finishedAt, timeoutAt,
  attempts, errorCode, errorMessage`.
- `assessment.ts`: `AssessmentSchema` (Zod). `status: 'COMPLETED' | 'NEEDS_INPUT'`.
  `classification?: 'CANCELACION_VENTA' | 'BAJA' | 'CANCELACION_VENTA_OPERATIVA' |
  'DICTAMINACION'`. `findings[]`, `evidenceReferences[]`, `policyReferences[]`,
  `contradictions[]`, `missingEvidence[]` (con `description`, `reason`,
  `suggestedEvidence`).
  Regla: `status === 'NEEDS_INPUT'` **exige** `missingEvidence.length >= 1`.
  Regla: `status === 'COMPLETED'` **exige** `classification`.
- `review.ts`: `ReviewSchema` (Zod). `verdict: 'CONFIRMED' | 'REJECTED'`.
- `policy.ts`: manifiesto y sección.
- `logger.ts`: logging estructurado. Nunca secretos, nunca transcripciones
  completas.

### 3.2 `packages/ai`

- `openrouter.ts`: `OpenRouterProvider` con `generateStructured()` y
  `generateWithTools()`. Timeout con `AbortSignal`. Registra `model`,
  `inputTokens`, `outputTokens`, `estimatedCost`, `latencyMs`.
- `assemblyai.ts`: `AssemblyAIProvider` con `submit()`, `status()`,
  `transcript()`. Webhook preferido; fallback de polling acotado.
- `analyst.ts`: `runCaseAnalyst()` — bucle acotado que expone tools al modelo.
- `reviewer.ts`: `runAuditReviewer()`.
- `tools/`: `listEvidence`, `readEvidence`, `searchEvidence`, `readPdfPage`,
  `searchPdf`, `inspectImage`, `getAudioTranscript`, `getAudioSegment`,
  `searchPolicy`, `readPolicySection`, `getCaseMetadata`, `getTimeline`.
- `policy/retrieval.ts`: índice de búsqueda por sección/página/contenido.

### 3.3 `policy/`

```
policy/
  manifest.json     { code, version, publishedAt, sourceSha256, pageCount, sections[] }
  sections/5.1.md … { section, title, pages, text }
```

`searchPolicy(query)` devuelve `{ section, title, page, snippet, score }`.
`readPolicySection(section)` devuelve el texto completo.

### 3.4 `apps/web`

Rutas nuevas: `POST /api/cases`, `GET /api/cases`,
`POST /api/cases/:caseId/evidences`, `POST /api/cases/:caseId/runs`,
`GET /api/runs/:runId`, `POST /api/webhooks/assemblyai`.

UI: `nuevo caso → drag&drop → procesando → analizando → revisando → resultado`.

---

## 4. KEEP

| Ruta | Nota |
|---|---|
| `apps/web/src/app/(private)/auditorias/` | Componentes de UI reutilizables: `NewAuditForm` (drag&drop), `AuditStatusBadge`, `ManualCommentsPanel`, `DeleteAuditButton`. |
| `apps/web/src/app/login/`, `src/middleware.ts`, `src/server/auth/` | Auth InsForge. |
| `apps/web/src/server/evidence/upload.ts` | Valida mime por firma, calcula SHA-256, sube a storage. Se conserva la validación, se añade deduplicación por hash. |
| `apps/web/src/server/insforge/server.ts` | Cliente InsForge. |
| `apps/web/src/server/config/env.ts` | Se reescribe con las nuevas variables de modelos. |
| `apps/web/src/server/jobs/` (cola durable) | `enqueue-evidence.ts` y los RPC `enqueue_job`/`claim_next_job`/`complete_job`/`schedule_job_retry`/`fail_job_permanent`. `max_attempts` pasa de 3 a 2. |
| `apps/web/src/lib/format.ts`, `globals.css`, `tailwind.config.ts` | Presentación. |
| `templates/Dictamen.pdf` | Plantilla canónica en disco. **No cableada** (ver §5). |
| `fixtures/evidence/` | 7 archivos de ejemplo para pruebas. |
| `.github/workflows/ci.yml` | lint → typecheck → test → build. |

---

## 5. UNKNOWN

| Tema | Decisión tomada para avanzar | Pendiente |
|---|---|---|
| Generación de dictamen PDF | **Se elimina** la ruta activa. `templates/Dictamen.pdf` queda en disco sin cablear. | Reimplementar el render sobre `AuditResult` cuando el assessment sea estable. No está en la Definition of Done de esta migración. |
| Procedimiento D53 (`GDM_GAM_PRD_MXL_008`) y Glosario | **No se indexan.** Sólo V5. | El agente puede indexarlos después con el mismo loader sin cambios de código. |
| Cancelación de Processing de audio | `ToolExecution` en `WAITING_EXTERNAL` expira por `timeoutAt`; un barrido marca `FAILED`. | El barrido se dispara desde `jobs/process`. |
| Comparación IA vs dictamen humano (`OD-001`) | **Se elimina.** Depende del motor. | Reimplementar como `Reviewer` si el owner lo pide. |
| Presión de `fact_run` congelado | **Desaparece.** No hay fact run. | — |
| Regresión numérica vs golden cases | **No aplica.** No hay reglas. | El eval dataset nuevo cubre variabilidad. |
| Datos históricos en tablas del motor | **Se borran.** Eran derivados, no evidencia. `evidences` y `audit_log` (evidencia + trazabilidad) se conservan. | Si el owner necesita historia, Git + los PDFs de `normative/` la tienen. |

---

## 6. Criterios de aceptación

Cada `AuditRun` creado durante las pruebas termina en exactamente uno de
`COMPLETED`, `NEEDS_INPUT`, `FAILED`. Un provider que nunca responde termina por
timeout. Un webhook duplicado no duplica resultados. Un run `COMPLETED` no vuelve a
`PROCESSING`. El eval dataset produce al menos un caso por outcome principal.
