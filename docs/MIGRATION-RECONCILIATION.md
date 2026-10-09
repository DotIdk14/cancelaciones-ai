# Auditoría y conciliación de migraciones

Snapshot inicial observado el 9 de octubre de 2026. Consultas a InsForge en modo lectura;
no se ejecutó SQL de producción, no se aplicaron migraciones y no se modificó el
historial remoto.

## Relectura de producción · 9 de octubre de 2026

Esta relectura sustituye los estados anteriores de `20261009100000` y
`20261009110000`. Se usó `npx -y @insforge/cli db migrations list --json` y
consultas `SELECT` de catálogos; no se escribieron datos ni esquema.

- El ledger remoto devuelve **54 migraciones**; el checkout contiene **20 archivos
  SQL**. `20261009100000_case-list-pagination-indexes` y
  `20261009110000_case-area-comments-authenticated-policy` ya están registrados.
- `pg_indexes` confirma ambos índices de paginación en `public.cases`.
  `pg_policies` confirma que las tres políticas de comentarios usan solo el rol
  `authenticated`.
- `20261009120000_case-student-name` existe localmente, no está registrada en el
  ledger remoto y `public.cases.student_name` **no existe** en producción. El
  `POST /api/cases` local inserta esa columna (`src/server/cases.ts`); desplegar
  este código antes de conciliar/aplicar esa migración rompería la creación de
  expedientes nuevos. Es un bloqueo de release.
- `20260930120000` tampoco figura en el ledger; sus efectos se observaron en
  inspecciones anteriores. El ledger contiene 37 versiones remotas sin archivo
  en el checkout, pertenecientes a la arquitectura anterior. No descargar,
  reordenar ni adoptar automáticamente ese historial.
- La lectura actual confirma 29 casos, ninguno sin `created_by`, y 2 memberships
  `coordinator` + 1 `manager`. Son conteos sin identidades.
- La exposición actual de funciones `SECURITY DEFINER` y sus grants se trata en
  la revisión preproducción; no se revocaron permisos como parte de esta lectura.

## Hallazgo

El historial oficial remoto contiene 45 registros: 37 migraciones de la
arquitectura anterior y ocho migraciones de la ruta AI-native hasta
`20261003010000_derived-extractions`. La migración
`20260930120000_case-metadata-and-human-reviews.sql` y las siete migraciones de
octubre posteriores a `20261003010000` no aparecen en ese historial, pero la
inspección anterior de catálogos confirmó que sus tablas, columnas, checks,
índices y vistas finales ya existen. El diagnóstico de “SQL aplicado por fuera
del ledger” es, por tanto, cierto para esos ocho archivos; la ausencia de una
entrada remota por sí sola no se tomó como prueba.

`scripts/apply-migration.mjs` era una vía de escritura directa con `db query`:
ejecutaba sentencias, pero no registraba la migración. Además, InsForge solo
documenta `list`, `fetch`, `new` y `up` para migraciones; no se encontró una
operación oficial de `resolve`/`mark-applied`. `fetch` descarga el historial
registrado a `migrations/`; no adopta cambios ya presentes en el esquema.

No es seguro reejecutar sin más todos los archivos sin registrar para que el
CLI los registre. Por ejemplo, los archivos
`20260930120000_case-metadata-and-human-reviews.sql` y
`20261005120000_origin-country-channel.sql` reemplazan versiones anteriores de
`audit_dashboard_metrics` con menos columnas que la vista final de 34 columnas.
PostgreSQL no permite quitar columnas de una vista mediante
`CREATE OR REPLACE VIEW`; esos archivos pueden fallar contra la vista que ya
existe. Se requiere una reconciliación que conserve exactamente la vista final
y use una vía oficialmente soportada por InsForge.

## Matriz de archivos

“Aplicada sin registrar” significa que los efectos se observaron en el esquema
remoto, pero el archivo no consta en el historial oficial.

