# Policy Foundation Remediation Report

> **Checkpoint de continuación:** 2026-09-24. La remediación no está completa. El trabajo llegó y aprobó las Tasks 1–7 del plan; las Tasks 8–12 siguen pendientes. Este documento registra el estado verificable antes de commit/push.

## 1. Executive Summary

Estado: **PARTIAL — checkpoint después de Task 7**.

Se implementaron y revisaron los fundamentos de contratos, provenance, Golden Master, separación de estados, firewall de Extraction Tools, validación de evidencia y sanitización blind fail-closed. No se modificó `evaluatePolicy` ni `v5Rules`, y no se conectaron tools, OpenRouter o shadow engine al pipeline productivo.

La persistencia durable de Fact Runs, AI_DECISION_V1 y las migraciones InsForge todavía no se implementó en este checkpoint. DB validation permanece **BLOCKED** porque el proyecto CLI no estaba enlazado y no se aplicaron migraciones.

## 2. Baseline Before Changes

- Tests: **PASS** — 13 archivos web y 4 paquetes, 58 tests.
- Lint: **PASS**.
- Typecheck: **FAIL** — seis errores preexistentes en `audit-pipeline.dev-e2e.test.ts` y `audit-queue.e2e.test.ts`.
- Build: **PASS**.

El typecheck fue corregido mecánicamente en Task 1, preservando la expectativa funcional `COMPLETED | SUCCEEDED`.

## 3. Files Changed

- `packages/domain/src/policy-foundation.ts`
- `packages/domain/src/policy-foundation.test.ts`
- `packages/domain/src/index.ts`
- `packages/policy-engine/src/source-registry.ts`
- `packages/policy-engine/src/source-registry.test.ts`
- `packages/policy-engine/src/evaluation-envelope.ts`
- `packages/policy-engine/src/evaluation-envelope.test.ts`
- `packages/policy-engine/src/shadow-engine.ts`
- `packages/policy-engine/src/shadow-engine.test.ts`
- `packages/policy-engine/src/golden-master-cases.ts`
- `packages/policy-engine/src/golden-master.test.ts`
- `packages/policy-engine/src/testdata/golden-master-v1.json`
- `packages/policy-engine/src/index.ts`
- `apps/web/src/server/extraction/`
- `apps/web/src/server/policy/blind-evidence-sanitizer.ts`
- `apps/web/src/server/policy/blind-evidence-sanitizer.test.ts`
- `apps/web/src/server/policy/blind-audit.ts`
- `apps/web/src/server/policy/blind-audit.test.ts`
- `apps/web/src/server/jobs/audit-pipeline.dev-e2e.test.ts`
- `apps/web/src/server/jobs/audit-queue.e2e.test.ts`
- `docs/superpowers/specs/2026-09-24-policy-foundation-remediation-design.md`
- `docs/superpowers/plans/2026-09-24-policy-foundation-remediation.md`

El reporte histórico `RULE-ENGINE-REFACTOR-REPORT.md` se conservó sin cambios normativos.

## 4. Canonical Policy Source Registry

**PASS técnico / BLOCKED normativamente.**

Se creó el contrato con estados `CANONICAL`, `LEGACY`, `PENDING_VERIFICATION` y `SUPERSEDED`, validación SHA-256, duplicados, `get`, `list`, `canonicalSources` y referencias. La fuente local sigue `PENDING_VERIFICATION`; no se designó ningún PDF como canónico.

## 5. Golden Master

**PASS.**

Se congelaron 13 familias sintéticas, incluyendo UNKNOWN, collections PARTIAL/UNKNOWN, 5.2, 5.7.e, 5.8.a, coverage gaps, missing facts y un probe explícito de conflicto no materializado por el rule set actual. La fixture es estática y no tiene auto-update.

Fixture SHA-256 actual: `38e29f441498b72137fcb6bda49b0aa00ff6f4f898c2c7f6504b46a378ea0d76`.

## 6. Frozen Fact Run Immutability

**BLOCKED / pendiente.**

Se diseñó el contrato, pero no se creó migración, RPC ni trigger de freeze irreversible. La revisión humana actual aún puede consultar revisiones humanas al construir una evaluación.

## 7. AI_DECISION_V1 Persistence

**BLOCKED / pendiente.**

