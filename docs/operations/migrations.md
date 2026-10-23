# Migraciones: estado verificado al 23/10/2026

Lectura real con CLI: ledger oficial y catálogos de PostgreSQL, sin aplicar migraciones ni modificar datos. El ledger tiene 34 entradas, desde baseline (versión remota 0) hasta 20261022163849. Los avisos de migraciones pendientes de documentos anteriores deben leerse como históricos.

## Clasificación

A: aplicada y necesaria para reconstrucción. B: no registrada pero representada. C: pendiente necesaria. D: sustituida parcialmente. E: nunca implementada y sin dependencias. F: obsoleta pero necesaria para historial. Una migración puede contener objetos vigentes y otros sustituidos: no se elimina completa por un DROP posterior.

| Archivo local | Clase | Disponibilidad |
|---|---|---|
| 00000000000000_baseline.sql | A | Versionada |
| 20260928010000_ai-native-production.sql | A | Versionada |
| 20260929040000_audit-dashboard-metrics.sql | A | Versionada |
| 20260930010000_human-resolution.sql | A | Versionada |
| 20260930020000_human-review-dashboard-metrics.sql | A | Versionada |
| 20261001010000_case-reviewer-name.sql | A | Versionada |
| 20261002000000_auth-core.sql | A | Versionada |
| 20261003000000_paid-admissions.sql | A | Versionada |
| 20261003010000_derived-extractions.sql | A | Versionada |
| 20261005010000_case-area-comments.sql | A | Versionada |
| 20261005020000_case-dimensions-current.sql | A | Versionada |
| 20261005120000_origin-country-channel.sql | A | Versionada |
| 20261008090000_case-cycle-start-date-human.sql | A | Versionada |
| 20261008100000_membership-role-manager.sql | A | Versionada |
| 20261008110000_case-test-flag.sql | A | Versionada |
| 20261008120000_case-review-coordinator-decision.sql | A | Versionada |
| 20261008130000_dashboard-view-test-owner-scope.sql | A | Versionada |
| 20261009100000_case-list-pagination-indexes.sql | A | Versionada |
| 20261009110000_case-area-comments-authenticated-policy.sql | A | Versionada |
| 20261009120000_case-student-name.sql | A | Versionada |
| 20261011060433_app-incidents.sql | A | Versionada |
| 20261012100000_flokzu-case-import.sql | A / D-F parcial | Versionada |
| 20261013100000_dashboard-execution-evaluation-metrics.sql | A | Versionada |
| 20261013103000_flokzu-administrative-review.sql | A / D-F parcial | Versionada |
| 20261013110000_student-history-index.sql | A | Versionada |
| 20261013120000_student-history-reconciliation.sql | A | Versionada |
| 20261014180000_case-assignment-and-linking.sql | A | Versionada |
| 20261014180100_manual-cave-reference-repair.sql | A | Versionada |
| 20261014180200_case-merge-history.sql | A | Versionada |
| 20261014180300_confirmed-case-consolidation.sql | A | Versionada |
| 20261015100000_dashboard-sales-channel-flokzu.sql | A | Versionada |
| 20261019100000_case-reviews-per-audit.sql | A | Versionada |
| 20261019100100_ai-continuous-improvement.sql | A | Versionada |
| 20261022163849_remove-flokzu-administrative-review.sql | A | Versionada |

B: no se detectan versiones locales sin registro en esta lectura; esto no prueba igualdad de cada sentencia ni descarta cambios manuales. C/E: ninguna demostrada en la cadena local actual. D/F: las partes administrativas de Flokzu creadas por migraciones anteriores se retiran en 20261022163849; conservar sus archivos por orden y reconstrucción. Los dos SQL de docs/migration-archive son antecedentes excluidos del runner (F), no pendientes aplicables.

## Contraste del esquema

- case_reviews tiene índice único por audit_id; conservar revisiones de cada intento, no restaurar unicidad por case_id.
- audit_feedback, approved_examples, audit_versions y tablas de evaluación existen: las dos migraciones del 19 están registradas y representadas. La vista HTTP de mejora continua sigue deshabilitada.
- case_import_batches y flokzu_admin_events están ausentes; el catálogo no contiene las columnas administrativas retiradas de cases.
- Se consultaron constraints, índices, políticas, funciones, vistas y triggers públicos. Los recuentos agregados están en [infraestructura](../audits/infrastructure-evidence.json). Esto no sustituye ejecutar los bloques DO de cada migración en staging ni comparar todos los cuerpos SQL.

## Instalación nueva y corrección de la revisión inicial

Las 34 migraciones están versionadas, incluida 20260930010000_human-resolution.sql. Se confirmó con git ls-files --stage y git show HEAD:ruta. La entrada de .gitignore no desversiona archivos existentes: la supuesta brecha del informe inicial fue un diagnóstico erróneo y se corrigió antes de publicar. No es necesario recuperar ese SQL ni modificar la base.

El baseline no representa por sí solo el esquema vigente. Mantener los incrementos y usar el runner oficial en una base InsForge aislada para ensayar instalaciones nuevas. No se ha certificado una reconstrucción completa desde cero en esta sesión. No aplicar --all en producción; no hay versiones locales pendientes según el ledger consultado. Revisar [historial de conciliación](migration-history.md), backup y ensayo antes de cualquier cambio de esquema.