| Archivo | Clase | Historial remoto | Efecto observado / motivo |
|---|---|---|---|
| `00000000000000_baseline.sql` | B | No registrado; esperado en el proyecto existente | Base inicial limpia de `cases`, `evidence`, `audits`; es la ruta de instalación nueva y no sirve como migración sobre la producción legacy. No representa el esquema vigente completo. |
| `20260928010000_ai-native-production.sql` | B | Aplicada y registrada | Transición forward-only que preserva el esquema anterior y establece las tres tablas AI-native en el entorno legacy. Es una ruta de actualización existente. |
| `20260929040000_audit-dashboard-metrics.sql` | B | Aplicada y registrada | Vista de métricas y su índice; el SQL posterior evoluciona la vista. Necesaria en la secuencia histórica registrada. |
| `20260930010000_human-resolution.sql` | B | Aplicada y registrada | `case_reviews`, `case_comparisons`, FKs, RLS y trigger. Dependencia de la vista de comparaciones. |
| `20260930020000_human-review-dashboard-metrics.sql` | B | Aplicada y registrada | Primera forma de la vista de comparaciones; se conserva como parte del historial y dependencia de la evolución posterior. |
| `20260930120000_case-metadata-and-human-reviews.sql` | C | Aplicada sin registrar | Dimensiones y tabla `case_human_reviews` presentes; la vista evolucionó posteriormente. Conservar hasta que InsForge permita una conciliación soportada. |
| `20261001010000_case-reviewer-name.sql` | B | Aplicada y registrada | `case_reviews.reviewer_name` presente; es parte de la secuencia oficial. |
| `20261002000000_auth-core.sql` | B | Aplicada y registrada | `app_memberships` y `cases_created_by_id_idx` presentes. Base del acceso por membresía. |
| `20261003000000_paid-admissions.sql` | B | Aplicada y registrada | `request_admissions` y `admit_or_reject_quota` presentes. Base durable de cuotas. |
| `20261003010000_derived-extractions.sql` | B | Aplicada y registrada | Columnas de extracción derivada presentes en `evidence`. Último archivo compartido por el ledger y el árbol local. |
| `20261005010000_case-area-comments.sql` | B | Registrada en la relectura | Tabla, checks, FK, índice único y RLS. |
| `20261005120000_origin-country-channel.sql` | B | Registrada en la relectura | `cases.channel` y vista final evolucionada; `country` tiene la proyección cerrada actual. |
| `20261008090000_case-cycle-start-date-human.sql` | B | Registrada en la relectura | Columnas y FK de procedencia humana. |
| `20261008100000_membership-role-manager.sql` | B | Registrada en la relectura | Check de `app_memberships.role` admite `user`, `coordinator` y `manager`. |
| `20261008110000_case-test-flag.sql` | B | Registrada en la relectura | `cases.is_test boolean NOT NULL DEFAULT false`. |
| `20261008120000_case-review-coordinator-decision.sql` | B | Registrada en la relectura | Cinco columnas y dos checks de decisión del Coordinador. |
| `20261008130000_dashboard-view-test-owner-scope.sql` | B | Registrada en la relectura | Vistas con `created_by` e `is_test`, restricciones de acceso y 34/11 columnas. |
| `20261009100000_case-list-pagination-indexes.sql` | B | Registrada en la relectura | Los dos índices de paginación constan tanto en el ledger como en `pg_indexes`. |
| `20261009110000_case-area-comments-authenticated-policy.sql` | B | Registrada en la relectura | Las tres políticas aparecen con `roles = {authenticated}` en `pg_policies`. |
| `20261009120000_case-student-name.sql` | E | No registrada; columna ausente | El código actual inserta `cases.student_name`; falta conciliar y aplicar esta migración antes de desplegar el código que la usa. |

No se asigna clase D: no se demostró que retirar un SQL sea seguro para todas
las rutas de actualización. Los archivos A-F no se clasifican por edad, sino
por su papel y el estado observado. Los SQL legacy registrados siguen siendo
necesarios para reproducir el historial remoto, aunque ya no sean el modelo de
datos de la aplicación.

## Diferencias relevantes de producción

- El esquema principal observado contiene las funcionalidades de la aplicación
  hasta `dashboard-view-test-owner-scope`; la lista remota no las registra a
  todas.
- `cases.created_by` admite `NULL` en producción para conservar expedientes
  históricos sin custodio. El baseline limpio actual lo declara `NOT NULL`.
  No debe “normalizarse” esa diferencia con un `SET NOT NULL` sin resolver y
  respaldar los casos huérfanos.
