# Base de datos — Cancelaciones AI

Este documento describe el esquema PostgreSQL/InsForge, migración por migración.
El historial remoto y el esquema observado no están completamente sincronizados;
consulta [`MIGRATION-RECONCILIATION.md`](MIGRATION-RECONCILIATION.md) antes de
aplicar SQL. No ejecutes `up --all` en producción hasta resolver esa conciliación.

## Secuencia histórica

| Orden | Archivo | Propósito |
|---|---|---|
| 1a (base vacía) o 1b (producción legacy) | `migrations/00000000000000_baseline.sql` | Esquema AI-native limpio sobre base vacía. **Aborta** si detecta tablas legacy. |
| 1b (producción legacy) | `migrations/20260928010000_ai-native-production.sql` | Crea las mismas 3 tablas sobre una base con esquema legacy; renombra la vieja `audits` a `legacy_audits`. |
| 2 | `migrations/20260929040000_audit-dashboard-metrics.sql` | Vista de métricas de auditoría para dashboard. |
| 3 | `migrations/20260930010000_human-resolution.sql` | Tablas de revisión humana y comparación. |
| 4 | `migrations/20260930020000_human-review-dashboard-metrics.sql` | Vista de métricas de comparaciones para dashboard. |
| 5 | `migrations/20260930120000_case-metadata-and-human-reviews.sql` | Añade las dimensiones del caso (`country`, `campus`, `modality`, `project`, `responsible`, `guideline`) y recrea la vista de métricas. |
| 6 | `migrations/20261001010000_case-reviewer-name.sql` | Columna `reviewer_name` en `case_reviews`. |
| 7 | `migrations/20261002000000_auth_core.sql` | Tabla `app_memberships` e índice adicional para scoping. |
| 8 | `migrations/20261003000000_paid-admissions.sql` | Tabla `request_admissions` + RPC `admit_or_reject_quota` (cuotas atómicas). |
| 9 | `migrations/20261003010000_derived-extractions.sql` | Columnas `extracted_text` y `extraction_pipeline_version` en `evidence`. |
| 10 | `migrations/20261005010000_case-area-comments.sql` | Tabla `case_area_comments` (bitácora por área, UPSERT por `(case_id, area)`). |
| 11 | `migrations/20261005120000_origin-country-channel.sql` | Proyección de `cases.country`/`cases.channel` y recreación de la vista de métricas. |
| 12 | `migrations/20261008090000_case-cycle-start-date-human.sql` | Cuatro columnas `cycle_start_date*` en `cases` (dato humano, no evidencia). |
| 13 | `migrations/20261008100000_membership-role-manager.sql` | Amplía el `CHECK` de `app_memberships.role` a `user`/`coordinator`/`manager`. |
| 14 | `migrations/20261008110000_case-test-flag.sql` | Columna `cases.is_test boolean NOT NULL DEFAULT false`. |
| 15 | `migrations/20261008120000_case-review-coordinator-decision.sql` | Cinco columnas del coordinador en `case_reviews` + dos `CHECK`. |
| 16 | `migrations/20261008130000_dashboard-view-test-owner-scope.sql` | Recrea las dos vistas de dashboard con `created_by` e `is_test` (34 y 11 columnas). |
| 17 | `migrations/20261009100000_case-list-pagination-indexes.sql` | Índices para paginación por fecha y estado; pendiente de verificar en la base existente. |
| 18 | `migrations/20261009110000_case-area-comments-authenticated-policy.sql` | Limita explícitamente las tres políticas de comentarios a `authenticated`; pendiente de staging y aprobación. |

> Esta tabla documenta los archivos y sus dependencias históricas; no es una
> instrucción para ejecutarlos en el estado remoto actual. El baseline solo
> cubre las tablas principales y no representa el esquema completo vigente.
>
> Las migraciones recientes traen `DO $verify$`.
> Estas comprobaciones no registran la migración; no se debe aplicar DDL por un
> ejecutor alterno que omita el ledger oficial.

## Resumen de objetos

