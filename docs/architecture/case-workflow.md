# Expedientes, seguimiento e historial

Corte: 23/10/2026. Los apartados fechados conservan antecedentes, sin certificar producción.

## Listado operativo de expedientes

La navegación se deriva en lectura con `src/lib/case-workflow.ts`. No cambia
`cases.status`, el assessment ni la revisión humana. El endpoint y los contadores
usan la misma clasificación; los filtros y el cursor incluyen la etapa elegida.

| Pestaña o lista | Condición persistida |
| --- | --- |
| Borradores | Cero evidencias y sin cierre humano final |
| En curso / Por auditar | Tiene evidencias y necesita una auditoría vigente; incluye preparación y auditoría en curso |
| En curso / Dictamen del Asesor | Dictamen IA vigente, sin revisión del Asesor |
| En curso / Cierre del Coordinador | Revisión del Asesor registrada, sin decisión del Coordinador |
| Completados | Decisión final del Coordinador registrada |
| Errores | Estado técnico `ERROR`, con evidencias y sin cierre humano final |

Todo conserva la lectura global existente. Los Asesores ven su trabajo propio
en En curso y sus revisiones finalizadas en Completados. Los errores abiertos
del Asesor se limitan a sus casos propios. Borradores conserva el alcance de
lectura general. Coordinador y Gerente conservan supervisión global, pero la
lista de cierre del Coordinador solo se ofrece y admite por API a quien tiene
`canFinalizeAnyCase`. Las guardas de escritura siguen siendo independientes.

Un cierre humano es terminal: conserva su lugar en Completados aunque la
proyección técnica del caso diga `ERROR` o no queden evidencias. El estado
mostrado en Todo distingue una auditoría terminada de un caso cerrado.

## Revisión de `codex/historial-auditorias-flujo`

Se inspeccionaron el commit base `b767b21` y sus cambios sin commit en el worktree
`auditoria-historial-flujo/cancelaciones-ai`, sin modificarlo.

Se integraron dos mejoras compatibles:

- El historial distingue auditoría vigente y anterior, manteniendo la revisión
  asociada a su auditoría original.
- El listado dice «Pendiente de nueva auditoría» cuando el dictamen anterior
  perdió vigencia, y lo clasifica en Por auditar si no hay revisión humana.

No se integró la propuesta de revisión por auditoría: elimina la unicidad por
caso, exige una migración pendiente y cambia el flujo humano actual. Sus bloqueos
de edición/reprocesamiento y la selección de comparación dependen de ese cambio;
el worktree no añade pruebas para validarlo. La comparación vigente sigue
usando el `audit_id` inmutable de la revisión. Aplicar solo esas piezas podría
desvincular una resolución histórica o impedir su comparación.

Este cambio del listado no requiere migraciones ni modifica recursos remotos.


---

## Confirmación humana de contacto

Cuando un intento falla en el contrato de la sección 5.2 o termina en `TICKET_RECHAZADO` con intentos de contacto faltantes, el expediente pregunta si se realizó contacto con el estudiante.

- **Sí:** autoriza una nueva ejecución con ese contexto humano. La ausencia de los registros de intentos no bloquea por sí sola el análisis. No se inventan conteos ni se marca cumplimiento sin evidencia; los demás requisitos se siguen evaluando.
- **No:** registra la respuesta y mantiene el caso detenido, sin llamar al proveedor de IA.

Es una instrucción operativa solicitada por el owner, no una modificación del documento `GDM_GAM_PRD_MLG_003`, versión 5. La confirmación no constituye evidencia ni reemplaza el análisis del expediente.

La API existente `POST /api/cases/:id/audit` admite únicamente `{ contactConfirmation: { auditId, performed } }`. El usuario y la fecha los deriva el servidor. Rechaza intentos desactualizados, expedientes modificados y campos de atribución del cliente; conserva los guards de sesión, capacidades, propiedad, revisión y finalización.

La respuesta se guarda en `audits.provider_metadata.contactConfirmation`: actor interno, fecha, respuesta, intento de origen y huella base del expediente. En **Sí**, se persiste en la nueva fila `RUNNING` antes de llamar al modelo. En **No**, se conserva en la auditoría observada sin cambiar su dictamen. La huella de una auditoría confirmada incorpora el nuevo contexto; una confirmación no se hereda si cambian las evidencias o el contexto del expediente. Las consultas, revisiones y comparaciones usan esa misma huella. No requiere migraciones ni Functions nuevas.


---

## Menú contextual del expediente

Implementación integrada en `codex/integracion-worktrees`, disponible para revisión local. El menú se abre desde la izquierda y empieza cerrado. En escritorio reserva espacio sin bloquear el visor; en móvil ocupa la pantalla completa. Conserva el estilo oscuro y el dock existente.

## Componentes y estado

