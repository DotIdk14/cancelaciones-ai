# Inmutabilidad de hechos: Fact Runs y snapshots congelados

> **ESTADO GLOBAL: la migración `migrations/20260925120000_policy-foundation-immutability.sql`
> está ESCRITA Y VERSIONADA pero NO APLICADA a ninguna base de datos.**
> Todo lo que en este documento aparece como *garantía de base de datos* está
> marcado **`NO APLICADA`**. El código de aplicación que la consume **sí existe** y
> sí está commiteado, y detecta la ausencia del objeto y degrada al comportamiento
> anterior con un código de aviso estable.
>
> **DB VALIDATION: BLOCKED.** El único backend InsForge configurado en el
> repositorio es el proyecto remoto base/producción (`appkey 4pw4jdzv`); la rama
> DEV `4pw4jdzv-cif` no tiene credenciales. Ninguna migración se ejecutó, ningún
> cliente de base de datos se abrió y ninguna aserción de trigger, ACL o RPC de
> este documento ha sido observada contra un Postgres real. Cada barrera
> descrita abajo está **escrita y revisada por lectura**, no **verificada por
> ejecución**.

---

## 1. El ciclo de vida de un Fact Run

```
                 ┌───────────────────────────────┐
                 │                               │
                 ▼                               │ (sólo lectura)
        ┌─────────────┐                          │
        │   DRAFT     │  ¿"re-congelar"? NO:      │
        └──────┬──────┘  no hay salida hacia    │
               │         atrás                  │
               │ CREATE                        │
               ▼                               │
        ┌──────────────┐                        │
        │  PROCESSING  │                        │
        └───┬──────┬───┘                        │
            │      │                           │
   UPDATE    │      │  UPDATE                   │
   state →   │      │  state →                  │
   FAILED    │      │  FAILED                   │
            │      │                            │
            │  UPDATE state → FROZEN           │
            │  + INSERT fact_run_frozen_       │
            │    snapshots (UNIQUE fact_run_id)│
            ▼      ▼                            │
        ┌─────────────┐                         │
        │   FAILED    │  (sin salida)            │
        └─────────────┘                         │
        ┌─────────────┐                         │
        │   FROZEN    │◄────────────────────────┘
        └──────┬──────┘   (no se vuelve a abrir)
               │
               │  NO se modifica: ni state, ni facts,
               │  ni fingerprints, ni provenance
               │
               │  create_derived_fact_run_v1(...)  ──►  NUEVO run DRAFT
               │                                        (parent_fact_run_id
               │                                         = este run,
               │                                         derivation_reason
               │                                         obligatorio)
               ▼
        ┌──────────────────────────────┐
        │  Fact Run DERIVADO           │  recorre DRAFT → PROCESSING → FROZEN
        │  + SU propio snapshot        │  con SU propio integrity_hash
        └──────────────────────────────┘
               │
               └──► el padre conserva SU fingerprint efectivo,
                    byte a byte (lo devuelve el RPC antes y después)
```

**La regla de `FROZEN`, en una frase:** un Fact Run `FROZEN` no recibe ni un
`UPDATE` y no admite ni un `INSERT` nuevo de hechos. No es un estado editable,
es un sello. La única forma de incorporar información nueva es crear otro Fact
Run que **declare a este como padre**, con motivo, autor e instante.

---

## 2. Columnas reales de `public.fact_extraction_runs`

Definición base: `migrations/20260923220000_phase-5-fact-model-shadow.sql:1-13`.
Columnas añadidas después, en migraciones **ya aplicadas**:

| Columna | Tipo | Origen | Estado |
|---|---|---|---|
| `id` | `uuid` PK `DEFAULT gen_random_uuid()` | `20260923220000:1` | aplicada |
| `audit_id` | `uuid NOT NULL` FK `audits(id)` `ON DELETE CASCADE` | `20260923220000:2` | aplicada |
| `policy_code` | `text NOT NULL` | `20260923220000:3` | aplicada |
| `policy_version` | `text NOT NULL` | `20260923220000:4` | aplicada |
| `extractor_version` | `text NOT NULL` | `20260923220000:5` | aplicada |
| `artifact_set_fingerprint` | `text NOT NULL` | `20260923220000:6` | aplicada |
| `state` | `text NOT NULL DEFAULT 'DRAFT'`, `CHECK (state IN ('DRAFT','PROCESSING','FAILED','FROZEN'))` | `20260923220000:8` | aplicada |
| `frozen_at` | `timestamptz` | `20260923220000:9` | aplicada |
| **`created_by`** | `uuid REFERENCES auth.users(id)` | `20260923220000:10` | aplicada |
| `created_at` / `updated_at` | `timestamptz` | `20260923220000:11-12` | aplicada |
| `policy_code_hash` | `text NOT NULL` | `20260924170400` | aplicada |
| `artifact_set_fingerprint_hash` | `text NOT NULL` | `20260924170450` | aplicada |

Columnas que añade la migración de inmutabilidad (`20260925120000`, §2,
líneas 171-211) — **todas `NO APLICADA`**:

| Columna | Tipo | Para qué |
|---|---|---|
| `parent_fact_run_id` | `uuid REFERENCES public.fact_extraction_runs(id) ON DELETE SET NULL` | Declara el run del que se deriva una corrección. Es la cadena de custodia: sin él, una "corrección" podría aparecer sin origen. |
| `derivation_reason` | `text` | Motivo obligatorio de la derivación. |
| `effective_facts_fingerprint` | `text` | Huella SHA-256 de los hechos **efectivos** (los que verá el motor, correcciones humanas incluidas). Es la prueba de que el padre no se movió al derivar el hijo. |

Restricciones que los acompañan (**`NO APLICADA`**):

