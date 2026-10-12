# Auditoría de confiabilidad · 12 de octubre de 2026

## Alcance y criterio

Revisión del flujo React/Vite, cliente HTTP, rutas Vercel, persistencia de expedientes, preparación de audio, auditorías durables, caché, revisión humana, permisos, incidencias y dependencias. Se conservan el procedimiento V5, la decisión de la IA, los roles, hash routing y los límites del proveedor. No se agregan Functions: siguen siendo 12.

P0: pérdida/exposición general o servicio inutilizable. P1: operación principal incorrecta o pérdida de trabajo. P2: fallo limitado o riesgo que requiere condiciones adicionales. P3: mejora menor. Impacto y probabilidad se indican por separado; una vulnerabilidad de una dependencia no equivale a una explotación reproducida.

## Fallos verificados y corregidos

| Prioridad | Hallazgo y causa | Impacto / probabilidad | Corrección y evidencia |
| --- | --- | --- | --- |
| P1 | Audio sin respuestas HTTP parciales; el salto antes de cargar metadata se perdía. | Alto / alta en llamadas largas | `206`, `Content-Range`, rangos abiertos/sufijos y `416`; seek diferido, conversión exacta de ms a segundos, fuente inline y reinicio por archivo. Pruebas `audio-navigation` y `recovery-server`. |
| P1 | Referencias a llamadas sin navegación al fragmento. | Medio / alta | Enlaces desde hechos, comprobaciones y razonamiento, con el nombre del archivo. Solo se vinculan tiempos explícitos a una única llamada identificada; nunca se elige una llamada ambigua. |
| P1 | Respuesta de creación/subida perdida seguida de duplicación. | Alto / media | UUID estable por solicitud y claves primarias existentes; recuperación por actor, archivo/hash y payload. No se sobrescriben originales. Pruebas de replay, identidad ajena y payload incompatible. |
| P1 | Una carga parcial navegaba y perdía los objetos File de los fallidos. | Alto / media | Permanece el formulario con los fallidos; solo se reenvían esos archivos. Abrir con los guardados es una acción explícita. Pruebas de NewCasePanel. |
| P1 | Polling ignoraba errores y podía detenerse ante un resultado anterior. | Alto / media | Error visible, consulta segura del estado antes de repetir, exclusión de dictámenes obsoletos, límites de espera, bloqueo de doble pulsación y protección contra respuestas de otra ruta. Pruebas `audit-recovery`. |
| P1 | Finalizar la auditoría actualizaba solo `detail.audit`, dejando estado, historial y permisos viejos. | Alto / alta | Se recarga el expediente completo al alcanzar estado terminal. |
| P1 | Pestaña Dictamen mostraba una auditoría vieja aunque `auditIsCurrent` fuera falso. | Alto / alta al añadir evidencia | Se bloquea la presentación vigente y se conserva la consulta histórica. Regresión de CaseDetailWorkspace. |
| P1 | Fallo al proyectar COMPLETED borraba un assessment ya persistido y lo convertía en ERROR. | Alto / baja | El resultado durable se conserva; la proyección es secundaria, el fallo se registra y el DTO refleja el estado terminal vigente. Regresiones de evidence-status y case-freshness. |
| P1 | Refresco concurrente marcaba ERROR mientras AssemblyAI aún recibía el audio. | Alto / media | Marca durable SUBMITTING con plazo. Se espera durante la entrega y se llega a ERROR si fue interrumpida. Pruebas antes/después del plazo. |
| P1 | Preparación de audio fallida podía presentarse como subida exitosa sin recuperación. | Alto / media | La ventana muestra que el original se guardó pero falló su preparación. Reintento condicional sobre la misma fila, sin otra subida a Storage; un solo ganador. Logs ASYNC correlacionados. |
| P1 | Cambiar BO/HelpDesk no invalidaba la caché de IA. | Alto / alta al editar comentarios | Huella compartida incluye únicamente el contexto inyectado; ejecución usa el mismo snapshot leído. Regresión ejecuta dos evaluaciones con contextos distintos. |
| P1 | Asesor podía registrar una revisión contra un dictamen anterior a la evidencia vigente. | Alto / media | Guard de huella en backend y bloqueo del formulario de primera revisión cuando no hay dictamen vigente. `409` pide auditar de nuevo. Historial y decisiones existentes no se reescriben. |
| P2 | Escrituras de transcripciones fallidas se silenciaban. | Medio / baja | El error de persistencia se propaga y puede consultarse/reintentarse; no se promete READY sin guardarlo. |
| P2 | `safeRoute` eliminaba `#` y colapsaba todos los módulos a `#/`. | Medio / alta | Rutas hash/API saneadas, query e identificadores retirados. Regresión incluye query con secreto sintético. |
| P2 | Correlación HTTP distinta del error ASYNC y variable global vulnerable a errores concurrentes. | Medio / media | Referencia por solicitud, conservada en el error tipado y en metadata saneada del audit. Persistencia de logs esperada antes de responder. |
| P2 | Nombre URL-encoded inválido generaba un error técnico 500. | Bajo / baja | Rechazo 400 antes de Storage o DB. |
| P2 | Modal de incidencias sin gestión nativa de foco/Escape y ausencia de datos tras error de consulta. | Medio / media | ModalShell compartido, diálogo nativo, altura acotada, foco restaurado; carga, fallo y lista vacía diferenciados. |
| P2 | Esperas HTTP sin plazo o respuestas truncadas poco claras. | Medio / media | Plazos de lectura; respuesta incompleta identificada como RESPONSE_ERROR; AssemblyAI mantiene cancelación también durante la lectura del cuerpo. |

