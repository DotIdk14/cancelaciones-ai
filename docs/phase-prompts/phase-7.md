# Phase 7 — Dictamen oficial, revisión humana y workflow PDF

NO tienes contexto de chats anteriores.
Reconstruye el estado desde el repositorio y los reportes.

## Documentación Obligatoria

Leer antes de implementar:

- `AGENTS.md`
- `README.md`
- `docs/phases/roadmap.md`
- `docs/reports/phase-6-report.md`
- `docs/reporting/dictamen-template.md`
- `docs/policy/*`
- `docs/architecture/*`
- `docs/quality/mvp-acceptance-gate.md`
- `templates/Dictamen.pdf`

## Estado de Entrada

PHASE 6 DEVELOPMENT GATE = PASS.

REAL-CASE VALIDATION = DEFERRED.

Phase 7 puede iniciar desarrollo aunque no exista todavía validación E2E con expediente real. No falsificar validaciones reales: cualquier fixture, seed o synthetic run usado durante esta fase debe marcarse `NON_PRODUCTION_VALIDATION`.

## Objetivo

Construir el flujo de dictamen oficial alrededor de:

- Machine Decision
- Human Review
- Manual Area Comments
- Evidence Selection
- Report Snapshot
- Draft Dictamen.pdf
- Approval
- Final Dictamen.pdf

Separar siempre `FEATURE_IMPLEMENTED` de `REAL_CASE_VALIDATED`.

## Alcance de Desarrollo Permitido

Para desarrollo y pruebas de Phase 7 se permite usar:

- fixture controlado;
- synthetic Fact Run;
- seeded Engine Run;
- existing test Engine Run.

Todo lo anterior debe quedar marcado como `NON_PRODUCTION_VALIDATION` y no puede cerrar `docs/quality/mvp-acceptance-gate.md`.

No usar un Dictamen humano histórico como input normativo. Los históricos siguen siendo referencia/comparación, no política.

## Human Review

Implementar revisión humana explícita:

- APROBAR RESULTADO
- CORREGIR RESULTADO

Mantener separados:

- `machineOutcome`
- `humanOutcome`

Si el usuario corrige, `humanReason` es obligatorio.

Persistir:

- `reviewedBy`
- `reviewedAt`

La Machine Decision es immutable. Una corrección humana no sobrescribe la decisión de máquina.

## Report Snapshot

Antes de generar documento crear un snapshot durable con:

- `auditId`
- `factRunId`
- `engineRunId`
- `policyCode`
- `policyVersion`
- machine outcome
- human outcome
- manual comments
- selected evidence
- template hash
- rule trace refs

El snapshot debe permitir reproducir el documento generado.

## Draft Dictamen

Generar primero `DRAFT DICTAMEN`.

Permitir revisar:

- datos
- comentarios
- outcome
- texto
- evidencias

`DRAFT != FINAL`.

## Final Dictamen

Sólo tras aprobación generar `FINAL DICTAMEN`.

Persistir:

- snapshot ID
- PDF SHA-256
- storage key
- generatedBy
- generatedAt
- template hash

El final debe ser immutable.

## Plantilla Canónica

Usar `templates/Dictamen.pdf` como canonical presentation template.

No sustituirla por HTML u otro reporte alternativo como salida oficial. No cambiar estructura arbitrariamente. No convertir históricos en política.

## Manual Area Comments

Mapeo obligatorio:

- `back_office_comment` -> Comentarios BO
- `helpdesk_comment` -> Comentarios HelpDesk
- `school_services_comment` -> Comentarios SER
- `finance_comment` -> Comentarios Finanzas

`additional_comment` requiere elección humana antes de insertar en el documento.

## Evidence Selection

Permitir que el auditor seleccione qué evidencias son determinantes para el PDF.

No insertar todo automáticamente. Conservar referencias a originales, hashes y provenance.

## Synthetic Development Fixture

Crear un fixture E2E privado/no-PII para desarrollar Phase 7 si no hay caso real.

Debe estar claramente marcado:

`SYNTHETIC / DEVELOPMENT ONLY` y `NON_PRODUCTION_VALIDATION`.