- `fact_extraction_runs_derivation_check`:
  `parent_fact_run_id IS NULL OR (derivation_reason IS NOT NULL AND btrim(derivation_reason) <> '')`.
  Un run derivado **debe** justificar por qué existe. Las filas preexistentes
  tienen `parent_fact_run_id IS NULL`, así que el CHECK es seguro para ellas.
- `fact_extraction_runs_parent_not_self_check`: `parent_fact_run_id <> id`.
- `fact_extraction_runs_parent_idx`: índice parcial sobre `parent_fact_run_id`.
- `fact_extraction_runs_created_by_idx`: índice sobre `created_by`.

**`created_by` NO se añadió en esta migración.** Ya existía desde
`20260923220000:10`; añadirla otra vez habría producido una columna ambigua. Lo
que faltaba era el índice, y eso sí se añadió.

Restricción preexistente y crítica para la idempotencia
(**aplicada**): `fact_extraction_runs_idempotency_hash_idx` sobre
`(audit_id, policy_code_hash, policy_version, extractor_version,
artifact_set_fingerprint_hash)` (`20260924170450:32-39`). Los dos hashes largos
los calcula el trigger `fact_runs_long_hashes_on_write`.

---

## 3. `public.fact_run_frozen_snapshots`

**Tabla `NO APLICADA`.** Definida en `20260925120000`, §5, líneas 387-404.
Congela los hechos efectivos de un run en el instante en que pasa a `FROZEN`.

| Columna | Tipo y restricciones | Qué congela |
|---|---|---|
| `id` | `uuid` PK `DEFAULT gen_random_uuid()` | identidad de la fila |
| `audit_id` | `uuid NOT NULL` FK `audits(id)` `ON DELETE CASCADE` |dueño de la auditoría |
| `fact_run_id` | `uuid NOT NULL` FK `fact_extraction_runs(id)` `ON DELETE CASCADE` | run sellado |
| `facts` | `jsonb NOT NULL`, `CHECK jsonb_typeof(facts) = 'array'` | hechos canónicos tal como los verá el motor |
| `provenance` | `jsonb NOT NULL`, `CHECK jsonb_typeof(provenance) = 'object'` | de dónde viene cada hecho (`UNKNOWN` ≠ `FALSE`) |
| `fact_reviews_snapshot` | `jsonb NOT NULL DEFAULT '[]'`, `CHECK = 'array'` | revisiones humanas **tal como estaban** al sellar |
| `extractor_version` | `text NOT NULL`, `CHECK btrim <> ''` | qué extractor produjo los hechos |
| `policy_source_id` | `text NOT NULL`, `CHECK btrim <> ''` | `document_id` en `policy_source_registry` (FK lógica verificada por el RPC) |
| `canonical_facts_fingerprint` | `text NOT NULL`, `CHECK btrim <> ''` | huella de los hechos canónicos |
| `effective_facts_fingerprint` | `text NOT NULL`, `CHECK btrim <> ''` | huella de los hechos efectivos (con correcciones) |
| `fact_count` | `integer NOT NULL`, `CHECK >= 0` | invariante rápida y legible |
| `integrity_hash` | `text NOT NULL`, `CHECK integrity_hash ~ '^[a-f0-9]{64}$'` | SHA-256 del snapshot canónico completo |
| `frozen_by` | `uuid REFERENCES auth.users(id)` `ON DELETE SET NULL` | quién selló |
| `frozen_at` | `timestamptz NOT NULL DEFAULT now()` | instante del sellado |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | — |

### 3.1 La restricción `fact_run_frozen_snapshots_run_identity`

```sql
CONSTRAINT fact_run_frozen_snapshots_run_identity UNIQUE (fact_run_id)
```

`NO APLICADA`. Es la pieza que hace que "volver a congelar" sea **imposible** en
lugar de **duplicar evidencia**: como máximo un snapshot por Fact Run, así que
una segunda llamada al RPC falla en vez de escribir una segunda versión de los
hechos. Sin ella, un `DRAFT → PROCESSING → FROZEN` repetido produciría dos
snapshots del mismo run y "los hechos que alimentaron la evaluación" dejarían de
estar bien definidos.

Índices asociados (**`NO APLICADOS`**): `…_audit_created_idx` sobre
`(audit_id, created_at DESC)`, `…_canonical_fingerprint_idx` sobre
`canonical_facts_fingerprint`, y `…_integrity_hash_idx` sobre
**`left(integrity_hash, 63)`** — se indexa el prefijo de 63 bytes, no el hash
entero, para no depender del máximo de bytes por entrada de índice B-tree de la
versión de Postgres del backend (un SHA-256 son 64 bytes y rozan ese límite).

### 3.2 RLS y ACL de la tabla (**`NO APLICADOS`**)

- `ENABLE ROW LEVEL SECURITY`.
- `REVOKE ALL … FROM anon`; `REVOKE INSERT, UPDATE, DELETE … FROM authenticated`;
  `GRANT SELECT … TO authenticated`. La **única** vía de escritura es el RPC.
- Política `fact_run_frozen_snapshots_select_visible`, patrón literal del repo:

  ```sql
  EXISTS (SELECT 1 FROM public.audits
    WHERE audits.id = fact_run_frozen_snapshots.audit_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
  ```

- Trigger `fact_run_frozen_snapshots_append_only` (`BEFORE UPDATE OR DELETE` →
  `guard_append_only_row()`), que aborta con
  `APPEND_ONLY_TABLE: fact_run_frozen_snapshots`. El trigger cierra la escritura
  incluso al **propietario de la tabla**; el `REVOKE` sólo cierra al rol de
  cliente. Son barreras complementarias, ninguna sustituye a la otra.

---

## 4. Las transiciones de estado: exactamente cuáles se permiten

Trigger `guard_fact_run_transition`, función homónima,
`BEFORE UPDATE OF state ON public.fact_extraction_runs FOR EACH ROW`
(`20260925120000`, §3, líneas 233-257). **`NO APLICADO`.**

