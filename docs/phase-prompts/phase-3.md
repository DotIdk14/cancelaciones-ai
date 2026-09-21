# CANCELACIONES AI
# PHASE 3 - JOBS DURABLES, LEASING E IDEMPOTENCIA

Estas iniciando Phase 3 de Cancelaciones AI.

Phase 2 termino PASS_WITH_WARNINGS. La aplicacion ya dispone de Next.js full-stack, monorepo pnpm, InsForge auth/database/storage, auditorias persistidas, storage privado, tabla `evidences`, evidencia original inmutable, SHA-256, lifecycle de evidencia, audit log base, upload/list/download autenticados y RLS/autorizacion server-side.

Todavia NO existen OpenRouter, AssemblyAI, OCR/vision, fact extraction, rule engine ni generacion `Dictamen.pdf`.

## 1. Objetivo Real De Phase 3

Construir la plataforma de ejecucion durable sobre la cual funcionaran todas las operaciones largas o costosas posteriores.

Phase 3 debe garantizar que una auditoria pueda continuar procesandose aunque el navegador se cierre, una request HTTP termine, el proceso Next.js/Vercel desaparezca, exista un retry, llegue dos veces el mismo trigger, un worker falle, una operacion tarde varios minutos o el sistema se reinicie.

La arquitectura final NO puede depender de `setTimeout` persistente, `setInterval` persistente, variables globales, memoria del proceso ni background loops que requieren un servidor vivo indefinidamente.

## 2. Principios

Leer y obedecer `AGENTS.md`, especialmente `NO_PROCESS_LOCAL_DURABILITY`, `DO_NOT_REPROCESS_AI_UNNECESSARILY`, `PRESERVE_EVIDENCE_PROVENANCE`, `DO_NOT_DUPLICATE_IMPLEMENTATIONS`, `KEEP_IT_SIMPLE` y `NO_PII_IN_GIT`.

Principio tecnico Phase 3: AT_LEAST_ONCE_EXECUTION. Asumir que una operacion puede ejecutarse mas de una vez a nivel infraestructura. La seguridad ante duplicados debe venir de persistencia, idempotencia y transiciones atomicas. No fingir exactly-once delivery.

## 3. No Implementar IA Todavia

No integrar OpenRouter, AssemblyAI, OCR, vision ni transcripcion real. Validar la plataforma con un handler sintetico barato y determinista, por ejemplo `metadata-probe`, que demuestre lifecycle, progreso, leasing, retry e idempotencia sin convertirse en funcionalidad de negocio permanente.

## 4. Primer Paso: Revisar Capacidades Reales

Antes de implementar, investigar y documentar capacidades reales actuales de Vercel, Next.js, InsForge, cron/scheduling y background execution disponible. No asumir que una funcion HTTP vive indefinidamente. Decidir como se despierta/procesa un job. Preferir DB durable como source of truth y evitar Redis, Kafka, RabbitMQ, Temporal, BullMQ u otra infraestructura salvo necesidad demostrable.

Crear ADR `docs/adr/005-durable-job-execution.md`.

## 5. Source Of Truth

La database es la fuente autoritativa del estado del job. Nunca memoria del worker, estado React, cookie o localStorage. El frontend solo refleja estado persistido.

## 6. Job Model

Crear tabla `jobs` mediante migracion reproducible. Evaluar campos: `id`, `audit_id`, `job_type`, `status`, `priority`, `idempotency_key`, `payload`/`input_reference`, `progress`, `attempt_count`, `max_attempts`, `available_at`, `lease_owner`, `lease_expires_at`, `started_at`, `completed_at`, `failed_at`, `last_error_code`, `last_error_message_sanitized`, `created_at`, `updated_at`.

No guardar contenido enorme en payload. Preferir IDs/referencias como auditId, evidenceId, artifactId.

## 7. Job Types

