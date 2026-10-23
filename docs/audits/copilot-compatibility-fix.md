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