```sql
IF NEW.state = OLD.state THEN RETURN NEW; END IF;                 -- no-op: pasa
IF OLD.state = 'DRAFT'      AND NEW.state IN ('PROCESSING','FAILED') THEN RETURN NEW; END IF;
IF OLD.state = 'PROCESSING' AND NEW.state IN ('FROZEN','FAILED')    THEN RETURN NEW; END IF;
RAISE EXCEPTION 'FACT_RUN_STATE_TRANSITION_FORBIDDEN: % -> %', OLD.state, NEW.state;
```

| Desde \ Hacia | `DRAFT` | `PROCESSING` | `FROZEN` | `FAILED` |
|---|---|---|---|---|
| `DRAFT` | pasa (no cambia `state`) | **permitido** | **prohibido** | **permitido** |
| `PROCESSING` | **prohibido** | pasa (no cambia `state`) | **permitido** | **permitido** |
| `FROZEN` | **prohibido** | **prohibido** | pasa (pero otra barrera lo bloquea) | **prohibido** |
| `FAILED` | **prohibido** | **prohibido** | **prohibido** | pasa (pero otra barrera lo bloquea) |

Error: `FACT_RUN_STATE_TRANSITION_FORBIDDEN: <desde> -> <hacia>`.

### 4.1 La segunda barrera: `guard_frozen_fact_run_row`

`BEFORE UPDATE ON public.fact_extraction_runs FOR EACH ROW`
(`20260925120000`, §3, líneas 270-285). **`NO APLICADO`.**

```sql
IF OLD.state IN ('FROZEN','FAILED') THEN
  RAISE EXCEPTION 'FACT_RUN_IMMUTABLE_ROW: run % en estado %', OLD.id, OLD.state;
END IF;
RETURN NEW;
```

Este trigger es **más ancho** que el de transición y por eso es imprescindible:
el anterior sólo mira `state`, así que un `UPDATE` que no toque `state` — y que
cambie `artifact_set_fingerprint`, `extractor_version` o `policy_version` —
lo dejaría pasar. Y esas tres columnas son exactamente la identidad del índice de
idempotencia `fact_extraction_runs_idempotency_hash_idx`: mutarlas es redefinir
"qué es el mismo run". Con este segundo trigger, una fila `FROZEN` o `FAILED` no
admite **ningún** `UPDATE`.

### 4.2 El hueco deliberado (y su riesgo residual)

**`DELETE` sobre `fact_extraction_runs` NO está bloqueado por ningún trigger.**
Es una decisión consciente: `apps/web/src/server/jobs/audit-pipeline.dev-e2e.test.ts:40`
borra runs ya `FROZEN` en su `cleanup`, y ese archivo está commiteado como
correcto.

Lo que sí está cerrado es el rol de cliente: la sección 10 de la migración hace
`REVOKE UPDATE, DELETE ON public.facts, public.fact_extraction_runs FROM anon,
authenticated`. Es decir:

- El rol `authenticated` (la app) **no puede** borrar un run `FROZEN`.
- **El propietario de la tabla / un DDL / un cliente administrativo sí puede.**
  Ese hueco residual está documentado, no cerrado. Cerrarlo exige un
  `BEFORE DELETE` más una migración que actualice el `cleanup` del E2E de
  pipeline. **Decisión del propietario.**

Consecuencia adicional: el trigger de `facts` (ver §5) **permite** el borrado en
`CASCADE` cuando el padre ya no existe, siguiendo la convención ya establecida
en `public.prevent_protected_rule_child_mutation`
(`migrations/20260924220000:99-107`). Por tanto borrar el run padre puede
arrastrar sus hechos.

---

## 5. El bloqueo de `facts` cuando el run ya está congelado

Dos triggers sobre `public.facts`, ambos **`NO APLICADOS`**.

### 5.1 Bloqueo del `INSERT` (bloque de hechos congelados)

Trigger `facts_reject_frozen_run_insert` (`BEFORE INSERT FOR EACH ROW`) →
`guard_frozen_fact_run_insert()` (`20260925120000`, §4, líneas 304-324):

```sql
SELECT state INTO v_state FROM public.fact_extraction_runs WHERE id = NEW.run_id;
IF v_state = 'FROZEN' THEN
  RAISE EXCEPTION 'FACT_RUN_FROZEN_APPEND_ONLY: run %', NEW.run_id;
END IF;
RETURN NEW;
```

Error: `FACT_RUN_FROZEN_APPEND_ONLY: <run_id>`.

La función es `SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp`
porque **lee** el estado del padre y, sin el privilege escalation, un `INSERT`
de un rol sin permiso de `SELECT` sobre `fact_extraction_runs` vería `NULL` y
dejaría pasar el hecho.

Ya existía además una barrera anterior en RLS: la política
`facts_insert_visible_runs` (`migrations/20260924106000:19-26`) ya exigía
`r.state IN ('DRAFT','PROCESSING')`. El trigger añade lo que la RLS no puede
dar: también cierra al propietario de la tabla.

### 5.2 Bloqueo del `UPDATE` y del `DELETE`

Trigger `facts_guard_frozen_run_mutation` (`BEFORE UPDATE OR DELETE FOR EACH ROW`)
→ `guard_frozen_fact_run_mutation()` (`20260925120000`, §4, líneas 326-365):

```sql
-- run padre inexistente ⇒ el DELETE viene del CASCADE del propio padre: se permite
SELECT state INTO v_state FROM public.fact_extraction_runs WHERE id = v_run_id;
IF v_state IS NULL THEN RETURN OLD/NEW; END IF;
IF v_state IN ('FROZEN','FAILED') THEN
  RAISE EXCEPTION 'FACT_RUN_APPEND_ONLY: run % en estado %', v_run_id, v_state;
END IF;
```

