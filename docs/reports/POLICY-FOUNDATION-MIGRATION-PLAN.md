# Plan de migración — Policy Foundation

Documento **previo** a cualquier cambio en base de datos. Se escribe antes de aplicar,
porque aplicarla sin plan medido sería repetir el defecto que este cierre corrige.

Alcance: **exclusivamente el backend DEV** (`audit-pipeline-dev-e2e`, appkey
`4pw4jdzv-cif`). Producción queda fuera por prohibición explícita
(`PROHIBIDO PRODUCCIÓN`).

---

## 1. Puerta de seguridad: identidad del objetivo

Ninguna sentencia se emite hasta que el objetivo está identificado de cinco formas
independientes. Si cualquiera de las cinco no coincide con DEV, se detiene todo.

| Señal | Valor observado | Fuente de la observación |
|---|---|---|
| `project_id` | `5350861f-1050-4ecb-88b1-b171d45d2386` | `insforge current --json` |
| `project_name` | `audit-pipeline-dev-e2e` | `insforge current --json` |
| `appkey` | `4pw4jdzv-cif` | `insforge current --json`, `projects get --json` |
| Host | `https://4pw4jdzv-cif.us-west.insforge.app` | `.insforge/project.json` → `oss_host` |
| `parent_project_id` | `9e29e329-…` (`Cancelaciones`) | `projects get --json` |
| `instance_type` | `nano` | `projects get --json` |

Producción es un proyecto **distinto**, con `project_id` y `appkey` distintos:

| Señal | Producción |
|---|---|
| `project_name` | `Cancelaciones` |
| `appkey` | `4pw4jdzv` |
| Host | `https://4pw4jdzv.us-west.insforge.app` |

Diferencia de discriminante: `4pw4jdzv-cif` frente a `4pw4jdzv`. El objetivo contiene
el sufijo de rama; producción no. Además el objetivo es una **rama de backend creada
desde** producción (`parent_project_id`), no producción misma.

Guarda de segunda capa, en código: los tres E2E de DEV rechazan cualquier
`NEXT_PUBLIC_INSFORGE_URL` que no contenga el appkey de DEV y lanzan
`REFUSING_NON_DEV_INSFORGE_URL`. Es decir, aunque el entorno apuntara a producción, la
suite se negaría a correr en vez de migrar producción por accidente.

Estado de datos del objetivo: `audits=0`, `facts=0`, `fact_extraction_runs=0`,
`engine_runs=0`, `fact_reviews=0`, `audit_runs=0`, `auth.users=4` (todas de prueba,
dominio `example.test`). Radio de impacto de un fallo: **cero datos de negocio**.

---

## 2. Inventario de migraciones

29 ficheros en `migrations/`. El ledger del backend DEV registra **21**. Los 8
ficheros no registrados **no están pendientes en el sentido de "falta el esquema"**:
sus objetos ya existen materializados en DEV. El ledger quedó incompleto al crearse la
rama. Se verificó objeto por objeto, no por assume.

| # | Fichero | Ledger DEV | Objetos ya materializados en DEV | Acción |
|---|---|---|---|---|
| 1 | `20260918211733_create-auditor-schema` | aplicado | — | — |
| 2 | `20260918212205_make-auditor-ids-text` | aplicado | — | — |
| 3 | `20260921221309_phase-1-base-schema` | aplicado | — | — |
| 4 | `20260921223222_phase-2-evidence-ingestion` | aplicado | — | — |
| 5 | `20260921225156_phase-3-durable-jobs` | aplicado | — | — |
| 6 | `20260922140000_fact-human-reviews` | **no registrado** | `fact_reviews` existe | no aplicar (ver §2.1) |
| 7 | `20260922150000_fact-reviews-schema-compat` | **no registrado** | columnas `decision`/`corrected_value` a verificar | no aplicar (ver §2.1) |
| 8 | `20260922160000_audit-display-name` | **no registrado** | columna `display_name` a verificar | no aplicar (ver §2.1) |
| 9 | `20260922170000_audit-manual-comments` | **no registrado** | `audit_manual_comments` existe | no aplicar (ver §2.1) |
| 10 | `20260922220000_phase-4-universal-evidence-processing` | aplicado | — | — |
| 11 | `20260922230000_phase-4-fix-provider-op-idempotency` | aplicado | — | — |
| 12 | `20260923220000_phase-5-fact-model-shadow` | aplicado | — | — |
| 13 | `20260924101000_phase-6-policy-engine` | aplicado | — | — |
| 14 | `20260924102000_vertical-slice-fact-run-policy-link` | aplicado | — | — |
| 15 | `20260924103000_evidence-legacy-ticket-compat` | aplicado | — | — |
| 16 | `20260924103001_actionable-decision-status` | **no registrado** | `engine_runs.decision_status` **ausente** | no aplicar (ver §2.1) |
| 17 | `20260924104000_enqueue-job-evidence-id` | aplicado | — | — |
| 18 | `20260924105000_record-job-artifact-extended` | aplicado | — | — |
| 19 | `20260924106000_fact-run-write-policies` | aplicado | — | — |
| 20 | `20260924110000_phase-7-dictamen-reporting` | **no registrado** | `dictamen_documents`, `dictamen_versions` existen | no aplicar (ver §2.1) |
| 21 | `20260924120000_ai-human-comparison` | aplicado | — | — |
| 22 | `20260924130000_policy-code-hash-index-fix` | aplicado | — | — |
| 23 | `20260924131000_fact-run-hash-index-fix` | **no registrado** | `fact_extraction_runs_idempotency_hash_idx` existe | no aplicar (ver §2.1) |
| 24 | `20260924170400_fact-runs-policy-code-hash-index` | aplicado | — | — |
| 25 | `20260924170450_fact-runs-artifact-fingerprint-hash-index` | aplicado | — | — |
| 26 | `20260924170500_finish-audit-48680` | aplicado | — | — |
| 27 | `20260924180000_audit-delete-with-trace` | aplicado | — | — |
| 28 | `20260924220000_mc-f2-003-evidence-requirements` | **no registrado** | `evidence_requirements` existe | no aplicar (ver §2.1) |
| 29 | `20260925120000_policy-foundation-immutability` | **no registrado** | **ninguno** (verificado) | **APLICAR** |

