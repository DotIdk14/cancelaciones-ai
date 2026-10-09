# Troubleshooting — Cancelaciones AI

Errores reales esperables y su causa. Antes de cambiar código, identifica la capa que falla.

## Desarrollo local

### `npm.ps1` está bloqueado por ExecutionPolicy

**Síntoma**: al ejecutar `npm` en PowerShell aparece un error de política de ejecución de scripts.

**Causa**: Windows Corporate restringe scripts `.ps1`.

**Solución**: usa `npm.cmd` (batch) en lugar de `npm` (PowerShell):

```powershell
npm.cmd install
npm.cmd run dev
```

**No cambies la política de ejecución del host** (`Set-ExecutionPolicy`) en un equipo corporativo.

## Autenticación y autorización

### 401 UNAUTHENTICATED

- No hay cookie de acceso.
- La cookie expiró y el refresh falló.
- El token es inválido según InsForge.

### 403 AUTH_ERROR

- El usuario autenticado **no tiene fila** en `public.app_memberships`.
- El header `Origin` no coincide con `APP_URL`/`VERCEL_URL` (mutaciones).
- Falta el header `X-App-Request: 1` en POST/PATCH/DELETE.

### 503 PROVIDER_UNAVAILABLE

- InsForge Auth no responde al validar el token (`getCurrentUserFromCookies`).
- La app responde 503 (fail-closed) en lugar de dejar pasar anónimo.

### La cookie no se envía

- Verifica que la cookie tenga `Secure` y `SameSite=Lax`. En localhost Vercel/InsForge puede requerir HTTPS.
- El navegador no envía cookies cross-origin si el frontend no usa `credentials: 'same-origin'`; la app lo hace en `src/lib/api.ts`.
- `APP_URL` mal configurada puede hacer que el backend rechace el `Origin` y el navegador no envíe la cookie en contexto de CORS.

## Configuración de entorno

### `APP_URL` / `VERCEL_URL` mal configurada

- Si `APP_URL` no está definida y Vercel no inyecta `VERCEL_URL`, el chequeo de `Origin` en `assertMutatingCsrf` falla en producción con 403.
- También afecta el header `HTTP-Referer` enviado a OpenRouter.
- **Fix**: define `APP_URL=https://<tu-dominio>` en Vercel.

### Tabla `app_memberships` inexistente

- La migración `20261002000000_auth_core.sql` no se aplicó.
- Todos los endpoints protegidos devolverán 401/403/500.

### Migración sin aplicar

- Revisar `insforge db migrations status`.
- Aplicar en orden por nombre de archivo; la secuencia completa y las comprobaciones por migración están en [`DATABASE.md`](DATABASE.md) y [`DEPLOYMENT.md`](DEPLOYMENT.md). Las últimas de la feature de roles son `membership-role-manager`, `case-test-flag`, `case-review-coordinator-decision` y `dashboard-view-test-owner-scope`.

## Evidencias

### Evidencia en estado `UPLOADED` eterno

- Antes del fix, las evidencias no-audio también quedaban en `UPLOADED`. Actualmente solo el audio pasa por `UPLOADED` → `TRANSCRIBING`.
- Si una no-audio está en `UPLOADED`, la migración o el código no es el vigente.
- Para audio: verifica que `ASSEMBLYAI_API_KEY` esté configurada y que `submitTranscription` no haya fallado (estado `ERROR`).

### PDFs que fallan al extraer

- `src/server/pdf.ts` usa `pdfjs-dist` en modo legacy sin canvas.
- Si el PDF es escaneado, el texto extraído será vacío o corto; la app envía el PDF nativo al modelo multimodal.
- Si el proceso falla con error de PDF mal formado, la auditoría se marca `ERROR` con `category = AI_PROVIDER_ERROR` o `INVALID_AI_RESPONSE` según la etapa.

## OpenRouter / IA

### 429 RATE_LIMIT

- Se alcanzó el rate limit del proveedor o de OpenRouter.
- El transporte reintenta una vez si es retryable; si persiste, devuelve 429/502.

### Respuesta truncada

- `finish_reason = length` y `error_category = TRUNCATED_OUTPUT`.
- Aumentar `AI_MAX_OUTPUT_TOKENS` hasta 16384 si el modelo lo soporta; el transporte ya pide el máximo seguro publicado.

### UNSUPPORTED_MODEL_CAPABILITY

- El modelo configurado no soporta `response_format` o la modalidad requerida (imagen/PDF).
- Verifica `/api/health/ai` para ver capacidades publicadas.
- Configura `OPENROUTER_FALLBACK_MODEL` con un modelo que sí soporte JSON + visión.

### `audits` en `ERROR` sin `result_json`

- Revisa `provider_metadata.openrouterAttempts` para distinguir:
  - `PROVIDER_BAD_REQUEST`: schema rechazado.
  - `INVALID_JSON` / `SCHEMA_VALIDATION_ERROR`: el modelo no respetó el contrato.
  - `INVALID_EVIDENCE_REFERENCE`: el modelo citó una evidencia inexistente.
  - `TIMEOUT` / `PROVIDER_UNAVAILABLE`: caída del proveedor.
  - `PAYMENT_REQUIRED`: saldo agotado.

## Límites

- `UPLOAD_ERROR` 413: el archivo supera `MAX_EVIDENCE_BYTES` (default 4 MB).
- `VALIDATION_ERROR` 413 en auditoría: `MAX_EVIDENCE_COUNT`, `MAX_AUDIT_TEXT_CHARS` o `MAX_AUDIT_MULTIMODAL_BYTES` excedidos.
- Reduce evidencias o aumenta los límites (con cuidado de coste/latencia).

## Healthcheck de IA

```
GET /api/health/ai
```

- **Anónimo**: devuelve `status: "ok"` o `"misconfigured"` sin datos sensibles.
- **Autenticado**: devuelve capacidades del modelo primario/fallback, presupuesto de tokens y `productionReady`.
- Si dice `"capability_catalog_unavailable"`, OpenRouter no responde al catálogo; el transporte usará capacidades conservadoras.
- Si dice `"misconfigured"`, faltan `OPENROUTER_API_KEY` o `OPENROUTER_MODEL`.

## Otros

### Caso ajeno devuelve 404 en lugar de 403

- Es el comportamiento esperado. La app no revela la existencia de un caso que no pertenece al usuario; `getScopedCaseOr404` devuelve 404 tanto para inexistente como para no autorizado.

### Dashboard vacío

- Verifica que `project_admin` tenga `SELECT` sobre las vistas `audit_dashboard_metrics` y `case_comparisons_dashboard_metrics`.
- Verifica que los índices `audits_created_at_idx` y `case_comparisons_created_at_idx` existan.
