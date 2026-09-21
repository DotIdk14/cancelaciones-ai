# Persistencia Phase 1

## Tablas fisicas creadas

- `profiles`: perfil minimo y rol `AUDITOR`/`OWNER`.
- `audits`: expediente tecnico minimo.
- `audit_log`: eventos append-only para auditoria futura.
- `policy_sources`: registro versionable de fuentes oficiales y plantilla.

## Tablas diferidas

- `evidences`: Phase 2, cuando exista upload real.
- `jobs`: Phase 3, cuando se implemente durabilidad/idempotencia de procesamiento.
- `engine_runs`: Phase 6, cuando exista motor normativo.
- `ai_usage`: Phase 5, cuando exista consumo IA real.
- `report_artifacts`: Phase 9, cuando exista generacion PDF.

## Motivo

La fase necesita persistir auditorias reales sin adelantar estructuras de evidencia, IA, reglas o reportes. Se evita una base con campos especulativos.

## Seguridad

RLS habilitado en tablas publicas. Los auditores acceden a sus auditorias; OWNER puede ver y administrar mas mediante `profiles.role`.