No se creó tabla durable ni repositorio append-only. El runner shadow sigue devolviendo el registro en memoria y no tiene caller productivo.

## 8. AI_DECISION_V1 Immutability

**BLOCKED / pendiente.**

No existe todavía garantía DB de UPDATE/DELETE blocked para snapshots AI. El hash actual aún se calcula en memoria y no cubre el contrato completo de persistencia.

## 9. Human Correction Versioning

**BLOCKED / pendiente.**

No se implementó la creación de Fact Run derivado. El endpoint de revisiones existente todavía necesita migrarse para no reescribir retrospectivamente la entrada de una decisión.

## 10. Evaluation State Separation

**PASS.**

`AuditEvaluationEnvelopeV1` separa `decision`, `evidence`, `policy`, `system` y `review`, con reason codes separados. `missingFacts` no activa `MISSING_EVIDENCE`; conflictos normativos no se convierten en contradictory evidence.

## 11. Fact Provenance Model

**PASS para el contrato shadow.**

`FactProvenanceV1` conserva evidence, artifact, hash, timestamps, source text, método, extractor ID/version y confianza cuando existe.

## 12. Fact State Model

**PASS para contratos shadow.**

Se definieron `OBSERVED`, `INFERRED`, `UNKNOWN` y `CONTRADICTORY`; `UNKNOWN` conserva `value: null` y no se transforma en `false`.

## 13. Extraction Tool Contract

**PASS.**

Zod valida input/output; el output es strict y sólo admite `{ facts }`; existe metadata estable, deterministic, versiones de schema y validación runtime.

## 14. Extraction Tool Registry

**PASS.**

Registry local con `register`, `get`, `list` y `execute`, metadata congelada, duplicados rechazados y validación de input/output.

## 15. Policy Firewall

**PASS.**

Se rechazan campos normativos en el nivel superior y recursivamente dentro de `value`, objetos, arrays y records. No se permiten outcomes, decisions, rule IDs ni policy decisions como output de tools.

## 16. Reference Extraction Tools

**PASS como shadow/test-only.**

- `extract_dates`: fechas ISO estructuradas, incluyendo `YYYY-MM-DD`.
- `extract_contact_attempts`: reutiliza `extractFactsFromArtifacts` y filtra sólo contacts permitidos; collections vacías se mantienen UNKNOWN.

No hay callers en `apps/web/src/app` ni `apps/web/src/server/jobs`.

## 17. LLM Tool Boundary

**PASS como frontera preparada; LLM no conectado.**

El contrato de salida exige validación Zod, provenance y references. OpenRouter no fue conectado ni usado como autoridad normativa.

## 18. Evidence Reference Validation

**PASS.**

`validateEvidenceReferences` comprueba existencia, allowlist, auditoría, artifact asociado, hash, roles BLIND, referencias huérfanas y modo runtime inválido. Los tools validan antes y después de extraer.

## 19. Blind Sanitization

**PASS.**

El manifest es fail-closed, sólo admite `document_role = EVIDENCE`, excluye roles humanos/desconocidos/vacíos, valida relaciones artifact-evidence antes de filtrar y rechaza facts/candidates inconsistentes antes de graph/reasoner.

## 20. Fingerprint Determinism

**PASS para blind foundation.**

`blindCanonicalInputV1` excluye audit ID, fact run ID, UUIDs operativos y `createdAt`; ordena por code points e incluye artifacts, facts y candidates relevantes.

## 21. Shadow Engine Preparation

**PASS como boundary.**

`ShadowPolicyEngine` sólo expone `id`, `version` y `evaluate`; el runner fuerza `authoritative: false` y `DECLARATIVE_SHADOW`, sin DB, persistencia ni pathway oficial.

## 22. Tests Added

- Golden Master estático y fingerprints.
- Source registry y estados normativos.
- Evaluation envelope y shadow boundary.
- Extraction contracts, recursive firewall y registry.
- Evidence reference validation, mode fail-closed y artifact hash.
- `extract_dates` y `extract_contact_attempts`.
- Blind manifest, roles, references, candidates y fingerprints.

Task 7 reportó 30 blind tests y web suite de 121 tests en verde.

## 23. Regression Results

