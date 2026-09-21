# Evidence Ingestion

## Alcance Phase 2

Phase 2 guarda evidencia original, metadata y hash. No interpreta contenido.

## Bucket

`dictamen-evidencias`, privado.

## Storage Key

`audits/{auditId}/originals/{evidenceId}/{safeFilename}`

## Metadata

La tabla `evidences` existente del proyecto InsForge tenia columnas legacy. La migracion Phase 2 agrega columnas canonicas sin romper legacy:

- `audit_id`
- `original_filename`
- `safe_filename`
- `detected_mime_type`
- `storage_bucket`
- `status`
- `uploaded_by`
- `failure_reason`
- `retired_at`
- `retired_by`

## Lifecycle

- `PENDING`: metadata creada, upload en curso.
- `STORED`: objeto privado subido y metadata/hash asociados.
- `FAILED`: upload o persistencia fallo.
- `RETIRED`: reservado para retiro/soft-delete futuro.

## Consistencia

No hay transaccion ACID entre DB y storage. La aplicacion usa saga y estados visibles para evitar afirmar que un archivo esta listo si fallo una etapa.

## Acceso

No se exponen URLs permanentes. La descarga pasa por endpoint autenticado que revalida RLS y descarga desde InsForge por `storage_key`.
