# Confirmación de contacto antes de consumir IA

## Incidente y causa

Los intentos históricos de octubre fallaron en la validación del contrato de la sección 5.2: faltaban el check de contacto, valores observados o una explicación de los registros faltantes. Esto es un fallo técnico de la respuesta del modelo, no una decisión humana de no contactar.

La pantalla ofrecía confirmar esos intentos, pero el servidor exigía que su huella histórica coincidiera con la huella del pipeline actual. Al cambiar el pipeline, la confirmación se rechazaba con HTTP 409 antes de consumir IA.

## Flujo corregido

La ruta de auditoría solicita una respuesta humana antes de una inferencia nueva cuando no existe una confirmación vigente. Devuelve `contactRequest` con el último intento observado (o null para el primer intento) y la huella actual, antes de preparar el proveedor, cobrar cuota o insertar RUNNING. No decide mediante reglas si una ruta normativa aplica: solicita contexto de contacto y la IA conserva el análisis del procedimiento.

La interfaz pausa sin error ni polling. La respuesta Sí vuelve a enviarse ligada a esa huella; el servidor verifica intento y evidencia, deriva actor y fecha de la sesión, y conserva la confirmación en la auditoría antes del proveedor. La respuesta No mantiene la pausa sin ejecutar IA ni crear un intento fallido; no guarda una confirmación positiva. Un expediente modificado exige una nueva pregunta. Las respuestas no acreditan conteos de llamadas o mensajes.

Los dictámenes vigentes y trabajos en curso se reutilizan sin llamadas adicionales. Los intentos históricos conservan sus resultados y metadatos. Continúan los guards de rol, propiedad, revisión, cuotas y finalización; no se agregan endpoints, migraciones ni cambios en Policy o Skill. OpenRouter continúa primero y Copilot solo entra tras HTTP 402 real.

## Verificación

Regresiones de servicio: primera auditoría, huella histórica, respuesta antigua, cambios de evidencia, pausa sin cuota/fila/proveedor, respuesta negativa y reutilización tras respuesta positiva. Pruebas de interfaz: pregunta antes de IA, cuerpo enviado con huella, pausa sin error, ausencia de polling y limpieza al cambiar de expediente.
