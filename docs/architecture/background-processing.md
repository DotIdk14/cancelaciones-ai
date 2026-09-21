# Procesamiento en segundo plano

## Modelo

Cada auditoria crea un job durable persistido en base de datos. El navegador puede cerrarse sin perder estado.

## Estados de job Phase 3

- QUEUED
- RUNNING
- RETRY_SCHEDULED
- SUCCEEDED
- FAILED
- CANCELLATION_REQUESTED
- CANCELLED

## Idempotencia

Operaciones costosas usan claves idempotentes por `auditId`, `evidenceId`, hash, operacion, provider y modelo. La garantia vive en DB con unique constraints, no solo en codigo de aplicacion.

## Reintentos

Reintentar solo etapas fallidas. Nunca reprocesar IA si el derivado o transcript valido ya existe.

## Claim

`claim_next_job` usa `FOR UPDATE SKIP LOCKED` para que multiples workers puedan competir sin reclamar el mismo job elegible.
