# Respaldo de IA con GitHub Copilot

Se integra el SDK oficial `@github/copilot-sdk` con su runtime CLI. La autorización del usuario para agregar Copilot sustituye la restricción anterior de usar exclusivamente OpenRouter; el procedimiento V5 y el Skill siguen siendo la única inteligencia de negocio.

## Configuración del servidor

- `AI_PROVIDER_MODE=openrouter`: comportamiento existente, sin consultas de saldo ni arranque de Copilot.
- `AI_PROVIDER_MODE=github-copilot`: propuesta, contraste y comparación usan Copilot.
- `AI_PROVIDER_MODE=auto`: consulta los límites de clave y el saldo real de OpenRouter antes de inferir. Por debajo de `OPENROUTER_MIN_BALANCE_USD` (USD 0,50 por defecto), o si esa información no puede comprobarse, selecciona el respaldo configurado.
- `COPILOT_GITHUB_TOKEN`, `COPILOT_MODEL` y `COPILOT_REVIEW_MODEL` son secretos/configuración del servidor. Los modelos deben existir y estar habilitados en el catálogo de esa cuenta. La sesión de la computadora no autentica por sí sola las Functions de Vercel.

La selección queda fija para las dos etapas de la auditoría. No se reinicia una propuesta en otro proveedor después de un fallo ni se agrega una tercera llamada. Si falla el contraste, no se publica el dictamen. La comparación humana utiliza el mismo transporte con su propio contrato.

## Alcance y límites

El runtime trabaja en un directorio temporal por llamada, en modo vacío, sin herramientas, plugins, skills, acceso al repositorio, memoria compartida ni continuación automática. El entorno del hijo excluye las claves de InsForge y OpenRouter. El dictamen y sus estados durables permanecen en la base; no dependen de la sesión CLI. Se cancela el trabajo al agotar el deadline y se elimina el directorio temporal propio.

El texto, las imágenes y los PDF mantienen sus referencias. Se comprueban MIME, cantidad y tamaño contra el catálogo antes de inferir; los PDF originales solo se envían si el modelo anuncia `application/pdf`. Los modelos configurados admiten cinco adjuntos de hasta 3 MiB cada uno. Un respaldo que no puede leer todo el expediente devuelve error y requiere un proveedor compatible; nunca omite evidencia para producir una conclusión.

El contrato JSON completo se incluye como instrucción, porque la gramática estricta del proveedor rechaza su complejidad. Se lee un único objeto JSON completo, admitiendo cercado de código y llaves de cierre sobrantes al final. Nunca se completan valores, alteran campos ni aceptan mensajes adicionales. El objeto se valida íntegro con Zod, referencias y contraste crítico antes de persistir un resultado. No se intenta corregir JSON mediante otra inferencia.

El proveedor real se conserva en el resultado, la auditoría y la comparación. Los tokens se toman de los eventos del SDK; los dólares quedan `null`, porque los créditos de Copilot no son dólares de OpenRouter. El nombre histórico de la colección técnica `openrouterAttempts` se conserva para los consumidores existentes, con modelos y métricas reales; no atribuye el resultado a OpenRouter. El proveedor de la fila y `model.provider` identifican la fuente.

## Verificación

Las pruebas sin red cubren elección por saldo de cuenta frente a límite de clave, configuración ausente, herramientas denegadas, referencias de imágenes, formatos no soportados, JSON inválido, validación local y deadlines. La conexión real debe comprobarse con la cuenta de Copilot y un caso sintético antes de habilitar el respaldo en producción. No se considera validada una conexión solo porque el SDK esté instalado.

Validación del 23 de octubre de 2026: 1.321 pruebas sin red aprobadas, contratos y compilación correctos. Conexión real con imagen y PDF comprobada. Pasaron por separado las auditorías sintéticas de salud con retención rechazada, petición de ayuda sin solicitud de cancelar y fecha administrativa distinta del inicio académico. Se conserva el presupuesto total de 240 segundos; la propuesta dispone de hasta la mitad y el contraste usa el tiempo restante. Las credenciales y `AI_PROVIDER_MODE=auto` se configuraron como secretos del servidor en los dos proyectos Vercel. Copilot consume la cuota de la cuenta; la suscripción no implica uso ilimitado.

Fuentes: [autenticación oficial](https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/authenticate), [SDK Node.js](https://github.com/github/copilot-sdk/tree/main/nodejs), [entrada de imágenes](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/image-input).

## Compatibilidad del expediente y errores previos a inferir

El servidor comprueba el catálogo y los límites de ambos modelos de Copilot antes de admitir la cuota pagada y crear RUNNING. Cuenta cada imagen, página y PDF que el Skill ya enviaría, sin cambiar originales ni prompts. Cuando las imágenes exceden el límite de adjuntos de cualquiera de las dos etapas, se preparan en un PDF técnico: una página por imagen, a dimensiones nativas y sin recorte ni reducción de resolución. PNG se incorpora sin pérdida de píxeles; JPEG conserva sus bytes comprimidos. Cada página identifica el ID de evidencia y la página de origen. El texto preparado por el Skill se conserva y señala la página correspondiente. Los PDF originales siguen siendo adjuntos separados. El contenedor solo se utiliza si ambos modelos admiten PDF y su cantidad y tamaño finales; de lo contrario se rechaza antes de inferir. Propuesta y contraste reciben exactamente el mismo contenedor. El manifiesto con hash del PDF, hashes de origen, dimensiones y mapa de páginas se persiste en audits.provider_metadata.evidenceTransport, sin contenido sensible ni cambio de esquema. Los originales durables permiten reproducir el contenedor determinista; no se guarda estado durable en memoria. En auto, si OpenRouter no tiene presupuesto suficiente o verificable y Copilot es incompatible, la respuesta indica el bloqueo y la acción requerida: revisar saldo o configurar un proveedor compatible. No se reduce evidencia ni se fuerza una llamada pagada contra un saldo desconocido.

La elección se mantiene por ejecución usando contexto asíncrono aislado; no es estado durable ni caché de auditorías. La fila RUNNING registra el proveedor y modelo elegidos. Los rechazos de capacidad de Copilot conservan diagnóstico técnico, aun sin inferencia. Los timeouts se identifican expresamente, cancelan la operación y no publican propuesta ni añaden reintentos. No se cambian los 240 segundos globales, modelos, contratos, procedimiento ni los dos llamados máximos.


Verificación del contenedor (23/10/2026): ambos modelos configurados leyeron los doce códigos visuales sintéticos en dos llamadas reales del transporte. Se compararon los píxeles extraídos del PDF con las doce imágenes originales y se revisó su renderizado. La preparación local del expediente rechazado, sin inferencia ni escritura en backend, conservó doce imágenes y produjo un PDF de 2.555.061 bytes, aceptado por el catálogo de ambos modelos. Esta comprobación no equivale a una auditoría completada de ese expediente.
