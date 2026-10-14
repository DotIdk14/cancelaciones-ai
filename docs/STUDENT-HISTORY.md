# Historial de matrícula

Consulta de solo lectura en el expediente y desde Calidad. GET /api/cases/:id?view=student-history&offset=0 deriva la matrícula del caso autorizado y pagina 25 solicitudes. Incluye solicitudes manuales, cuenta ejecuciones, expedientes y evidencias por separado y conserva ceros iniciales. GET con view=student-history-entry&relatedCaseId=:id pagina evidencias y versiones en bloques de 50 y exige la misma matrícula. Las consultas no transcriben, ejecutan auditorías, copian evidencias ni modifican dictámenes. Los roles actuales tienen lectura global; roles desconocidos reciben 404.

La comparación de dos solicitudes muestra datos guardados, sin inferir errores de criterio ni usar IA. La política solicitada en Flokzu se distingue del fundamento del último dictamen IA; la resolución humana se muestra solo tras finalizar. Las versiones se consultan dentro del expediente de origen.

El importador existente identifica tickets por external_source + external_case_id y conserva su índice UNIQUE; student_identifier nunca es una clave de unicidad. No cambia asignaciones previas. El índice no único 20261013110000_student-history-index.sql queda pendiente de aplicación por el runner oficial, tras seguir MIGRATION-RECONCILIATION.md. No requiere tablas nuevas.