Crear solo job sintetico necesario para demostrar plataforma. El modelo debe permitir posteriormente `PROCESS_EVIDENCE`, `TRANSCRIBE_AUDIO`, `EXTRACT_DOCUMENT`, `EXTRACT_FACTS`, `RUN_POLICY`, `GENERATE_REPORT` sin migracion conceptual completa. No implementar esos handlers.

## 8. Estados

Definir state machine explicita. Evaluar `QUEUED`, `RUNNING`, `RETRY_SCHEDULED`, `SUCCEEDED`, `FAILED`, `CANCELLATION_REQUESTED`, `CANCELLED`. Documentar transiciones permitidas y rechazar invalidas. No permitir `SUCCEEDED -> RUNNING` silenciosamente.

## 9. Claim Atomico

Dos workers no deben ejecutar simultaneamente el mismo intento. Implementar claim atomico mediante DB: seleccionar job disponible + cambiar a RUNNING + asignar `lease_owner` + `lease_expires_at` como operacion segura frente a concurrencia. No usar `SELECT` y luego `UPDATE` vulnerable a race condition.

## 10. Lease

`RUNNING` no pertenece eternamente al proceso que lo tomo. Implementar lease con `lease_owner` y `lease_expires_at`. Si el worker desaparece, el job debe recuperarse posteriormente.

## 11. Heartbeat

Si un handler puede superar duracion razonable del lease, permitir renovar lease. No heartbeat excesivo. Si el handler sintetico dura poco, puede dejarse mecanismo disenado y documentado.

## 12. Stale Job Recovery

Detectar `RUNNING` con `lease_expires_at < now` y hacerlo recuperable. Definir retry o FAILED segun attempts. No dejar jobs eternamente atorados.

## 13. Attempts

Separar JOB de EXECUTION ATTEMPT. Evaluar tabla `job_attempts` desde ahora si mejora auditabilidad sin complejidad excesiva. Attempt puede guardar `id`, `job_id`, `attempt_number`, `worker_id`, `started_at`, `finished_at`, `outcome`, `error_code`, `error_message_sanitized`.

## 14. Retry Policy

Clasificar errores: `TRANSIENT`, `PERMANENT`, `CANCELLED`. Reintentar transitorios con backoff documentado; no reintentar permanentes innecesariamente.

## 15. Max Attempts

Definir max attempts razonable. Al agotarse, `FAILED`. Nunca retry infinito.

## 16. Idempotency Key

Cada operacion costosa futura debe tener identidad logica estable, por ejemplo `transcribe:{evidenceId}:{transcriptionConfigVersion}` o `policy:{auditId}:{policyVersion}:{factsHash}`. Construir mecanismo ahora sin implementar esas operaciones.

## 17. Idempotencia != Job ID

`jobId` cambia; `idempotencyKey` identifica la misma operacion logica. Si se solicita dos veces la misma operacion, no debe generarse trabajo costoso duplicado. Disenar constraint/scoping apropiado, por ejemplo unique operation scope + idempotency key.

## 18. Resultados Idempotentes

Preparar el caso: proveedor termino, resultado se guardo, proceso murio antes de marcar job `SUCCEEDED`, job reintenta. El retry debe detectar resultado costoso existente. En Phase 3 implementar resultado sintetico para demostrarlo.

## 19. Effectively-Once Side Effects

No prometer exactly-once execution. Buscar effectively-once side effects: el handler puede invocarse de nuevo, pero no vuelve a producir/cobrar la misma operacion si el resultado ya esta persistido. Demostrar con test.

## 20. Fingerprint De Input

Disenar `inputFingerprint` determinista basado en referencias/versiones relevantes. No usar `JSON.stringify` arbitrario si su orden puede generar fingerprints inestables.

## 21. Versionado

La idempotencia futura debe considerar cambios de implementacion/config, por ejemplo `TRANSCRIBER_V1` vs `TRANSCRIBER_V2`.

## 22. Queue Creation

Crear funcion autoritativa `enqueueJob(...)` que centralice validation, idempotency, DB insert/reuse y audit log. No permitir inserts manuales dispersos.

## 23. Job Claiming

