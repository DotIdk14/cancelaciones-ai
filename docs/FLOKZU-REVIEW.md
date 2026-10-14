# Revisión administrativa de Flokzu

La identidad sigue siendo `cases (external_source, external_case_id)`, única por CaVe. No se crea un segundo registro administrativo que pueda perder la relación con evidencias, auditorías o revisión humana. Los campos `flokzu_*` separan clasificación importada, decisión local, elegibilidad, discrepancia y versión. `assigned_to` conserva el responsable y `created_by` conserva al creador.

La clasificación administrativa no interpreta el procedimiento V5, no emite un dictamen y no cambia `cases.status`, `case_reviews` ni `audits.result_json`. Usa Estado, Tarea actual, Finalizado y señales contradictorias del motivo, descripción y comentarios importados. Los valores no reconocidos requieren verificación. Una etapa BO explícita sin Estado puede entrar en auditoría si no hay señal de cierre; esta es la conducta preexistente del export. Las referencias se conservan, sin descargarlas automáticamente.

`OPEN` sigue la clasificación automática; `PENDING` y `CLOSED` excluyen el ticket de trabajo activo; `REACTIVATED` mantiene su elegibilidad aunque Flokzu lo reporte cerrado. Los cambios incompatibles posteriores marcan una discrepancia sin sobrescribir la decisión. Una repetición idéntica no reabre cierres ni genera otro expediente. El histórico permite consultar cierres; la vista de discrepancias incluye reactivaciones activas que requieren nueva verificación.

El endpoint existente `/api/cases?view=flokzu-review` sirve lista y detalle mediante GET y decisiones mediante PATCH. El backend verifica `canImportCases`; Asesores y Gerentes reciben 403 antes de consultar o escribir. Los cuerpos son estrictos; actor y fecha no se aceptan del navegador. El RPC vuelve a verificar el rol, bloquea la fila y compara `flokzu_revision`; un conflicto exige recargar. La importación y las decisiones comparten el bloqueo transaccional existente. Cada cambio conserva snapshots anteriores y nuevos en `flokzu_admin_events`, con actor, motivo, fecha, batch y asignaciones. Solo el cliente administrativo accede a esa tabla.

## Migración y despliegue

La migración `20261013103000_flokzu-administrative-review.sql` requiere `20261012100000_flokzu-case-import.sql`. No aplicar automáticamente a producción. Seguir `docs/MIGRATION-RECONCILIATION.md`, comprobar el ledger y esquema reales y ensayar el archivo exacto con el runner oficial en un backend aislado. Desplegar backend y frontend conjuntamente después de la migración: las nuevas consultas requieren las columnas administrativas.

El backfill registra un evento BASELINE por ticket previamente importado y lo marca para conciliación, preservando ID, responsable, autor y relaciones. Una nueva exportación válida o una reactivación manual restablece la elegibilidad cuando corresponde. Los casos nativos conservan `flokzu_audit_eligible=true`. Revisar el volumen de tickets afectados antes del cambio y comunicar que pasarán temporalmente a la bandeja administrativa.

Los previews creados antes de la migración deben volver a subirse: el commit rechaza staging sin clasificación. No editar las migraciones históricas ni el ledger de sistema. La retención del historial impide borrar tickets Flokzu; el cierre administrativo es la acción de conservación.

## Verificación local

La ruta `?preview=dashboard&role=coordinator#/revision-flokzu` muestra datos sintéticos sin consultar InsForge. Permite inspeccionar tabla, filtros y panel; las decisiones se deshabilitan. La validación de transacciones y sincronización diaria requiere un backend aislado con la migración aplicada; los tests de servicios con dobles no sustituyen esa prueba.

## Limitaciones de verificación en esta sesión

La creación del backend aislado fue rechazada por InsForge: API key inválida, revocada o vencida. La migración no se aplicó a ninguna base y el flujo transaccional queda pendiente de ensayo real. La inspección del navegador local también quedó pendiente por timeouts del navegador. Estos pendientes impiden declarar la funcionalidad lista para desplegar aunque el código quede guardado en su rama.