Puede contener:

- sample student data
- sample machine outcome
- sample rules
- sample comments
- sample evidence artifacts

No agregar PII. No usar este fixture para cerrar MVP Acceptance Gate.

## Frontend Foundation

Preparar componentes reutilizables sin mega-components:

- `AuditStatusBadge`
- `MachineDecisionCard`
- `HumanReviewCard`
- `RuleGroupList`
- `MissingItemsPanel`
- `EvidenceSelector`
- `ManualCommentsPanel`
- `ReportPreviewCard`
- `AuditTimeline`

Mantener diseño pragmático y alineado al lenguaje visual actual. No hacer un rediseño total todavía.

## Frontend UX

Mejorar especialmente:

- Audit detail page
- Result panel
- Review workflow
- Comments
- Evidence selection
- PDF workflow

La vista ideal debe aproximarse a:

- Auditoría
- Resumen
- Evidencias
- Datos detectados
- Resultado sugerido
- Reglas
- Comentarios de otras áreas
- Revisión humana
- Dictamen

No es obligatorio implementar tabs si otra navegación simple resulta mejor.

## User Management Preparation

No implementar RBAC empresarial complejo en Phase 7.

Revisar que el dominio soporte posteriormente:

- users
- profiles
- organization
- audit ownership
- createdBy
- reviewedBy

No crear roles innecesarios.

## AI Boundaries

No volver el Policy Engine probabilístico.

AI sigue siendo:

- extraction
- classification of evidence
- structured parsing
- summarization for review

AI NO decide policy.

Preparar arquitectura para mejorar providers/model routing después si es necesario.

## Validaciones de Phase 7

Implementation Gate requiere:

- `pnpm lint` PASS
- `pnpm typecheck` PASS
- `pnpm test` PASS
- `pnpm build` PASS
- human review tests
- machine immutability tests
- comments mapping tests
- snapshot tests
- draft/final tests
- idempotency tests
- authorization tests
- private storage tests

Si no se utiliza caso real, reportar `REAL_CASE_VALIDATION = DEFERRED_TO_MVP_ACCEPTANCE`, no `BLOCKED`.

## Reporte Canónico

Actualizar únicamente:

- `docs/reports/phase-7-report.md`

No crear:

- `phase-7-final-report.md`
- `phase-7-closure.md`
- `phase-7-validation.md`
- reportes duplicados equivalentes.

El reporte debe contener:

- `# Phase 7 Report`
- `## Current Status`
- `## Last Updated`
- `## Executive Summary`
- `## Implementation`
- `## Human Review`
- `## Machine Decision Preservation`
- `## Manual Comments`
- `## Evidence Selection`
- `## Report Snapshot`
- `## Canonical Template`
- `## Draft PDF`
- `## Final PDF`
- `## Hashes`
- `## Storage`
- `## Authorization`
- `## Audit Log`
- `## Frontend UX`
- `## Synthetic Development Fixture`
- `## Tests`
- `## Lint`
- `## Typecheck`
- `## Build`
- `## Deferred Real Validation`
- `## Remaining Warnings`
- `## Phase 8 Readiness`
- `## Status History`

## Completion Rules

Al terminar Phase 7:

Si Implementation Gate pasa, crear `docs/phase-prompts/phase-8.md` y eliminar cualquier `docs/phase-prompts/phase-7-remediation.md`.

Si Phase 7 implementation queda realmente bloqueada, crear `docs/phase-prompts/phase-7-remediation.md`.

## Phase 8 Direction

La siguiente fase deberá centrarse principalmente en productization:

- frontend refinement
- user management
- account/profile UX
- audit lists/search/filter
- dashboard
- operational workflows
- AI quality improvements
- observability
- costs
- settings

No implementar todo eso dentro de Phase 7 si excede el objetivo.

## Reglas Finales

No generar `FINAL DICTAMEN` productivo sin aprobación humana y validación de snapshot.

No declarar el generador listo para producción hasta validarlo con expediente real.

No cambiar política normativa para permitir avanzar.

No confundir `REAL_CASE_VALIDATION = DEFERRED` con bloqueo de desarrollo.
