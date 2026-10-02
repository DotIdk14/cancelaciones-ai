# Runbook de cutover — Cancelaciones AI

Documento de despliegue real. Cada paso manual está marcado **MANUAL**.
Antes de tocar producción, valida localmente con:

```powershell
npm.cmd ci
npm.cmd run verify:release
```

## Requisitos de entorno

Todas las variables son **server-side**. No debe existir ninguna variable con prefijo `VITE_` ni `NEXT_PUBLIC_` que contenga secretos.

| Variable | Requerida | Valor / default | Notas |
|---|---|---|---|
| `INSFORGE_BASE_URL` | Sí | `https://4pw4jdzv.us-west.insforge.app` | URL del proyecto InsForge. |
| `INSFORGE_ANON_KEY` | Sí | — | Anon key del proyecto. |
| `INSFORGE_API_KEY` | Sí | — | Clave administrativa (`project_admin`). |
| `INSFORGE_STORAGE_BUCKET` | No | `evidencias` | Bucket de Storage. |
| `OPENROUTER_API_KEY` | Sí | — | API key de OpenRouter. |
| `OPENROUTER_MODEL` | Sí | ej. `google/gemini-2.5-flash-lite` | Modelo primario. |
| `OPENROUTER_FALLBACK_MODEL` | No | — | Debe ser distinto del primario. |
| `AI_MAX_OUTPUT_TOKENS` | No | `16384` | Máximo 16384. |
| `AI_TIMEOUT_MS` | No | `60000` | Timeout por intento. |
| `TOTAL_AUDIT_TIMEOUT_MS` | No | `240000` | Deadline total de una auditoría. |
| `AUDIT_STALE_AFTER_MS` | No | `600000` | Cuándo un RUNNING se marca ERROR. |
| `MAX_EVIDENCE_BYTES` | No | `4194304` | 4 MB por evidencia. |
| `MAX_EVIDENCE_COUNT` | No | `50` | Evidencias por caso. |
| `MAX_AUDIT_TEXT_CHARS` | No | `180000` | Texto agregado máximo. |
| `MAX_AUDIT_TEXT_CHARS_PER_EVIDENCE` | No | `40000` | Texto máximo por evidencia. |
| `MAX_AUDIT_MULTIMODAL_BYTES` | No | `16777216` | Imágenes/PDF nativos agregados. |
| `TRANSCRIPTION_POLL_TIMEOUT_MS` | No | `25000` | Espera a transcripción antes de auditar. |
| `COMPARISON_MAX_RETRIES` | No | `3` | Reintentos de comparación. |
| `COMPARISON_RETRY_MIN_BACKOFF_MS` | No | `5000` | Backoff mínimo entre reintentos. |
| `ASSEMBLYAI_API_KEY` | No | — | Obligatoria solo si se sube audio. |
| `APP_URL` | Sí* | `https://<dominio>` | Origen propio para CSRF y HTTP-Referer. |
| `VERCEL_URL` | No | asignado por Vercel | Fallback de `APP_URL` si no está definida. |

> *`APP_URL` tiene default a `https://${VERCEL_URL}` o `http://localhost:5173`. Si `APP_URL` no está configurada **y** Vercel no inyecta `VERCEL_URL` (p. ej. un entorno custom), el chequeo de `Origin` en mutaciones fallará con 403.

## Orden de aplicación de migraciones

**MANUAL**. Aplicar en orden según el entorno:

### Instalación limpia (base vacía)

```bash
insforge db migrations up --all
```

Esto aplica:
1. `00000000000000_baseline.sql`
2. `20260929040000_audit-dashboard-metrics.sql`
3. `20260930010000_human-resolution.sql`
4. `20260930020000_human-review-dashboard-metrics.sql`
5. `20261001010000_case-reviewer-name.sql`
6. `20261002000000_auth_core.sql`

### Base de producción con esquema legacy

```bash
# El baseline abortaría; no usarlo.
insforge db migrations up --all
```

Esto aplica:
1. `20260928010000_ai-native-production.sql` (renombra `audits` legacy a `legacy_audits`)
2. Las migraciones 2-6 de la lista anterior.

Verifica que ninguna migración termine con `RAISE EXCEPTION`.

## Provisión de `app_memberships`

**MANUAL**. El producto no tiene signup público; el owner designa usuarios.

1. Crea las cuentas de usuario en InsForge Auth (o asegúrate de que ya existan en `auth.users`).
2. Inserta una fila por usuario en `public.app_memberships`:

```sql
INSERT INTO public.app_memberships (user_id, role) VALUES
  ('<uuid-del-usuario>', 'user'),
  ('<uuid-del-coordinador>', 'coordinator');
```

