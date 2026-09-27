# Integración de evidencia canónica — Reporte A–T

## A. Baseline

- Rama inicial verificada: `feature/policy-foundation-remediation`.
- HEAD inicial verificado: `52a0564ba95fb1d567020a49e51628ccd65627ae`.
- Árbol inicial: limpio.
- Gates iniciales verificados antes de cambiar código: typecheck 5/5, lint 5/5, tests 526, build PASS.

## B. Verified previous implementation

Se preservó la corrección previa: roles de fuente, D53 provisional-only, traza `AUTHORITY` / `PROVISIONAL_ONLY`, guard fail-closed de reporting y boundary 501. No se reinició Rule Engine V2.

## C. Source roles

`GDM_GAM_PRD_MLG_003` sigue siendo la única autoridad primaria para cerrar desenlaces. D53 y glosario permanecen auxiliares. `R-RET-03` mantiene grounding primario vía `N-32`.

## D. Cancellation outcome catalog

No se modificó el catálogo de outcomes: `CANCELACION_VENTA`, `BAJA`, `CANCELACION_VENTA_OPERATIVA`, `CANCELACION_MATRICULA`, `RETENCION`, `DICTAMINACION`.

## E. Changes implemented

- Capa pura `acquisition/` en `packages/rule-engine-v2`.
- `CanonicalFactCandidate`.
- Matriz de adquisición de 94 hechos.
- Validación determinista de candidatos.
- Merge canónico con `CONTRADICTED`.
- Builder de `EvaluateAuditInput`.
- Proyección de faltantes relevantes.
- E2E determinista evidencia sintética → hechos → motor → resolución provisional.
- Adaptador web para mappings legacy `EXACT` solamente.
- Migración SQL para corridas/hechos/candidatos/contexto temporal canónicos.
- Boundary actualizado: mantiene 501, pero con precondiciones nuevas y veraces.

## F. Rule Engine coverage

Tests del motor pasaron de 343 a 358. Nuevos tests cubren matriz, validación, merge, contexto, faltantes relevantes, AMB-CON-01 y E2E canónico.

## G. Automatic audit workflow

Probado de forma determinista:

```text
CanonicalFactCandidate[]
→ candidateToFact
→ mergeCanonicalFacts
→ buildCanonicalEvaluateAuditInput
→ evaluateAudit
→ closestOutcome = BAJA
```

El E2E produce `REQUIRES_HUMAN_REVIEW`, `normativeOutcome: null` y `closestOutcome: BAJA`.

## H. Human interaction

No se creó cuestionario de 94 campos. La salida operacional usa `relevantMissingFactsForEvaluation`, que filtra hechos faltantes por candidato/rama activa.

## I. AMB-CON-04

No se modificó AMB-CON-04. El foco de regresión solicitado fue AMB-CON-01; se añadió prueba que garantiza su visibilidad en salida, traza y candidate trace.

## J. Provisional results

El fixture canónico demuestra el comportamiento que quieres probar: aunque el cierre normativo siga indeterminado por revisión, el sistema devuelve resolución provisional (`closestOutcome`) y trazabilidad.

## K. Auxiliary source safety

No se abrió ningún camino para que D53 cierre por sí solo. El E2E canónico alcanza `R-D53-RELOJ-50` y devuelve `closestOutcome: BAJA`, pero el estado sigue `REQUIRES_HUMAN_REVIEW`.

## L. API

La ruta sigue 501. No se fabricó un 200. Nuevas precondiciones:

- `CANONICAL_FACT_PIPELINE_NOT_WIRED_TO_ROUTE`
- `CANONICAL_FACT_RUN_NOT_LOADED_BY_ROUTE`
- `TEMPORAL_CONTEXT_NOT_CAPTURED_FOR_REAL_AUDIT`

## M. Persistence

Nueva migración: `migrations/20260927120000_canonical_fact_context.sql`.

Tablas declaradas:

- `audit_temporal_context`
- `canonical_fact_runs`
- `canonical_fact_candidates`
- `canonical_facts`

Incluye provenance JSONB, confidence de extracción separada, estados canónicos y temporal context.

## N. UI

No se agregó UI nueva ni cuestionario. La UI existente puede consumir `relevantMissingFacts` cuando se conecte la ruta.

## O. PDF/reporting

No se reabrió Dictamen ni reporting normativo. El safeguard fail-closed permanece.

## P. Tests

Nuevos tests focales:

- Rule Engine: 15 tests nuevos focales.
- Web: 18 tests focales relevantes incluyendo boundary.
- DB: 1 test de migración.

Full suite: 545 tests.

## Q. Gates

Resultados reales:

```text
typecheck: 5/5 Done
lint:      5/5 Done
tests:     545 passed
build:     5/5 Done
```

## R. Git diff summary

Creado/modificado:

- `packages/rule-engine-v2/src/acquisition/*`
- `packages/rule-engine-v2/src/tests/24-30*`
- `apps/web/src/server/canonical-facts/*`
- `apps/web/src/server/audit-engine/boundary.ts`
- `packages/db/src/canonical-fact-context-migration.test.ts`
- `migrations/20260927120000_canonical_fact_context.sql`
- `docs/rule-engine-v2/canonical-fact-acquisition-matrix.{json,md}`
- `docs/superpowers/plans/2026-09-27-canonical-evidence-integration.md`
- documentación previa corregida de “cinco valores” a cuatro estados de hecho.

## S. Remaining limitations

- La ruta real aún no carga `canonical_fact_runs` ni ejecuta contra auditorías subidas.
- La migración está escrita y testeada por forma; no fue aplicada remotamente en esta sesión.
- Sólo hay un mapping legacy `EXACT`: `contact.effectiveContact → F-contacto_efectivo`.
- `classroom.hasActivities` queda `AMBIGUOUS` por polaridad/nivel.
- Fechas capturadas por formulario aún deben persistirse y conectarse a `audit_temporal_context`.

Conteo de matriz:

```text
Canonical facts total: 94
Automatically acquirable: 92
  direct extraction: 46
  deterministic derivation: 3
  audit metadata/prefill: 4
  temporal derivation: 39
Not currently automatically acquirable: 0
Owner semantic mapping required: 1
Auxiliary reference / not user input: 1
```

## T. Normative status

```text
Phase 1.5: READY_FOR_OWNER_REVIEW
Owner normative questions: UNRESOLVED
Normative Phase 2: NOT COMPLETE
Rule Engine V2: IMPLEMENTED_AND_VERIFIED
Canonical evidence integration: PARTIAL_PREFERRED_CONDITION_PROVEN
Provisional integration: AVAILABLE_IN_DETERMINISTIC_E2E
Official normative Dictamen for unresolved cases: CLOSED
```