Crear API/repository autoritativo `claimNextJob(...)`. No duplicar logica entre workers.

## 24. Job Completion

Centralizar `completeJob`, `failAttempt`, `scheduleRetry`, `cancelJob`, `renewLease` segun corresponda. Proteger transiciones.

## 25. Worker Identity

Cada ejecucion debe tener worker/runner ID, puede ser UUID por invocation. Sirve para lease, debug y attempt trace.

## 26. Worker Execution Model

Elegir como corre worker con infraestructura disponible. Patrones posibles: HTTP invocation corta que procesa uno/pocos jobs, cron periodico, background nativo, combinacion. No crear `while(true)` esperando vivir para siempre en Vercel. Documentar trigger, max jobs por invocation, despertar, backlog y workers concurrentes.

## 27. Concurrency

Crear limite simple y configurable. Correctness no debe depender del limite; aunque existan dos workers, claim atomico debe funcionar.

## 28. Progress

Jobs deben soportar progreso persistido. No inventar precision falsa; Phase 3 puede usar 0/25/50/75/100 para handler sintetico.

## 29. Audit-Level Status

No confundir `audit.status` con `job.status`. Documentar como se deriva/actualiza estado visible sin acoplamiento irreversible.

## 30. Job Events / Audit Log

Registrar `JOB_QUEUED`, `JOB_STARTED`, `JOB_RETRY_SCHEDULED`, `JOB_SUCCEEDED`, `JOB_FAILED`, `JOB_CANCEL_REQUESTED`, `JOB_CANCELLED`. No guardar payload completo; referenciar jobId, auditId, jobType, attempt.

## 31. Cancelacion

Preparar cancelacion cooperative con `CANCELLATION_REQUESTED`. Handler verifica puntos seguros y termina. Demostrar con handler sintetico si es razonable.

## 32. Errores

Persistir version sanitizada para UI (`PROVIDER_TEMPORARILY_UNAVAILABLE`, etc.). No mostrar secrets, stack trace ni raw response con PII.

## 33. Dead Letter

`FAILED` despues de max attempts funciona como dead-letter inicial. No implementar plataforma DLQ compleja.

## 34. Manual Retry

Implementar si es simple: reintentar FAILED creando nuevo attempt/requeue sin borrar historial ni romper idempotency.

## 35. UI

En auditoria mostrar estado de procesamiento, job actual, progreso, intentos y ultimo error sanitizado. Polling razonable; no WebSockets. Detener polling al terminar.

## 36. No Server State En React

Estado visible viene de DB/API. Refresh debe recuperar estado.

## 37. Restart Test

Demostrar: crear job, claim RUNNING, simular worker desaparece, lease expira, otro worker recupera, job termina, estado no se pierde.

## 38. Double Worker Test

Demostrar dos workers intentan reclamar al mismo tiempo y solo uno obtiene el job/attempt. Validar garantia DB, no mutex en memoria.

## 39. Idempotency Test

Demostrar `enqueue(operation X, key K)` dos veces no genera dos ejecuciones costosas independientes.

## 39.1 Validacion Real De Atomic Claim

La garantia de atomic claim NO puede validarse unicamente mediante mocks, repositorios fake o tests en memoria.

Si las credenciales de InsForge/PostgreSQL estan disponibles, debe existir al menos una prueba de integracion contra la DB real que demuestre:

1. Crear un job `QUEUED` real.
2. Lanzar dos claims concurrentes.
3. Ambos compiten por el mismo job.
4. Exactamente uno obtiene el job.
5. El otro NO obtiene ese mismo job/attempt.
6. Verificar el estado final directamente en DB.

El mecanismo utilizado para atomic claim debe quedar documentado.

Si esta prueba no puede ejecutarse por una limitacion EXTERNA, `PASS_WITH_WARNINGS` puede ser valido unicamente si el mecanismo atomico esta implementado mediante una garantia real de la base de datos y la limitacion de validacion queda documentada.

Si el claim depende de leer primero, actualizar despues y esperar que no haya concurrencia, Phase 3 = BLOCKED.

