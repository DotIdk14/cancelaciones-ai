# Base de datos — Cancelaciones AI

Este documento describe el esquema real de PostgreSQL/InsForge, migración por migración.
Todas las migraciones son **forward-only** y se aplican en orden lexicográfico (timestamp).

## Orden de aplicación

| Orden | Archivo | Propósito |
|---|---|---|
| 1a (base vacía) o 1b (producción legacy) | `migrations/00000000000000_baseline.sql` | Esquema AI-native limpio sobre base vacía. **Aborta** si detecta tablas legacy. |
| 1b (producción legacy) | `migrations/20260928010000_ai-native-production.sql` | Crea las mismas 3 tablas sobre una base con esquema legacy; renombra la vieja `audits` a `legacy_audits`. |
| 2 | `migrations/20260929040000_audit-dashboard-metrics.sql` | Vista de métricas de auditoría para dashboard. |
| 3 | `migrations/20260930010000_human-resolution.sql` | Tablas de revisión humana y comparación. |
| 4 | `migrations/20260930020000_human-review-dashboard-metrics.sql` | Vista de métricas de comparaciones para dashboard. |
| 5 | `migrations/20261001010000_case-reviewer-name.sql` | Columna `reviewer_name` en `case_reviews`. |
| 6 | `migrations/20261002000000_auth_core.sql` | Tabla `app_memberships` e índice adicional para scoping. |

> En una instalación limpia se aplica el baseline (1a). En la base de producción existente se salta el baseline y se aplica `20260928010000_ai-native-production.sql` (1b), que es idempotente y no borra datos legacy.

## Resumen de objetos

### Tablas principales

| Tabla | Columnas clave | Propósito |
|---|---|---|
| `public.cases` | `id`, `status`, `student_identifier`, `created_by`, `created_at`, `updated_at` | Expediente y ciclo de vida. |
| `public.evidence` | `id`, `case_id`, `filename`, `mime_type`, `size_bytes`, `hash`, `storage_path`, `processing_status`, `transcript_json`, `created_at` | Metadatos de archivos; el binario vive en Storage. |
| `public.audits` | `id`, `case_id`, `status`, `provider`, `model`, `evidence_fingerprint`, `attempt_number`, `deadline_at`, `provider_metadata`, `result_json`, `error_category`, `latency_ms`, `created_at` | Intento de auditoría; `result_json` es la única fuente de verdad del dictamen. |
| `public.case_reviews` | `id`, `case_id` UNIQUE, `audit_id`, `result`, `reviewer_name`, `comment`, `created_at`, `created_by` | Resolución humana final; una por caso. |
| `public.case_comparisons` | `id`, `case_review_id` UNIQUE, `audit_id`, `status`, `result_json`, `provider`, `model`, `error_category`, `latency_ms`, `attempt_count`, `deadline_at`, `created_at`, `updated_at` | Juicio de la IA sobre dictamen vs. decisión humana. |
| `public.app_memberships` | `user_id` PK, `role` | Roles de acceso a la aplicación (`user` o `coordinator`). |

### Vistas

| Vista | Fuente | Propósito |
|---|---|---|
| `public.audit_dashboard_metrics` | `audits` + `cases` | Proyección de escalares (resultado, confianza, coste, tokens, latencia, modelos) para el dashboard. |
| `public.case_comparisons_dashboard_metrics` | `case_comparisons` + `case_reviews` + `cases` + `audits` | Proyección de comparaciones (`agrees`, `confidence`, `audit_result`, etc.). |

### Índices

| Índice | Tabla | Propósito |
|---|---|---|
| `cases_created_by_created_at_idx` | `cases` | Listado por dueño y orden temporal. |
| `cases_created_by_id_idx` | `cases` | Scoping rápido por dueño (creado en `auth_core.sql`). |
| `evidence_case_id_created_at_idx` | `evidence` | Listar evidencias de un caso. |
| `evidence_hash_idx` | `evidence` | Consulta por hash (NO único, por diseño). |
| `audits_case_id_created_at_idx` | `audits` | Historial de auditorías del caso. |
| `audits_case_id_fingerprint_created_at_idx` | `audits` | Reutilización por fingerprint. |
| `audits_one_running_per_case_fingerprint_idx` | `audits` | UNIQUE parcial `WHERE status = 'RUNNING'`; evita dos RUNNING concurrentes. |
| `audits_created_at_idx` | `audits` | Filtros por fecha del dashboard. |
| `case_comparisons_created_at_idx` | `case_comparisons` | Filtros por fecha del dashboard. |

### Triggers

| Trigger | Tabla | Función |
|---|---|---|
| `cases_set_updated_at` | `cases` | `public.set_updated_at()` — asigna `NEW.updated_at = now()` en cada UPDATE. |
| `case_comparisons_set_updated_at` | `case_comparisons` | Igual, para reflejar reintentos/rearms. |

## Migraciones en detalle

### `00000000000000_baseline.sql`

- **Prerrequisitos**: `CREATE EXTENSION IF NOT EXISTS pgcrypto`.
- **Guardia previa**: aborta con `AI_NATIVE_BASELINE_LEGACY_PRESENT` si encuentra tablas del esquema retirado.
- **Tablas**: `public.cases`, `public.evidence`, `public.audits` con CHECKs de estado.
- **Índices**: los 4 índices principales de la tabla anterior (sin contar `audits_created_at_idx`, que viene luego).
- **Función**: `public.set_updated_at()` con `search_path = pg_catalog, public, pg_temp`.
- **Privilegios**:
  - `REVOKE ALL` a `anon` y `authenticated` sobre las 3 tablas.
  - `GRANT SELECT, INSERT, UPDATE, DELETE` a `authenticated` y `project_admin`.
