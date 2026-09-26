# D7 — DB History Restoration & Reproducibility

**Fecha:** 2026-09-26  
**Alcance:** restauración de historia SQL auténtica y reproducibilidad de schema  
**Resultado final:** `BLOCKED`  
**Decision Tree Phase 1:** no ejecutado.

---

## 1. Estado D6 inicial

D6 quedó cerrado con resultado aceptado:

```text
BLOCKED
```

D6 demostró que el repo actual no era una fuente reproducible de la DB y localizó un
primer failure reproducible:

```text
20260925090200_fact-reviews-schema-compat.sql
ERROR: column "status" does not exist
```

También demostró una ventaja importante: las 6 migrations ausentes tenían SQL histórico
exacto recuperable desde refs saneadas y ledger DEV.

D7 no inicia Rule Engine V2, no implementa Decision Tree y no recupera runtime legacy.

---

## 2. Las 6 migrations recuperadas

Se restauraron exactamente 6 archivos históricos al directorio `migrations/`:

| Version | Archivo restaurado | Fuente saneada | Blob histórico | SHA-256 archivo | Bytes |
|---|---|---|---|---|---:|
| `20260925120000` | `20260925120000_policy-foundation-immutability.sql` | `feature/policy-foundation-tasks-8-12` | `8205bd87e450` | `a5ef37b80d3c7de8` | 74780 |
| `20260925140000` | `20260925140000_policy-foundation-security-closure.sql` | `archive/origin-main` | `941c809f12a8` | `53bf1e8e7d6032e7` | 10952 |
| `20260925150000` | `20260925150000_fix-legacy-snapshot-fact-shape.sql` | `archive/origin-main` | `7107c5bb47d1` | `ed2877427c6e766b` | 5484 |
| `20260925160000` | `20260925160000_pipeline-lifecycle-and-cost-guard.sql` | `archive/origin-main` | `d0302fc491b2` | `85526071753a2786` | 14393 |
| `20260925161000` | `20260925161000_restore-fact-run-processing-state.sql` | `archive/origin-main` | `20814aa0331e` | `62096227333214a9` | 4151 |
| `20260925200000` | `20260925200000_cost-telemetry-contract.sql` | `archive/origin-main` | `a6433a887816` | `ffe8dad7236c9f7a` | 15733 |

No se restauró `20260924170500_finish-audit-48680.sql` porque D5/D6 lo clasificaron como
volcado accidental de datos con PII, no schema.

---

## 3. Evidencia de identidad

Para cada archivo se verificó antes de restaurar:

- timestamp exacto;
- nombre exacto;
- path histórico;
- blob Git histórico en ref saneada;
- SHA-256 de contenido;
- tamaño en bytes;
- ausencia de PII real conocida.

Comandos reproducibles usados:

```bash
git rev-parse <ref>:migrations/<file>.sql
git show <ref>:migrations/<file>.sql | sha256sum
git cat-file -s <blob>
```

La restauración fue por `git restore --source=<ref> -- <path>`, sin edición manual.

No se modernizó SQL, no se cambió formato, no se agregaron guards, no se combinaron
migrations y no se eliminaron objetos legacy.

---

## 4. Archivos restaurados

Commit de restauración histórica:

```text
a66bcdb db: restore recovered historical migrations
```

Archivos:

- `migrations/20260925120000_policy-foundation-immutability.sql`
- `migrations/20260925140000_policy-foundation-security-closure.sql`
- `migrations/20260925150000_fix-legacy-snapshot-fact-shape.sql`
- `migrations/20260925160000_pipeline-lifecycle-and-cost-guard.sql`
- `migrations/20260925161000_restore-fact-run-processing-state.sql`
- `migrations/20260925200000_cost-telemetry-contract.sql`

---

## 5. Fresh rebuild #2

DB desechable: contenedor Docker `postgres:16-alpine`, DB
`cancelaciones_rebuild_d7`.

Shims mínimos de plataforma InsForge, explícitamente identificados:

- schema `auth`;
- tabla mínima `auth.users(id uuid primary key)`;
- schema `system`;
- roles `anon`, `authenticated`, `project_admin`, `service_role`;
- extension `pgcrypto`;
- función `auth.uid()` retornando `null::uuid`;
- función trigger `system.update_updated_at()`.

No se creó manualmente ningún objeto de app.

Orden ejecutado: 36 migrations en orden lexicográfico por filename.

Resultado:

```json
{
  "total_migrations": 36,
  "status": "FAIL",
  "first_failure_index": 21,
  "first_failure_file": "20260925090200_fact-reviews-schema-compat.sql",
  "last_success": "20260925090100_fact-human-reviews.sql"
}
```

Error exacto:

```text
psql:migrations/20260925090200_fact-reviews-schema-compat.sql:12:
ERROR:  column "status" does not exist
LINE 2: SET decision = CASE status
```

---

## 6. Diferencia respecto al failure de D6

No cambió el primer failure.

La restauración de las 6 migrations históricas no podía afectar este punto porque sus

La hipótesis D6 de “historial incompleto posterior” queda descartada para este failure
concreto. El fallo es anterior a las 6 migrations recuperadas.

---

## 7. Primer failure restante

Failure restante:

```text
20260925090200_fact-reviews-schema-compat.sql
```

La migration contiene:

```sql
UPDATE public.fact_reviews
SET decision = CASE status
  WHEN 'ACCEPTED' THEN 'VALID'
  WHEN 'REJECTED' THEN 'INVALID'
  ELSE NULL
END
WHERE decision IS NULL;
```

Pero la migration previa del repo crea `fact_reviews` sin `status`:

