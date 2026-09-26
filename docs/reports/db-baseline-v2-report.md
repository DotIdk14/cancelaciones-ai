# D8 — Baseline V2 report

**Fecha:** 2026-09-26  
**Resultado final:** `PASS`  
**Decision Tree / Rule Engine V2:** no iniciado.  
**Normative boundary:** `AUDIT_ENGINE_NOT_IMPLEMENTED` preservada.

---

## 1. Why legacy replay was abandoned

D6 y D7 probaron que la cadena legacy no es una fuente reproducible honesta:

- D7 restauró exactamente las 6 migrations históricas recuperables.
- Fresh rebuild #2 siguió fallando antes de llegar a ellas.
- El failure reproducible quedó en `20260925090200_fact-reviews-schema-compat.sql`:

```text
ERROR: column "status" does not exist
```

El ledger confirmó que `20260925090100_fact-human-reviews` tampoco creaba `status`. Por
tanto, `20260925090200` dependía de estado implícito de DEV no representado por historia
reproducible.

D8 no edita ni borra migrations legacy. Baseline V2 es una línea nueva de inicialización
para runtime clean-slate.

---

## 2. Runtime DB inventory

Inventario construido desde consumidores reales actuales (`packages/db`, routes y jobs):

| Object | Classification | Runtime consumer |
|---|---|---|
| `profiles` | `V2_REQUIRED` | roles/current_app_role/API profile reads |
| `audits` | `V2_REQUIRED` | audit CRUD, health check |
| `evidences` | `V2_REQUIRED` | upload, listing, jobs |
| `audit_log` | `V2_REQUIRED` | delete trace/log list |
| `audit_manual_comments` | `V2_REQUIRED` | manual comments repository |
| `jobs`, `job_attempts`, `job_artifacts` | `V2_REQUIRED` | durable job queue |
| `fact_extraction_runs`, `facts`, `fact_reviews` | `V2_REQUIRED` | fact extraction and review storage |
| `policy_source_registry` | `V2_REQUIRED_TRANSITIVE_DEPENDENCY` | fact sealing/provenance lookup |
| `fact_run_frozen_snapshots` | `V2_REQUIRED_TRANSITIVE_DEPENDENCY` | `freeze_fact_run_v1` output |
| `rules`, `evidence_requirements` | `V2_REQUIRED` | evidence requirements governance; not normative interpretation |
| `audit_evidence_selection` | `V2_REQUIRED` | evidence selection repository |
| `audit_runs` | `V2_REQUIRED` | run tracking |
| `dictamen_documents` | `V2_REQUIRED` | PDF document registry |
| `ai_usage` | `V2_REQUIRED` | usage/cost telemetry |

Excluded examples: `engine_runs`, `engine_rule_results`, `audit_evaluation_envelopes`,
`ai_decision_snapshots`, `shadow_*`, `human_reference_*`, `historical_references`,
`report_snapshots`. They are `LEGACY_ONLY` for V2 unless a future runtime consumer proves
otherwise.

---

## 3. V2 target schema

Target schema is documented in:

```text
docs/db/baseline-v2.md
```

Artifact SQL files:

- `db/baseline-v2/000_provider-shims.sql`
- `db/baseline-v2/001_baseline-v2.sql`
- `db/baseline-v2/002_technical-seed.sql`
- `db/baseline-v2/003_schema_assertions.sql`
- `db/baseline-v2/004_runtime_smoke.sql`

Validated local result:

| Metric | Value |
|---|---:|
| public base tables | 20 |
| public functions count observed | 45 |
| public policies | 7 |

Function count includes extension-visible public functions in the disposable DB; required
functions are asserted explicitly by name.

---

## 4. Included/excluded objects

Included objects are only the current clean-slate KEEP runtime and transitive dependencies.

Excluded legacy objects remain in old migrations/DEV but not in Baseline V2. DEV may keep
them during adoption; V2 compatibility compares only the V2 contract, not absence of
legacy extras.

---

## 5. Transitive dependencies

`policy_source_registry` is included because `freeze_fact_run_v1` validates
`policy_source_id` and jobs handlers resolve policy source provenance.

`fact_run_frozen_snapshots` is included because it is the durable output of fact sealing.

