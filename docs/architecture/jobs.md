# Jobs durables

## Alcance Phase 3

Phase 3 implementa infraestructura de ejecucion durable. No ejecuta IA, AssemblyAI, OpenRouter, OCR, vision, rule engine ni `Dictamen.pdf`.

## Tablas

- `jobs`: unidad durable de trabajo, estado, lease, prioridad, payload e idempotencia.
- `job_attempts`: historial append-only de intentos por worker.
- `job_artifacts`: resultados idempotentes producidos por jobs.

## Estados

- `QUEUED`: pendiente.
- `RUNNING`: reclamado por un worker con lease vigente.
- `RETRY_SCHEDULED`: fallo transitorio con `available_at` futuro.
- `SUCCEEDED`: terminal exitoso.
- `FAILED`: terminal fallido.
- `CANCELLATION_REQUESTED`: reservado para cancelacion cooperativa.
- `CANCELLED`: terminal cancelado.

## Claim atomico

`claim_next_job` selecciona candidatos con `FOR UPDATE SKIP LOCKED`, actualiza estado a `RUNNING`, asigna `lease_owner`, calcula `lease_expires_at`, incrementa `attempt_count` y crea `job_attempts` en la misma transaccion.

## Lease

Un job `RUNNING` vuelve a ser elegible cuando `lease_expires_at < now()` y `attempt_count < max_attempts`. Esto evita jobs muertos permanentes si el proceso se cae.

## Worker HTTP

`POST /api/jobs/process` reclama y procesa un job. Es intencionalmente corto y no mantiene estado durable local. El handler sintetico `METADATA_PROBE` registra un artifact y completa el job.

## UI

La pagina `/auditorias/{auditId}` muestra jobs recientes, estado, progreso e intentos. Tambien permite encolar y procesar el job sintetico de prueba.