```sql
decision text NOT NULL CHECK (decision IN ('VALID', 'INVALID')),
corrected_value jsonb,
note text,
```

Se verificó contra ledger DEV que `20260925090100` aplicado en DEV tampoco creaba
`status`; su statement `CREATE TABLE IF NOT EXISTS public.fact_reviews (...)` contiene
`decision`, `corrected_value`, `note`, pero no `status`.

Clasificación:

```text
IMPLICIT_DEV_STATE
ORDERING_ERROR
```

Interpretación: `20260925090200` dependía de que `fact_reviews` ya existiera en DEV con
una forma legacy que incluía `status`. Esa precondición no está representada por la cadena
de migrations del repo ni por `system.custom_migrations` inmediatamente anterior.

No se modificó `20260925090200`.

---

## 8. Schema comparison rebuilt ↔ DEV

No se ejecutó comparación final completa porque no existe schema rebuilt completo: la
cadena se detiene en la migration 21.

Comparar un schema parcial contra DEV sería engañoso para el gate final. La comparación
estructural completa queda bloqueada hasta que la cadena pueda finalizar sin intervención
manual.

---

## 9. `policy_source_registry`

La migration restaurada `20260925120000_policy-foundation-immutability.sql` contiene la
creación histórica de `policy_source_registry` junto con la infraestructura de fact
sealing/evaluation:

- `policy_source_registry`;
- `fact_run_frozen_snapshots`;
- `audit_evaluation_envelopes`;
- `ai_decision_snapshots`;
- RPCs como `freeze_fact_run_v1`, `create_derived_fact_run_v1` y
  `persist_policy_evaluation_v1`.

Sin embargo, Fresh Rebuild #2 no alcanza esa migration por el failure en `250902`.

Estado D7:

```text
policy_source_registry: HISTORICAL_SQL_RESTORED_BUT_CHAIN_BLOCKED_BEFORE_CREATION
```

No se fabricó retrospectivamente ninguna migration para ella.

---

## 10. Drift restante

Drift estructural restante no se puede medir exhaustivamente porque la cadena no termina.

Drift/fallo demostrado:

| Object | Rebuilt | DEV | Match | Difference | Runtime relevance |
|---|---|---|---|---|---|
| `public.fact_reviews.status` | ausente antes de `250902` | presente en DEV | no | migration `250902` lee `status` pero repo no lo crea antes | human review compatibility |
| `public.policy_source_registry` | no alcanzado | presente en DEV | no evaluable | SQL histórico restaurado, pero bloqueado antes | fact sealing/source provenance |
| `persist_policy_evaluation_v1` | no alcanzado | presente en DEV | no evaluable | SQL histórico restaurado, pero bloqueado antes | engine persistence RPC |

---

## 11. Forward-only migrations necesarias

No se creó ninguna forward-only migration en D7.

Una migration forward-only con timestamp actual **no resolvería** el primer failure de
fresh rebuild, porque se ejecutaría después de `20260925090200`, es decir demasiado tarde
para crear `fact_reviews.status` antes de que se lea.

Opciones futuras honestas:

1. **Encontrar una migration histórica anterior faltante** que cree `fact_reviews.status`.
   D7 no la encontró en las refs saneadas inspeccionadas ni en el ledger alrededor de
   `250901/250902`.
2. **Aceptar que hay una migration histórica rota para rebuild desde cero** y decidir una
   estrategia de baseline/reconciliation documentada.
3. **Crear baseline V2** del schema esperado y abandonar la promesa de replay completo de
   la historia antigua.
4. **Editar una migration histórica ya aplicada** solo como último recurso consciente,
   pero eso contradice la regla D7 de no falsificar historia.

Recomendación: no intentar un forward-only fix hasta decidir explícitamente cómo tratar
el estado implícito de `fact_reviews.status`.

---

## 12. Gate PASS/BLOCKED

```text
BLOCKED
```

Motivo reproducible:

- empty DB + shims mínimos de plataforma;
- repo migrations restauradas (36 total);
- ejecución en orden;
- failure en `20260925090200_fact-reviews-schema-compat.sql`;
- causa: dependencia de `fact_reviews.status` no representada en la cadena histórica.

No se obtuvo PASS mediante intervención manual.

---

## 13. Gates de aplicación

Después de restaurar migrations históricas se verificó que la frontera normativa sigue
siendo explícita:

```text
AUDIT_ENGINE_NOT_IMPLEMENTED
```

Gates ejecutados:

| Gate | Resultado |
|---|---|
| `pnpm typecheck` | `PASS` |
| `pnpm lint` | `PASS` |
| `pnpm test` | `PASS` — 114 tests |
| `pnpm build` | `PASS` |

Restaurar migrations históricas no restauró runtime legacy ni autorizó outcomes,
confidence o interpretación normativa.

---

## 14. Commits

Commits D7:

1. `a66bcdb db: restore recovered historical migrations`
2. commit documental de este reporte: pendiente al momento de redactar; debe contener
   solo `docs/reports/db-reproducibility-restoration-report.md`.

---

## 15. Blockers antes de Decision Tree Phase 1

No iniciar `docs/phase-prompts/rebuild-decision-tree-phase-1.md` hasta resolver uno de
estos caminos:

1. encontrar/restaurar historia auténtica anterior que explique `fact_reviews.status`;
2. aprobar explícitamente una estrategia de baseline/reconciliation que no pretenda replay
   completo de la historia rota;
3. repetir fresh rebuild hasta completar la cadena;
4. comparar schema rebuilt completo contra DEV;
5. comprobar que la app inicia sobre ese schema manteniendo
   `AUDIT_ENGINE_NOT_IMPLEMENTED` como frontera normativa.
