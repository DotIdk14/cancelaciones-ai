# D6 — DB reconciliation report

**Fecha:** 2026-09-26  
**Alcance:** `repo ↔ migration ledger DEV ↔ DEV schema`  
**Resultado final:** `BLOCKED`  
**Decision Tree Phase 1:** no ejecutado.

---

## 1. Executive summary

Una DB vacía **no puede reconstruirse únicamente a partir del repositorio actual** hasta
obtener el schema esperado de DEV.

La cadena actual del repo está bloqueada por tres causas reproducibles:

1. **Ordering failure antes de las migrations perdidas.** En una DB desechable con shims
   mínimos de plataforma InsForge (`auth`, `system`, roles y `system.update_updated_at`),
   la migration `20260925090200_fact-reviews-schema-compat.sql` falla porque ejecuta
   `CASE status` sobre `public.fact_reviews`, pero la migration inmediatamente anterior
   en el repo (`20260925090100_fact-human-reviews.sql`) crea `fact_reviews` sin columna
   `status`.
2. **7 entradas de ledger DEV están ausentes del repo actual.** Una es el dump PII
   `20260924170500_finish-audit-48680`, eliminado correctamente de la historia. Las 6
   migrations históricas solicitadas sí aparecen en el ledger y también existen como SQL
   histórico en ramas saneadas, pero no están presentes en `migrations/` de la rama actual.
3. **Objetos de runtime existen en DEV pero no pueden producirse desde el repo actual.**
   Incluye `policy_source_registry`, `fact_run_frozen_snapshots`,
   `audit_evaluation_envelopes`, `ai_decision_snapshots` y RPCs como
   `persist_policy_evaluation_v1`.

Por lo tanto, el gate D6 es:

```text
BLOCKED
```

---

## 2. Ledger real

Fuente autoritativa consultada:

```sql
system.custom_migrations
```

Columnas verificadas por memoria/probe InsForge: `version`, `name`, `statements`,
`created_at`. Se usó `md5(array_to_string(statements, ...))` como checksum reproducible
del payload aplicado, no como hash de archivo original.

Resumen:

| Fuente | Count |
|---|---:|
| Migrations en ledger DEV | 37 |
| Migrations en repo actual | 30 |
| Ledger-only total | 7 |
| Ledger-only PII dump eliminado | 1 |
| Ledger-only históricas solicitadas | 6 |

Ledger-only total:

| Version | Name | created_at | Statements | Ledger statements MD5 | Clasificación |
|---|---|---:|---:|---|---|
| `20260924170500` | `finish-audit-48680` | `2026-09-24T17:36:56.732Z` | 16 | `9dc26877a277f73d92babf237ce86210` | `LEDGER_ONLY`; dump PII eliminado |
| `20260925120000` | `policy-foundation-immutability` | `2026-09-25T20:46:11.683Z` | 100 | `22a8f4a68779a3b9483f5435b0a29913` | `ORIGINAL_SQL_RECOVERED` |
| `20260925140000` | `policy-foundation-security-closure` | `2026-09-25T21:00:03.665Z` | 15 | `c8039c90dfb5b9aa9ef4e4a411371838` | `ORIGINAL_SQL_RECOVERED` |
| `20260925150000` | `fix-legacy-snapshot-fact-shape` | `2026-09-25T21:03:28.387Z` | 4 | `bb71a37a33d7a1769798ef983675fd76` | `ORIGINAL_SQL_RECOVERED` |
| `20260925160000` | `pipeline-lifecycle-and-cost-guard` | `2026-09-25T22:09:36.585Z` | 20 | `6552df763c1ceaea832147b1de432cb6` | `ORIGINAL_SQL_RECOVERED` |
| `20260925161000` | `restore-fact-run-processing-state` | `2026-09-25T22:11:20.924Z` | 3 | `b1820fc025483bf21aa56827630d2044` | `ORIGINAL_SQL_RECOVERED` |
| `20260925200000` | `cost-telemetry-contract` | `2026-09-25T23:52:18.122Z` | 22 | `5013e46e57b78dee14a3050389c237f0` | `ORIGINAL_SQL_RECOVERED` |

---

## 3. Migrations faltantes

Las 6 migrations solicitadas están ausentes de `migrations/` en la rama actual, pero el
SQL histórico exacto fue recuperado desde ramas/tags saneados y el ledger DEV conserva el
payload de statements aplicado.