Error: `FACT_RUN_APPEND_ONLY: <run_id> en estado FROZEN`.

`facts` sólo tiene `GRANT SELECT, INSERT` para `authenticated`
(`migrations/20260923220000:53`), así que para ese rol no había ningún
`UPDATE`/`DELETE` que revocar. Aun así la sección 10 los revoca explícitamente:
deja la intención escrita y sobrevive a un `GRANT` accidental futuro. La barrera
real es el trigger.

---

## 6. Los RPC de escritura

Ambos están definidos en `20260925120000` y ambos son **`NO APLICADOS`**.

| RPC | Ubicación | `SECURITY DEFINER` | `search_path` |
|---|---|---|---|
| `public.freeze_fact_run_v1(uuid, jsonb, jsonb, text, text, text, jsonb, integer)` | §11, líneas 780-929 | **sí** | `SET search_path = pg_catalog, public, pg_temp` |
| `public.create_derived_fact_run_v1(uuid, text, jsonb, jsonb, text, text, text, text, jsonb)` | §12, líneas 946-1147 | **sí** | `SET search_path = pg_catalog, public, pg_temp` |

Sobre el `search_path`: es la convención copiada literalmente de
`public.delete_audit` (`migrations/20260924180000:38`). Todas las referencias a
objetos dentro de las funciones `SECURITY DEFINER` están calificadas con `public.`
o `pg_catalog.`; las únicas no calificadas son `digest` (pgcrypto, instalado en
`public` por `migrations/20260921221309_phase-1-base-schema.sql:1`) y funciones de
`pg_catalog`.

`EXECUTE` está revocado a `PUBLIC` **y** a `anon`, y concedido a `authenticated`
con la firma completa explícita. Doble seguridad: aunque `anon` alcanzara el
función, `auth.uid()` sería `NULL` y abortaría con `AUTH_REQUIRED`.

### 6.1 `freeze_fact_run_v1`: la única forma de sellar

`RETURNS TABLE(out_snapshot_id, out_fact_run_id, out_audit_id,
out_canonical_facts_fingerprint, out_effective_facts_fingerprint, out_fact_count,
out_frozen_at)`.

Valida, **en este orden y en la misma transacción** (una sola llamada a una
función `plpgsql` es una sola transacción):

1. `auth.uid()` no nulo → `AUTH_REQUIRED`
2. `p_fact_run_id` no nulo → `FACT_RUN_ID_REQUIRED`
3. El run existe (`SELECT … FOR UPDATE`) → `FACT_RUN_NOT_FOUND`
4. La auditoría del run existe → `AUDIT_NOT_FOUND`
5. `audits.created_by = actor OR public.current_app_role() = 'OWNER'` → `FORBIDDEN`
6. `v_run.state = 'PROCESSING'` → **`FACT_RUN_NOT_PROCESSING: <state>`**
7. Payloads `jsonb` bien formados → `FACTS_PAYLOAD_INVALID`, `PROVENANCE_PAYLOAD_INVALID`, `FACT_REVIEWS_PAYLOAD_INVALID`
8. Hay hechos CRUDO persistidos (`count(*) FROM facts WHERE run_id = … > 0`) → `FACT_RUN_EMPTY`
9. El snapshot no va vacío → `FROZEN_SNAPSHOT_EMPTY`
10. Si el llamador declaró `p_fact_count`, coincide con el payload → `FACT_COUNT_MISMATCH`
11. Los dos fingerprints no van vacíos → `FACTS_FINGERPRINT_REQUIRED`
12. **`p_policy_source_id` existe como `document_id` en `policy_source_registry`** → `POLICY_SOURCE_NOT_REGISTERED: <id>`

Y sólo después calcula el `integrity_hash` **en el servidor**:

```sql
v_integrity_hash := encode(digest(jsonb_build_object(
  'auditId', v_run.audit_id, 'factRunId', v_run.id,
  'extractorVersion', v_run.extractor_version,
  'policySourceId', p_policy_source_id,
  'canonicalFingerprint', p_canonical_facts_fingerprint,
  'effectiveFingerprint', p_effective_facts_fingerprint,
  'facts', p_facts, 'provenance', p_provenance,
  'factReviews', p_fact_reviews_snapshot)::text, 'sha256'), 'hex');
```

que inserta el snapshot y sella el run en la misma transacción:

```sql
INSERT INTO public.fact_run_frozen_snapshots (…) VALUES (…);
UPDATE public.fact_extraction_runs
   SET state = 'FROZEN',
       frozen_at = v_snapshot.frozen_at,
       effective_facts_fingerprint = p_effective_facts_fingerprint
 WHERE id = v_run.id;
```

Dos decisiones que importan:

- **El hash lo calcula el servidor, no el llamador.** Si el llamador mandara su
  propio `integrity_hash`, podría sellar un snapshot cuyo hash no corresponde a
  sus bytes, y el hash dejaría de probar nada.
- **El `audit_id` se toma del run, nunca del llamador.** El RPC no lo recibe como
  parámetro; un par `audit_id`/`fact_run_id` incoherente no puede construirse.

### 6.2 `create_derived_fact_run_v1`: la corrección humana

`RETURNS TABLE(out_derived_fact_run_id, out_derived_snapshot_id,
out_parent_fact_run_id, out_parent_fingerprint_before,
out_parent_fingerprint_after)`.

