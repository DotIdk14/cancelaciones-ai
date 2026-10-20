# Auditoría y conciliación de migraciones

## Revisión humana por versión de auditoría · 19 de octubre de 2026

El código y la migración local `20261019100000_case-reviews-per-audit.sql`
permiten conservar una revisión por auditoría y abrir una nueva revisión cuando
una resolución de evidencia insuficiente da lugar a otra auditoría. La migración
cambia la unicidad de `case_reviews.case_id` a `case_reviews.audit_id` y actualiza
el RPC de historial de matrícula para leer la revisión de la auditoría vigente.
Esta versión **no está confirmada en el ledger ni aplicada en producción**. No
ejecutarla hasta reconciliar el ledger y seguir el procedimiento de staging y
respaldo descrito en este documento.

## Preparación de Resumen y canales CaVe · 15 de octubre de 2026

La migración `20261015100000_dashboard-sales-channel-flokzu.sql` se ensayó con
el runner oficial en la rama aislada `cancelaciones-predeploy-20261009`, cuya
historia ya incluía las migraciones hasta `20261014180300`. La aplicación
terminó correctamente. Las cuatro vistas nuevas exponen `sales_channel` como
texto; `anon` y `authenticated` no tienen `SELECT`, y `project_admin` sí.

Con autorización expresa para sustituir el respaldo anterior y publicar, se
eliminó `pre-deploy-current-schema-2026-10-09` y se creó el backup nativo
`pre-deploy-dashboard-cave-2026-10-15` (`03bd71bc-3c59-41a5-a611-4f95143eaa09`),
con estado `completed`. La migración se aplicó individualmente con el runner
oficial en producción y quedó registrada como `20261015100000`. La lectura
posterior confirmó `sales_channel` de tipo `text` en las cuatro vistas y los
permisos esperados: `anon` y `authenticated` sin `SELECT`, `project_admin` con
`SELECT`. El backup nativo no se restauró durante este cambio.

Antes de publicar, `npm run verify:release` terminó correctamente: lint,
TypeScript, 105 pruebas de contrato, 1,257 pruebas de aplicación aprobadas y 3
omitidas, además del build de Vite. El commit `da967e7` se publicó en `main` y
Vercel terminó el despliegue de producción `dpl_AjeM6jJqJkyMVztDx1TbQjbPCFJh`
con estado `Ready`. La URL estable respondió HTTP 200:
https://cancelaciones-ai.vercel.app.

## Asignación y vinculación · 14 de octubre de 2026

Con autorización expresa del propietario para corregir también la base real,
se ensayaron y aplicaron individualmente con el runner oficial las versiones
`20261014180000`, `20261014180100`, `20261014180200` y `20261014180300` en el
backend aislado existente y después en producción. Sus bloques `DO $verify$`
terminaron correctamente. No se modificó el ledger manualmente ni el baseline.

La reparación archivó tres importados vacíos, completó cuatro CaVe y mantuvo
activos dos manuales con discrepancia, según la elección del propietario. Las
huellas anteriores y posteriores confirmaron la conservación de 22 evidencias,
siete auditorías, una revisión y siete comentarios en los expedientes afectados.
Los manuales reales creados por Asesores o Coordinación no dejaron responsables
pendientes después del backfill. Los originales y dictámenes no se trasladaron
ni eliminaron, y no se llamó a IA.

Las exportaciones de esquema/datos y comprobaciones están fuera de Git en
`tmp/assignment-repair/` del checkout original. No incluyen una prueba de
restauración de Storage. Los detalles y el estado de la entrega de código se
registran en `docs/asignacion-y-vinculacion-contactos.md`.

## Integración en producción · 13 de octubre de 2026

La integración `6ed7b8f` incorpora `a1ec64d` y las correcciones del menú contextual,
historial y referencias de evidencia. Se ensayaron y aplicaron mediante el runner
oficial, en orden, las migraciones `20261013100000`, `20261013103000`,
`20261013110000` y `20261013120000`. Ya no están pendientes en producción.

El ensayo se hizo en la rama completa `cancelaciones-predeploy-20261009`.
Los bloques de verificación de los cuatro archivos finalizaron correctamente en
staging y producción. El ledger registra las cuatro versiones; las nuevas tablas
tienen RLS y los RPC de historial y conciliación no conceden ejecución al navegador.
Los conteos antes y después fueron: 13 casos, 4 auditorías, 26 evidencias,
0 revisiones y 11 membresías. La conciliación inicial de Flokzu conserva las
relaciones y exige verificar los tickets históricos antes del reparto automático.

InsForge rechazó un respaldo manual nuevo por cuota `1/1` y una rama nueva por
cuota `2/2`. Se conservó el respaldo completo existente del 9 de octubre y se
guardó una exportación actual de esquema y datos fuera de Git. No se ensayó la
restauración de estos respaldos; no deben describirse como recuperación probada.
La sesión administrativa de la CLI se renovó con autorización del usuario.

