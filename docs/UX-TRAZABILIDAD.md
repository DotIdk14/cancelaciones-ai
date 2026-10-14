# Ajustes de UX y trazabilidad

Actividad y consumo queda en `#/ia-costos`, con navegación y guard HTTP basados en `canManageCases`, capacidad exclusiva del Gerente. El Resumen conserva sus métricas operativas, pero la respuesta HTTP para Asesor y Coordinador omite `cost` y `activity`; su consulta tampoco lee actividad de comparaciones ni las identidades auxiliares de consumo.

Recharts muestra costo conocido, tokens, ejecuciones y auditorías completadas, promedio por ejecución de auditoría y costo por modelo. Las series se agregan en servidor desde las filas ya consultadas, por día, semana desde lunes UTC o mes. No se hacen consultas nuevas para estas series. Consumo ausente conserva `null`; el costo conocido parcial se identifica y no se estima el resto. Los valores exactos y la cobertura quedan en tablas desplegables.

El dock usa posición fija, ancho de contenido y separación inferior segura. El contenido reserva espacio desplazable para evitar acciones ocultas. El panel de contexto usa una capa fija en escritorio; conserva el diálogo modal existente en móvil. Abrirlo no cambia la rejilla del visor. Se cierra con Escape, botón y clic exterior en escritorio; otros diálogos conservan su capa superior.

Cronología y hechos nunca dejaron de persistirse: se reutilizan `audits.result_json.timeline`, `facts`, `audit.procedureChecks`, `audit.missingEvidence` y `conflicts`. No se altera el contrato del modelo ni se reprocesa IA. La cronología ordena fechas ISO conocidas y deja fechas no determinables al final, con enlaces a las evidencias originales. Se mantiene separada de los eventos de plataforma. Los hechos muestran citas, confianza declarada y criterios con evidencia compartida; esta relación documental no constituye una inferencia causal nueva. El contrato existente no clasifica explícitamente cada hecho como comprobado o inferencia: se informa esa limitación en lugar de inventar la clasificación.

La comparación amplía el historial existente con las respuestas de dos expedientes independientes. Consulta cada caso una vez por selección y guarda las respuestas durante la comparación. Verifica `case.id`, `audit.caseId` y `evidence.caseId`, cancela actualizaciones tardías y permite reintentar errores. Compara alumno, programa, ingreso administrativo, inicio académico capturado, auditoría, lineamiento, justificación, archivos y hashes, faltantes, hechos y cronología. Contactos y gestiones se localizan por descripción; también se ofrece la lista completa de eventos. “Sin registrar” significa que no hay dato guardado, no que el acontecimiento no ocurrió. No se incorporan evidencias de otros tickets al expediente abierto.

Archivos de implementación modificados en esta tarea:

- `api/dashboard/[view].ts`
- `src/server/dashboard-activity.ts`, `src/server/dashboard-queries.ts`
- `src/lib/dashboard-metrics-contracts.ts`, `src/lib/student-history.ts`
- `src/components/AppDock.tsx`, `OperationProgressDialog.tsx`, `CaseDetailPage.tsx`, `CaseContextMenu.tsx`, `StudentHistory.tsx`, `HistoryComparisonDetails.tsx`
- `src/components/dashboard/OverviewPage.tsx`, `AiCostsPage.tsx`, `ActivityCharts.tsx`
- `src/index.css`

Pruebas nuevas: `activity-series.test.ts`, `dashboard-access.test.ts`, `HistoryComparisonDetails.test.tsx`; ampliaciones en `routes.test.ts`. Los dobles de PostgreSQL admiten las consultas de identidad que ya existían; las pruebas de consumo usan explícitamente el Gerente. La prueba de captura de inicio académico abre el panel donde reside el control.

No se aplicaron migraciones ni se desplegó. Las pruebas usan datos sintéticos y no llaman al proveedor de IA. La revisión visual local usa el preview identificado como ficticio; no equivale a una validación contra una sesión autenticada y datos remotos. Los expedientes históricos conservan sus resultados y ausencias originales.

Validación: suite completa con 1161 pruebas aprobadas y 3 omitidas; lint (secretos, contraste, ESLint, TypeScript) y build aprobados. En navegador se verificó la igualdad de posición y ancho del visor antes y después de abrir contexto, el dock dentro del viewport móvil y la redirección de Asesor desde la ruta administrativa a expedientes. No hay validación manual del backend remoto ni ejecución real de una auditoría de producción.