| Version | Nombre | SQL histórico en refs saneadas | Blob | SHA-256 archivo | Evidencia |
|---|---|---|---|---|---|
| `20260925120000` | `policy-foundation-immutability` | sí | `8205bd87e450` | `a5ef37b80d3c7de8` | `feature/policy-foundation-tasks-8-12`, `archive/origin-main` |
| `20260925140000` | `policy-foundation-security-closure` | sí | `941c809f12a8` | `53bf1e8e7d6032e7` | commit `22b8186` |
| `20260925150000` | `fix-legacy-snapshot-fact-shape` | sí | `7107c5bb47d1` | `ed2877427c6e766b` | commit `22b8186` |
| `20260925160000` | `pipeline-lifecycle-and-cost-guard` | sí | `d0302fc491b2` | `85526071753a2786` | commit `dbfd6dc` |
| `20260925161000` | `restore-fact-run-processing-state` | sí | `20814aa0331e` | `62096227333214a9` | commit `dbfd6dc` |
| `20260925200000` | `cost-telemetry-contract` | sí | `a6433a887816` | `ffe8dad7236c9f7a` | commit `3f9004a` |

Nota: `20260925120000` tuvo dos blobs históricos. El blob final presente en el tip
saneado de `feature/policy-foundation-tasks-8-12` y `archive/origin-main` es
`8205bd87e450...`. El blob anterior (`9592485db866...`) queda solo como antecedente.

---

## 4. Evidencia recuperada

Comando de ledger usado:

```sql
select version, name, created_at,
       cardinality(statements) as statement_count,
       md5(coalesce(array_to_string(statements, E'\n-- statement --\n'),'')) as statements_md5
from system.custom_migrations
order by version;
```

Comando de búsqueda en refs saneadas:

```bash
git rev-list --all --objects | grep 'migrations/<version>_'
git log --all -- migrations/<version>_*.sql
```

La recuperación se considera `ORIGINAL_SQL_RECOVERED` para las 6 porque existen dos
fuentes autoritativas concordantes:

- ledger DEV con `version`, `name`, `created_at`, `statements[]`, count y checksum;
- archivo SQL histórico en ramas saneadas, con path de migration y blob hash.

No se restauró ningún archivo de migration en la rama actual durante D6.

---

## 5. Schema DEV

Introspección por catálogo (`pg_catalog`, `information_schema`, `pg_get_*def`):

| Tipo | Count DEV |
|---|---:|
| Tablas public | 47 |
| Funciones/RPCs public | 238 |
| Triggers public | 45 |
| Policies public | 105 |

Tablas DEV relevantes que no se pueden producir desde la rama actual sin las 6 migrations:

- `policy_source_registry`
- `fact_run_frozen_snapshots`
- `audit_evaluation_envelopes`
- `ai_decision_snapshots`

`fact_reviews` en DEV tiene 10 columnas e incluye `status`, `note_sanitized`, `decision`,
`corrected_value`, `note`. Esto contrasta con la reconstrucción parcial del repo, donde
`fact_reviews` se crea sin `status` y luego una migration intenta leerla.

---

## 6. Schema producido por repo

### 6.1 Prueba raw PostgreSQL vacío

DB desechable: contenedor `postgres:16-alpine`, DB `cancelaciones_rebuild`.

Resultado inmediato:

| Última migration exitosa | Primera migration fallida | Error |
|---|---|---|
| `<none>` | `20260918211733_create-auditor-schema.sql` | `schema "auth" does not exist` |

Este resultado confirma que las migrations dependen de plataforma InsForge (`auth`,
roles, `system`). No es el failure principal de app, sino ausencia de baseline de
plataforma.

### 6.2 Prueba con shim mínimo de plataforma InsForge

DB desechable: `cancelaciones_rebuild_platform` en el mismo contenedor. Shims de
plataforma usados:

- schema `auth`;
- tabla mínima `auth.users(id uuid primary key)`;
- roles `anon`, `authenticated`, `project_admin`, `service_role`;
- extension `pgcrypto`;
- `auth.uid()`;
- schema `system`;
- `system.update_updated_at()`.

No se creó ningún objeto de app manualmente.

Resultado:

| Última migration exitosa | Primera migration fallida | Error exacto |
|---|---|---|
| `20260925090100_fact-human-reviews.sql` | `20260925090200_fact-reviews-schema-compat.sql` | `ERROR: column "status" does not exist` |

Estado parcial antes del fallo:

- 20 migrations aplicadas;
- 28 tablas public;
- `fact_reviews` contiene: `id`, `audit_id`, `fact_id`, `decision`, `corrected_value`,
  `note`, `reviewed_by`, `created_at`;
