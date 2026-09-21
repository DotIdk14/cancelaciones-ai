# Modelo de seguridad

## Datos sensibles

PII: nombre, matricula, correo, telefono, audios, conversaciones, screenshots academicos y financieros.

## Controles iniciales

- Auth obligatoria.
- Roles minimos: AUDITOR y OWNER.
- Storage privado por defecto.
- URLs firmadas con expiracion corta.
- Secrets solo server-side.
- Validacion MIME y tamano maximo inicial 50 MB.
- Sanitizacion de nombres y proteccion contra path traversal.
- No registrar PII innecesaria.
- Audit log para acciones relevantes.
- `.gitignore` protege historicos privados.

## Roles

- AUDITOR: crear auditorias, subir evidencias, auditar, revisar y aprobar/corregir.
- OWNER: gestionar fuentes normativas, policy versions y precedencias operativas.
