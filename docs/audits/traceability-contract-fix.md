# Contrato de citas del contraste · 24/10/2026

El último rechazo observado en Vercel fue `SCHEMA_VALIDATION_ERROR` en `reliabilityReview`: el contraste no cubrió con citas todas las referencias de un hecho. La propuesta de Gemini Flash terminó; Gemini Pro produjo el contraste, pero este no superó la validación. No hubo rechazo por créditos ni motivo para activar Copilot.

El transporte ahora entrega desde la primera llamada de contraste una comprobación explícita de correspondencia entre cada hecho final y sus citas. Para `CONFIRMED` se refiere a la propuesta; para `CORRECTED` o `NEEDS_INPUT`, al assessment revisado. Ambos transportes reciben la misma instrucción técnica, después del expediente y sin modificar el system prompt, el procedimiento, los originales ni el resultado del modelo.

La validación permanece intacta. No se inventan citas, eliminan referencias, normalizan hechos ni aceptan respuestas inválidas. La primera corrección conservó dos inferencias y la prioridad de OpenRouter; Copilot sigue reservado al rechazo real por créditos. Las pruebas cubren la entrega del contrato en el primer contraste, la conservación del sistema y las evidencias, y el rechazo de cobertura incompleta frente a la aceptación de citas completas.

El reintento operativo se realiza desde la sesión autenticada del Coordinador y queda sujeto a los permisos, estados, cuota y plazo habituales. Su estado terminal se comprueba en la aplicación y en la persistencia antes de declararlo completado.


## Límite ampliado expresamente por el owner

La primera ejecución con el contrato explícito volvió a fallar: una cita no pertenecía al hecho o a una evidencia real. Se mantuvo ERROR y no se publicó dictamen. El owner autorizó entonces un nuevo intento con máximo tres llamadas: propuesta, contraste y una única corrección del contraste si su salida no pasa la validación.

La corrección reutiliza propuesta, originales, modelo y deadline. El revisor recibe su respuesta rechazada cercada como contenido no confiable y la ruta concreta del error. Se distingue una cita faltante, una evidencia inexistente y una cita ajena al evidenceIds del hecho, sin registrar claves libres, citas ni IDs inventados en el diagnóstico. Nunca se modifica la respuesta para hacerla pasar. La respuesta inválida vive solo en el contexto privado de la llamada, no se serializa ni persiste. Uso y costo reales se agregan; importes desconocidos permanecen en null. Una segunda revisión inválida termina el intento, sin nuevas llamadas ni reinicio automático.