### Tablas principales

| Tabla | Columnas clave | Propósito |
|---|---|---|
| `public.cases` | `id`, `status`, `student_identifier`, `created_by`, `created_at`, `updated_at`, `is_test`, `country`, `channel`, `campus`, `modality`, `project`, `responsible`, `guideline`, `cycle_start_date`, `cycle_start_date_by`, `cycle_start_date_at`, `cycle_start_date_by_name` | Expediente y ciclo de vida. `is_test` (default `false`) marca pruebas; `country`/`channel` son proyecciones del dictamen; `campus`/`modality`/`project`/`responsible`/`guideline` son dimensiones del caso; las `cycle_start_date*` son un dato humano con procedencia. |
| `public.evidence` | `id`, `case_id`, `filename`, `mime_type`, `size_bytes`, `hash`, `storage_path`, `processing_status`, `transcript_json`, `extracted_text`, `extraction_pipeline_version`, `created_at` | Metadatos de archivos; el binario vive en Storage. Las columnas derivadas cachean la extracción sin tocar el original. |
| `public.audits` | `id`, `case_id`, `status`, `provider`, `model`, `evidence_fingerprint`, `attempt_number`, `deadline_at`, `provider_metadata`, `result_json`, `error_category`, `latency_ms`, `created_at` | Intento de auditoría; `result_json` es la única fuente de verdad del dictamen. |
| `public.case_reviews` | `id`, `case_id` UNIQUE, `audit_id`, `result`, `reviewer_name`, `comment`, `created_at`, `created_by`, `coordinator_decision`, `coordinator_resolution`, `coordinator_created_by`, `coordinator_created_at`, `coordinator_comment` | Resolución humana de dos etapas: una por caso. `result` es la decisión del Asesor (inmutable); las columnas `coordinator_*` son la finalización del Coordinador (`APPROVE`/`CHANGE`). |
| `public.case_comparisons` | `id`, `case_review_id` UNIQUE, `audit_id`, `status`, `result_json`, `provider`, `model`, `error_category`, `latency_ms`, `attempt_count`, `deadline_at`, `created_at`, `updated_at` | Juicio de la IA sobre dictamen vs. decisión humana. |
| `public.case_area_comments` | `id`, `case_id`, `area`, `comment`, `created_by`, `created_at`, `updated_at`, UNIQUE `(case_id, area)` | Bitácora por área (Back Office, HelpDesk, Servicios Escolares, Finanzas, Adicional). No participa en el dictamen. |
| `public.app_memberships` | `user_id` PK, `role` | Roles de acceso a la aplicación (`user` = Asesor, `coordinator`, `manager`). |
| `public.request_admissions` | `id`, `subject_hash`, `user_id`, `operation`, `context_hash`, `admitted_at` | Admisiones de cuota (login/paid) sin Redis; el sujeto va hasheado. |

### Vistas

| Vista | Fuente | Propósito |
|---|---|---|
| `public.audit_dashboard_metrics` | `audits` + `cases` + `case_human_reviews` | Proyección de escalares (resultado, confianza, coste, tokens, latencia, modelos, dimensiones del caso) para el dashboard. **34 columnas**; las dos últimas son `created_by` e `is_test`, para que el scope del Asesor y la exclusión de pruebas viajen en el SQL. |
| `public.case_comparisons_dashboard_metrics` | `case_comparisons` + `case_reviews` + `cases` + `audits` | Proyección de comparaciones (`agrees`, `confidence`, `audit_result`, etc.). **11 columnas**; las dos últimas son `created_by` e `is_test`. |

Las dos vistas las recrea `20261008130000_dashboard-view-test-owner-scope.sql` para añadir `created_by` e `is_test` AL FINAL (columnas 33-34 y 10-11). `CREATE OR REPLACE VIEW` solo puede agregar columnas al final, así que `is_test` es la última y los consumidores seleccionan por nombre, nunca por posición. El `DO $verify$` comprueba el conteo de columnas, que `is_test` sea la última y que `anon`/`authenticated` no tengan privilegio.

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

