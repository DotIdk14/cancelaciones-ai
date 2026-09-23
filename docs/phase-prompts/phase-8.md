# Phase 8 — Cierre de dictamen y post-producción

NO tienes contexto de chats anteriores.
Reconstruye el estado desde el repositorio y los reportes.

## Documentación Obligatoria

Leer antes de implementar:

- `AGENTS.md`
- `README.md`
- `docs/phases/roadmap.md`
- `docs/reports/phase-7-report.md`
- `docs/reporting/dictamen-template.md`
- `docs/reporting/template-vs-historical-cases.md`
- `docs/policy/*`
- `docs/architecture/*`
- `docs/quality/mvp-acceptance-gate.md`
- `templates/Dictamen.pdf`

## Estado de Entrada

PHASE 7 DEVELOPMENT GATE = PASS.

REAL-CASE VALIDATION = DEFERRED.

Phase 8 puede iniciar desarrollo aunque no exista todavía validación E2E con expediente real. No falsificar validaciones reales: cualquier fixture, seed o synthetic run usado durante esta fase debe marcarse `NON_PRODUCTION_VALIDATION`.

## Objetivo

Cerrar el flujo de dictamen oficial dentro del alcance de desarrollo permitido:

- Workflow de dictamen en la UI (revisión humana -> selección de evidencia -> snapshot -> borrador -> aprobación -> final).
- Estados visibles del expediente: acciones permitidas solo en el estado correcto.
- Descarga de borrador y final desde la UI.
- Comentarios manuales integrados al snapshot y al PDF.
- Limpieza de deuda técnica de Phase 7 que no requiera real-case validation.

Separar siempre `FEATURE_IMPLEMENTED` de `REAL_CASE_VALIDATED`.

## Alcance de Desarrollo Permitido

Para desarrollo y pruebas de Phase 8 se permite usar:

- fixture controlado;
- synthetic Fact Run;
- seeded Engine Run;
- el fixture sintético `SYNTHETIC / DEVELOPMENT ONLY / NON_PRODUCTION_VALIDATION` de Phase 7.

Todo lo anterior debe quedar marcado como `NON_PRODUCTION_VALIDATION` y no puede cerrar `docs/quality/mvp-acceptance-gate.md`.

## Workflow UI

Implementar en el detalle de auditoría los pasos en este orden:

1. Revisión humana (APROBAR / CORREGIR con razón obligatoria).
2. Selección de evidencias determinantes.
3. Crear snapshot (idempotente).
4. Generar borrador (BORRADOR - NO ES DOCUMENTO FINAL).
5. Aprobar snapshot (solo con revisión humana).
6. Generar documento FINAL (solo desde snapshot aprobado).

Reglas de UI:

- Mostrar siempre qué paso está pendiente y cuál es el siguiente habilitado.
- Un snapshot DRAFT tras una nueva revisión/selección debe permitir regenerar el borrador.
- La descarga del borrador debe dejar claro que no es el documento final.
- El documento final debe marcarse inmutable y enlazar su SHA-256.

## Estados

Definir y mostrar un estado legible por expediente:

- SIN REVISAR
- REVISADO
- SNAPSHOT CREADO
- BORRADOR GENERADO
- APROBADO
- FINAL GENERADO

Persistir los cambios de estado en el `audit_log` como eventos durables; nunca depender de memoria del proceso.

## Descarga

- Borrador y final se descargan vía `GET /api/audits/[auditId]/dictamen/[docId]/download`.
- El botón de descarga solo aparece cuando el documento existe.
- Mantener `Cache-Control: private, no-store`.

## Comentarios Manuales

- Los comentarios ya persisten en `audit_manual_comments`.
- Revisar que el snapshot los congele (`manual_comments`) y que el PDF los refleje en las celdas `comentariosBO`, `comentariosHelpDesk`, `comentariosSER`, `comentariosFinanzas`.
- Campos vacíos se omiten del PDF.

## Deuda Técnica Permitida

Solo dentro de lo ya implementado en Phase 7:

- Ajustar mapeos campo->celda si un campo visible del PDF no coincide con la plantilla.
- Corregir `PAGE1_CELLS`/layout si el render degrada.
- Mejorar componentes reutilizables sin duplicar implementaciones (`DO_NOT_DUPLICATE_IMPLEMENTATIONS`).

No ampliar cobertura normativa nueva (eso requiere fuentes OWNER y real-case validation).

## Gates

Antes de declarar Phase 8:

- `pnpm lint` PASS
- `pnpm typecheck` PASS
- `pnpm test` PASS
- `pnpm build` PASS
- smoke render PASS (si se tocó render)
- documento `docs/reports/phase-8-report.md` creado
- prompt `docs/phase-prompts/phase-9.md` creado (si roadmap requiere otra fase) o cierre de fases de desarrollo

## Estado Final Esperado

Termina la respuesta con:

PHASE 8 READY

y si no queda documentación duplicada ni huérfana:

DOCUMENTATION CLEANUP