## Cierre de Flokzu en producción · 12 de octubre de 2026

Con autorización del propietario para integrar y publicar en `main`, se aplicó
`20261012100000_flokzu-case-import.sql` exclusivamente por destino explícito
con `db migrations up`. No se reejecutó el baseline ni se modificó manualmente
el ledger. Las 21 sentencias locales coincidieron con las ya registradas en el
backend aislado `cancelaciones-predeploy-20261009`.

El runner oficial ejecutó el bloque `DO $verify$`. La lectura posterior confirmó
las cuatro columnas nuevas, la tabla de batches y ejecución de los RPC solo
para `project_admin`: `anon` y `authenticated` no pueden ejecutarlos. Producción
conservó sus 8 casos, 5 auditorías y 47 evidencias; la tabla de importaciones
quedó vacía. Los datos de pruebas de staging permanecen en ese entorno.

El intento de respaldo manual nuevo fue rechazado por cuota llena (`1/1`). Se
conservó el respaldo `completed` del 9 de octubre y se guardó una exportación
SQL privada actual en `tmp/release-flokzu/production-before-flokzu.sql`, ignorada
por Git. SHA-256:
`9F00E22C790C11B2E5AF4E8BAA47E0A5BC6C6DC43F789A03DA363A785E24D95F`.
Esta exportación es un recurso complementario; no se ensayó su restauración
integral ni se declara equivalente a un respaldo de DB + Storage.

Antes de publicar se completó `npm run verify:release`: lint, TypeScript,
102 pruebas de contrato, 1,110 pruebas de aplicación y build correctos.
Tres pruebas de integración real permanecieron omitidas por su configuración.

Snapshot inicial observado el 9 de octubre de 2026. Las lecturas iniciales y la
conciliación histórica se conservan abajo; el cierre de producción del mismo día
se registra en la sección actualizada.

## Relectura y cierre de producción · 9 de octubre de 2026

La lectura inicial devolvió 54 migraciones remotas y 20 archivos locales. Después
de probar en la rama aislada `cancelaciones-predeploy-20261009`, se aplicaron a
producción con el runner oficial de InsForge los archivos
`20261009120000_case-student-name.sql` y
`20261009212142_restrict-security-definer-rpc-execution.sql`. El ledger remoto
ahora contiene **56 migraciones** y el checkout **21 archivos SQL**.

- `20261009100000_case-list-pagination-indexes` y
  `20261009110000_case-area-comments-authenticated-policy` ya estaban registrados;
  `pg_indexes` y `pg_policies` confirmaron su estado.
- `20261009120000_case-student-name` fue aplicada y registrada. La columna
  `public.cases.student_name` existe como `text`; `ALTER TABLE` no tocó filas y
  la producción permaneció en 29 expedientes.
- `20261009212142_restrict-security-definer-rpc-execution` revocó el acceso
  directo a las funciones privilegiadas del esquema `public`, conservando
  `authenticated` en los seis helpers usados por políticas RLS. La verificación
  posterior encontró 0 funciones `SECURITY DEFINER` ejecutables por `anon`, 0
  ejecutables por `authenticated` fuera de esos helpers y los seis helpers de
  política habilitados. La cuota continúa reservada a `project_admin`.
- El intento inicial de `db migrations up --to ...` fue rechazado sin escritura
  porque el baseline local es anterior al head remoto. InsForge aplicó ambos
  archivos correctamente al invocarlos en orden como destinos explícitos
  (`db migrations up <archivo>`). No se editaron `system.custom_migrations` ni
  `system.migrations` manualmente.
- InsForge no permitió un backup manual adicional (cuota `1/1`). Se conservó el
  backup `completed` de las 16:58 UTC y no se borró. La rama de staging era full,
  pero no se ejecutó una restauración de ese backup; en la lectura posterior
  había dos expedientes más en producción que en la copia.
- El CLI confirmó que la app no usa los RPC heredados como cliente: su única
  invocación directa es `admit_or_reject_quota`, que mantiene el permiso solo
  para `project_admin`. La rama de staging no tenía trabajos activos en la tabla
  legacy `jobs`.
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
| `20261009120000_case-student-name.sql` | B | Aplicada y registrada en el cierre del 9 oct 2026 | `cases.student_name` nullable para presentar nombre e identificador; requerida por `POST /api/cases`. |
| `20261009212142_restrict-security-definer-rpc-execution.sql` | B | Aplicada y registrada en el cierre del 9 oct 2026 | Revoca llamadas directas de cliente a funciones `SECURITY DEFINER`; mantiene seis helpers requeridos por RLS. |

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

## Procedimiento aplicable a futuras reconciliaciones

El cierre descrito arriba ya se aplicó con los dos archivos explícitos. Este
procedimiento queda como guía para cualquier otra escritura; la restauración
del backup no se ensayó y debe cubrirse antes de una operación de recuperación.

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