- falta `status`, requerida por `20260925090200` línea 7.

---

## 7. Drift matrix

| Object | Repo | Ledger | DEV | Runtime usage | Classification | Evidence | Proposed action |
|---|---|---|---|---|---|---|---|
| `20260924170500_finish-audit-48680` | ausente | presente | aplicado | ninguno requerido | `LEDGER_ONLY` | 16 statements; dump PII; eliminado de historia | No restaurar; documentar como data dump accidental |
| `20260925120000_policy-foundation-immutability` | ausente en rama actual; presente en ramas saneadas | presente | aplicado | freeze/evaluation/fact sealing | `LEDGER_ONLY` en rama actual / `ORIGINAL_SQL_RECOVERED` | ledger MD5 `22a8...`; blob `8205bd...` | Restaurar archivo histórico exacto en rama actual |
| `20260925140000_policy-foundation-security-closure` | ausente en rama actual; presente en ramas saneadas | presente | aplicado | ACL/RLS | `LEDGER_ONLY` / `ORIGINAL_SQL_RECOVERED` | ledger MD5 `c803...`; blob `941c...` | Restaurar archivo histórico exacto |
| `20260925150000_fix-legacy-snapshot-fact-shape` | ausente en rama actual; presente en ramas saneadas | presente | aplicado | frozen snapshot compat | `LEDGER_ONLY` / `ORIGINAL_SQL_RECOVERED` | ledger MD5 `bb71...`; blob `7107...` | Restaurar archivo histórico exacto |
| `20260925160000_pipeline-lifecycle-and-cost-guard` | ausente en rama actual; presente en ramas saneadas | presente | aplicado | lifecycle RPCs | `LEDGER_ONLY` / `ORIGINAL_SQL_RECOVERED` | ledger MD5 `6552...`; blob `d030...` | Restaurar archivo histórico exacto |
| `20260925161000_restore-fact-run-processing-state` | ausente en rama actual; presente en ramas saneadas | presente | aplicado | processing state | `LEDGER_ONLY` / `ORIGINAL_SQL_RECOVERED` | ledger MD5 `b182...`; blob `20814...` | Restaurar archivo histórico exacto |
| `20260925200000_cost-telemetry-contract` | ausente en rama actual; presente en ramas saneadas | presente | aplicado | AI cost telemetry | `LEDGER_ONLY` / `ORIGINAL_SQL_RECOVERED` | ledger MD5 `5013...`; blob `a643...` | Restaurar archivo histórico exacto |
| `fact_reviews.status` | migration 250902 espera columna, 250901 no la crea | DEV conserva columna | presente | human review compat | `ORDERING_FAILURE` | fresh rebuild falla en 250902 línea 7 | Recuperar/corregir migration histórica previa exacta; no parchear ad hoc |
| `policy_source_registry` | no está en rama actual | creado por 25120000 | presente | `handlers.ts`, freeze RPCs | `DEV_ONLY` en rama actual / `MISSING_DEPENDENCY` | DEV table + grep runtime | Restaurar migration 25120000 o forward-only si no se restaura |
| `persist_policy_evaluation_v1` | solo GRANT en repo; no CREATE | creado por 25120000 | presente | engine persistence RPC | `MISSING_DEPENDENCY` | DEV def MD5 `4bcd...`; grep migration 26183000 | Restaurar 25120000 antes de GRANT |
| `fact_run_frozen_snapshots` | ausente en rama actual | creado por 25120000 | presente | fact sealing | `DEV_ONLY` / `MISSING_DEPENDENCY` | DEV columns + ledger objects | Restaurar 25120000 |
| `audit_evaluation_envelopes` | ausente en rama actual | creado por 25120000 | presente | evaluation snapshots | `DEV_ONLY` / `MISSING_DEPENDENCY` | DEV columns + ledger objects | Restaurar 25120000 |
| `ai_decision_snapshots` | ausente en rama actual | creado por 25120000 | presente | decision snapshots | `DEV_ONLY` / `MISSING_DEPENDENCY` | DEV columns + ledger objects | Restaurar 25120000 |

---

## 8. `policy_source_registry`

### 8.1 Naturaleza

`policy_source_registry` es una mezcla de responsabilidades:

- **metadata de procedencia:** `document_id`, `sha256`, `effective_from`, `effective_to`,
  `verified_by`, `verified_at`;
- **registry técnico:** unicidad por `document_id` y por `(policy_code, policy_version)`;
- **infraestructura de fact sealing:** se usa como fuente canónica de `policy_source_id`
  para snapshots/freeze;