- `CaseDetailPage` conserva carga, selección de archivos, búsqueda, transcripción, auditoría y permisos. La revisión humana y las notas cambian de ubicación, sin cambiar sus operaciones.
- `CaseContextMenu` organiza Datos, Dictamen y Auditorías. Sus contenidos permanecen montados al cerrar o cambiar de pestaña para conservar borradores y selección histórica.
- `FlokzuContextPanel` y `ModalShell` proporcionan el panel existente, ahora con comportamiento no modal en escritorio. Solo los diálogos modales restauran el scroll previo; el menú de escritorio conserva los desplazamientos realizados mientras estaba abierto.
- `StudentHistory` conserva el historial y la comparación descriptiva de solicitudes, integrado en Auditorías. Se carga al consultar esa pestaña y permite seleccionar un dictamen sin abandonar el expediente.
- `EvidencePane`, `EvidenceList`, `EvidenceUploader`, `AreaQuickComments`, `CycleStartDateCapture` y `CaseReviewPanel` conservan sus funciones y validaciones.

## Lectura histórica

`GET /api/cases/:caseId?auditId=:auditId` lee el assessment original. Primero resuelve el caso autorizado y después comprueba que la auditoría pertenece exactamente a ese caso; cruces e identificadores inexistentes devuelven 404. No ejecuta IA ni modifica decisiones. El resumen incorpora la sección del procedimiento para localizar las versiones.

La selección histórica se mantiene aparte de `detail.audit`. Las respuestas tardías se ignoran y una revisión humana solo se presenta vinculada cuando coincide `review.auditId`. Los comentarios actuales del caso no se presentan como snapshots históricos.

No se añadieron Functions ni cambios de esquema para esta reorganización. Proyecto, modalidad y estado académico muestran «No reportado» cuando no están disponibles. La fecha de ingreso, el inicio de clases confirmado y el inicio administrativo de Flokzu se distinguen explícitamente.

## Validación

Pruebas de apertura, cierre, borradores, pestañas, selección histórica, respuestas tardías, pertenencia de la auditoría y sesión. Las pruebas existentes cubren evidencia, carga, búsqueda, permisos y captura de fecha. Revisión visual en escritorio y móvil; la vista previa usa datos ficticios y no consulta InsForge.

La integración incluye además las funciones administrativas de conciliación y sus migraciones pendientes, documentadas en [INTEGRACION-WORKTREES.md](../audits/worktree-integration-history.md).


---

## Historial de matrícula

Consulta de solo lectura en el expediente y desde Calidad. GET /api/cases/:id?view=student-history&offset=0 deriva la matrícula del caso autorizado y pagina 25 solicitudes. Incluye solicitudes manuales, cuenta ejecuciones, expedientes y evidencias por separado y conserva ceros iniciales. GET con view=student-history-entry&relatedCaseId=:id pagina evidencias y versiones en bloques de 50 y exige la misma matrícula. Las consultas no transcriben, ejecutan auditorías, copian evidencias ni modifican dictámenes. Los roles actuales tienen lectura global; roles desconocidos reciben 404.

La comparación de dos solicitudes muestra datos guardados, sin inferir errores de criterio ni usar IA. La política solicitada en Flokzu se distingue del fundamento del último dictamen IA; la resolución humana se muestra solo tras finalizar. Las versiones se consultan dentro del expediente de origen.

El importador existente identifica tickets por external_source + external_case_id y conserva su índice UNIQUE; student_identifier nunca es una clave de unicidad. No cambia asignaciones previas. El índice no único 20261013110000_student-history-index.sql queda pendiente de aplicación por el runner oficial, tras seguir MIGRATION-RECONCILIATION.md. No requiere tablas nuevas.


---

## Historial y conciliación de expedientes

Rama aislada: codex/conciliacion-expedientes. Contiene una copia de los cambios locales previos; no se modificó su checkout original.

La lectura del backend configurado confirmó dos expedientes reales con la matrícula indicada por el propietario: dos y cinco evidencias, creadores distintos, ninguna auditoría. No hubo hashes compartidos entre ambos. No se encontraron CaVe repetidos. Estas observaciones no confirman duplicidad de solicitud. El ticket indicado como completado no apareció en este backend; no se atribuye una causa individual sin su registro.

Causas verificadas en código: cases.status es independiente de la huella vigente; la interfaz descarta resultados desactualizados pero conservaba el rótulo COMPLETED. deleteUnreviewedAudit eliminaba archivos fuente y la fila de costos: se cambia por retiro conservador. No se han recuperado datos borrados anteriormente.

El historial paginado filtra por matrícula en servidor, conserva ceros y no usa el nombre como clave. Muestra expedientes manuales y CaVe, versiones y contadores separados. Comparar consulta los dos expedientes autorizados sin llamadas de IA. La matrícula por sí sola nunca bloquea. Solo el mismo ticket sin conciliar o un secundario confirmado bloquea nuevas llamadas de OpenRouter; outputs durables existentes siguen reutilizables. Conciliar registra una decisión inmutable, nunca copia referencias ni archivos, reasigna o reescribe revisiones.

