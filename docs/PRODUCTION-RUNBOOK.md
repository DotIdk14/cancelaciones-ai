# Runbook de producción

## Alcance

Los cambios de transporte OpenRouter, contrato Zod, diagnósticos y healthcheck
no requieren migración de base de datos ni cambios en InsForge. No ejecutes un
baseline sobre una base existente ni operaciones destructivas de schema para
desplegar esta capa.

La promoción requiere pasar `npm run verify:release`, desplegar un preview,
comprobar su healthcheck y ejecutar una canary sintética contra el entorno
preview antes de promover. Una respuesta exitosa de Vercel por sí sola no es una
validación de IA.

## Variables server-side para Vercel

Configurar como variables de entorno del proyecto Vercel, sin prefijos `VITE_` ni
`NEXT_PUBLIC_`:

- `INSFORGE_BASE_URL`
- `INSFORGE_ANON_KEY`
- `INSFORGE_API_KEY`
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`
- `APP_URL` con el dominio HTTPS productivo

Opcionales:

- `OPENROUTER_FALLBACK_MODEL`
- `AI_MAX_OUTPUT_TOKENS=8192`
- `ASSEMBLYAI_API_KEY`
- `INSFORGE_STORAGE_BUCKET=evidencias`
- `MAX_EVIDENCE_BYTES=4194304`
- `TRANSCRIPTION_POLL_TIMEOUT_MS=25000`
- `AI_TIMEOUT_MS=60000`
- `TOTAL_AUDIT_TIMEOUT_MS=240000`
- `AUDIT_STALE_AFTER_MS=600000`
- `MAX_EVIDENCE_COUNT=50`
- `MAX_AUDIT_TEXT_CHARS=180000`
- `MAX_AUDIT_TEXT_CHARS_PER_EVIDENCE=40000`
- `MAX_AUDIT_MULTIMODAL_BYTES=16777216`

## Deploy Vercel

Primero valida localmente:

```powershell
npm.cmd ci
npm.cmd run verify:release
```

Configura los IDs del modelo solo en variables server-side. `AI_MAX_OUTPUT_TOKENS`
por defecto es 8192, su máximo operativo es 16384 y se contrasta con el máximo
publicado por OpenRouter. Zod mantiene la validación estricta; el schema de
provider es una proyección y `json_object` recibe una estructura derivada del
mismo schema. La cascada no repite un 400 determinista y limita a dos las
llamadas por auditoría.

Con Vercel CLI autenticado y el proyecto enlazado:

```powershell
npx vercel env ls
npx vercel deploy
```

Después de crear el preview, consulta `https://<preview>/api/health/ai` y
confirma `status: "ok"`, que el modelo sea el esperado y que el perfil soporte
la modalidad/JSON requerido. El endpoint no genera texto ni expone secretos.
Para canary sintética con configuración de preview, descarga las variables
server-side a un archivo local ignorado por Git y ejecuta el smoke en modo
preview:

```powershell
npx vercel env pull .env.preview.local --environment=preview
npm.cmd run test:ai-smoke:preview
```

El smoke llama OpenRouter directamente con el mismo código y variables de
preview; no escribe en InsForge. Requiere saldo y puede generar coste.

Promueve con `npx vercel deploy --prod` solo después de pasar ambos checks. Luego
repite el healthcheck y smoke para producción. No promociones si el smoke live
no pasó; no concluyas que producción está sana por el estado del deployment.

## Smoke test post-deploy

1. `GET /api/health/ai` debe devolver `status: "ok"` sin campos secretos.
2. Crear caso y subir PDF/TXT/imagen: evidencias no-audio deben
   quedar `READY`.
3. Ejecutar auditoría: debe persistir una fila `COMPLETED`, sus referencias
   deben existir y `provider_metadata.openrouterAttempts` no debe contener
   contenido de prompt/evidencias.
4. Revisa `audits.provider_metadata.openrouterAttempts` para distinguir schema
   rechazado, JSON inválido, truncamiento, timeout o caída del provider.

## Nota de seguridad

No almacenar ni imprimir connection strings, API keys o tokens. Las credenciales
se consumen únicamente desde entornos server-side o desde la configuración segura
de las plataformas.
