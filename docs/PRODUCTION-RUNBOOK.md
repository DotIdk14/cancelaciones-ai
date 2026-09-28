# Runbook de producción

Estado verificado localmente:

- `npm.cmd test`: 63/63 tests verdes.
- `npm.cmd run typecheck`: sin errores.
- `npm.cmd run build`: OK.
- Bucket InsForge `evidencias`: creado como privado.

## Bloqueo actual

El proyecto InsForge vinculado contiene un esquema legacy en `public` con decenas
de tablas (`audits`, `evidences`, `jobs`, `engine_runs`, `rules`, etc.). La
arquitectura vigente requiere únicamente:

- `public.cases`
- `public.evidence`
- `public.audits`

La migración baseline `migrations/00000000000000_baseline.sql` está diseñada para
aplicarse sobre una base vacía. Si detecta tablas legacy, aborta por seguridad.

La cuenta CLI actual puede conectarse y consultar, pero no es propietaria del
schema `public`; por lo tanto no puede ejecutar operaciones reservadas como
`DROP SCHEMA public CASCADE` / `CREATE SCHEMA public`.

## SQL mínimo para administrador autorizado

Un administrador autorizado de la base debe ejecutar esta preparación antes de
aplicar el baseline:

```sql
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO service_role;
```

Después, ejecutar el contenido de:

```text
migrations/00000000000000_baseline.sql
```

Verificación esperada:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

Debe devolver únicamente:

```text
audits
cases
evidence
```

Y las políticas RLS deben existir para esas tres tablas.

## Variables server-side para Vercel

Configurar como variables de entorno del proyecto Vercel, sin prefijos `VITE_` ni
`NEXT_PUBLIC_`:

- `INSFORGE_BASE_URL`
- `INSFORGE_ANON_KEY`
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`
- `APP_URL` con el dominio HTTPS productivo

Opcionales:

- `OPENROUTER_FALLBACK_MODEL`
- `ASSEMBLYAI_API_KEY`
- `INSFORGE_STORAGE_BUCKET=evidencias`
- `MAX_EVIDENCE_BYTES=4194304`
- `TRANSCRIPTION_POLL_TIMEOUT_MS=25000`
- `AI_TIMEOUT_MS=60000`
- `TOTAL_AUDIT_TIMEOUT_MS=240000`
- `AUDIT_STALE_AFTER_MS=600000`
- `MAX_EVIDENCE_COUNT=20`
- `MAX_AUDIT_TEXT_CHARS=180000`
- `MAX_AUDIT_TEXT_CHARS_PER_EVIDENCE=40000`
- `MAX_AUDIT_MULTIMODAL_BYTES=16777216`

## Deploy Vercel

El CLI de Vercel debe estar autenticado con permisos del proyecto. Luego:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npx vercel --prod
```

## Smoke test post-deploy

1. `GET /api/auth/me` debe responder 200 con `user: null` sin sesión.
2. Rutas protegidas (`/api/cases`, downloads) deben responder 401 sin sesión.
3. Crear usuario, crear caso, subir PDF/TXT/imagen: evidencias no-audio deben
   quedar `READY`.
4. Ejecutar auditoría: debe persistir una fila en `audits` y mostrar resultado.
5. Recargar navegador: la sesión debe persistir con cookies `HttpOnly` y
   `Secure` en HTTPS.
6. Probar aislamiento RLS con dos usuarios: recursos ajenos deben dar 404/401.

## Nota de seguridad

No almacenar ni imprimir connection strings, API keys o tokens. Las credenciales
se consumen únicamente desde entornos server-side o desde la configuración segura
de las plataformas.