- Las dos vistas tienen las definiciones finales esperadas, pero
  `audit_dashboard_metrics` mantiene una dependencia histórica de
  `case_human_reviews`. No eliminar esa tabla ni rehacer la vista hasta
  verificar retención y semántica de las métricas históricas.
- Snapshot inicial: 27 casos. La relectura del 9 de octubre encontró 29 casos,
  ninguno con `created_by IS NULL`; la columna sigue nullable por definición
  histórica y no debe normalizarse sin conciliar y respaldar casos huérfanos.
- Snapshot inicial: cinco memberships `coordinator`. La relectura encontró 2
  `coordinator` y 1 `manager`. Son conteos cambiantes que no incluyen identidades.
- Los objetos principales tienen RLS habilitada. Las tablas de casos,
  evidencias y auditorías conceden `SELECT` a `authenticated` y aplican
  políticas por dueño; revisiones, comparaciones, memberships, comentarios y
  cuotas no conceden `SELECT` directo a los roles cliente. Las vistas del
  dashboard conceden `SELECT` únicamente a `project_admin`.
- Triggers observados: `cases_set_updated_at`,
  `case_comparisons_set_updated_at` y `case_area_comments_set_updated_at`, los
  tres ejecutan `set_updated_at()` en `BEFORE UPDATE`. Funciones de la app:
  `set_updated_at()` tiene `search_path` fijo y no es ejecutable por `anon`;
  `admit_or_reject_quota(text,text,text,uuid)` es `SECURITY DEFINER`, fija el
  mismo `search_path` y solo `project_admin` puede ejecutarla. `project_admin`
  tiene `BYPASSRLS`; `anon` y `authenticated` no.
- Hashes de definición observados con `md5(pg_get_viewdef(..., true))`:
  `audit_dashboard_metrics` (34 columnas)
  `b6ba2c943832ddd1209611159368c467`; `case_comparisons_dashboard_metrics`
  (11 columnas) `d54782df3d5f0898837ebdc83de0504b`. Son huellas de comparación,
  no hashes criptográficos de un dump canónico.
- Índices observados: owner+created_at y owner+id en `cases`, ambos índices de
  lectura por caso en `evidence` y `audits`, más `audits_created_at_idx`. La
  relectura posterior confirma también `cases_created_at_id_idx` y
  `cases_status_created_at_id_idx`.
- Existen objetos de la arquitectura anterior en el proyecto InsForge. No se
  incluyeron en una nueva definición global porque requieren una decisión de
  retención y no pertenecen al conjunto mínimo de la aplicación actual.
- Snapshot inicial: los índices de paginación y el alcance de políticas de
  comentarios parecían pendientes. La relectura actual confirma que ambos
  cambios están registrados y sus efectos coinciden con el SQL local.

## Plan reproducible antes de cualquier escritura

## Dependencias y orden

| Migración | Prerrequisito |
|---|---|
| Baseline limpio `00000000000000` | Base de InsForge vacía; roles y `auth.users` de plataforma. |
| `20260928010000_ai-native-production` | Ruta existente legacy, no el baseline limpio. |
| `20260929040000_audit-dashboard-metrics` | `cases`, `audits` AI-native. |
| `20260930010000_human-resolution` | `cases`, `audits`. |
| `20260930020000_human-review-dashboard-metrics` | `20260930010000` (`case_reviews`, `case_comparisons`). |
| `20260930120000_case-metadata-and-human-reviews` | Métricas de auditoría y esquema core. |
| `20261001010000_case-reviewer-name` | `case_reviews`. |
| `20261002000000_auth-core` | `cases` e `auth.users`. |
| `20261003000000_paid-admissions` | `auth.users`, roles de InsForge y `pg_advisory_xact_lock`. |
| `20261003010000_derived-extractions` | `evidence`. |
| `20261005010000_case-area-comments` | `cases`, `auth.users`, `set_updated_at()`. |
| `20261005120000_origin-country-channel` | `cases.country` y la vista de métricas previa. |
| `20261008090000_case-cycle-start-date-human` | `cases`, `auth.users`. |
| `20261008100000_membership-role-manager` | `app_memberships`. |
| `20261008110000_case-test-flag` | `cases`. |
| `20261008120000_case-review-coordinator-decision` | `case_reviews`, `auth.users`. |
| `20261008130000_dashboard-view-test-owner-scope` | `cases.is_test`, `case_reviews`, `case_comparisons`, auditorías y vistas previas. |
| `20261009100000_case-list-pagination-indexes` | `cases`; los índices apoyan el orden por `created_at DESC, id DESC` y el filtro `status`. |
| `20261009110000_case-area-comments-authenticated-policy` | `case_area_comments` y rol `authenticated`. |

