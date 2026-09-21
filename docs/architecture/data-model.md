# Modelo de datos conceptual

## Entidades Phase 1 fisicas

- `profiles`: perfil minimo, usuario y rol `AUDITOR`/`OWNER`.
- `audits`: expediente tecnico minimo con `id`, `status`, `external_case_id`, `created_by`, `created_at`, `updated_at`.
- `audit_log`: eventos append-only para trazabilidad operativa.
- `policy_sources`: registro versionable de fuentes oficiales, plantilla e historicos de referencia.
- `evidences`: metadata de originales subidos, hash, bucket/key privado, lifecycle y provenance root.
- `jobs`: trabajo durable por auditoria con estado, lease, retry e idempotencia.
- `job_attempts`: intentos de ejecucion por worker, sin sobrescribir intentos previos.
- `job_artifacts`: resultados idempotentes por job/scope/key/fingerprint.

## Entidades futuras

- `evidence_artifacts`: derivados por evidencia: texto, imagenes, OCR, vision, transcript.
- `facts`: hechos estructurados con source refs y confidence de extraccion.
- `engine_runs`: snapshot de facts, policy version, rules version, resultado, faltantes, conflictos y trace.
- `human_reviews`: aprobacion/correccion, notas, usuario y fecha.
- `operational_precedences`: precedencias del owner, versionadas y separadas de politica.
- `ai_usage`: costo por provider, modelo, operacion y evidencia.

## Principio

El resultado humano no destruye el resultado de maquina; ambos deben poder compararse.
