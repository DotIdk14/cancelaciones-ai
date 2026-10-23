# Optimización Flokzu — implementación parcial, pendiente de validación

Se agregaron observaciones importadas separadas de `case_area_comments`, con texto original, área, CaVe, fecha de exportación y hash del texto normalizado. La preparación determinista conserva fragmentos y menciones de fechas sin convertirlas en hechos acreditados ni inventar años. El contexto compacto de BackOffice y HelpDesk se cerca con `wrapUntrusted`; no genera IDs de evidencia. La huella incorpora únicamente ese contexto, conservando la fórmula histórica cuando no hay contexto útil.

La ficha de expediente muestra afirmaciones por corroborar. Los tickets finalizados no son elegibles para asignación automática. Este indicador no bloquea la auditoría manual ni sustituye la validación existente de evidencias parciales. La caché de extracciones de evidencia sigue usando el mecanismo previo.

Las nuevas métricas de preparación son caracteres de evidencia y contexto, archivos visuales y menciones útiles. Los tokens, costo y reintentos siguen proviniendo de OpenRouter. No se ha medido ahorro real.

## Trabajo pendiente

- Localizar `test_flokzu-CaVe-2026-10-12.xlsx` y verificar los seis tickets indicados. Los ejemplos nuevos son sintéticos y no reproducen el contenido real de esos casos.
- Historial durable completo y sincronización concurrente de versiones. Los batches actuales borran `staged_rows` al confirmar: no deben confundirse con un historial de comentarios.
- Fechas explícitas de comentarios, registro de contacto y tipo de evidencias como fuentes de afirmaciones; actualmente los últimos dos permanecen como referencias administrativas del importador previo.
- Detección conservadora de contradicciones entre áreas y cotejo de evidencia mencionada con archivos realmente cargados.
- Contadores durables de reutilización y auditorías evitadas, y una comparación controlada de calidad, tokens y costo real. El indicador de elegibilidad solo actúa sobre asignación automática; no existe un nuevo despachador automático.
- Validación completa de lint, TypeScript, pruebas, build y revisión visual. La instalación de dependencias del worktree estuvo incompleta durante los primeros intentos; no se declara aprobación de checks.

No se aplicaron migraciones ni se llamó a proveedores para validar casos reales. El procedimiento V5 permanece como única fuente normativa.