## 39.2 Idempotency Scope

No basta con almacenar una columna `idempotency_key`.

Debe existir una garantia REAL a nivel de persistencia que impida crear dos operaciones logicamente iguales bajo concurrencia.

Preferir `UNIQUE CONSTRAINT` / `UNIQUE INDEX` sobre consultar primero si existe y luego insertar.

Debe existir un test concurrente equivalente a `enqueue X with key K` y `enqueue X with key K` ejecutados concurrentemente.

El resultado debe ser UNA sola operacion logica durable.

No considerar idempotencia resuelta unicamente mediante comprobaciones en TypeScript.

## 40. Crash-After-Side-Effect Test

Simular handler produce resultado, resultado se persiste, crash antes de `completeJob`, luego retry. Sistema detecta artifact existente y no repite side effect sintetico.

## 41. Retry Test

Handler sintetico: attempt 1 -> transient error, attempt 2 -> success. Validar attempt count, retry state, available_at, audit events, final result.

## 42. Permanent Failure Test

Handler devuelve error permanente. Validar no retry automatico innecesario.

## 43. Max Attempts Test

Errores transitorios repetidos eventualmente pasan a FAILED. No loop infinito.

## 44. Persistencia

Crear nueva migracion. No modificar migraciones aplicadas. Posibles tablas: `jobs`, `job_attempts`, `job_artifacts`/`operation_results`. Elegir minimo necesario. No reutilizar legacy sin inspeccion.

## 45. RLS / Access

Jobs pertenecen a auditorias. Usuario solo consulta jobs de auditorias autorizadas. Workers server-side pueden necesitar permisos distintos. No exponer privileged service credentials al browser.

## 46. Security

Payload debe minimizar PII: preferir `{ auditId, evidenceId }`, no nombres, emails, telefonos, transcripts completos.

## 47. Observability

Registrar jobId, attemptId, jobType, duration, outcome. No Datadog/OpenTelemetry complejo todavia.

## 48. Cleanup

No borrar jobs exitosos inmediatamente; son trazabilidad tecnica. Documentar futura estrategia si volumen crece.

## 49. API / Internal Boundary

Creacion/ejecucion de jobs server-side. Browser no puede enviar arbitrariamente `jobType`. Usar allowlist y validar payload por tipo.

## 50. Handler Registry

Crear registro sencillo `JobType -> Handler`. TypeScript explicito, sin reflection/magia/plugins dinamicos.

## 51. Handler Contract

Disenar contrato `execute(context, payload)`. Context puede proveer job, attempt, heartbeat, progress, cancellation check. Handler no debe modificar manualmente `jobs` saltandose plataforma.

## 52. Transaction Boundaries

Documentar transacciones necesarias: claim, idempotent enqueue, attempt creation, completion, artifact registration. No usar transaccion gigante alrededor de llamadas externas futuras.

## 53. Futuro AssemblyAI

No implementar ahora. Considerar patron submit -> provider job ID -> wait/poll/callback -> result.

## 54. Futuro OpenRouter

No implementar ahora. Plataforma debe permitir asociar AIUsage a auditId, jobId, attemptId y artifact/result.

## 55. Futura Orquestacion

Phase 3 construye jobs individuales. No construir DAG completo. Documentar encadenamiento futuro mediante job completion -> enqueue next operation sin memoria.

## 56. InsForge

Inspeccionar schema actual antes de migrar. No borrar legacy. Migraciones aditivas. Validar DB real si credenciales siguen disponibles.

## 57. Vercel

ADR debe explicar compatibilidad con execution model real de Vercel. Si una limitacion impide jobs durables confiables sin servicio adicional, documentarla y evaluar alternativa minima.

## 58. No Implementar

Fuera de scope: OpenRouter, AssemblyAI real, OCR, vision, PDF parsing, fact extraction, rule engine, conflict resolution, Dictamen.pdf, full audit orchestration, dashboard, analytics, email/WhatsApp integrations.

## 59. Documentacion

