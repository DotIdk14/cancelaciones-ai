# Phase 3 Report

## Estado

PASS.

## Alcance

Jobs durables, leasing, idempotencia en DB, retry basico y worker sintetico. No se implemento IA ni generacion de dictamen.

## Migracion

`migrations/20260921225156_phase-3-durable-jobs.sql`, aplicada en InsForge real.

## Tablas

- `jobs`
- `job_attempts`
- `job_artifacts`

## Garantias DB

- `UNIQUE (operation_scope, idempotency_key)` en `jobs`.
- `UNIQUE (operation_scope, idempotency_key, artifact_type, input_fingerprint)` en `job_artifacts`.
- `claim_next_job` usa `FOR UPDATE SKIP LOCKED`.
- Lease con `lease_owner` y `lease_expires_at`.

## Validacion Real DB

- Idempotencia: 10 llamadas a `enqueue_job` con misma clave produjeron 1 job distinto.
- Atomic claim: 5 workers simultaneos compitieron por 1 job; solo 1 creo intento y obtuvo lease.
- Lease recovery: un job `RUNNING` con lease vencido fue reclamado por otro worker como intento 2.

## App

- `POST /api/audits/{auditId}/jobs`: encola `METADATA_PROBE` idempotente.
- `GET /api/audits/{auditId}/jobs`: lista jobs de la auditoria.
- `POST /api/jobs/process`: procesa un job reclamado.
- `/auditorias/{auditId}` muestra estado e intentos.

## Tests Locales

- `pnpm lint`: PASS.
- `pnpm typecheck`: PASS.
- `pnpm test`: PASS.
- `pnpm build`: PASS.

## Limitaciones

- El worker es invocado manualmente por HTTP; scheduler/background runner queda para una fase posterior.
- El handler incluido es sintetico y no consume proveedores externos.

## Proxima fase

`docs/phase-prompts/phase-4.md`.