### 2.1 Por qué no se aplican las 8 no registradas

`migrations up --all` está prohibido por el handoff, y aquí hay además una razón
técnica: **casi todas son supersedidas o ya materializadas**, y reaplicarlas no añade
invariante, sólo riesgo.

- **#23** `fact-run-hash-index-fix` está **supersedida** por #24 + #25, que ya están en el
  ledger. Reaplicarla volvería a hacer `DROP INDEX` + `CREATE` del mismo índice único.
- **#6, #9, #20, #28**: sus tablas ya existen. Son `CREATE TABLE IF NOT EXISTS` más
  políticas; reaplicar sólo reescribiría políticas idénticas.
- **#16** es la única cuyo objeto **falta de verdad**: `engine_runs.decision_status` no
  existe en DEV. Se aplica **fuera de esta fase**, porque pertenece a la cadena de
  `actionable decision status`, no a la inmutabilidad. Se registra como deuda con
  migración propia y timestamp único. Foundation **no la necesita**: la migración
  Foundation no referencia `decision_status` en ningún punto (0 coincidencias).
- **#7, #8**: su efecto es `ADD COLUMN IF NOT EXISTS`; hay que verificar el estado real de
  esas columnas antes de decidir, no reaplicar a ciegas.

**Conclusión:** la única migración de esta fase es **#29**. Se aplica **una**, se
verifica, y se detiene.

---

## 3. Migración a aplicar

```text
migrations/20260925120000_policy-foundation-immutability.sql
```

### 3.1 Precondiciones verificadas en DEV