No se reprodujo un P0.

## Progreso y recuperación

- Creación: expediente, conteo real de archivos guardados y comentarios. Nunca se simulan porcentajes ni transferencia de bytes.
- Auditoría: evidencias disponibles/transcripción pendiente, preparación-evaluación-validación del servidor y dictamen vigente guardado. Preparación y evaluación comparten etapa mientras el backend no publique un desglose durable más fino.
- La ventana muestra operación, categoría, causa disponible y referencia; permite cerrar sin cancelar el servidor, reabrir, reintentar y reportar al sistema de incidencias existente.
- El reporte se precarga con operación/código/referencia. Los diagnósticos del proveedor ya saneados siguen disponibles en el expediente; no se envían prompts, transcripciones, tokens ni secretos automáticamente.
- Tras recarga se consulta el expediente persistido. El navegador guarda solo UUIDs/huellas técnicas en sessionStorage. Los archivos todavía no enviados se seleccionan de nuevo; los originales ya guardados no se pierden. Sin sessionStorage/Web Crypto permanece la protección por identidad en memoria.
- La salida accidental avisa si hay trabajo pendiente. Cerrar sesión elimina las identidades locales de recuperación.
- Reintentar no crea nuevos runs automáticamente después de un fallo: es una decisión explícita del usuario; un RUNNING vigente se observa y un COMPLETED vigente se reutiliza.

## Riesgos pendientes, sin afirmar incidentes reproducidos

| Prioridad | Riesgo | Impacto / probabilidad | Pendiente real |
| --- | --- | --- | --- |
| P1 | Finalización concurrente con una mutación de evidencia/comentarios: guard y escritura son operaciones separadas. | Alto / baja | Prueba concurrente contra Postgres y protección transaccional en una migración reconciliada. Los guards de rol/propiedad/finalización sí están probados; no prueban atomicidad entre operaciones. |
| P2 | Ticket persistido pero evento CREATED fallido, o respuesta perdida al crear ticket. | Medio / baja | Idempotencia/atomicidad para tickets y eventos. No se reprodujo contra InsForge; se identificó la secuencia de dos escrituras. |
| P2 | Objetos de una solicitud de subida interrumpida antes de insertar su fila pueden quedar recuperables sin dueño en DB si nunca se reintenta. | Medio / baja | Limpieza con plazo y conciliación de objetos huérfanos; no borrar automáticamente mientras una solicitud pueda recuperarse. |
| P2 | Dependencias de desarrollo/build con advisories. | Alto en entorno de desarrollo / no medida | `npm audit`: 23 (3 critical, 14 high, 6 moderate). Las critical corresponden a tar, tinypool y vitest. `npm audit --omit=dev`: 0. Actualización y regresión de tooling en un cambio dedicado; no se comprobó explotación. |
| P2 | Cambios de evidencia después de la decisión inmutable del Asesor. | Alto / baja | Definir explícitamente si debe abrirse otro ciclo de revisión o mantenerse la revisión histórica para el Coordinador. No se sobrescribió una decisión humana ni se inventó un flujo nuevo. |
| P3 | Rango HTTP descarga el original completo desde Storage antes de recortar. | Bajo / depende de uso | Medir carga con llamadas largas y evaluar lectura parcial nativa del SDK. Acceso y límites de archivo se conservan. |

## Archivos y módulos

UI: `CaseDetailPage`, `EvidencePane`, `NewCasePanel`, `ReportProblemModal`, `useCaseAuditWorkflow`; componentes nuevos `OperationProgressDialog`/`ModalShell` y `EvidenceReferences`.

Cliente: `api`, `useEvidenceUpload`, `useSession`.

Backend: rutas de casos/alta/evidencias/auditoría/descarga; `http`, `cases`, `dto`, `audit-service`, `audit-fingerprint`, `audit-observability`, `comparison-service`, `incidents`, `assemblyai`; nuevo `audio-preparation`.

Pruebas: nuevas `audio-navigation`, `audit-recovery`, `recovery-server`; ampliadas `evidence-status`, `human-review`, `NewCasePanel`, `CaseDetailWorkspace`, `case-freshness`.

No se requieren cambios de esquema: se usan claves UUID, JSONB y tablas de incidencias existentes. No se aplica una migración por esta entrega.

## Verificación

`npm run verify:release` terminó con código 0 e incluyó:

- `npm run lint`: secretos, contraste, ESLint y typecheck correctos.
- `npm run test:contract`: 102 pruebas correctas.
- `npm test`: 1,076 correctas y 3 live omitidas; 74 archivos correctos y 1 omitido.
- `npm run build`: correcto; hash routing y lazy loading conservados.
- Detector Impeccable sobre los seis componentes de UI: sin hallazgos.
- `npm audit --omit=dev`: 0 vulnerabilidades; auditoría completa de tooling: 23, pendientes arriba.

 Las fallas externas, pérdida de respuesta, concurrencia de reclamación y plazos se reproducen con dobles controlados. Se verificó visualmente el diálogo real compartido con datos sintéticos en escritorio y móvil, además del reintento y Escape. Esto no equivale a haber creado/finalizado un expediente real mediante Google, Storage, AssemblyAI y OpenRouter en un único recorrido de navegador.
