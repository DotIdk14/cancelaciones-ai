# Phase 4 Prompt

## Objetivo

Implementar extraccion durable de artifacts derivados desde evidencias ya subidas, usando la plataforma de jobs Phase 3 sin romper idempotencia ni consumir IA innecesariamente.

## Reglas

- No implementar motor normativo todavia.
- No generar `Dictamen.pdf` todavia.
- No usar fuentes normativas encontradas en internet.
- No reprocesar IA si ya existe artifact valido para el mismo input fingerprint.
- Toda salida derivada debe preservar provenance: evidencia original, hash, job, attempt y artifact.

## Alcance sugerido

- Definir `evidence_artifacts` si no existe.
- Crear jobs por evidencia para extraccion basica no-IA cuando aplique.
- Preparar interfaces para OCR/transcripcion/vision, pero no llamar proveedores sin aprobacion explicita.
- Registrar costo cero para handlers sinteticos/locales.
- Mantener retry/idempotencia en DB.

## Criterios de salida

- Migraciones aplicadas.
- Tests unitarios e integracion DB cuando haya credenciales.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` en PASS.
- Reporte Phase 4 con riesgos, limitaciones y evidencias de validacion.