La migración 20261013120000 está PENDIENTE. Requiere validar el ledger según MIGRATION-RECONCILIATION.md y aprobación explícita antes de producción. Sin el RPC de preflight se falla cerrado antes de una llamada nueva. No desplegar código antes del esquema validado.

Los dashboards de ejecuciones y costos conservan todas las filas. Las pruebas siguen excluidas por is_test=false en SQL. Los contadores del historial incluyen pruebas etiquetadas y no constituyen métricas operativas. No se deduplica por matrícula ni se mezclan evaluaciones de tickets distintos.

## Verificación local

La suite completa pasó con 1.153 pruebas y tres pruebas de integración omitidas por configuración. Lint (secretos, contraste, ESLint y TypeScript) y build correctos. La nueva migración se ejecutó solo en PostgreSQL local con PGlite para verificar DDL, RPC, permisos y escenarios; no se aplicó a InsForge. La vista de localhost utiliza datos ficticios y no inicia sesión, llama a OpenRouter ni concilia registros reales.

El retiro administrativo conserva el autor servidor. La consulta de versiones por auditId comprueba que pertenezca al expediente autorizado. Los contadores de solicitudes usan el ticket o el principal conciliado; las matrículas no deduplican ejecuciones ni evaluaciones. Los manuales sin ticket cuentan provisionalmente como solicitudes independientes hasta una decisión explícita.


---

## Ajustes de UX y trazabilidad

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

Pruebas nuevas: `activity-series.test.ts`, `dashboard-access.test.ts`, `HistoryComparisonDetails.test.tsx`; ampliaciones en `routes.test.ts`. Se conservaron los RPC y contratos actuales de main; los dobles de PostgreSQL admiten las consultas auxiliares; las pruebas de consumo usan explícitamente el Gerente. La prueba de captura de inicio académico abre el panel donde reside el control.

No se aplicaron migraciones ni se desplegó. Las pruebas usan datos sintéticos y no llaman al proveedor de IA. La revisión visual local usa el preview identificado como ficticio; no equivale a una validación contra una sesión autenticada y datos remotos. Los expedientes históricos conservan sus resultados y ausencias originales.

Validación: suite completa con 1161 pruebas aprobadas y 3 omitidas; lint (secretos, contraste, ESLint, TypeScript) y build aprobados. En navegador se verificó la igualdad de posición y ancho del visor antes y después de abrir contexto, el dock dentro del viewport móvil y la redirección de Asesor desde la ruta administrativa a expedientes. No hay validación manual del backend remoto ni ejecución real de una auditoría de producción.

## Integración para producción · 14 de octubre de 2026

Se integraron los commits vigentes de main y se conservaron su historial consultivo, conciliación administrativa y correcciones de ciclo de vida. La tabla de diferencias reutiliza las dos respuestas que el historial ya consulta; no agrega llamadas. Se retiró el archivo local de índice con versión 20261013100000, que colisionaba con la migración de métricas ya registrada. No se aplicaron cambios de esquema en esta publicación.



---

## Corrección de pendientes y panel contextual · 14 de octubre de 2026

Se reprodujo el error con lecturas de la base productiva, sin modificar datos ni ejecutar IA. La página de 51 expedientes funcionaba; una página de 100 fallaba en `/api/database/records/case_reviews`, cuya URL tenía 3995 caracteres. El gateway devolvía HTML con 502 y el SDK lo trasladaba como error genérico.

La preparación de resúmenes ahora divide todas las consultas relacionadas por grupos de 40 identificadores, conservando la página completa y los filtros de bandeja. La lectura real de 100 expedientes terminó correctamente después del cambio. La condición de cierre de paginación de auditorías verifica los casos del lote actual, sin confundirlos con los lotes ya procesados. Un fallo HTML del servicio se traduce a un mensaje de servicio no disponible (503); no se imprime HTML interno en pantalla.

En `72e8177` ya estaban las reglas CSS del dock flotante y de superposición. Para eliminar la dependencia restante del contenedor del expediente, el panel «Ver datos y dictamen» se monta mediante un portal en `document.body` y mantiene posición fija. El identificador accesible pertenece al diálogo real. Los otros diálogos conservan su montaje. El cierre mantiene borradores, foco y desplazamiento trabajado.

La prueba de regresión confirma que el diálogo no está dentro de la rejilla. Se conservan los ajustes previos de consumo gerencial, comparación, cronología y hechos. La aplicación local se levantó en 127.0.0.1:5173; la herramienta de navegador rechazó la apertura automática por política de URLs, por lo que no se declara una medición visual nueva. El enlace local permite al propietario revisarlo directamente.

No hay migraciones ni cambios de permisos, dictámenes o evidencias. Los archivos de pruebas y consultas temporales no forman parte del despliegue.