| Precondición | Estado observado | Cómo se comprobó |
|---|---|---|
| `public.audits` existe | sí | `information_schema.tables` |
| `public.facts` existe | sí | ídem |
| `public.fact_extraction_runs` existe | sí | ídem |
| `public.engine_runs` existe, con `fact_run_id` | sí | `information_schema.columns` |
| `public.engine_rule_results` existe | sí | `information_schema.tables` |
| `public.audit_runs` existe, con `run_type`/`status`/`completed_at` | sí | `information_schema.columns` |
| `public.current_app_role()` existe | sí | `information_schema.routines` |
| `public.delete_audit` existe | sí | `information_schema.routines` |
| `public.prevent_protected_rule_child_mutation` existe | sí | `information_schema.routines` |
| `auth.users` existe | sí (4 filas) | `auth.users` |
| `digest()` (pgcrypto) disponible | sí (la usa #25 ya aplicada) | ledger |
| Objetos Foundation previos | **ninguno** | `information_schema` sobre las 4 tablas y los 5 RPC |
| `decision_status` en `engine_runs` | **ausente, y no se necesita** | 0 referencias en el SQL de Foundation |

### 3.2 Objetos que crea

Tablas: `policy_source_registry`, `fact_run_frozen_snapshots`,
`audit_evaluation_envelopes`, `ai_decision_snapshots`.

Columnas en `fact_extraction_runs`: `parent_fact_run_id`, `derivation_reason`,
`effective_facts_fingerprint`.

Funciones: 8 `SECURITY DEFINER` con `search_path` fijo + 6 barreras sin escalar
privilegio.
RPC: `freeze_fact_run_v1`, `create_derived_fact_run_v1`, `persist_policy_evaluation_v1`.
Sondas: `policy_foundation_acl_probe` (sólo metadatos ACL),
`policy_foundation_immutability_probe` (cada mutación en subtransacción revertida).

Triggers: 11.

### 3.3 Restricciones esperadas

- `fact_run_frozen_snapshots`: `UNIQUE (fact_run_id)`.
- `ai_decision_snapshots`: índice único `ai_decision_snapshots_identity (audit_id,
  decision_version, input_fingerprint)`.
- `engine_runs_fact_run_id_fkey`: FK real con `ON DELETE SET NULL` (no `CASCADE`: perder
  un fact run no debe borrar una decisión de máquina ya tomada).
- `policy_source_registry` sembrada con **una** fila, `status =
  'PENDING_VERIFICATION'`, `ON CONFLICT DO NOTHING`. **No** se marca `CANONICAL`: eso es
  una decisión del propietario y esta fase no la toma.

### 3.4 Grants esperados

| Rol | Objetos | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|---|
| `anon` | las 4 tablas Foundation | no | no | no | no |
| `anon` | `facts`, `fact_extraction_runs`, `engine_runs`, `engine_rule_results` | no | no | no | no |
| `anon` | `audit_runs` | (sin cambio) | (sin cambio) | (sin cambio) | (sin cambio) |
| `authenticated` | `policy_source_registry` | sí | no | no | no |
| `authenticated` | `fact_run_frozen_snapshots` | sí | no | no | no |
| `authenticated` | `audit_evaluation_envelopes` | sí | no | no | no |
| `authenticated` | `ai_decision_snapshots` | sí | **sí** | no | no |
| `authenticated` | `engine_runs`, `engine_rule_results` | sí | no | no | no |
| `authenticated` | `facts` | sí | sí | **no** | **no** |
| `authenticated` | `fact_extraction_runs` | sí | sí | **sí** | **no** |

`ai_decision_snapshots` conserva `INSERT` a propósito: `appendAiDecisionV1` inserta
directo y no tiene RPC. Actualizar y borrar están revocados **y** bloqueados por trigger.

### 3.5 Rollback

No hay rollback automático, y no debe haberlo: los triggers de append-only existen
precisamente para que el reverted sea imposible por diseño. La reversión, si hiciera
falta, es una migración posterior escrita a mano que elimine objetos **en orden inverso**
de dependencia, y sólo tiene sentido en un entorno descartable. En DEV, con cero datos de
negocio, la reversión real es **resetear la rama de backend**, que es más rápida y más
honesta que un `DROP`crafted.

Lo que **no** se hace: un `down`/`rollback` automático. Un rollback automático de una
migración de inmutabilidad sería una puerta trasera al mismo invariante que la migración
sella.

### 3.6 Post-validación

Tras aplicar, y antes de declarar nada:

1. Las 4 tablas y los 5 RPC existen.
2. `policy_source_registry` tiene exactamente 1 fila, `PENDING_VERIFICATION`.
3. Los 11 triggers existen sobre las tablas esperadas.
4. `RLS enabled` en las 4 tablas.
5. ACL real leída con `has_table_privilege` y comparada con §3.4.
6. RLS con 4 identidades: `anon`, `authenticated` propietario, `authenticated` usuario
   ajeno, y perfil `OWNER`.
7. E2E de FROZEN: `DRAFT→PROCESSING→FROZEN` y después los 5 intentos de mutación
   bloqueados.
8. E2E de corrección humana: padre intacto, corrección #1 y #2 sin colisión, reintento
   idempotente.
9. E2E de `AI_DECISION_V1`: `INSERT` pasa, `UPDATE`/`DELETE` rechazados, reintento de
   misma identidad da `AI_DECISION_V1_ALREADY_EXISTS`.
10. E2E de persistencia de evaluación sobre fact run FROZEN.
11. Backfill legacy: fact run `FROZEN` sin snapshot → snapshot creado, original intacto,
    reintento idempotente.

---

## 4. Colisión de timestamps

Búsqueda de timestamps duplicados en `migrations/`: **ninguno**. Los 29 prefijos son
únicos.

La colisión descrita en el handoff (`20260925120000_fact-run-derivation.sql` frente a
`20260925120000_policy-foundation-immutability.sql`) **no se materializa en este
repositorio**: la rama `feature/dictamen-panel` no existe ni local ni en `origin`, y
`fact-run-derivation.sql` no aparece en ninguna referencia de ningún ref. Se verificó
ref por ref.

 Aun así, la condición que la habría producido no está vigilada. Se añade un check de CI
que falle ante timestamps duplicados, para que la colisión no pueda volver a introducirse
en silencio. Es prevention, no cleanup.

---

## 5. Orden de ejecución

1. Verificar identidad DEV (§1). Detenerse si no coincide.
2. Snapshot de estado: contar filas de las 7 tablas de negocio.
3. Verificar precondiciones (§3.1).
4. Escribir este plan. *(Este documento.)*
5. Aplicar **#29 únicamente**.
6. Post-validación completa (§3.6).
7. E2E de DEV.
8. Regresión completa: `typecheck`, `lint`, `test`, `build`, Golden Master.
9. Informe.

Si un paso falla: **STOP**. No se continúa con la siguiente migración ni se compensa con
una sentencia manual.
