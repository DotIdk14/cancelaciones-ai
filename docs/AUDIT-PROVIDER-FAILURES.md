# Fallos de auditoría: diagnóstico y prevención

## Rechazo de Gemini por complejidad (20 de octubre de 2026)

Se reprodujo HTTP 400 con el mismo expediente de siete imágenes PNG. OpenRouter devolvía `Provider returned error`, pero `error.metadata.raw` contenía el motivo de Google: `The specified schema produces a constraint that has too many states for serving`.

El esquema incluía los UUID completos del expediente como enums repetidos en todos los campos de referencias. Con el mismo expediente, eliminar esas enumeraciones dinámicas produjo HTTP 200. Las pruebas iniciales con IDs sintéticos de prefijo compartido no reprodujeron el problema: no bastaba verificar el tamaño del JSON ni la aceptación de un esquema pequeño.

El perfil Gemini usa ahora un esquema estructural cuyo tamaño no crece con el número de UUIDs. El registro de IDs permitido sigue inyectado en el contexto y `validateAssessmentReferences` sigue rechazando cualquier referencia inexistente antes de persistir un dictamen. Los vocabularios cerrados de resultado, origen y estados permanecen en el esquema. No se reclasifica ni se corrige un resultado de negocio en el servidor.

## Coherencia y corrección

El esquema y el prompt piden completar la ruta y los checks antes de escribir el resultado. La validación reúne los problemas independientes de coherencia en una sola pasada: antes, una orientación provisional ausente ocultaba una confianza inválida y cada error consumía un intento diferente. Si falla una validación local, el único intento restante recibe los motivos juntos (hasta 2.400 caracteres) y el JSON rechazado, cercado por `wrapUntrusted` y limitado a 80.000 caracteres. Ese JSON es salida anterior para reparar, nunca evidencia nueva ni instrucciones. El assessment completo se vuelve a validar, incluidas sus referencias.

Se mantienen dos llamadas máximas al proveedor, el deadline global y los errores terminales. Agotar el presupuesto no inicia un run nuevo ni convierte un error técnico en un dictamen.

## Observabilidad segura

`src/server/ai/provider-errors.ts` lee el mensaje principal y el error anidado de OpenRouter únicamente para elegir un motivo estático: complejidad del esquema, imagen inválida, límite de tokens o parámetro rechazado. Nunca publica ni persiste el cuerpo crudo, las imágenes, el prompt o el JSON rechazado. Los metadatos durables conservan categoría, formato, tiempo, ruta y detalle atestiguado.

La interfaz presenta la causa en español y conserva el detalle técnico y la referencia para reportarla. El permiso del Coordinador sigue limitado a reintentar un último intento en `ERROR`, con los bloqueos de revisión, finalización y cuotas.

## Verificaciones

- `tests/provider-schema.test.ts`: schema Gemini constante ante múltiples UUIDs y análisis anterior al resultado.
- `tests/provider-errors.test.ts`: clasificación del error anidado sin filtrar datos.
- `tests/openrouter.test.ts`: reparación de la contradicción 5.2 con salida previa cercada, máximo dos intentos y ausencia de contenido crudo en diagnósticos.
- `npm run test:ai-smoke -- --schema-only`: regresión contra OpenRouter con siete PNG sintéticos y UUIDs aleatorios; exige assessment validado, referencias reales y ningún intento perdido en HTTP 400.

Referencias técnicas: [errores y detalles del proveedor en OpenRouter](https://openrouter.ai/docs/api/reference/errors-and-debugging), [salidas estructuradas en OpenRouter](https://openrouter.ai/docs/guides/features/structured-outputs). No son fuentes de política institucional.
