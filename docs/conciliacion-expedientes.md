# Historial y conciliación de expedientes

Rama aislada: codex/conciliacion-expedientes. Contiene una copia de los cambios locales previos; no se modificó su checkout original.

La lectura del backend configurado confirmó dos expedientes reales con la matrícula indicada por el propietario: dos y cinco evidencias, creadores distintos, ninguna auditoría. No hubo hashes compartidos entre ambos. No se encontraron CaVe repetidos. Estas observaciones no confirman duplicidad de solicitud. El ticket indicado como completado no apareció en este backend; no se atribuye una causa individual sin su registro.

Causas verificadas en código: cases.status es independiente de la huella vigente; la interfaz descarta resultados desactualizados pero conservaba el rótulo COMPLETED. deleteUnreviewedAudit eliminaba archivos fuente y la fila de costos: se cambia por retiro conservador. No se han recuperado datos borrados anteriormente.

El historial paginado filtra por matrícula en servidor, conserva ceros y no usa el nombre como clave. Muestra expedientes manuales y CaVe, versiones y contadores separados. Comparar consulta los dos expedientes autorizados sin llamadas de IA. La matrícula por sí sola nunca bloquea. Solo el mismo ticket sin conciliar o un secundario confirmado bloquea nuevas llamadas de OpenRouter; outputs durables existentes siguen reutilizables. Conciliar registra una decisión inmutable, nunca copia referencias ni archivos, reasigna o reescribe revisiones.

La migración 20261013120000 está PENDIENTE. Requiere validar el ledger según MIGRATION-RECONCILIATION.md y aprobación explícita antes de producción. Sin el RPC de preflight se falla cerrado antes de una llamada nueva. No desplegar código antes del esquema validado.

Los dashboards de ejecuciones y costos conservan todas las filas. Las pruebas siguen excluidas por is_test=false en SQL. Los contadores del historial incluyen pruebas etiquetadas y no constituyen métricas operativas. No se deduplica por matrícula ni se mezclan evaluaciones de tickets distintos.

## Verificación local

La suite completa pasó con 1.153 pruebas y tres pruebas de integración omitidas por configuración. Lint (secretos, contraste, ESLint y TypeScript) y build correctos. La nueva migración se ejecutó solo en PostgreSQL local con PGlite para verificar DDL, RPC, permisos y escenarios; no se aplicó a InsForge. La vista de localhost utiliza datos ficticios y no inicia sesión, llama a OpenRouter ni concilia registros reales.

El retiro administrativo conserva el autor servidor. La consulta de versiones por auditId comprueba que pertenezca al expediente autorizado. Los contadores de solicitudes usan el ticket o el principal conciliado; las matrículas no deduplican ejecuciones ni evaluaciones. Los manuales sin ticket cuentan provisionalmente como solicitudes independientes hasta una decisión explícita.
