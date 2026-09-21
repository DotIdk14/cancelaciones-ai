# Idempotencia

## Principio

La idempotencia productiva debe estar garantizada por la base de datos. Un chequeo en TypeScript no es suficiente.

## Job idempotency

`jobs` tiene `UNIQUE (operation_scope, idempotency_key)`. `enqueue_job` usa `ON CONFLICT` y devuelve el job existente.

## Artifact idempotency

`job_artifacts` tiene `UNIQUE (operation_scope, idempotency_key, artifact_type, input_fingerprint)`. `record_job_artifact` reutiliza el artifact existente y no duplica resultados.

## Scope recomendado

El `operation_scope` debe separar claramente auditoria, evidencia, operacion, proveedor y version logica cuando aplique. Ejemplos futuros:

- `audit:{auditId}:metadata-probe`
- `evidence:{evidenceId}:transcription:assemblyai:v1`
- `evidence:{evidenceId}:ocr:provider:model:v1`

## Regla para IA futura

Antes de llamar un proveedor externo, el worker debe buscar artifact exitoso para el mismo scope/key/fingerprint. Si existe, debe reutilizarlo y no consumir IA.
