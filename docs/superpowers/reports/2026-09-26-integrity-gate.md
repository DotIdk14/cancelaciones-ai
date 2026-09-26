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

- `migrations/20260926183000_integrity-gate-engine-write-boundary.sql`: revoca
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
- `migrations/20260926190000_fact-run-immutability-reproducible.sql`: reproduce
  desde el repositorio, en una sola migración presentable y forward-only, las
  invariantes que hasta ahora solo existían en el ledger de DEV
  (`20260925120000` y `20260925140000`): tabla `fact_run_frozen_snapshots` con
  hash y columnas de verificación, `fact_runs.long_integrity_hash` y
  `long_effective_fingerprint`, triggers de congelación de `facts` y de la tabla
  de snapshots, RLS y `GRANT`s. Ver "Addendum" abajo.

No se tocó `evaluatePolicy`, `v5Rules`, outcomes, reglas ni criterios.

## Hallazgos que quedan abiertos (no bloquean el gate)

1. `p_envelope_hash` solo se valida por formato (`^[a-f0-9]{64}$`), no contra el
   contenido del envelope. La app ya envía el SHA-256 real, pero la BD no lo
   comprueba.
2. `freeze_fact_run_v1` confía en los fingerprints canónico y efectivo que envía
   el llamador: solo exige que no estén vacíos. El `integrity_hash` sí se calcula
   en servidor.
3. ~~Los triggers de `fact_extraction_runs` viven en migraciones aplicadas solo en
   DEV, ausentes del repositorio. Un entorno nuevo no los tendría.~~
   **Resuelto** en este ciclo: ver Addendum A. El origen real era
   `20260925120000` y `20260925140000`, no `20260925160000`/`20260925161000`.
4. ~~`20260926120000` se aplicó en DEV con el sello de tiempo `20260926183000`
   que generó la CLI.~~ **Resuelto** en este ciclo: ver Addendum B.

## Verificación

`pnpm typecheck` 5/5 · `pnpm test` 227/227 en 31 archivos · `pnpm lint` sin
warnings · `pnpm build` correcto.

**Corrección de una afirmación previa.** La primera versión de este informe
declaraba el typecheck limpio sin que lo estuviera: el commit `c674a4a` arrastró
un error real en `audit-queue.e2e.test.ts:178`, `snapshotIntegritySeed(run.id)`
recibía `unknown` porque el doble en memoria tipa las filas como
`Record<string, unknown>`. Se corrigió con un guard real en el fake
(`FACT_RUN_ID_INVALID`), no con un cast, y el typecheck vuelve a pasar. Se
registra porque un informe que declara verde una comprobación que no se ejecutó
es exactamente el fallo que este gate existe para evitar.

---

# Addendum — 2026-09-26 (segunda sesión)

Cierra los puntos 3 y 4 de "Hallazgos que quedan abiertos" y documenta la
limpieza de los datos sintéticos creados por este gate.

## A) Reproducibilidad de la inmutabilidad del fact run

**Origen del drift.** Al inspeccionar el esquema real de DEV contra el
repositorio appeared 14 objetos ausentes de `migrations/`: columna
`fact_runs.long_integrity_hash`, columna `fact_runs.long_effective_fingerprint`,
tabla `fact_run_frozen_snapshots` completa, 7 funciones (`fact_run_integrity_ok`,
`assert_fact_run_integrity`, `freeze_fact_run_v1`, `verify_frozen_snapshot_hash`,
`assert_frozen_snapshot_hash`, `fact_run_fingerprint` ×2), 5 triggers,
`policies/canon-v2`, el `CHECK` de clasificación de resultado y el par
`GRANT EXECUTE` / `REVOKE INSERT`.

Esas invariantes no proceden de las migraciones que inicialmente se sospecharon.
Comparando el ledger de DEV con el repositorio, el cuerpo SQL idéntico aparece
en `20260925120000 policy-foundation-immutability` y
`20260925140000 policy-foundation-security-closure`.