Valida: `auth.uid()` → `AUTH_REQUIRED`; `p_parent_fact_run_id` no nulo;
`p_derivation_reason` no vacío → `DERIVATION_REASON_REQUIRED`; `p_facts` es array
no vacío con `fact_type` no vacío y `classification ∈ {OBSERVABLE,
HUMAN_CONFIRMED, HUMAN_CORRECTED}` → `DERIVED_FACTS_INVALID`;
`p_provenance` objeto; `p_fact_reviews_snapshot` array; `p_extractor_version` no
vacío; los dos fingerprints no vacíos; `p_policy_source_id` registrado; el padre
existe (`FOR SHARE`); **el padre está `FROZEN`** → `PARENT_FACT_RUN_NOT_FROZEN`;
**el padre tiene snapshot** → `PARENT_FROZEN_SNAPSHOT_MISSING`; autorización sobre
la auditoría del padre.

El run derivado hereda `audit_id`, `policy_code`, `policy_version` y
`artifact_set_fingerprint` del padre. Como el índice único de idempotencia
`(audit_id, policy_code_hash, policy_version, extractor_version,
artifact_set_fingerprint_hash)` deja **`extractor_version` como única variable
libre**, el RPC exige que difiera y da un error legible en vez de un `23505`
opaco:

```
DERIVED_RUN_IDEMPOTENCY_COLLISION: p_extractor_version debe diferir de la del padre (…)
```

Después recorre la máquina **legal** en vez de saltarse el guard: inserta el
run derivado en `DRAFT`, inserta los hechos, `UPDATE … SET state='PROCESSING'`,
inserta **su** snapshot con **su** `integrity_hash`, y `UPDATE … SET state='FROZEN'`.

**El padre no recibe ni un `UPDATE`.** Y para que el llamador pueda probarlo, el
RPC lee `effective_facts_fingerprint` del padre ANTES de cualquier escritura y lo
devuelve DESPUÉS:

```sql
RETURN QUERY SELECT v_derived.id, v_derived_snapshot.id, v_parent.id,
                    v_parent_fingerprint_before,
                    (SELECT effective_facts_fingerprint
                       FROM public.fact_extraction_runs WHERE id = v_parent.id);
```

El cliente aborta con `PARENT_FACT_RUN_MUTATED` si antes ≠ después.

---

## 7. Cómo lo consume el código de aplicación

Todo esto **existe y está commiteado**; lo que no existe es el otro lado de la
conexión (la tabla y los RPC en una base real).

| Pieza | Ruta | Qué hace |
|---|---|---|
| `freezeFactRunWithSnapshot` | `apps/web/src/server/facts/fact-run-snapshot.ts:412` | Sella vía `freeze_fact_run_v1` con `p_facts`, `p_provenance`, ambos fingerprints, `p_fact_reviews_snapshot` y `p_fact_count`. Sin RPC: recorre `DRAFT → PROCESSING → FROZEN` con `UPDATE` directos y avisa `FREEZE_FACT_RUN_RPC_ABSENT`. |
| `getFrozenEffectiveFacts` | `apps/web/src/server/facts/fact-run-snapshot.ts:278` | Devuelve los hechos efectivos con `source ∈ {SNAPSHOT, LEGACY_CAPTURED, LEGACY_REVIEW_APPLIED}`. |
| `deriveFactRunFromReviews` | `apps/web/src/server/facts/human-correction.ts:143` | Corrección humana como run derivado. |
| `isFoundationObjectMissing` / `warnFoundationDegradation` | `apps/web/src/server/facts/foundation-objects.ts:60,75` | Distingue **AUSENCIA** del objeto de **FALLO** de negocio. |
| `mapSnapshotFactsToPolicyFacts` | `apps/web/src/server/policy/frozen-fact-run.ts:107` | Proyecta el array sellado a `Fact[]` sin reinterpretar nada. |
| `createFactRepository.freezeRun` | `packages/db/src/index.ts:703` | Recorre la máquina legal **sin** snapshot. Queda un caller (`/api/dev/synthetic-case`) y es la forma de degradación. |
| `POST /api/audits/[auditId]/fact-runs` | `apps/web/src/app/api/audits/[auditId]/fact-runs/route.ts` | Llama a `freezeFactRunWithSnapshot`. |
| `POST /api/audits/[auditId]/fact-reviews` | `apps/web/src/app/api/audits/[auditId]/fact-reviews/route.ts` | Guarda la review y, si trae `correctedValue`, deriva el run. |

### 7.1 AUSENCIA ≠ FALLO

`isFoundationObjectMissing` devuelve `true` **sólo** para `PGRST202/204/205`,
`42P01`, `42883`, `42703`, los textos `undefined_table|function|column`,
`relation "…" does not exist`, `column "…" does not exist`,
`function … does not exist`, y el texto exacto `Unsupported rpc <fn>` que devuelve
el fake local `DurableDb`. Ante la duda devuelve `false`: **se prefiere propagar
un error a degradar en silencio**.

Un error de **negocio** del RPC (`AUTH_REQUIRED`, `FACT_RUN_EMPTY`, `FORBIDDEN`,
`POLICY_SOURCE_NOT_REGISTERED`, `FROZEN_SNAPSHOT_MISSING`,
`DERIVED_RUN_IDEMPOTENCY_COLLISION`…) **nunca degrada: se propaga**. Si se
confundieran los dos, un fallo de autorización se disfrazaría de "funciona
porque cayó al camino viejo", que es la clase de bug que borra evidencia de
máquina sin dejar rastro.

Códigos de degradación activos (todos grepeables como
`[policy-foundation:<CÓDIGO>]`):

| Código | Cuándo |
|---|---|
| `FROZEN_SNAPSHOT_TABLE_ABSENT` | la tabla `fact_run_frozen_snapshots` no existe (el caso real de hoy) |
| `FROZEN_SNAPSHOT_CAPTURE_NOT_PERSISTED` | el `INSERT` de la captura legacy fue rehusado |
| `FREEZE_FACT_RUN_RPC_ABSENT` | `freeze_fact_run_v1` no existe |
| `DERIVE_FACT_RUN_RPC_ABSENT` | `create_derived_fact_run_v1` no existe |
| `DERIVED_FACT_RUN_FINGERPRINT_COLUMN_ABSENT` | `effective_facts_fingerprint` no existe aún |
| `PERSIST_POLICY_EVALUATION_RPC_ABSENT` | `persist_policy_evaluation_v1` no existe |

