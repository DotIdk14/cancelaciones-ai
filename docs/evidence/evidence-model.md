# Modelo de evidencia

## Tipos soportados inicialmente

PDF, PNG, JPG, JPEG, WEBP, MP3, WAV, M4A, TXT, CSV, XLSX y DOCX.

## Evidencia original

Campos minimos:

- `evidenceId`
- `auditId`
- `originalFilename`
- `sanitizedFilename`
- `mimeType`
- `sizeBytes`
- `sha256`
- `storageKey`
- `uploadedAt`
- `uploadedBy`
- `status`

## Artefactos derivados

- `text.json` para texto extraido.
- `page-N.webp` para paginas renderizadas.
- `vision.json` para salida estructurada de vision.
- `transcript.json` y `segments.json` para audio.
- `tables.json` para CSV/XLSX o tablas extraidas.

## Clasificacion interna

DECISIVE, SUPPORTING, REVIEWED_NOT_USED, IRRELEVANT, UNREADABLE.
