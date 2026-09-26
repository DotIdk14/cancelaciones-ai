# Baseline V2 — DB rebuild contract

**Version:** `baseline-v2`  
**Artifact commit:** `b7f07ac33c96ea664dacc68a402009ed8c5c302a`  
**Combined artifact SHA-256:** `b4abace815ca2e7542fc987384236fc6da722abcd866c8a3bae13346ba53a0fe`  
**Validated PostgreSQL:** `postgres:16-alpine` (`PostgreSQL 16.15`)  
**Scope:** clean-slate KEEP runtime database contract only.

> Nota de vocabulario: este documento usa “Fresh V2 rebuild” o “inicialización V2”, no
> “bootstrap”, para evitar confusión con Bootstrap CSS. No se introduce Bootstrap UI; la
> UI del proyecto sigue en el stack existente.

---

## Purpose

Baseline V2 abandona el replay completo de la cadena legacy rota y define una nueva
línea de inicialización reproducible:

```text
empty DB
→ provider shims mínimos
→ Baseline V2
→ technical seed
→ schema assertions
→ runtime smoke
```

No reescribe historia. Las migrations legacy quedan intactas. Cualquier cambio futuro de
DB debe ser forward-only sobre Baseline V2.

---

## Artifact files

| Orden | Archivo | SHA-256 | Rol |
|---:|---|---|---|
| 0 | `db/baseline-v2/000_provider-shims.sql` | `2d185c5ef99c9e71bf32ba8231d875a32b0eddec6297b0ff954fd746ff129fc0` | Shims mínimos de InsForge para DB local desechable |
| 1 | `db/baseline-v2/001_baseline-v2.sql` | `0f108fbae6ce01e6c5aa9bd830b2078f3aa9369bf32a56fbeb2968692d338628` | Schema app-owned V2 |
| 2 | `db/baseline-v2/002_technical-seed.sql` | `f3fea88d6e2771b1ae8385c8e2461b0161bddb0f85e26c5cfe72a6db4b8b6879` | Seed técnico determinístico, sin datos reales |
| 3 | `db/baseline-v2/003_schema_assertions.sql` | `e11ab4944a854079aa3f51147bd7744ddcd4017feef2b5d384f7cac090c6b400` | Assertions de tablas, columnas, funciones, RLS, policies, grants |
| 4 | `db/baseline-v2/004_runtime_smoke.sql` | `221dc2f9a99692bc256e3ed1639d82cd9548cddf1db98fb3a5d4f2b48bf6b839` | Smoke test SQL de runtime clean-slate |

---

## Provider assumptions

Baseline V2 separa objetos del proveedor de objetos app-owned.

Los shims locales crean solo:

- schema `auth`;
- schema `system`;
- roles `anon`, `authenticated`, `project_admin`, `service_role`;
- tabla mínima `auth.users`;
- función `auth.uid()`;
- función `system.update_updated_at()`;
- extension `pgcrypto`.

No deben aplicarse a DEV/PROD InsForge.

---

## V2 required app-owned objects

Clasificación por consumidores runtime actuales:

| Object | Classification | Rationale |
|---|---|---|
| `profiles` | `V2_REQUIRED` | authz/roles (`current_app_role`) |
| `audits` | `V2_REQUIRED` | auditorías base, health check, UI |
| `evidences` | `V2_REQUIRED` | upload/list/process evidence |
| `audit_log` | `V2_REQUIRED` | trazabilidad y delete audit |
| `audit_manual_comments` | `V2_REQUIRED` | comentarios manuales KEEP |
| `jobs`, `job_attempts`, `job_artifacts` | `V2_REQUIRED` | durable queue y artifacts |
| `fact_extraction_runs`, `facts`, `fact_reviews` | `V2_REQUIRED` | extracción/hechario, no motor normativo |
| `policy_source_registry` | `V2_REQUIRED_TRANSITIVE_DEPENDENCY` | requerido por `freeze_fact_run_v1` y handlers para provenance/fact sealing |
| `fact_run_frozen_snapshots` | `V2_REQUIRED_TRANSITIVE_DEPENDENCY` | salida de `freeze_fact_run_v1` |
| `rules`, `evidence_requirements` | `V2_REQUIRED` | governance/evidence requirements UI, no interpreta GDM |
| `audit_evidence_selection` | `V2_REQUIRED` | selección de evidencias para reportes |
| `audit_runs` | `V2_REQUIRED` | tracking de runs, frontera actual no evalúa reglas |
| `dictamen_documents` | `V2_REQUIRED` | workflow de documentos PDF |
| `ai_usage` | `V2_REQUIRED` | telemetría de costo/uso |

Objetos legacy excluidos: `engine_runs`, `engine_rule_results`, `audit_evaluation_envelopes`,
`ai_decision_snapshots`, `shadow_*`, `human_reference_*`, `historical_references`,
`report_snapshots`, y tablas/rpcs del policy engine legacy. Si algún objeto vuelve a ser
necesario, debe entrar por una migration forward-only nueva con justificación.

---

## Rebuild command

Ejemplo local:

```bash
export PGPASSWORD=postgres
for f in \
  db/baseline-v2/000_provider-shims.sql \
  db/baseline-v2/001_baseline-v2.sql \
  db/baseline-v2/002_technical-seed.sql \
  db/baseline-v2/003_schema_assertions.sql \
  db/baseline-v2/004_runtime_smoke.sql; do
  psql -v ON_ERROR_STOP=1 -h localhost -p 55434 -U postgres -d baseline_v2 -f "$f"
done
```

Expected result:

```text
schema assertions: 0 rows
runtime smoke: 0 rows
```

---

## Normative boundary

Baseline V2 no implementa reglas normativas. La frontera sigue siendo:

```text
AUDIT_ENGINE_NOT_IMPLEMENTED
```

No se crea Decision Tree, Rule Engine V2, outcomes ni confidence.
