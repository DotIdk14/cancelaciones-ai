# Corrección de compatibilidad y diagnóstico de Copilot · 23/10/2026

## Causa

Tres intentos del mismo expediente fallaron antes de inferir con UNSUPPORTED_MODEL_CAPABILITY. El expediente contiene 12 imágenes y el catálogo consultado limita los modelos utilizados a cinco adjuntos. La fila inicial conservaba Gemini/OpenRouter y el rechazo previo escapaba sin diagnósticos. Otro intento previo agotó 120 segundos de Copilot; no fue un problema del procedimiento.

## Corrección

- Preflight de los adjuntos originales contra propuesta y revisor de Copilot, antes de cuota pagada y de crear otra fila RUNNING.
- Proveedor fijado por ejecución mediante AsyncLocalStorage y persistido correctamente desde el inicio. No se utiliza esa memoria para estado durable.
- Rechazos previos conservan categoría, modelo, etapa capability y detalle técnico seguro; no se registra texto del expediente, respuestas crudas ni claves.
- Timeout identificado, cancelación y descarte de respuesta tardía; no se añade otra inferencia ni se publica una propuesta sin contraste.

En modo auto no se omiten archivos ni se fuerza OpenRouter si el saldo es insuficiente o no verificable. Cuando ningún proveedor configurado puede atender el expediente, se devuelve un error accionable antes de consumir cuota o crear otro intento. Habilitar saldo o configurar capacidad compatible es una acción operativa distinta; este cambio no compra créditos ni cambia modelos.

## Alcance y validación

Sin cambios en policy/** ni src/skills/**: 43 archivos comparados por SHA-256 contra el inicio de esta corrección. Sin cambios en prompts, contratos, modelos, permisos, SQL ni historias previas. El manifiesto de 372 archivos del informe anterior sigue siendo una foto histórica, no el alcance de congelamiento de esta corrección autorizada.

Pruebas nuevas: doce adjuntos, revisor incompatible, modelo no disponible, catálogo sin respuesta, aislamiento concurrente de proveedor, bloqueo antes de cuota/fila, persistencia del proveedor real y timeout sin reintento. Pruebas sintéticas, sin volver a procesar expedientes reales. Los resultados finales y publicación se registran en el cierre de la entrega y en Historial de Notion.

Validación local: lint y TypeScript aprobados; suite completa con dos workers: 1.336 pruebas aprobadas y cuatro omitidas. La comprobación focalizada posterior del descarte de respuestas tardías aprobó 30 pruebas. Build de producción aprobado (con la advertencia de tamaño de chunk ya existente). Se consultó el catálogo real mediante el nuevo preflight y se reprodujo el rechazo 12 frente a 5 con contenido sintético, sin inferencias. No se reejecutaron auditorías reales ni se modificaron sus filas históricas.


## Solución funcional del límite de doce imágenes

La corrección inicial detectaba y explicaba el rechazo, pero no permitía auditar ese expediente. Se añade un contenedor técnico PDF cuando la cantidad de imágenes excede los límites del catálogo. Conserva cada imagen íntegra en una página a dimensiones nativas, con ID y página de origen. No modifica Policy, Skill, contrato, modelos ni las dos llamadas máximas. Los originales y los PDF nativos permanecen intactos. El manifiesto reproducible queda en provider_metadata.evidenceTransport, con hash del contenedor, hashes de origen, dimensiones y mapa de páginas; los bytes no se registran en logs.

Pruebas reales: Haiku y Sonnet leyeron correctamente los doce códigos visuales sintéticos, una llamada por etapa. Comparación de píxeles y dimensiones de las doce imágenes extraídas del PDF aprobada y renderizado revisado. Preparación del expediente afectado en memoria, sin inferir ni escribir en backend: doce originales verificados por hash, doce páginas, PDF de 2.555.061 bytes admitido por ambos modelos. No se reejecutó la auditoría real. Un expediente que exceda también el tamaño o los formatos del contenedor sigue fallando antes de cuota e inferencia; no se reduce ni omite evidencia.


## Prioridad de OpenRouter aclarada por el owner

La instrucción vigente sustituye la selección anticipada por saldo: en auto cada expediente llama primero a OpenRouter y solo un rechazo HTTP 402 por créditos de cuenta o clave activa Copilot. Se eliminó el umbral mínimo y las consultas previas de saldo. Timeout, validación, errores de red, 401/403/429/5xx y límite temporal en vuelo no disparan el cambio. Si el rechazo ocurre en contraste, se conserva la propuesta previa sin pagar ni ejecutar otra. El rechazo y el uso real quedan trazados; el cambio y el manifiesto visual se persisten antes de llamar a Copilot. No hay auditoría nueva ni otra cuota por el respaldo. Se permiten dos inferencias y una solicitud HTTP adicional rechazada por créditos; las fuentes normativas y el Skill no cambian.