### 7.2 La puerta que protege los outcomes (R-8)

Sin snapshot, `getFrozenEffectiveFacts` devuelve **exactamente** lo que devolvía
`evaluation.ts` antes: mismo `listFactsByRun`, mismo filtro de la review más
reciente con decisión `INVALID`, misma sustitución de `value` por
`corrected_value`, en ese orden. El filtro y el `map` se mantienen como **dos
pasos separados y en ese orden** a propósito: invertirlos cambiaría
`evaluation.factsFingerprint` y, con él, la identidad del `engine_run`.

La eliminación de la aplicación retrospectiva de reviews ocurre **únicamente** en
la rama `SNAPSHOT`, que sólo puede alcanzarse después de aplicar la migración.
Por eso hoy, en el único entorno real, **ningún outcome puede cambiar por esta
vía**.

---

## 8. El hueco conocido: un run `FROZEN` legacy no tiene cómo escribir su snapshot

**Este es el punto más importante de este documento, y sigue abierto.**

`freeze_fact_run_v1` exige `state = 'PROCESSING'` (línea 835-837). Un run ya
`FROZEN`:

- no cumple esa precondición;
- **no tiene salida** hacia `PROCESSING` (`guard_fact_run_transition` no admite
  retroceder);
- `create_derived_fact_run_v1` no sirve, porque exige padre `FROZEN` **y**
  padre **con** snapshot (`PARENT_FROZEN_SNAPSHOT_MISSING`).

Por tanto: **un Fact Run que ya estaba `FROZEN` antes de la migración no tiene
ninguna ruta de escritura de snapshot a través de la API de aplicación.**

Qué hace el código hoy, exactamente:

1. `getFrozenEffectiveFacts` detecta que la tabla existe pero el run no tiene
   snapshot → rama `LEGACY_CAPTURED`.
2. Calcula los hechos efectivos (los que habría visto la máquina), calcula
   `canonicalFactsFingerprint` y `effectiveFactsFingerprint` y **intenta** un
   `INSERT` directo en `fact_run_frozen_snapshots` (`persistLegacyCapture`,
   `fact-run-snapshot.ts:224`).
3. Con la migración aplicada ese `INSERT` está **revocado** para el rol
   `authenticated` (`REVOKE INSERT, UPDATE, DELETE … FROM authenticated`), así
   que **falla**.
4. La captura es **mejor esfuerzo deliberado**: el cálculo ya es correcto, así
   que no se rompe el pipeline; se emite `FROZEN_SNAPSHOT_CAPTURE_NOT_PERSISTED`
   y el resultado lleva `persistenceError` con el mensaje del servidor.

**Consecuencia honesta:** mientras no haya snapshot, las revisiones humanas **siguen
aplicándose en vivo** para los runs congelados antes de la migración, y
`effective_facts_fingerprint` sigue siendo `NULL` en esas filas. El sellado
retroactivo de esos runs **no está resuelto**.

Cerrarlo requiere trabajo que **no está hecho** y que es **decisión del
propietario**: un RPC nuevo (por ejemplo
`capture_legacy_frozen_snapshot_v1`, que acepte un run `FROZEN` bajo
autorización del dueño de la auditoría) o un `backfill` con DDL. La alternativa
—dejarlo así— es coherente con `UNKNOWN_IS_NOT_FALSE` si se dice en voz alta, pero
deja la garantía de inmutabilidad a medias para el histórico.

**Detalle adicional, no resuelto:** el `integrity_hash` de una captura legacy lo
calcula la **aplicación**
(`sha256(stableFingerprint({auditId, factRunId, extractorVersion, policySourceId,
canonical, effective, facts, provenance, factReviews}))`,
`fact-run-snapshot.ts:235`), no el servidor. Es una fórmula distinta de la del
RPC (`jsonb_build_object(...)::text` sobre el texto de `jsonb`), así que **las
dos no son comparables entre sí**. Mitigación: la `provenance` de esos snapshots
lleva `origin: 'IMPORTED'`, lo que los distingue de los sellados por el servidor.
**El hash no ha sido verificado contra un Postgres real.**

---

## 9. Qué hace una corrección humana, y qué no puede hacer nunca

### 9.1 Lo que sí hace

Cuando `POST /api/audits/[auditId]/fact-reviews` recibe un `correctedValue`:

1. Guarda la review en `fact_reviews` (append-only). Esto **no** cambia ningún
   hecho ya evaluado.
2. Llama a `deriveFactRunFromReviews` con `factId`, `correctedValue`, la review,
   el `actorId` y el `policySourceId`.
3. `deriveFactRunFromReviews` **verifica** que el run padre exista, pertenezca a
   la auditoría y esté `FROZEN` (`HUMAN_CORRECTION_PARENT_NOT_FROZEN`), y que el
   hecho esté en los hechos efectivos del padre
   (`HUMAN_CORRECTION_FACT_NOT_IN_SNAPSHOT`).
4. Toma como base **los hechos sellados del padre**, no "lo que la última review
   dejó a medias" — eso es lo que garantiza que la corrección se acumule sobre
   una base estable.
5. Sustituye el valor del hecho corregido, marca ese hecho con
   `classification: 'HUMAN_CORRECTED'` y actualiza su `provenance` con
   `extractionMethod: 'HUMAN'`, `origin: 'HUMAN_CORRECTION'`, `corrected: true` y
   el `reviewId`.