- Policy engine: Golden Master y suites de envelope/source/shadow verdes.
- Web: **121 tests PASS** en la última ejecución de Task 7.
- Web typecheck: **PASS**.
- Web lint: **PASS**.
- No se modificaron `evaluatePolicy`, `v5Rules` ni `policySets`.
- Warning preexistente: Vite CJS API deprecated.
- Tests legacy pueden imprimir `MODEL_ERROR` esperado; no son evidencia de un camino de decisión exitoso.

## 24. Database Validation

**BLOCKED.**

No se enlazó el CLI al proyecto, no se creó/aplicó migration y no se ejecutó E2E/RLS contra InsForge DEV en este checkpoint.

## 25. Normative Divergences Discovered

- La fuente/hash/versionado normativo sigue inconsistente y requiere OWNER.
- 5.2 permanece parcial.
- 5.7.e no tiene efecto de outcome conectado en el motor actual.
- 5.8.a clasifica cualquier nivel no vacío distinto de LICENCIATURA como no-licenciatura.
- V2 se genera reetiquetando V5.
- `READY_TO_APPROVE` no considera automáticamente todos los software coverage gaps.

Ninguna de estas divergencias fue corregida.

## 26. Remaining Risks

- Fact reviews pueden seguir alterando la entrada efectiva de una evaluación.
- `AI_DECISION_V1` aún no es durable ni append-only en DB.
- Los snapshots no están congelados a nivel trigger/constraint.
- La persistencia de engine runs y rule results aún no es atómica.
- La integración real de InsForge y RLS está sin validar.
- La ruta legacy y `runBlindMachineAudit` permanecen no productivas.

## 27. Remaining Blockers

- Tasks 8–12 del plan no ejecutadas.
- `AI_DECISION_V1` durable/inmutable.
- Frozen Fact Runs y human correction versioning.
- Migraciones forward-only y aplicación en InsForge DEV.
- E2E/RLS real.
- Reporte final completo después de completar la fase.

## 28. Readiness for Declarative Rules

**NO.**

Golden Master y shadow boundary están listos como base técnica, pero la fuente normativa continúa `PENDING_VERIFICATION` y faltan invariantes DB de inmutabilidad y validación real.

## 29. Readiness for LLM Extraction Tools

**NO como producción; YES comoBoundary técnica.**

La frontera LLM está especificada, pero no debe conectarse hasta completar persistencia, sanitización fail-closed de extremo a extremo, references durable y validación DB.

## 30. Recommended Next Phase

Después de revisión humana de este checkpoint:

```text
EXTRACTION TOOLS + DECLARATIVE SHADOW ENGINE
```

La siguiente ejecución debe comenzar con:

1. Implementar AI_DECISION_V1 durable/immutable.
2. Implementar Fact Run snapshots, FROZEN irreversible y correcciones derivadas.
3. Crear/aplicar migrations y validar RLS/E2E en InsForge DEV.
4. Completar documentación arquitectónica.
5. Sólo después continuar con tools reales y declarative shadow.

## Readiness Matrix

| Capability | Status | Evidence |
|---|---|---|
| Policy source canonical | BLOCKED | registry existe; fuente local PENDING_VERIFICATION |
| Golden Master | PASS | 13 casos estáticos, fixture y tests |
| Frozen Fact Runs immutable | BLOCKED | Task 6/7 no implementan DB freeze |
| AI_DECISION_V1 durable | BLOCKED | no migration/repository todavía |
| AI_DECISION_V1 immutable | BLOCKED | no trigger/append-only DB todavía |
| Human corrections versioned | BLOCKED | no derived Fact Run todavía |
| State separation | PASS | envelope tests |
| Full fact provenance | PASS | domain/tools contracts y shadow references |
| Tool contract | PASS | Zod strict tests |
| Tool registry | PASS | registry tests |
| Policy firewall | PASS | recursive forbidden-field tests |
| Evidence ref validation | PASS | validator/registry/tool tests |
| Blind sanitization | PASS | fail-closed manifest y runner tests |
| Stable fingerprints | PASS | blind tests sin IDs/timestamps operativos |
| Golden tests | PASS | dos ejecuciones exitosas reportadas |
| Shadow engine boundary | PASS | API no autoritativa |
| Declarative migration ready | NO | DB inmutability pendiente |
| LLM extraction tools ready | NO | persistencia y DEV E2E pendientes |
