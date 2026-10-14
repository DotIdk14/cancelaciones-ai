# Menú contextual del expediente

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

La integración incluye además las funciones administrativas de conciliación y sus migraciones pendientes, documentadas en [INTEGRACION-WORKTREES.md](INTEGRACION-WORKTREES.md).