### `20260930120000_case-metadata-and-human-reviews.sql`

- Añade a `public.cases` seis dimensiones del caso, todas `text` NULL-able: `country`, `campus`, `modality`, `project`, `responsible`, `guideline`. Se crean vacías (NULL = "no lo sabemos"), sin FK a catálogo, porque todavía no existe un catálogo real del que derivar valores. `country` lo reutiliza luego `20261005120000_origin-country-channel.sql` con vocabulario cerrado.
- Crea `public.case_human_reviews` (dictamen humano por auditoría, `UNIQUE (audit_id)`, `decision_type` `APPROVE`/`CORRECT`), separada de `result_json` para no sobrescribir el dictamen de la IA.
- **Recrea** `public.audit_dashboard_metrics` (31 columnas) para proyectar las dimensiones del caso y el `human_outcome` por `LEFT JOIN` 1:1.
- Privilegios: la vista y la tabla quedan solo para `project_admin`; `anon`/`authenticated`/`PUBLIC` sin acceso.

### `20261001010000_case-reviewer-name.sql`

- `ALTER TABLE public.case_reviews ADD COLUMN IF NOT EXISTS reviewer_name text`.
- Nullable para conservar revisiones históricas creadas antes del campo.

### `20261002000000_auth_core.sql`

- Crea `public.app_memberships`:
  - `user_id uuid PRIMARY KEY REFERENCES auth.users(id)`
  - `role text NOT NULL CHECK (role IN ('user','coordinator'))` (el CHECK lo amplía `20261008100000` a `manager`).
- Habilita RLS; no se crean políticas para `authenticated`.
- `REVOKE ALL` a `anon` y `authenticated`; `GRANT SELECT` solo a `project_admin`.
- Crea `cases_created_by_id_idx` para acelerar el scoping por dueño.

### `20261003000000_paid-admissions.sql`

- Crea `public.request_admissions` (`subject_hash`, `operation IN ('paid','login')`, `context_hash`) con RLS.
- Función `admit_or_reject_quota` `SECURITY DEFINER` (search_path fijo); `REVOKE` a `PUBLIC`/`anon`/`authenticated`, `GRANT EXECUTE` solo a `project_admin`.
- Sin Redis: la cuota se resuelve atómicamente en la base.

### `20261003010000_derived-extractions.sql`

- `ALTER TABLE public.evidence ADD COLUMN IF NOT EXISTS extracted_text text, extraction_pipeline_version text`.
- Caché de extracción; los bytes originales nunca se modifican (`PRESERVE_EVIDENCE_PROVENANCE`).

### `20261005010000_case-area-comments.sql`

- Crea `public.case_area_comments` con `UNIQUE (case_id, area)` (guardar = UPSERT, no historial).
- `comment` `NOT NULL` con `CHECK` de longitud (mismo límite que Zod en el servidor).
- RLS fail-closed por `created_by = auth.uid()`; sin `SELECT` para `anon`.

### `20261005120000_origin-country-channel.sql`

- `cases.country` ya existía; cambia su significado (vocabulario cerrado `EVIDENCE_COUNTRIES`) y añade `cases.channel` (`EVIDENCE_CHANNELS`).
- Recrea la vista de métricas para proyectar las nuevas dimensiones.
- La trazabilidad vive en `audits.result_json`; `country`/`channel` son proyección para filtrar (`PROJECTION_IS_NOT_THE_DICTAMEN`).

### `20261008090000_case-cycle-start-date-human.sql`

- Cuatro columnas en `cases`: `cycle_start_date date`, `cycle_start_date_by uuid REFERENCES auth.users(id)`, `cycle_start_date_at timestamptz DEFAULT now()`, `cycle_start_date_by_name text`.
- Dato HUMANO con procedencia (no evidencia); el autor y la hora los pone el servidor.
- No toca RLS: el `DO $verify$` comprueba que `cases` sigue con RLS y sus 4 políticas.

### `20261008100000_membership-role-manager.sql`