Roles:
- `user`: ve y muta solo sus propios casos.
- `coordinator`: puede leer cualquier caso; no puede crear casos ni evidencias ajenas (el scoping de escritura sigue siendo de dueño).

Hasta que un usuario tenga fila en `app_memberships`, podrá autenticarse pero recibirá **403**.

## Asignación de casos históricos huérfanos

**MANUAL**. La migración `20260928010000_ai-native-production.sql` deja `cases.created_by` como nullable para casos históricos. No se asignan automáticamente al primer login.

Procedimiento sugerido:

1. Identifica casos huérfanos (sin PII en el comando):

```sql
SELECT count(*) FROM public.cases WHERE created_by IS NULL;
```

2. Resuelve el mapping usuario-custodio por un canal privado, fuera de Git. No imprimas `student_identifier` en logs ni scripts versionados.
3. Aplica el backfill en una transacción con verificación de conteos:

```sql
BEGIN;
WITH mapping AS (
  SELECT '<case-id-1>'::uuid AS case_id, '<user-id-1>'::uuid AS user_id
  UNION ALL SELECT '<case-id-2>', '<user-id-2>'
  -- ...
)
UPDATE public.cases c
SET created_by = m.user_id
FROM mapping m
WHERE c.id = m.case_id
  AND c.created_by IS NULL;

-- Verificación: el número de filas actualizadas debe coincidir con mapping.
SELECT count(*) FROM public.cases WHERE created_by IS NULL;
COMMIT;
```

4. Revalida que los usuarios asignados tengan `app_memberships`.

## Gate de Storage

**MANUAL**. Antes de habilitar login, verifica la política del bucket `evidencias`:

```bash
insforge storage buckets list
insforge storage policies list --bucket evidencias
```

- **No debe existir** una política que otorgue `SELECT` directo a `authenticated` ni a `anon`.
- El único acceso permitido al bucket es desde el servidor mediante `INSFORGE_API_KEY` (rol `project_admin`).
- Si existe una política pública o para `authenticated`, corrígela antes de cutover.

## Deploy en Vercel

```powershell
npx vercel env ls
npx vercel deploy
```

Después de crear el preview:

1. Ejecuta `npm.cmd run test:ai-smoke:preview` (requiere `npx vercel env pull .env.preview.local --environment=preview`).
2. Promueve a producción solo si pasan los checks.

## Checks post-deploy

**MANUAL**.

1. **Healthcheck mínimo**:
   ```
   GET https://<app>/api/health/ai
   ```
   Debe devolver `status: "ok"` o `"degraded"`, sin exponer secrets.

2. **Login propio**:
   - Iniciar sesión con un usuario que tenga `app_memberships`.
   - Verificar que la cookie se envía en peticiones posteriores.

3. **401 anónimo**:
   - `GET /api/cases` sin cookie → 401.

4. **403 sin membership**:
   - Autenticar con un usuario de InsForge que **no** esté en `app_memberships` → 403.

5. **Descarga autorizada**:
   - Subir evidencia, intentar descargar con el dueño → 200.
   - Con otro usuario autenticado → 404 (no 403, para no enumerar existencia).

6. **Flujo completo**:
   - Crear caso → subir PDF/TXT/imagen → evidencia `READY`.
   - Ejecutar auditoría → `audits` pasa a `COMPLETED`.
   - Verificar que `result_json.audit.result` tiene un valor del vocabulario cerrado y cita evidencia real.

## Rollback

**MANUAL**.

- No se hace rollback a una versión sin autenticación: eso expondría los casos a usuarios anónimos.
- El rollback seguro es **revertir el tráfico a una imagen que también exija sesión + `app_memberships`**.
- Si la app debe quedar offline, deshabilita el acceso desde InsForge/Vercel antes de degradar.
- La aplicación es **fail-closed por diseño**: si algo falla, responde 401/403/503; nunca 200 anónimo.

## Rotación de `INSFORGE_API_KEY`

**MANUAL**.

Si la clave se expuso:

1. Genera una nueva `INSFORGE_API_KEY` en el panel de InsForge.
2. Actualízala en Vercel (`npx vercel env add INSFORGE_API_KEY`).
3. Redespliega.
4. Revoca la clave anterior desde InsForge.
5. Verifica que el healthcheck y una auditoría de prueba funcionan.

## Notas de seguridad

- No imprimir connection strings, API keys ni tokens.
- No versionar `.env.local`, `.env.preview.local` ni `.insforge/project.json`.
- Si una migración falla con `RAISE EXCEPTION`, no continuar: corregir y reaplicar.
