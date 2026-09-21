# Phase 2 Report

## Estado

PASS_WITH_WARNINGS

## Upload Strategy

Route Handler autenticado en Next.js que valida usuario/auditoria, valida archivo, calcula SHA-256, crea evidencia `PENDING`, sube a InsForge Storage privado y marca `STORED`.

## Vercel/Next Constraints Evaluated

La implementacion usa `request.formData()` y carga bytes para hash/validacion. Es simple y valida para desarrollo. Riesgo: limites de body/runtime de Vercel para 50 MB; debe reevaluarse antes de produccion si direct upload/signed upload esta disponible.

## InsForge Storage

Bucket privado existente: `dictamen-evidencias`. No se creo bucket duplicado.

## Authentication

InsForge SSR auth. Upload/download requieren usuario autenticado.

## Authorization

La app consulta la auditoria via RLS antes de upload/list/download. Si la auditoria no es visible, la operacion falla.

## Evidence Schema

Se adapto tabla legacy `evidences` con columnas canonicas aditivas para Phase 2.

## Migration

`migrations/20260921223222_phase-2-evidence-ingestion.sql`, aplicada.

## Supported Types

PDF, PNG, JPG, JPEG, WEBP, MP3, WAV, M4A, TXT, CSV, DOCX, XLSX.

## Type Detection

Extension + MIME declarado + magic bytes cuando aplica. Mismatch se rechaza.

## Size Limit

50 MB por archivo, constante `MAX_EVIDENCE_FILE_BYTES`. Archivos vacios se rechazan.

## Filename Strategy

Se conserva `original_filename` y se genera `safe_filename` sin path traversal, slashes ni caracteres de control.

## Storage Key Strategy

`audits/{auditId}/originals/{evidenceId}/{safeFilename}`.

## SHA-256

Calculado sobre bytes originales recibidos antes de subir a storage.

## Lifecycle

`PENDING`, `STORED`, `FAILED`, `RETIRED`.

## DB/Storage Consistency

Saga documentada: pending -> upload -> stored; fallo -> failed + audit log. No hay ACID cross-storage.

## Retry / Idempotency

Cada intento genera `evidenceId` independiente. No hay deduplicacion silenciosa por SHA-256. Retrys fallidos quedan visibles como `FAILED` si alcanzaron DB.

## Original Immutability

No se sobrescribe storage key existente; cada evidencia usa UUID independiente.

## Access / Download

Endpoint privado `/api/evidences/{evidenceId}/download` descarga desde storage tras auth/RLS. No se persistio `storage_url`.

## Multi-file

`POST` acepta multiples archivos en campo `files`; cada archivo se procesa independientemente y devuelve resultado por archivo.

## UI

Nueva ruta `/auditorias/{auditId}` con formulario multi-file, listado de evidencias y descarga autenticada.

## Audit Log

Eventos: `EVIDENCE_UPLOAD_STARTED`, `EVIDENCE_UPLOADED`, `EVIDENCE_UPLOAD_FAILED`.

## Security

Ver `docs/security/phase-2-security-review.md`.

## Legacy Reuse

No se copio codigo legacy. Se adapto la tabla legacy existente de forma aditiva para evitar romper recursos previos.

## Tests

Unitarios para sanitizacion, limites, MIME mismatch, storage key, SHA-256 y repository mapping.

## Integration Test

No ejecutado end-to-end por falta de usuario/credenciales de prueba. DB/storage fueron inspeccionados y migracion aplicada en InsForge real.

## Lint

PASS.

## Typecheck

PASS.

## Build

PASS.

## Git / PII Check

Git inicializado en el proyecto. `.env`, `.insforge`, `references/private-historical` y `private-historical` ignorados. No se versionaron evidencias reales.

## Archivos creados

- `migrations/20260921223222_phase-2-evidence-ingestion.sql`
- `apps/web/src/app/api/audits/[auditId]/evidences/route.ts`
- `apps/web/src/app/api/evidences/[evidenceId]/download/route.ts`
- `apps/web/src/app/(private)/auditorias/[auditId]/page.tsx`
- `apps/web/src/server/evidence/upload.ts`
- `apps/web/src/server/evidence/upload.test.ts`
- `docs/adr/004-evidence-upload-strategy.md`
- `docs/architecture/evidence-ingestion.md`
- `docs/security/phase-2-security-review.md`
- `docs/reports/phase-2-report.md`
- `docs/phase-prompts/phase-3.md`

## Archivos modificados

- `.gitignore`
- `docs/phase-prompts/phase-2.md`
- `packages/domain/src/index.ts`
- `packages/domain/src/index.test.ts`
- `packages/db/src/index.ts`
- `packages/db/src/index.test.ts`
- `apps/web/src/app/(private)/auditorias/page.tsx`

## Riesgos

- Estrategia server-side puede requerir rediseño si Vercel no soporta 50 MB en el entorno final.
- La tabla `evidences` venia de legacy; se mantuvieron columnas legacy por compatibilidad.

## Limitaciones

- Falta usuario de prueba para test upload autenticado real.
- No hay progreso visual granular de upload.

## Blockers

Ninguno para Phase 3.

## Technical Debt

Revisar direct upload/signed upload antes de produccion si se confirma limite de Vercel.

## Proxima fase

`docs/phase-prompts/phase-3.md`
