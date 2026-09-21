# ADR 005: Ejecucion durable de jobs

## Estado

Aceptado.

## Contexto

Las fases futuras van a ejecutar operaciones costosas y no idempotentes por naturaleza, como transcripcion, OCR, vision, extraccion IA y generacion de derivados. El estado no puede depender de memoria del proceso ni de una request HTTP larga.

## Decision

Los jobs se persisten en InsForge/Postgres con `jobs`, `job_attempts` y `job_artifacts`. La decision de ejecucion se toma con funciones SQL `SECURITY DEFINER`:

- `enqueue_job`: crea o reutiliza un job por `operation_scope` + `idempotency_key`.
- `claim_next_job`: reclama atomicamente un job con `FOR UPDATE SKIP LOCKED` y crea un intento.
- `record_job_artifact`: registra resultado idempotente por scope, key, tipo e input fingerprint.
- `complete_job`, `schedule_job_retry`, `fail_job_permanent`, `renew_job_lease`: transiciones controladas.

## Consecuencias

- Un proceso muerto no deja jobs bloqueados indefinidamente porque el lease expira.
- Multiples workers pueden competir sin reclamar el mismo intento activo.
- Las llamadas costosas futuras deben consultar/persistir artefactos antes de repetir trabajo externo.
- La app web invoca jobs de forma corta; la durabilidad vive en DB, no en Next.js.

## Validacion

Se aplico la migracion en InsForge real y se valido:

- 10 llamadas repetidas a `enqueue_job` con la misma clave devolvieron 1 solo job distinto.
- 5 workers simultaneos compitieron por 1 job elegible; solo 1 obtuvo lease.
- Un job `RUNNING` con lease vencido fue reclamado por otro worker como intento nuevo.