6. Llama a `create_derived_fact_run_v1` con
   `p_derivation_reason = 'HUMAN_CORRECTION: <factType>'`,
   `p_extractor_version = '<padre>+human-correction'` (garantiza por construcción
   que difiere de la del padre, y por tanto que no choca con el índice de
   idempotencia), y **los dos fingerprints**: el canónico (lo que habría visto la
   máquina) y el efectivo (lo que verá con la corrección). Son distintos y
   ambos no vacíos, porque el RPC exige ambos.
7. Comprueba que el `effective_facts_fingerprint` del padre es idéntico antes y
   después. Si no, aborta con `PARENT_FACT_RUN_MUTATED`.
8. Devuelve `derivedFactRunId` en la respuesta y el padre queda intacto.

### 9.2 Lo que no puede hacer nunca

- **No puede reescribir el run padre.** Ni su `state`, ni sus hechos, ni su
  `extractor_version`, ni su `artifact_set_fingerprint`, ni su `integrity_hash`.
  El test correspondiente comprueba esas cinco columnas.
- **No puede cambiar un outcome ya registrado.** El run derivado **no se evalúa
  automáticamente**: crear una corrección no mueve ninguna evaluación existente.
  El motor tiene que correr de nuevo, y esa corrida nueva parte de hechos
  distintos y por tanto genera un `engine_run` distinto (distinta
  `facts_fingerprint`).
- **No puede decidir el resultado.** La corrección cambia **hechos**, nunca
  reglas ni outcomes. `AI_EXTRACTS` y `POLICY_ENGINE_DECIDES` siguen siendo
  responsabilidades separadas.
- **No puede aplicarse retroactivamente cuando hay snapshot.** Ése es el corte
  de R-8: con snapshot, `getFrozenEffectiveFacts` no vuelve a consultar
  `fact_reviews`. Sin snapshot, sí, y por eso se considera un modo degradado
  declarado, no el correcto.

### 9.3 Semántica de la respuesta cuando la derivación falla

Si la derivación falla, la review **ya está guardada** y es append-only. El route
devuelve **201** con `derivedFactRunId: null` y un bloque
`derivation: { status: 'FAILED', code, message }`, más un aviso en el log. No
devuelve 500 a propósito: un 500 invitaría al cliente a reintentar y duplicaría
evidencia. Sin `correctedValue`, la respuesta conserva su forma anterior con
`derivation: { status: 'NOT_APPLICABLE', code: 'NO_CORRECTED_VALUE' }`.

---

## 10. Interacción con `delete_audit`: conflicto conocido, sin resolver

`public.delete_audit(uuid, text)` (`migrations/20260924180000:24-94`) borra la
fila de `audits` y deja que el FK arrastre en `CASCADE`. La cascada toca, en
orden de dependencia, las tablas hoja primero: `fact_run_frozen_snapshots`,
`ai_decision_snapshots`, `audit_evaluation_envelopes`, después `facts`, después
`fact_extraction_runs`.

**Con la migración aplicada, esa cascada aborta.** En cuanto una auditoría tenga
cualquiera de los tres snapshots, `delete_audit` falla. Los triggers que disparan,
en orden:

| Orden | Trigger | Error |
|---|---|---|
| 1 | `fact_run_frozen_snapshots_append_only` (`BEFORE DELETE`) | `APPEND_ONLY_TABLE: fact_run_frozen_snapshots` |
| 2 | `ai_decision_snapshots_append_only` | `APPEND_ONLY_TABLE: ai_decision_snapshots` |
| 3 | `audit_evaluation_envelopes_append_only` | `APPEND_ONLY_TABLE: audit_evaluation_envelopes` |
| 4 | `facts_guard_frozen_run_mutation` (sólo si el padre sigue existiendo) | `FACT_RUN_APPEND_ONLY` |

**Dos opciones, ninguna elegida. `REQUIRES_OWNER_DECISION`:**

- **(a) Aceptar que no se puede borrar** una auditoría con fact run `FROZEN`.
  *Coste:* no hay ruta de borrado para el caso "esta auditoría se creó por error",
  que es exactamente el caso que motivó `delete_audit`. *Beneficio:* coherente
  con `PRESERVE_MACHINE_DECISION`; cero riesgo de perder evidencia de máquina.
- **(b) Ruta de purga explícita y registrada.** Una migración posterior
  redefine `delete_audit` (o añade `purge_audit`) que antes de borrar escriba en
  `audit_log` —que sobrevive al borrado por `ON DELETE SET NULL`
  (`20260924180000:12-17`)— el inventario de lo que se va a eliminar, y que para
  las filas inmutables exija un flag/motivo explícito y quizá rol `OWNER`.
  *Coste:* abre una vía de borrado de evidencia de máquina. *Beneficio:*
  conserva la capacidad de borrar duplicados reales.

Mientras tanto, el producto tiene un botón que va a fallar. Eso hay que
resolverlo **antes** de aplicar la migración, no después de que alguien pulse.

**Efecto colateral ya visible:** el `cleanup` del E2E de DEV
(`apps/web/src/server/jobs/audit-pipeline.dev-e2e.test.ts:35-46`) borra en
cascada esas mismas tablas; con la migración aplicada pasará a ser no-op
silencioso y dejará residuo en DEV.

---

## 11. Resumen de lo verificado y lo no verificado

