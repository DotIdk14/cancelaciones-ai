# Mejora Continua

## Audit Queue E2E Gate

- Status: `AUDIT PIPELINE E2E: PASS` para orquestación interna con provider local de texto.
- Test ejecutado: `pnpm --filter @cancelaciones/web test:audit:e2e` valida auditoría nueva, evidencias persistidas, fan-in multi-evidencia, `FACT_EXTRACTION`, facts congelados, `AUDIT_EVALUATION`, `engine_runs`, `engine_rule_results`, `REPORT_GENERATION`, `report_snapshots`, auditoría `COMPLETED`, retry e idempotencia.
- External providers: OpenRouter y AssemblyAI no fueron ejecutados en este gate.

## Operational Audit Pipeline

- Flujo: `EVIDENCE_PROCESSING -> FACT_EXTRACTION -> AUDIT_EVALUATION -> REPORT_GENERATION`.
- `FACT_EXTRACTION` reutiliza artifacts durables, inserta facts si no existen y congela el `fact_extraction_run` usado por el motor.
- `AUDIT_EVALUATION` reutiliza `runPolicyEngineForAudit`; no cambia reglas ni conecta F2.
- `REPORT_GENERATION` crea `report_snapshots` idempotentes y marca la auditoría `COMPLETED`.

## Current Queue Architecture

- Queue: tablas/RPC existentes `jobs`, `enqueue_job`, `claim_next_job`, `complete_job`, `schedule_job_retry`.
- Worker HTTP existente: `POST /api/jobs/process`.
- Worker persistente mínimo: `runJobWorker` ejecuta loop `claimNext -> executeClaimedJob -> delay`, con `AbortSignal` para cierre limpio.

## Known Infrastructure Limitations

- PostgreSQL real local no fue validado en esta máquina porque no hay `docker` ni `psql` disponibles.
- El E2E usa durable test client con repositorios, queue y worker reales de la app; no demuestra configuración de producción ni providers externos.
- PDF final automático no se generó en el pipeline; el artifact automático validado es `report_snapshots`.

## Next Product Step

- Con el pipeline interno en PASS, el siguiente frente recomendado es continuar F2 solo después de validar el mismo flujo contra PostgreSQL/InsForge de desarrollo.

## Audit Pipeline DEV Infrastructure Gate

- Status: `AUDIT PIPELINE DEV INFRA E2E: PASS`.
- Entorno: InsForge backend branch `audit-pipeline-dev-e2e`, appkey `4pw4jdzv-cif`, region `us-west`, modo `schema-only`; no se usó el proyecto base `Cancelaciones` para ejecutar fixtures.
- Migraciones: la rama DEV heredó schema sin datos y buckets vacíos. `db migrations up --all` detectó defecto local por versión duplicada `20260924103000`, remediado renombrando `actionable-decision-status` a `20260924103001`. La rama reporta schema operativo con tablas `jobs`, `job_artifacts`, `fact_extraction_runs`, `facts`, `engine_runs`, `engine_rule_results`, `report_snapshots`.
- E2E: `pnpm --filter @cancelaciones/web test:audit:dev-e2e` ejecutó repositorios reales, storage real, queue real y worker real contra InsForge DEV. Validó dos evidencias `.txt`, fan-in, facts, freeze, engine, rule results, report snapshot, `audits.status = COMPLETED` y reload desde DB real.
- Seguridad: el test usa `createAdminClient` solo como credencial server-side del worker/test; anon sin sesión no puede leer la auditoría creada. No se imprimen secretos.
- Limitaciones: OpenRouter y AssemblyAI no fueron probados. PDF final automático sigue fuera de este gate. PostgreSQL version exacta no fue expuesta por metadata CLI; backend InsForge reportó service version `2.3.2`.
- Próximo paso: con pipeline DEV validado, se puede retomar MC-F2-003; no se implementó F2 en esta ejecución.

## Rule Governance (MC-F2-003)

- Status: `MC-F2-003 EVIDENCE REQUIREMENTS: PASS`.
- Migración `20260924220000_mc-f2-003-evidence-requirements.sql` (posterior al head remoto `20260924180000`): crea `rules`, `rule_conditions` y `evidence_requirements`, todas con RLS y grants a `authenticated`.
- Modelo `evidence_requirements`: `rule_id` FK a `rules(id)` ON DELETE CASCADE, `requirement_key` con `UNIQUE(rule_id, requirement_key)`, `evidence_type`, `evidence_code`, `document_role` (EVIDENCE / HUMAN_DECISION_DOCUMENT / ADJUDICATION_EVIDENCE), `required`, `min_count`, `max_count`, `order_index`, `metadata`. Checks: `min_count >= 0`, `max_count >= min_count`, `required = true => min_count >= 1`, `metadata` objeto.
- Inmutabilidad: trigger `prevent_protected_rule_child_mutation` bloquea INSERT/UPDATE/DELETE de hijos cuando la regla no está en `DRAFT` (excepción `RULE_VERSION_IMMUTABLE`). Trigger `prevent_protected_rule_delete` impide borrar reglas no-DRAFT y evita saltar la inmutabilidad vía DELETE en cascada; reglas DRAFT sí se eliminan en cascada.
- Aislamiento de versiones: cada versión (`rule_key` + `version`) tiene su propio conjunto de requisitos; editar la versión DRAFT no afecta las versiones APPROVED/ACTIVE.
- Backend: repositorio `createRuleGovernanceRepository` en `packages/db` (createRule, updateRuleStatus, listRules, findRuleById, listEvidenceRequirements, create/update/deleteEvidenceRequirement) con validación previa a DB (`INVALID_REQUIREMENT_KEY`, `INVALID_EVIDENCE_TYPE`, `INVALID_COUNT_RANGE`, etc.).
- API: `GET/POST /api/rules`, `PATCH /api/rules/[ruleId]` (cambio de status), `GET/POST /api/rules/evidence-requirements`, `PATCH/DELETE /api/rules/evidence-requirements/[requirementId]`. Writes requieren rol OWNER vía servidor; la DB mantiene checks y RLS.
- Validación DEV: `pnpm --filter @cancelaciones/web test:governance:dev-e2e` crea rule v1/v2 y requisitos contra InsForge DEV real, publica una versión, verifica inmutabilidad (`RULE_VERSION_IMMUTABLE`), aislamiento entre versiones, rechazo de entrada inválida y que anon no lee requirements.
- Regresión tras el gate: `pnpm test` (58), `test:audit:e2e` (5), `test:audit:dev-e2e` (1), `test:governance:dev-e2e` (1), `policy-engine` (29), `lint` y `build` en PASS. RuleEngine, golden 24/24 y pipeline no fueron modificados.
- Próximo ticket: `MC-F2-004 — ruleset_versions` (resolver `rule_key, version` a la versión efectiva, aún no ejecutado).
