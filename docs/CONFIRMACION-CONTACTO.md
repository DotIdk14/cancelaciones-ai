# Confirmación humana de contacto

Cuando un intento falla en el contrato de la sección 5.2 o termina en `TICKET_RECHAZADO` con intentos de contacto faltantes, el expediente pregunta si se realizó contacto con el estudiante.

- **Sí:** autoriza una nueva ejecución con ese contexto humano. La ausencia de los registros de intentos no bloquea por sí sola el análisis. No se inventan conteos ni se marca cumplimiento sin evidencia; los demás requisitos se siguen evaluando.
- **No:** registra la respuesta y mantiene el caso detenido, sin llamar al proveedor de IA.

Es una instrucción operativa solicitada por el owner, no una modificación del documento `GDM_GAM_PRD_MLG_003`, versión 5. La confirmación no constituye evidencia ni reemplaza el análisis del expediente.

La API existente `POST /api/cases/:id/audit` admite únicamente `{ contactConfirmation: { auditId, performed } }`. El usuario y la fecha los deriva el servidor. Rechaza intentos desactualizados, expedientes modificados y campos de atribución del cliente; conserva los guards de sesión, capacidades, propiedad, revisión y finalización.

La respuesta se guarda en `audits.provider_metadata.contactConfirmation`: actor interno, fecha, respuesta, intento de origen y huella base del expediente. En **Sí**, se persiste en la nueva fila `RUNNING` antes de llamar al modelo. En **No**, se conserva en la auditoría observada sin cambiar su dictamen. La huella de una auditoría confirmada incorpora el nuevo contexto; una confirmación no se hereda si cambian las evidencias o el contexto del expediente. Las consultas, revisiones y comparaciones usan esa misma huella. No requiere migraciones ni Functions nuevas.