Provider dependencies are isolated to local shims:

- `auth.users`;
- `auth.uid()`;
- roles;
- `system.update_updated_at()`;
- `pgcrypto`.

---

## 6. `policy_source_registry`

Evaluated by consumer, not name.

Classification:

```text
V2_REQUIRED_TRANSITIVE_DEPENDENCY
```

Reason:

- `apps/web/src/server/jobs/handlers.ts` reads it for policy source/provenance.
- `freeze_fact_run_v1` validates its `document_id` before freezing.

It is not treated as normative rule content and does not implement GDM logic.

---

## 7. Provider contracts/shims

Local shims are in `db/baseline-v2/000_provider-shims.sql` and are **not** for DEV/PROD.

They simulate only the minimal InsForge-owned contract needed by app-owned SQL.

---

## 8. Baseline artifact + SHA-256

Artifact commit:

```text
b7f07ac33c96ea664dacc68a402009ed8c5c302a
```

Combined artifact SHA-256:

```text
b4abace815ca2e7542fc987384236fc6da722abcd866c8a3bae13346ba53a0fe
```

Validated PostgreSQL:

```text
PostgreSQL 16.15 via postgres:16-alpine
```

---

## 9. Technical seeds

`002_technical-seed.sql` inserts only deterministic technical rows:

- synthetic owner in `auth.users`;
- owner profile;
- placeholder policy source key for `GDM_GAM_PRD_MLG_003`.

No real DEV data and no PII are copied.

---

## 10. Fresh V2 rebuild result

Executed from an empty disposable DB:

```text
empty DB
→ provider shims
→ Baseline V2
→ technical seed
→ schema assertions
→ runtime smoke
```

Result:

```text
PASS
```

Schema assertions returned zero rows and completed without exception.

Runtime smoke returned zero rows and completed without exception.

---

## 11. Schema assertions

Assertions cover:

- required tables;
- required columns;
- required functions/RPCs;
- required indexes;
- RLS enabled on key tables;
- required policies;
- required grants.

File:

```text
db/baseline-v2/003_schema_assertions.sql
```

---

## 12. DEV compatibility

Only the V2 contract was compared against DEV. DEV may contain legacy extras.

Required V2 tables checked against DEV: 19/19 present.

Not required in DEV compatibility:

- `schema_baseline_v2_manifest` because it is a Baseline V2 lineage marker for fresh V2
  DBs, not a current DEV object.

---

## 13. Existing DB adoption plan

Do **not** apply the full Baseline V2 to existing DEV.

Adoption strategy:

1. Keep DEV as legacy lineage.
2. Use Baseline V2 for new empty environments.
3. For existing DEV/PROD, create forward-only reconciliation migrations if needed.
4. Compare DEV against the V2 contract and only add missing V2-required objects/columns.
5. Remove legacy-only objects only after dependency analysis and separate forward-only
   deprecation/drop migrations.

---

## 14. Future migration strategy

All future DB changes must be forward-only on top of Baseline V2.

Do not edit legacy migrations to obtain green rebuilds.

Do not add Rule Engine V2 tables until Decision Tree Phase 1+ explicitly defines the
normative inventory and DB contract.

---

## 15. App gates

Required app gates after adding Baseline V2 artifacts:

| Gate | Result |
|---|---|
| `pnpm typecheck` | `PASS` |
| `pnpm lint` | `PASS` |
| `pnpm test` | `PASS` — 114 tests |
| `pnpm build` | `PASS` |

Fresh verification was executed after creating the Baseline V2 artifact and docs.

---

## 16. PII scan

Baseline SQL artifact scan:

- real PII known from D5: 0 occurrences;
- emails present: only `baseline-owner@example.invalid`;
- no DEV data copied.

---

## 17. Commits

Commits D8:

1. `b7f07ac db: add baseline v2 rebuild artifacts`
2. documentation commit for this report: pending when drafted; see Git history after commit.

---

## 18. Final gate

```text
empty DB
→ provider shims
→ Baseline V2
→ expected V2 schema
→ clean-slate runtime
→ PASS
```

Final status:

```text
PASS
```

Decision Tree and Rule Engine V2 remain not started.
