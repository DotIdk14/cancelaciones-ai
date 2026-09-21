# Estrategia de testing

## Base

- TypeScript strict.
- Lint/typecheck en cada fase tecnica.
- Unit tests por paquetes.
- Tests del motor con trazabilidad a fuente normativa.

## Politica

- Boundary tests de fechas y dias habiles lunes-viernes.
- Tests de UNKNOWN != FALSE.
- Tests de datos faltantes NON_BLOCKING, IMPORTANT y BLOCKING.
- Tests de conflictos y precedencia explicita vs owner.

## Evidencia e IA

- Fixtures sinteticos/anonimizados.
- Parser tests para PDFs, imagenes, CSV/XLSX y transcripts.
- Validacion de JSON Schema y fallbacks.

## PDF

- Extraccion de texto del PDF generado.
- Snapshot estructural de campos.
- Visual regression/pixel diff contra plantilla cuando exista herramienta.