- **configuración normativa ligera:** `status` distingue `CANONICAL`, `LEGACY`,
  `PENDING_VERIFICATION`, `SUPERSEDED`, pero no contiene reglas normativas ni reemplaza
  al policy engine.

### 8.2 Definición DEV

Columnas principales DEV:

- `id uuid primary key default gen_random_uuid()`;
- `policy_code text not null`;
- `policy_version text not null`;
- `document_id text not null unique`;
- `sha256 text not null` con check `^[a-f0-9]{64}$`;
- `status text not null` con enum-check textual;
- `effective_from date`, `effective_to date`;
- `verified_by uuid references auth.users(id) on delete set null`;
- `verified_at timestamptz`;
- `notes text`;
- `created_at timestamptz not null default now()`.

Constraints DEV:

- PK `policy_source_registry_pkey`;
- unique `policy_source_registry_document_identity`;
- unique `policy_source_registry_version_identity`;
- checks de `policy_code`, `policy_version`, `document_id`, `sha256`, `status`, rango
  efectivo y verificación de canonical.

RLS/Policies DEV:

- RLS enabled: `true`;
- FORCE RLS: `false`;
- `policy_source_registry_select_authenticated`: `SELECT TO authenticated USING (true)`;
- `policy_source_registry_owner_insert`: `INSERT TO authenticated WITH CHECK
  (current_app_role() = 'OWNER')`.

Grants DEV:

- `authenticated`: `SELECT`, `INSERT`;
- `project_admin`: DML/DDL-adjacent privileges (`SELECT`, `INSERT`, `UPDATE`, `DELETE`,
  `REFERENCES`, `TRIGGER`, `TRUNCATE`).

### 8.3 Readers/writers/dependencies

Runtime repo:

- `apps/web/src/server/jobs/handlers.ts` lee `policy_source_registry` por
  `document_id` para procedencia/fact sealing.
- `apps/web/src/server/jobs/audit-queue.e2e.test.ts` simula la tabla y valida que el
  `policy_source_id` esté registrado.

Funciones DEV que referencian la tabla:

- `backfill_legacy_frozen_snapshots_v1(p_policy_source_id text)`;
- `create_derived_fact_run_v1(...)`;
- `freeze_fact_run_v1(...)`;
- `policy_foundation_acl_probe()`.

Qué falla si no existe:

- `handlers.ts` no puede resolver la procedencia del documento normativo;
- `freeze_fact_run_v1` / `create_derived_fact_run_v1` no pueden validar source id;
- migrations posteriores solo hacen GRANT condicional, por lo que evitan fallar en DDL
  pero dejan runtime inconsistente.

No se elimina ni renombra en D6.

---

## 9. Objetos fantasma

Objetos presentes/esperados por DEV o runtime pero no producibles desde la rama actual:

- `policy_source_registry`;
- `fact_run_frozen_snapshots`;
- `audit_evaluation_envelopes`;
- `ai_decision_snapshots`;
- `persist_policy_evaluation_v1`;
- `freeze_fact_run_v1`;
- `create_derived_fact_run_v1`;
- `backfill_legacy_frozen_snapshots_v1`;
- `begin_fact_run_processing_v1` y otros RPCs de lifecycle/cost telemetry de las
  migrations 25160000/25200000.

---

## 10. Funciones/RPCs faltantes

DEV contiene `persist_policy_evaluation_v1`:

| Function | Args | Security definer | Language | DEV def MD5 |
|---|---|---:|---|---|
| `persist_policy_evaluation_v1` | `p_audit_id uuid, p_fact_run_id uuid, p_policy_code text, p_policy_version text, p_rules_fingerprint text, p_facts_fingerprint text, p_suggested_outcome text, p_outcome_status text, p_evaluation jsonb, p_evaluated_rules jsonb, p_envelope jsonb, p_envelope_hash text, p_owner_precedence_version text, p_created_by uuid` | true | `plpgsql` | `4bcd4cf3b7f7630a91803ac720f335f1` |

En el repo actual no existe `CREATE FUNCTION` para esta RPC. Solo hay referencias y un
`GRANT EXECUTE` en `20260926183000_integrity-gate-engine-write-boundary.sql`.

---

## 11. Fresh rebuild

Comando base usado para cada migration:

```bash
psql -v ON_ERROR_STOP=1 -h localhost -p 55432 -U postgres \
  -d cancelaciones_rebuild_platform -f migrations/<file>.sql
```

Orden: lexicográfico por filename en `migrations/*.sql`.