Las migraciones de vistas deben conservar el orden histórico porque sus
columnas crecen de forma aditiva y `CREATE OR REPLACE VIEW` no puede borrar ni
reordenar columnas.

1. Guardar y comprobar un respaldo restaurable de InsForge; registrar la fecha,
   alcance y resultado de una restauración de ensayo. Un export SQL de esquema
   no cuenta como respaldo de datos.
2. Crear una copia aislada/staging del backend y confirmar que no comparte
   escrituras, Storage ni secretos de producción.
3. Ejecutar `db migrations fetch` únicamente dentro de un checkout temporal
   respaldado; comparar versiones y contenidos descargados contra Git antes de
   cambiar el directorio versionado.
4. En staging, reproducir el esquema remoto observado y ensayar la reconciliación
   oficial. Verificar estructura, FKs, checks, vistas, grants, RLS, y los flujos
   de API de Asesor, Coordinador y Gerente. Probar también expedientes con
   `created_by IS NULL` y métricas históricas.
5. No reejecutar `20260930120000` ni `20261005120000` sobre la vista final sin
   resolver primero el conflicto de forma. Si InsForge no ofrece adopción
   soportada, solicitar al proveedor el procedimiento oficial; no editar
   `system.custom_migrations`/`system.migrations` manualmente.
6. Para los índices, comparar `pg_indexes` y planes con y sin ellos en staging;
   comprobar bloqueos, duración y espacio. Probar primero la migración
   `20261009100000` en staging.
7. Para el alcance RLS de comentarios, comprobar `roles` en `pg_policies` y los
   privilegios de tabla antes y después de `20261009110000`.
8. Después de aprobación explícita, ventana de cambio, respaldo restaurable y
   aprobación del SQL exacto, usar solo el flujo soportado por InsForge. Tras la
   aplicación, repetir consultas de catálogos y `db migrations list`, y comparar
   el esquema con el inventario esperado.

## Instalaciones nuevas y limpieza

El baseline de `migrations/00000000000000_baseline.sql` contiene solo el núcleo
de tres tablas; por eso no es una definición consolidada del producto actual.
Tampoco es seguro reemplazarlo por un esquema final y mantener después la
secuencia actual: varias migraciones históricas recrean vistas intermedias y no
se pueden aplicar sobre la vista final. La CLI publicada no ofrece un comando
de baseline/squash ni de adopción de migraciones ya aplicadas. Hasta que exista
una ruta oficial y se pueda probar en una base aislada, se conservan los
archivos de migración y no se publica un baseline no verificable como camino de
instalación.

La prueba integral de una base nueva requiere PostgreSQL/InsForge aislado. En la
estación de trabajo de esta revisión no están disponibles `psql`, `docker`,
`pg_ctl` ni `initdb`; por tanto, ningún SQL se declara aplicado o probado en una
instancia vacía. `npm run verify:release` verifica el código y no sustituye esa
prueba.

Se creó una rama temporal InsForge `schema-only`, se confirmó que no contenía
casos, auditorías ni evidencias, y allí se ejecutaron las ocho sentencias DDL de
las dos migraciones preparadas. La inspección posterior confirmó que las tres
políticas usan solo `{authenticated}`, ambos índices existen y son válidos, y
`anon`/`authenticated` siguen sin `SELECT` directo en comentarios. No se ejecutó
el bloque `DO $verify$` ni el registro del runner oficial en esa prueba; por eso
se clasifica como prueba de DDL y estado de catálogo en staging, no como prueba
completa del flujo de migraciones. La rama temporal se eliminó después. El
baseline vacío sigue sin probarse.
