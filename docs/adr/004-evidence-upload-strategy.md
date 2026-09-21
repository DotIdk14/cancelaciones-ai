# ADR 004 - Evidence Upload Strategy

## Estado

Aceptada para Phase 2 con advertencia.

## Chosen Strategy

Upload autenticado mediante Next.js Route Handler (`POST /api/audits/{auditId}/evidences`) que valida usuario, autorizacion sobre auditoria, tipo, tamano, nombre, SHA-256 y sube el objeto al bucket privado InsForge `dictamen-evidencias`.

## Security

- No se usan credenciales privilegiadas en cliente.
- El servidor valida acceso a `auditId` antes de crear metadata o subir archivo.
- No se persiste `storage_url`; el dato autoritativo es `storage_bucket + storage_key`.
- La descarga se realiza via proxy autenticado (`/api/evidences/{evidenceId}/download`).

## Size Handling

Limite autoritativo: 50 MB por archivo (`MAX_EVIDENCE_FILE_BYTES`). La estrategia actual usa `request.formData()` y `File.arrayBuffer()`, por lo que puede cargar el archivo en memoria del runtime. Esto es aceptable para Phase 2 local/dev y el volumen esperado, pero debe revisarse antes de produccion en Vercel si los limites de request/runtime impiden 50 MB.

## Auth

Se usa auth SSR de InsForge. Las operaciones dependen del token de sesion y RLS.

## Failure Handling

Saga pequena:

1. Validar archivo.
2. Crear evidencia `PENDING`.
3. Registrar `EVIDENCE_UPLOAD_STARTED`.
4. Subir objeto a storage.
5. Marcar `STORED` y registrar `EVIDENCE_UPLOADED`.
6. Si falla, marcar `FAILED` y registrar `EVIDENCE_UPLOAD_FAILED` cuando exista `evidenceId`.

## Tradeoffs

- Simple y trazable.
- Evita signed URLs persistidas.
- No requiere worker ni infraestructura nueva.
- Puede no ser la estrategia final para archivos grandes en Vercel; Phase 3/produccion debe reevaluar direct upload o signed upload si InsForge lo expone.