Resultado con shim de plataforma:

```text
FIRST_FAILURE_INDEX 21
FIRST_FAILURE_FILE 20260925090200_fact-reviews-schema-compat.sql
LAST_SUCCESS 20260925090100_fact-human-reviews.sql
ERROR: column "status" does not exist
LINE 2: SET decision = CASE status
```

Como la cadena no termina, no se comparó schema final repo-vs-DEV; no existe schema final
producido por repo.

---

## 12. Primer failure point

`20260925090200_fact-reviews-schema-compat.sql` asume una forma legacy de
`public.fact_reviews`:

```sql
UPDATE public.fact_reviews
SET decision = CASE status
  WHEN 'ACCEPTED' THEN 'VALID'
  WHEN 'REJECTED' THEN 'INVALID'
  ELSE NULL
END
WHERE decision IS NULL;
```

Pero `20260925090100_fact-human-reviews.sql` crea en la rama actual:

```sql
decision text NOT NULL CHECK (decision IN ('VALID', 'INVALID')),
corrected_value jsonb,
note text,
```

No crea `status`; por eso el rebuild falla antes incluso de llegar a las 6 migrations
faltantes.

---

## 13. PASS/BLOCKED

```text
BLOCKED
```

Motivo reproducible:

1. una DB vacía raw falla por dependencias de plataforma (`auth`/`system`);
2. una DB con shim mínimo de plataforma falla en migration 21 por `fact_reviews.status`;
3. la rama actual no contiene las 6 migrations históricas requeridas para alcanzar DEV;
4. runtime KEEP depende de objetos DEV que el repo actual no produce.

---

## 14. Alternativas de recuperación

### A. Restore historical migrations

Restaurar los 6 archivos SQL históricos exactos desde refs saneadas a `migrations/`.

Ventajas:

- conserva timestamps históricos;
- alinea repo con ledger DEV;
- evita reconstrucciones inventadas.

Condición previa:

- resolver antes el ordering failure `20260925090100`/`20260925090200` con evidencia
  histórica exacta o una forward-only migration clara.

### B. Forward-only reconciliation migration

Crear una nueva migration con timestamp nuevo que lleve una DB reconstruida al shape DEV.

Ventajas:

- no reusa timestamps antiguos si algún SQL histórico no se acepta como canónico;
- puede documentar explícitamente diferencias aceptadas.

Riesgo:

- no repara el hecho de que la cadena actual ni siquiera llega a completarse.

### C. Baseline V2

Crear una baseline nueva del schema DEV y declarar obsoleta la cadena histórica rota.

No recomendado todavía porque el SQL histórico de las 6 migrations sí fue recuperado.

### D. Combinación recomendada

1. Resolver el failure `fact_reviews.status` con evidencia histórica o migration
   forward-only mínima.
2. Restaurar las 6 migrations históricas exactas recuperadas.
3. Reejecutar fresh rebuild completo.
4. Comparar schema final contra DEV.
5. Solo si quedan gaps residuales, proponer reconciliation forward-only.

---

## 15. Recomendación

Recomendación primaria:

```text
restore historical migrations + targeted ordering repair
```

No ejecutar baseline V2 todavía.

No restaurar `20260924170500_finish-audit-48680`; fue un data dump con PII y no schema.

---

## 16. Archivos generados

- `docs/reports/db-reconciliation-report.md`

Artefactos no versionados usados temporalmente:

- contenedor Docker `cancelaciones-d6-pg` (`postgres:16-alpine`);
- DBs desechables `cancelaciones_rebuild` y `cancelaciones_rebuild_platform`.

No se generó dump textual enorme del schema DEV; la evidencia se obtuvo con consultas de
catálogo y se resume en este reporte.

---

## 17. Commits

Este reporte debe commitearse como documentación D6. No se modificaron migrations ni
código de runtime durante D6.

---

## 18. Blockers antes de Decision Tree Phase 1

No iniciar `docs/phase-prompts/rebuild-decision-tree-phase-1.md` hasta resolver:

1. cadena de migrations actual falla en `20260925090200_fact-reviews-schema-compat.sql`;
2. 6 migrations históricas recuperadas siguen ausentes de la rama actual;
3. `policy_source_registry` y RPCs de fact sealing/evaluation existen en DEV pero no son
   reproducibles desde repo actual;
4. `persist_policy_evaluation_v1` no tiene `CREATE FUNCTION` versionado en la rama actual;
5. no existe todavía comparación final repo-rebuild-vs-DEV porque el rebuild no termina.