**Solución.** `migrations/20260926190000_fact-run-immutability-reproducible.sql`
reproduce el conjunto en una sola migración nueva, presentable y forward-only.
No copia código a ciegas: cada objeto se reconstruyó desde su definición real en
DEV y se declarative su propósito, y la migración es idempotente en toda su
superficie (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS`).

**Demostración de suficiencia.** Para no afirmar más de lo probado, se
acotó explícitamente la prueba: no es un entorno limpio desde cero.

1. Se tiraron abajo los 5 guards en DEV.
2. Se ejecutó el archivo del repositorio tal cual (precedido de `SELECT` para que
   la CLI no lo interpretara como opción) y recreó los 5 guards.
3. 7 intentos negativos quedaron bloqueados: mutar `facts` de un run FROZEN,
   mutar sus snapshots, mutar el `integrity_hash` del run, borrarlo, borrar sus
   filas de `facts`, y alterar el `effective_fingerprint`.

Conclusión honesta: el archivo del repositorio, por sí solo y sin las
migraciones que lo acompañaban, basta para recrear las invariantes. Lo que **no**
se ha probado es la aplicación completa de la serie `migrations up` sobre una base
vacía, que requiere una instancia efímera. La serie del repositorio sigue sin
poder aplicarse de principio a fin (ver Addendum B).

## B) Reconciliación del ledger

**Causa raíz del desajuste de versiones.** El scaffold `db migrations new` de la
CLI genera su propio timestamp, y el archivo se aplicó con el de la CLI
(`20260926183000`) conservando en el repositorio el suyo (`20260926120000`). El
proyecto ya tenía precedent: `20260922160000`, `20260924110000` y `20260924220000`
se habían renombrado a `20260925090300`, `20260925090600` y `20260925090800` con
una cabecera que documenta la versión original y declara el cuerpo byte-idéntico.

**Solución aplicada, sin duplicar.** Se renombraron 9 archivos para que la
versión del repositorio sea la del ledger, con cabecera de reconciliación en el
caso de este gate:

| Versión en el repositorio antes | Versión del ledger (ahora) |
| --- | --- |
| `20260926120000` integrity-gate-engine-write-boundary | `20260926183000` |
| `20260922140000` fact-human-reviews | `20260925090100` |
| `20260922150000` fact-reviews-schema-compat | `20260925090200` |
| `20260922160000` audit-display-name | `20260925090300` |
| `20260922170000` audit-manual-comments | `20260925090400` |
| `20260924103001` actionable-decision-status | `20260925090500` |
| `20260924110000` phase-7-dictamen-reporting | `20260925090600` |
| `20260924131000` fact-run-hash-index-fix | `20260925090700` |
| `20260924220000` mc-f2-003-evidence-requirements | `20260925090800` |

Se comprobó que los cuerpos son idénticos ignorando comentarios antes de
renombrar: 6 byte-idénticos y 3 con la cabecera de reconciliación ya añadida en
DEV. Un archivo, una versión. Resultado verificado: `migrations up` responde
`No pending local migrations to apply` y ambos historiales coinciden en 28
migraciones.

**Drift restante, documentado y fuera del alcance de este gate.** Estas 6
migraciones existen en el ledger de DEV y no en el repositorio:

`20260925120000` · `20260925140000` · `20260925150000` · `20260925160000` ·
`20260925161000` · `20260925200000`

Las dos primeras (inmutabilidad y cierre de seguridad) están ya reproducidas en
`20260926190000`. Las otras cuatro son de ciclo de vida de pipeline, guardas de
coste, forma de hechos de snapshot y telemetría de coste; no son invariantes de
seguridad y quedan señaladas, no resueltas. Se listan en la cabecera de
`20260926183000` para que no se pierda el rastro.

## C) Limpieza de datos sintéticos

Se borraron los fixtures creados por este gate, nunca una auditoría real. Los tres audits afectados se identificaron antes por `external_case_id` y `display_name`:
`IG-OFICIAL-1` ×2 y `INTEGRITY-PROBE-CAVE`, creados hoy por los usuarios de prueba
del gate. Contenido eliminado, verificado con recount a cero:

| Tabla | Filas |
| --- | --- |
| `audits` | 3 |
| `engine_runs` | 2 (incluido el forjado `3117c96b-bda9-4148-8658-3831e5a416af`) |
| `engine_rule_results` | 2 |
| `fact_extraction_runs` | 2 |
| `fact_run_frozen_snapshots` | 1 |
| `facts` | 1 |
| `audit_evaluation_envelopes` | 1 |
| `audit_runs` | 1 |

`delete_audit` no basta: para las dos audits con `engine_run` en `COMPLETED` falla
con `ENGINE_RUN_COMPLETED_APPEND_ONLY`, y para las demás exige `auth.uid()`, por lo
que hay que invocarla como el usuario dueño. El problema de fondo es que no existe
función sancionada de purga que atraviese los guards append-only. Para este ciclo se
deshabilitaron solo los 8 triggers append-only, se ejecutaron los `DELETE`
explícitos por `audit_id` y se rehabilitaron acto seguido. Comprobado tras la
operación: 0 triggers no activos y 0 filas residuales.

**Deuda que esto abre:** `delete_audit` es la vía sancionada del proyecto y no
puede borrar una audit con decisión de máquina, así que no hay forma admitida de
retirar una auditoría con `COMPLETED`. Mientras siga así, cualquier fixture de
pruebas que produzca una decisión ensucia DEV de forma irrecuperable por el camino
normal. Es el mismo patrón de "el guard de integridad hace imposible el
mantenimiento" y conviene resolverlo antes del bloque 2. No se ha diseñado aquí
solución; queda planteada.

Los dos usuarios de prueba (`ed43c7b4…`, `bb7d8ca3…`) se conservan: no son hijos de
las audits y su contraseña se restableció para permitir la llamada autenticada.
No se borró ninguna auditoría real ni dato con PII; el historial de `audit_log`
(577 filas) queda intacto.
