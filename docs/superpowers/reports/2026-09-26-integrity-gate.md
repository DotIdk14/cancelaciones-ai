# INTEGRITY GATE — Cerrado 2026-09-26

Alcance: inmutabilidad de `fact_extraction_runs` y frontera de escritura de la
decisión de máquina. Entorno de verificación: InsForge DEV.

## Causa raíz

La aplicación nunca se conectó a las funciones oficiales de sellado y evaluación.
Escribía directamente con el mismo JWT que recibe el navegador:

- `apps/web/src/server/jobs/handlers.ts:186` congelaba con
  `update({state:'FROZEN'})` en vez de `freeze_fact_run_v1`, por lo que nunca se
  creaba `fact_run_frozen_snapshots`.
- `apps/web/src/server/policy/evaluation.ts` insertaba en `engine_runs` y
  `engine_rule_results` en vez de llamar a `persist_policy_evaluation_v1`.

Como el rol `authenticated` tenía `INSERT` sobre ambas tablas, "servidor" y
"navegador" eran la misma credencial. El Dictamen lee
`ORDER BY created_at DESC LIMIT 1`, de modo que un `engine_run` forjado se
convertía en la decisión de máquina leída como oficial. Violaba
`PRESERVE_MACHINE_DECISION` y `TRACE_EVERY_DECISION`.

## A) Inmutabilidad del fact run

| Prueba | Resultado |
|---|---|
| `DRAFT → FROZEN` directo | 400 `FACT_RUN_STATE_TRANSITION_FORBIDDEN` |
| `FROZEN → DRAFT` | 400 `FACT_RUN_STATE_TRANSITION_FORBIDDEN` |
| `FROZEN → PROCESSING` | 400 `FACT_RUN_STATE_TRANSITION_FORBIDDEN` |
| `frozen_at = NULL` | 400 `FACT_RUN_IMMUTABLE_ROW` |
| `policy_code` alterado | 400 `FACT_RUN_IMMUTABLE_ROW` |
| `policy_version` alterado | 400 `FACT_RUN_IMMUTABLE_ROW` |
| `artifact_set_fingerprint` alterado | 400 `FACT_RUN_IMMUTABLE_ROW` |
| `extractor_version` alterado | 400 `FACT_RUN_IMMUTABLE_ROW` |
| Estado tras los 8 intentos | `FROZEN`, `GDM_GAM_PRD_MLG_003`, `5`, fingerprint y `frozen_at` intactos |
| Sellado oficial `freeze_fact_run_v1` | 201, crea snapshot `49d713b3-0687-453c-8e3d-a388a52a69cf` |

## B) Frontera de escritura de la decisión

| Prueba | Antes | Después |
|---|---|---|
| `INSERT engine_runs` desde cliente | **201 forjado** | **403 permission denied** |
| `INSERT engine_rule_results` desde cliente | **201 forjado** | **403 permission denied** |
| `UPDATE engine_runs` desde cliente | 403 | 403 |
| `SELECT engine_runs` (Dictamen) | 200 | 200 |
| `persist_policy_evaluation_v1` (oficial) | no usada | 200, crea engine_run `8e2d6238-3191-418b-814d-19c225f896f7` |
| Idempotencia de la función oficial | — | 200, `out_created: false`, mismos ids |
| Envelope + baseline + snapshot | — | 1 / 1 / 1 |

## Cambios

- `migrations/20260926120000_integrity-gate-engine-write-boundary.sql`: revoca
  `INSERT` de `authenticated` sobre `engine_runs` y `engine_rule_results`, elimina
  las políticas RLS de INSERT que anunciaban esa capacidad y mantiene `EXECUTE`
  de la función oficial.
- `apps/web/src/server/policy/evaluation.ts`: persiste por
  `persist_policy_evaluation_v1`; elimina el pre-`check` de idempotencia y los
  INSERT directos, que la función cubre de forma atómica.
- `apps/web/src/server/jobs/handlers.ts`: sella con `freeze_fact_run_v1`; resuelve
  el `document_id` normativo contra `policy_source_registry` en vez de una
  constante en código; reutiliza `canonicalFingerprintV1` de `@cancelaciones/domain`.
- `apps/web/src/server/comparison/baseline.ts`: extrae
  `recordBaselineCompletedEvent` para conservar el evento `AI_BASELINE_COMPLETED`,
  que la función oficial no escribe.
- `apps/web/src/server/jobs/audit-queue.e2e.test.ts`: el doble en memoria replica
  ambas funciones oficiales con sus validaciones.

No se tocó `evaluatePolicy`, `v5Rules`, outcomes, reglas ni criterios.

## Hallazgos que quedan abiertos (no bloquean el gate)

1. `p_envelope_hash` solo se valida por formato (`^[a-f0-9]{64}$`), no contra el
   contenido del envelope. La app ya envía el SHA-256 real, pero la BD no lo
   comprueba.
2. `freeze_fact_run_v1` confía en los fingerprints canónico y efectivo que envía
   el llamador: solo exige que no estén vacíos. El `integrity_hash` sí se calcula
   en servidor.
3. Los triggers de `fact_extraction_runs` viven en migraciones aplicadas solo en
   DEV (`20260925160000`, `20260925161000`, `20260925200000`), ausentes del
   repositorio. Un entorno nuevo no los tendría.
4. `20260926120000` se aplicó en DEV con el sello de tiempo `20260926183000` que
   generó la CLI. Reaplicarla es inofensiva (todo es idempotente).

## Verificación

`pnpm typecheck` 5/5 · `pnpm test` 227/227 en 31 archivos · `pnpm lint` sin
warnings · `pnpm build` correcto.