Crear `docs/adr/005-durable-job-execution.md`, `docs/architecture/jobs.md`, `docs/architecture/idempotency.md`, `docs/security/phase-3-security-review.md`, `docs/reports/phase-3-report.md`, `docs/phase-prompts/phase-4.md`. Actualizar `docs/architecture/data-model.md` si corresponde.

## 60. Phase 4

Phase 4 sera AUDIO + ASSEMBLYAI y debe usar la plataforma durable de Phase 3. No reinventar cola/retry/idempotency.

## 61. Validaciones Obligatorias

Ejecutar `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` y pruebas relevantes de jobs. No declarar PASS solo porque compila.

## 62. Acceptance Tests Minimos

Tests deben demostrar enqueue durable, estado fuera de memoria, atomic claim, dos workers no toman mismo attempt, lease expiration, stale recovery, retry transient, permanent error no retry, max attempts, idempotent enqueue, artifact/result idempotency, crash despues de side effect no duplica side effect, progress persistido, audit events, cancellation si se implementa, autorizacion de lectura y reload UI recupera estado.

## 63. Definition Of Done

PASS solo si existe persistencia durable real, execution model documentado compatible con Vercel, jobs no dependen de memoria, claim seguro frente a concurrencia, recovery de jobs abandonados, retries controlados, max attempts, idempotency, resultado persistido evita repetir side effects, progreso recuperable, UI refleja DB, migraciones reproducibles, lint/typecheck/tests/build pasan, phase-3-report y phase-4 prompt existen.

## 64. PASS_WITH_WARNINGS

Solo para limitaciones externas que no comprometan durabilidad, atomic claim, idempotency, recovery ni seguridad.

## 65. BLOCKED

Marcar BLOCKED si jobs dependen de memoria, no hay claim atomico, dos workers pueden procesar el mismo side effect sin proteccion, retry puede duplicar operacion costosa, RUNNING muerto queda atorado, no hay estrategia compatible con Vercel o validaciones fallan.

## 66. Remediation

Si BLOCKED, crear `docs/phase-prompts/remediation-phase-3.md` y no producir Phase 4 ejecutable como si estuviera resuelto.

## 67. Phase 3 Report

Debe incluir: Estado, Execution Model, Vercel Compatibility, Database Schema, Jobs, Job Attempts, Handler Registry, State Machine, Atomic Claim, Leasing, Heartbeat, Stale Recovery, Retry Policy, Backoff, Max Attempts, Idempotency, Input Fingerprint, Result/Artifact Idempotency, Crash Recovery, Cancellation, Progress, Audit Log, RLS/Authorization, Security, Synthetic Handler, Concurrency Tests, Restart Tests, Idempotency Tests, Integration Tests, Lint, Typecheck, Tests, Build, Files Created, Files Modified, Risks, Limitations, Blockers, Technical Debt, Next Phase.

## 68. Respuesta Final

Responder con PHASE 3 RESULT, EXECUTION MODEL, DATABASE, ATOMIC CLAIM, LEASE/RECOVERY, RETRY, IDEMPOTENCY, RESULT IDEMPOTENCY, VERCEL COMPATIBILITY, SYNTHETIC JOB TEST, CONCURRENCY TEST, CRASH RECOVERY TEST, VALIDATIONS, RISKS, BLOCKERS, NEXT y REMEDIATION.

## 69. Regla Final

Phase 3 existe para garantizar que un audio de 60 minutos no se transcriba dos veces por retry, una llamada OpenRouter no se cobre dos veces por crash, una auditoria no quede eternamente PROCESSING y cerrar navegador no destruya trabajo.

Antes de PASS debes poder responder que pasa si muere el worker, dos workers despiertan a la vez, llega dos veces la misma solicitud, side effect termino pero worker murio antes de actualizar job, provider falla temporal/permanentemente, se agotan retries o usuario recarga pagina. Si alguna respuesta depende de "esperamos que no ocurra", Phase 3 no esta terminada.

Comienza ahora. No avances a Phase 4 durante esta ejecucion.
