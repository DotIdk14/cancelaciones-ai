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

## Estado y aplicación de migraciones

**No ejecutes migraciones en producción desde este repositorio hasta cerrar la
conciliación documentada en [`MIGRATION-RECONCILIATION.md`](MIGRATION-RECONCILIATION.md).**
El historial remoto solo llega a `20261003010000`, aunque el esquema ya contiene
los efectos de ocho archivos locales posteriores. Algunos de esos archivos
reemplazan vistas intermedias y no se pueden reproducir directamente sobre la
vista final. El baseline limpio también está incompleto respecto a la
aplicación actual.

El procedimiento oficial de InsForge (`db migrations list/fetch/new/up`) no
incluye un comando para adoptar una migración sin ejecutarla ni para marcar un
baseline existente. No uses un ejecutor de `db query` por sentencia: produciría
SQL aplicado sin registro. La conciliación requiere staging aislado, respaldo
restaurable, comprobación de la vía que InsForge soporte y aprobación explícita
del SQL exacto antes de cualquier escritura de producción.

La migración de índices
`migrations/20261009100000_case-list-pagination-indexes.sql` está preparada,
pero no aplicada ni verificada en producción. Ensáyala primero en staging.

## Provisión de `app_memberships`

**MANUAL**. El producto no tiene signup público; el owner designa usuarios.

1. Crea las cuentas de usuario en InsForge Auth (o asegúrate de que ya existan en `auth.users`).
2. Inserta una fila por usuario en `public.app_memberships`:

```sql
INSERT INTO public.app_memberships (user_id, role) VALUES
  ('<uuid-del-asesor>', 'user'),
  ('<uuid-del-coordinador>', 'coordinator'),
  ('<uuid-del-gerente>', 'manager');
```

Roles (vocabulario cerrado, `CHECK` en la base desde `20261008100000`):

- `user` (**Asesor**): ve y muta solo sus propios casos; registra la decisión de asesor.
- `coordinator` (**Coordinador**): lee cualquier caso y finaliza cualquiera; crea y muta los suyos, pero NO escribe en casos ajenos (el scoping de escritura sigue siendo de dueño).
- `manager` (**Gerente**): solo lectura global; no crea, no muta, no revisa ni finaliza (un `POST` suyo es `403`).

Los permisos los decide `capabilitiesForRole` (`src/server/capabilities.ts`), no la RLS: el servidor escribe como `project_admin` y para él las políticas no aplican. Un rol fuera del vocabulario, o sin fila, recibe `403` (fail-closed).

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