| Afirmación | Mecanismo | ¿Aplicado? |
|---|---|---|
| Un run `FROZEN`/`FAILED` no admite ningún `UPDATE` | trigger `guard_frozen_fact_run_row` | **`NO APLICADA`** |
| `FROZEN` y `FAILED` no tienen salida de estado | trigger `guard_fact_run_transition` | **`NO APLICADA`** |
| No se insertan hechos nuevos en un run `FROZEN` | trigger `facts_reject_frozen_run_insert` + RLS `facts_insert_visible_runs` | **`NO APLICADA`** (la RLS sí) |
| `facts` de un run `FROZEN`/`FAILED` no se muta | trigger `facts_guard_frozen_run_mutation` | **`NO APLICADA`** |
| Un run tiene como máximo un snapshot | `UNIQUE (fact_run_id)` = `fact_run_frozen_snapshots_run_identity` | **`NO APLICADA`** |
| El snapshot no se actualiza ni se borra | `REVOKE` + trigger `fact_run_frozen_snapshots_append_only` | **`NO APLICADA`** |
| El rol `authenticated` no borra un run `FROZEN` | `REVOKE DELETE … FROM anon, authenticated` (§10) | **`NO APLICADA`** |
| El propietario de la tabla **sí** puede borrar un run `FROZEN` | ausencia deliberada de `BEFORE DELETE` | hueco abierto, documentado |
| El `integrity_hash` corresponde a los bytes sellados | `digest(...)` calculado en el servidor dentro del RPC | **`NO APLICADA`** |
| Una corrección deja el padre intacto | `create_derived_fact_run_v1` no hace `UPDATE` al padre + `PARENT_FACT_RUN_MUTATED` en cliente | **`NO APLICADA`** (la parte de aplicación, verificada por test unitario) |
| Los outcomes no cambian mientras no haya snapshot | rama `LEGACY_REVIEW_APPLIED` byte-equivalente | **aplicada** (verificada por test) |
| Un run `FROZEN` legacy no tiene ruta de escritura de su snapshot | §8 | **hueco abierto, `REQUIRES_OWNER_DECISION`** |
| `delete_audit` fallará con fact run `FROZEN` | §10 | **hueco abierto, `REQUIRES_OWNER_DECISION`** |

**Ningún trigger, ACL, política RLS ni RPC de este documento ha sido ejecutado
contra un Postgres.** La verificación del SQL es estructural (balanceo de `$$`,
sentencias de nivel superior terminadas, variables sin declarar, columnas
existentes con el tipo correcto, leídas una por una contra las migraciones ya
aplicadas) y por lectura comparada, **no por ejecución**. El E2E
`apps/web/src/server/policy/fact-run-snapshot.dev-e2e.test.ts` está escrito para
ser la primera ejecución real, y hoy no puede correr: **`BLOCKED`** por
`DEV_INFRA_NOT_CONFIGURED`.

---

## 12. Limitaciones conocidas y pendientes

Lo que sigue no está arreglado. Se documenta para que nadie lo descubra en
producción, y **no se ha cambiado el comportamiento de ningún endpoint** para
taparlo.

### 12.1 Una corrección humana crea filas de verdad, y no esinerte

`POST /api/audits/[auditId]/fact-reviews` con `correctedValue` no es hoy una
anotación pasiva: materializa un **`fact_extraction_runs` derivado** más sus
**filas `facts`** y lo deja `FROZEN`
(`deriveFactRunFromReviews`, `apps/web/src/server/facts/human-correction.ts:143`).
Con la migración sin aplicar lo hace con `INSERT`/`UPDATE` directos
(`human-correction.ts:259-298`); con ella, vía `create_derived_fact_run_v1`.

**Eso no cambia ningún outcome hoy, y conviene decir por qué:** nadie encola una
evaluación para el run derivado. `runPolicyEngineForAudit` no se llama desde la
ruta de correcciones, así que el run derivado queda sin `engine_run` y el
resultado del run padre no se mueve. Es inerte a propósito: `AI_EXTRACTS` y
`POLICY_ENGINE_DECIDES` siguen siendo responsabilidades separadas y una
corrección no puede decidir nada (§9.2).

**El efecto secundario que no es evidente:** una **segunda** corrección desde el
**mismo padre** choca contra el índice único de idempotencia
`fact_extraction_runs_idempotency_hash_idx (audit_id, policy_code_hash,
policy_version, extractor_version, artifact_set_fingerprint_hash)`. La razón es
estructural, no un accidente: las cinco columnas se derivan del padre y la
`extractor_version` derivada es **determinista** —
`derivedExtractorVersion` (`human-correction.ts`) devuelve exactamente
`` `${parentExtractorVersion}+human-correction` ``, sin contador ni sufijo
variable. Dos correcciones sobre el mismo padre producen, por tanto, la misma
tupla.

Cuando el RPC está disponible esto no ocurre: `create_derived_fact_run_v1` lo
detecta antes y devuelve el error legible
`DERIVED_RUN_IDEMPOTENCY_COLLISION` (§6.2). Cuando el RPC **no** está —el caso
de hoy, con la migración sin aplicar— no hay nadie que lo compruebe y el
`INSERT` choca con el `23505` de Postgres.

**Cómo se manifiesta:** el error se captura en el `catch` de la ruta y la
respuesta es **HTTP 201** con `derivedFactRunId: null`, `derivation.status:
'FAILED'`, `code: 'DERIVED_FACT_RUN_FAILED'` y el mensaje real de Postgres, más
un `console.warn`
(`apps/web/src/app/api/audits/[auditId]/fact-reviews/route.ts:101-108`). La
review queda guardada y es append-only, que es lo correcto; lo que se pierde es
el run derivado.

**Por qué está así y no se cambió:** un 500 invitaría al cliente a reintentar y
duplicaría evidencia (§9.3). El coste real es de **observabilidad**: un `23505`
esperado llega al operador como si fuera un fallo de derivación, y nada en la
respuesta distingue "el padre ya tenía una corrección" de "la derivación se
rompió". **Pendiente, no decidido:** o un sufijo único por corrección en
`extractor_version` (rompe la reproducibilidad del índice), o una comprobación
previo que traduzca el `23505` a un código propio, o devolver el run derivado ya
existente. Ninguna de las tres está implementada y **ninguna se ha decidido aquí**:
cambia la semántica de la idempotencia.