- `DROP CONSTRAINT IF EXISTS app_memberships_role_check` + `ADD CONSTRAINT ... CHECK (role IN ('user','coordinator','manager'))`.
- No reescribe filas: `user` y `coordinator` siguen admitidos. El `DO $verify$` exige exactamente un CHECK que admita los tres valores (si quedara el viejo junto al nuevo, `manager` seguiría bloqueado).

### `20261008110000_case-test-flag.sql`

- `ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false`.
- El `DEFAULT false` hace que un caso creado sin la marca sea real y que los históricos no se conviertan en prueba al añadir la columna.
- La exclusión de pruebas de las métricas la aplica el servidor (`is_test = false`), no la base.

### `20261008120000_case-review-coordinator-decision.sql`

- Cinco columnas NULL-able en `case_reviews`: `coordinator_decision text`, `coordinator_resolution text`, `coordinator_created_by uuid REFERENCES auth.users(id)`, `coordinator_created_at timestamptz`, `coordinator_comment text`.
- Dos `CHECK`: `case_reviews_coordinator_decision_check` (`NULL` o `APPROVE`/`CHANGE`) y `case_reviews_coordinator_consistency_check` (o todo el bloque vacío, o decisión con actor y hora; `APPROVE` sin resolución de cambio y `CHANGE` con resolución `DISTINCT FROM result`).
- No toca `result` (la decisión del Asesor sigue siendo `text NOT NULL`).

### `20261008130000_dashboard-view-test-owner-scope.sql`

- Recrea `audit_dashboard_metrics` (34 columnas) y `case_comparisons_dashboard_metrics` (11 columnas) añadiendo `created_by` e `is_test` al final.
- Permite que el scope del Asesor (`created_by = <sub>`) y la exclusión de pruebas (`is_test = false`) ocurran en SQL ANTES del `count`/`limit`.
- `REVOKE ALL` a `anon`/`authenticated`/`PUBLIC`; `GRANT SELECT` solo a `project_admin`.

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

### `case_area_comments`

| Política | Comando | Expresión |
|---|---|---|
| `case_area_comments_select_own` | SELECT | `created_by = auth.uid()` |
| `case_area_comments_insert_own` | INSERT | `created_by = auth.uid()` |
| `case_area_comments_update_own` | UPDATE | `USING/WITH CHECK created_by = auth.uid()` |

### `app_memberships`

RLS habilitada pero **sin políticas**. El único rol con privilegio es `project_admin` (BYPASSRLS), así que la aplicación server-side lee los roles mientras que cualquier acceso directo desde `authenticated` devuelve cero filas.

### `request_admissions`

RLS habilitada; `anon` y `authenticated` sin privilegios. La fila la escribe la función `SECURITY DEFINER` `admit_or_reject_quota`, no el cliente.

## Cliente administrativo y defensa en profundidad

- `src/server/insforge.ts` crea un cliente con `createAdminClient({ apiKey: INSFORGE_API_KEY })`. Este rol (`project_admin`) tiene BYPASSRLS y puede leer/escribir cualquier fila.
- La RLS no es la frontera primaria; lo es el hecho de que **el navegador nunca habla con InsForge**. La RLS existe como segundo muro en caso de fuga de token/cookie.
- Todas las consultas del backend usan el cliente admin, pero el alcance y los permisos se implementan en código: `getScopedCaseOr404` y `assertCaseOwner` resuelven el alcance (dueño, o cualquier caso si el rol tiene `canReadAllCases`), y `assertCaseWriteCapability` decide la mutación con las capacidades del rol (`capabilitiesForRole`), no con el nombre del rol ni con la RLS. Un caso ajeno es `404`; en alcance pero sin permiso es `403`.

## Forward-only y rollback

- Las migraciones no incluyen `BEGIN/COMMIT`; el runner de InsForge envuelve cada archivo en su propia transacción.
- No hay scripts de rollback automático. Para deshacer un cambio se aplica una nueva migración que corrige hacia adelante.
