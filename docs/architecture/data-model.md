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
- `engine_runs`: snapshot de facts, policy code/version, rules/facts fingerprints, resultado, faltantes, conflictos y trace.
- `engine_rule_results`: resultados por regla asociados a una corrida, con estado, cita y trace serializado.
- `human_reviews`: aprobacion/correccion, notas, usuario y fecha.
- `operational_precedences`: precedencias del owner, versionadas y separadas de politica.
- `ai_usage`: costo por provider, modelo, operacion y evidencia.
- `normative_shadow_comparisons`: comparación separada entre machine outcome y human historical outcome; no implica exactitud de política.

## Principio

El resultado humano no destruye el resultado de maquina; ambos deben poder compararse.