- **RLS**: habilitada en las 3 tablas; 12 políticas (4 por tabla) para el rol `authenticated`.
- **Verificación**: 13 controles que fallan la migración si el esquema no queda exactamente como se describe.

### `20260928010000_ai-native-production.sql`

- **Propósito**: aplicar el esquema AI-native sobre una base que ya tiene el esquema legacy.
- **Preservación**: si `audits` tiene `external_case_id` y no `case_id`, la renombra a `legacy_audits`.
- Crea las 3 tablas del producto (idénticas al baseline), índices, trigger y 12 políticas.
- **Cambio importante respecto al baseline**: `ALTER TABLE public.cases ALTER COLUMN created_by DROP NOT NULL`. Esto permite migrar casos históricos huérfanos mientras se resuelve su custodio.
- Verifica columnas, RLS, políticas, privilegios, FKs y trigger.

### `20260929040000_audit-dashboard-metrics.sql`

- Crea `public.audit_dashboard_metrics` (vista).
- Crea `public.audits_created_at_idx`.
- Revoca todo a `anon`, `authenticated` y `PUBLIC`; otorga `SELECT` solo a `project_admin`.
- La vista no pasa por RLS, por eso no se concede a `authenticated`.

### `20260930010000_human-resolution.sql`

- Crea `public.case_reviews` y `public.case_comparisons`.
- `case_reviews.case_id` UNIQUE; `case_comparisons.case_review_id` UNIQUE.
- FKs:
  - `case_reviews.case_id` → `cases(id) ON DELETE CASCADE`
  - `case_reviews.audit_id` → `audits(id) ON DELETE RESTRICT`
  - `case_comparisons.case_review_id` → `case_reviews(id) ON DELETE CASCADE`
  - `case_comparisons.audit_id` → `audits(id) ON DELETE RESTRICT`
- Trigger `case_comparisons_set_updated_at`.
- 6 políticas RLS (3 por tabla) para `authenticated`.
- Privilegios: solo `project_admin` tiene `SELECT, INSERT, UPDATE`; `anon`/`authenticated`/`PUBLIC` no tienen nada.

### `20260930020000_human-review-dashboard-metrics.sql`

- Crea `public.case_comparisons_dashboard_metrics`.
- Crea/asegura `case_comparisons_created_at_idx`.
- Grant solo a `project_admin`.

### `20261001010000_case-reviewer-name.sql`

- `ALTER TABLE public.case_reviews ADD COLUMN IF NOT EXISTS reviewer_name text`.
- Nullable para conservar revisiones históricas creadas antes del campo.

### `20261002000000_auth_core.sql`

- Crea `public.app_memberships`:
  - `user_id uuid PRIMARY KEY REFERENCES auth.users(id)`
  - `role text NOT NULL CHECK (role IN ('user','coordinator'))`
- Habilita RLS; no se crean políticas para `authenticated`.
- `REVOKE ALL` a `anon` y `authenticated`; `GRANT SELECT` solo a `project_admin`.
- Crea `cases_created_by_id_idx` para acelerar el scoping por dueño.

## Políticas RLS

### `cases`

| Política | Comando | Expresión |
|---|---|---|
| `cases_select_own` | SELECT | `created_by = auth.uid()` |
| `cases_insert_own` | INSERT | `created_by = auth.uid()` |
| `cases_update_own` | UPDATE | `USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid())` |
| `cases_delete_own` | DELETE | `created_by = auth.uid()` |

### `evidence` y `audits`

Ambas tablas usan EXISTS sobre `public.cases` con la misma regla de dueño:

```sql
EXISTS (
  SELECT 1 FROM public.cases
  WHERE cases.id = evidence.case_id
    AND cases.created_by = auth.uid()
)
```

Cada una tiene SELECT, INSERT, UPDATE y DELETE.

### `case_reviews`

| Política | Comando | Expresión |
|---|---|---|
| `case_reviews_select_own` | SELECT | `created_by = auth.uid()` |
| `case_reviews_insert_own` | INSERT | `created_by = auth.uid()` |
| `case_reviews_update_own` | UPDATE | `USING/WITH CHECK created_by = auth.uid()` |

### `case_comparisons`

Visibility por EXISTS sobre `case_reviews`:

```sql
EXISTS (
  SELECT 1 FROM public.case_reviews
  WHERE case_reviews.id = case_comparisons.case_review_id
    AND case_reviews.created_by = auth.uid()
)
```

Políticas: SELECT, INSERT, UPDATE.

### `app_memberships`

RLS habilitada pero **sin políticas**. El único rol con privilegio es `project_admin` (BYPASSRLS), así que la aplicación server-side lee los roles mientras que cualquier acceso directo desde `authenticated` devuelve cero filas.

## Cliente administrativo y defensa en profundidad

- `src/server/insforge.ts` crea un cliente con `createAdminClient({ apiKey: INSFORGE_API_KEY })`. Este rol (`project_admin`) tiene BYPASSRLS y puede leer/escribir cualquier fila.
- La RLS no es la frontera primaria; lo es el hecho de que **el navegador nunca habla con InsForge**. La RLS existe como segundo muro en caso de fuga de token/cookie.
- Todas las consultas del backend usan el cliente admin, pero el scoping se implementa en código (`getScopedCaseOr404`, `assertCaseOwner`) con la misma regla: dueño o coordinador.

## Forward-only y rollback

- Las migraciones no incluyen `BEGIN/COMMIT`; el runner de InsForge envuelve cada archivo en su propia transacción.
- No hay scripts de rollback automático. Para deshacer un cambio se aplica una nueva migración que corrige hacia adelante.
