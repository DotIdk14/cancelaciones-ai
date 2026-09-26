# Reporte Tarea 1 — Migración correctiva de GRANT RLS

**Fecha:** 2026-09-26
**Rama:** `feature/policy-foundation-remediation`
**Estado:** `DONE_WITH_CONCERNS`
**Commit:** `e81567b09b7b1cb8c91df82aaa69f09bf4f1a3f8`

---

## 1. Resumen

Se corrigió la divergencia entre políticas RLS y privilegios SQL en 4 tablas. La
premise del brief se confirmó en la base de datos: existían exactamente 4
divergencias `MISSING`, las 4 previstas. Se aplicó una migración aditiva con 4
sentencias `GRANT` (ninguna.policy modificada, ningún dato tocado) y la
verificación pasó de 4 `MISSING` a 9/9 `OK`.

Restricción normativa respetada: no se tocó ninguna regla, criterio ni el motor de
política. `GDM_GAM_PRD_MLG_003` no fue consultado ni alterado. El fix es
exclusivamente de privilegios SQL.

## 2. Archivos creados

| Archivo | Líneas | Commit |
|---|---|---|
| `migrations/20260926090000_fix-rls-grants-engine-fact.sql` | 21 | `e81567b` |
| `scripts/verify-rls-grants.sql` | 35 | `e81567b` |

Ningún archivo existente fue modificado o borrado. `git status` quedó limpio tras
el commit.

## 3. Entorno

- Directorio enlazado: `/tmp/opencode/insforge-probe` (proyecto `Cancelaciones`,
  id `9e29e329-252e-481c-a632-95b71ee3df51`, región `us-west`).
- Verificado con `npx -y @insforge/cli current`: usuario `DotIdk14`, proyecto
  enlazado correctamente.
- Head remoto previo a la intervención: `20260925200000 cost-telemetry-contract`.
- Entorno de desarrollo. Ninguna operación destructiva ejecutada: no hubo
  `TRUNCATE`, `DROP`, `DELETE` ni `VACUUM FULL`. El único cambio en la base fue
  el `GRANT` de 4 privilegios.

## 4. Comandos ejecutados

### Paso 1 — Script de verificación (RED)

Se creó `scripts/verify-rls-grants.sql` con el SQL exacto del brief.

### Paso 2 — Verificación ANTES del fix

El comando literal del brief falló por un artefacto de parsing del CLI:

```bash
npx -y @insforge/cli db query "$(cat .../scripts/verify-rls-grants.sql)"
# error: unknown option '-- Verificación read-only de paridad entre políticas RLS...'
```

El CLI interpretaba el `--` inicial del comentario SQL como una opción. Se resolvió
insertando el separador `--` antes del argumento, **sin modificar el archivo**:

```bash
cd /tmp/opencode/insforge-probe
npx -y @insforge/cli db query -- "$(cat /home/idk/Escritorio/cancelaciones-ai/scripts/verify-rls-grants.sql)"
```

**Salida (verbatim):**

```
┌────────────────────────┬─────────────────┬─────────────────┐
│ table_name             │ policy_command │ privilege_state │
├────────────────────────┼─────────────────┼─────────────────┤
│ engine_rule_results    │ INSERT         │ MISSING         │
│ engine_rule_results    │ SELECT         │ OK              │
│ engine_runs            │ INSERT         │ MISSING         │
│ engine_runs            │ SELECT         │ OK              │
│ fact_extraction_runs   │ INSERT         │ OK              │
│ fact_extraction_runs   │ SELECT         │ OK              │
│ fact_extraction_runs   │ UPDATE         │ MISSING         │
│ policy_source_registry │ INSERT         │ MISSING         │
│ policy_source_registry │ SELECT         │ OK              │
└────────────────────────┴─────────────────┴─────────────────┘
9 row(s) returned.
```

**4 filas `MISSING`, exactamente las previstas.** Condición de parada satisfecha:
`engine_runs/INSERT`, `engine_rule_results/INSERT`, `fact_extraction_runs/UPDATE`,
`policy_source_registry/INSERT`. Se procedió.

### Paso 3 — Migración correctiva

Se creó `migrations/20260926090000_fix-rls-grants-engine-fact.sql` con el SQL exacto
del brief: 4 `GRANT`, aditivo e idempotente, sin `DROP POLICY` ni `ALTER POLICY`.

### Paso 4 — Aplicación

El comando del brief (`db apply`) **no existe** en la CLI. Verificado:

```
$ npx -y @insforge/cli db --help
Commands: query, tables, functions, indexes, policies, triggers, rpc,
          export, import, migrations, connection-string
```

Comando real usado. `db migrations up` resuelve el archivo desde `./migrations`
relativo al CWD, por lo que se copió la migración al directorio del proyecto
enlazado (diff confirmado `IDENTICAL` contra el archivo del repo):

```bash
cp <repo>/migrations/20260926090000_fix-rls-grants-engine-fact.sql \
   /tmp/opencode/insforge-probe/migrations/
cd /tmp/opencode/insforge-probe
npx -y @insforge/cli db migrations up 20260926090000_fix-rls-grants-engine-fact.sql
```

**Salida:**

```
✓ Applied 1 migration file(s).
- 20260926090000_fix-rls-grants-engine-fact.sql
```

### Paso 5 — Verificación DESPUÉS del fix

Mismo comando que el paso 2. **Salida (verbatim):**

```
┌────────────────────────┬─────────────────┬─────────────────┐
│ table_name             │ policy_command │ privilege_state │
├────────────────────────┼─────────────────┼─────────────────┤
│ engine_rule_results    │ INSERT         │ OK              │
│ engine_rule_results    │ SELECT         │ OK              │
│ engine_runs            │ INSERT         │ OK              │
│ engine_runs            │ SELECT         │ OK              │
│ fact_extraction_runs   │ INSERT         │ OK              │
│ fact_extraction_runs   │ SELECT         │ OK              │
│ fact_extraction_runs   │ UPDATE         │ OK              │
│ policy_source_registry │ INSERT         │ OK              │
│ policy_source_registry │ SELECT         │ OK              │
└────────────────────────┴─────────────────┴─────────────────┘
9 row(s) returned.
```

`rowCount: 9`, todas `OK`. Sin filas `MISSING`.

### Verificación independiente (no presente en el brief)

`information_schema.role_table_grants` puede estar ciego según los privilegios del
rol que consulta. Se contrastó con `has_table_privilege`, que evalúa el ACL real:

```sql
SELECT t, p, has_table_privilege('authenticated', 'public.'||t, p)
FROM (VALUES ('engine_runs'),('engine_rule_results'),
             ('fact_extraction_runs'),('policy_source_registry')) AS tabs(t),
     unnest(ARRAY['SELECT','INSERT','UPDATE']) AS p;
```

Resultado (12 filas): los 4 privilegios faltantes ahora son `true`, y `UPDATE`
permanece `false` en `engine_runs`, `engine_rule_results` y
`policy_source_registry`. Confirma que el fix es **mínimo y respeta least
privilege**: no se abrieron permisos adicionales donde no existe política.

### Paso 6 — Registro en el historial

La tabla del brief no existe (InsForge no es Supabase):

```
$ npx -y @insforge/cli db query "SELECT version FROM supabase_migrations.schema_migrations ..."
Error: relation "supabase_migrations.schema_migrations" does not exist
```

Buscando el nombre real, como instruía el brief:

```sql
SELECT table_schema, table_name FROM information_schema.tables WHERE table_name ILIKE '%migration%';
-- system.custom_migrations
-- system.migrations
```

`system.migrations` es la tabla interna de la plataforma. El historial real de
migraciones de la aplicación es **`system.custom_migrations`** (columnas: `version`,
`name`, `statements`, `created_at`):

```
┌────────────────┬───────────────────────────┬────────────────────────────┐
│ version        │ name                      │ created_at                  │
├────────────────┼───────────────────────────┼────────────────────────────┤
│ 20260926090000 │ fix-rls-grants-engine-fact│ 2026-09-26T17:59:09.209Z   │
│ 20260925200000 │ cost-telemetry-contract   │ 2026-09-25T23:52:18.122Z   │
│ 20260925161000 │ restore-fact-run-...     │ 2026-09-25T22:11:20.924Z   │
└────────────────┴───────────────────────────┴────────────────────────────┘
```

`20260926090000` aparece como head del historial. Confirmado también vía
`npx -y @insforge/cli db migrations list`, que lo muestra primero con timestamp
`26/9/2026, 11:59:09`.

### Paso 7 — Commit

```
$ git add migrations/20260926090000_fix-rls-grants-engine-fact.sql scripts/verify-rls-grants.sql
$ git commit -m "fix(db): alinear GRANT con políticas RLS en tablas de engine y fact runs"
[feature/policy-foundation-remediation e81567b] fix(db): alinear GRANT con políticas RLS en tablas de engine y fact runs
 2 files changed, 56 insertions(+)
```

**Hash completo:** `e81567b09b7b1cb8c91df82aaa69f09bf4f1a3f8`
`git status` quedó limpio.

## 5. Confirmación de no-modificación de políticas

- La migración contiene **exclusivamente 4 sentencias `GRANT`**. Cero `DROP POLICY`,
  `CREATE POLICY` o `ALTER POLICY`.
- Conteo de políticas `authenticated` en las 4 tablas antes y después: **9 → 9**.
- No se tocó ninguna fila de datos.

## 6. Chequeo de alcance (read-only, adicional)

Se aplicó la misma verificación sobre **todas** las tablas de `public` con
políticas para `authenticated`, no solo las 4 del brief:

```sql
-- divergencias en todo el schema public
→ Query executed successfully. No rows returned.
```

**No quedan divergencias en ninguna otra tabla.** La clase de bug está cerrada en
este entorno, no solo en las 4 tablas del brief.

## 7. Preocupaciones

### 7.1 El repo NO reflejaba el estado real de `fact_extraction_runs` (ALTA)

La migración del repo `migrations/20260923220000_phase-5-fact-model-shadow.sql:52`
declara:

```sql
GRANT SELECT, INSERT, UPDATE ON public.fact_extraction_runs TO authenticated;
```

Es decir, el historial versionado del repo **ya otorgaba `UPDATE`**, pero la base
viva no lo tenía. Solo existen dos `REVOKE` en todo `migrations/` y ninguno toca
`fact_extraction_runs` (uno es `DELETE` sobre `public.audits`, el otro `ALL` sobre
`public.tickets, evidences, transcript_segments`).

Implicación: **las migraciones del repo no son una fuente de verdad fiable del
estado de la base viva.** Algo la llevó a divergir (cambio manual, bootstrap o
rebuild que no reprodujo el grant de phase-5). La premisa del brief —tratar el
historial del repo como spec— es válida para las políticas pero no para los
privilegios. Puede haber la misma deriva en **otros objetos fuera del alcance de
esta tarea** (otras bases, otros entornos, funciones, columnas). Recomiendo
auditar el drift repo↔BD de forma sistemática, no solo en estas 4 tablas.

### 7.2 El script de verificación no puede salir con código 1 (MEDIA)

El comentario del script dice *"Sale con código 1 si hay divergencias"*, pero el
cuerpo es un `SELECT` plano: `db query` devuelve **exit 0** tanto con 4 `MISSING`
como con 9 `OK` (comprobado en ambos pasos). Tal como está, el script **no es
usable como gate en CI**. No lo modifiqué porque el brief exige usar sus valores
literales. Para hacerlo efectivo habría que envolverlo, por ejemplo:

```sql
-- variante gateable: devuelve filas solo si hay divergencias
...
HAVING count(*) FILTER (WHERE g.privilege_type IS NULL) > 0;
```

y/o un wrapper que cuente `privilege_state = 'MISSING'` y devuelva exit 1.

### 7.3 Divergencia entre el brief y la CLI (INFO, ya resuelta)

Dos comandos del brief no existen tal cual: `db apply` (real: `db migrations up`)
y `supabase_migrations.schema_migrations` (real: `system.custom_migrations`). Se
usaron los comandos reales verificados contra `--help`. Sin impacto en el
resultado; queda documentado para futuras tareas.

### 7.4 Entorno de desarrollo, no producción (INFO)

El fix se aplicó en el proyecto de desarrollo. **Producción sigue sin corregir**:
si el error `permission denied for table fact_extraction_runs` también ocurre en
producción, esta migración debe promoverse allá por el flujo de despliegue
normal. No se hizo ningún despliegue a producción en esta tarea.

### 7.5 Nota de alcance normativo (INFO)

Conforme a `INSPECT_BEFORE_IMPLEMENTING` y al invariante de que las políticas son
la especificación: el fix no reinterpretó criterio normativo alguno. Solo se
 alineó el ACL con políticas que **ya existían y ya estaban aprobadas**. El
`INSERT` en `policy_source_registry` y el `INSERT` en las tablas `engine_*`
otorgan al rol `authenticated` la capacidad de escritura que las políticas ya
regulaban; las políticas siguen siendo la única fuente de autorización.

## 8. Memoria del proyecto

Se registró un gotcha durable para futuras sesiones:

- `InsForge CLI: db apply no existe, historial en system.custom_migrations, y SQL con -- rompe db query`
  (kind `fact`, verificado 2026-09-26, 5 puntos: comando de aplicación, tabla de
  historial real, separador `--`, orden de flags con `--json`, y requisito de
  versión pendiente).

## 9. Checklist de pasos del brief

| Paso | Estado |
|---|---|
| 1. Script de verificación | OK |
| 2. Verificación falla (RED) | OK — 4 `MISSING` exactos |
| 3. Migración correctiva | OK — 4 `GRANT`, literal del brief |
| 4. Aplicar migración | OK — con comando real `db migrations up` |
| 5. Verificación pasa (GREEN) | OK — 9/9 `OK` |
| 6. Registro en historial | OK — `system.custom_migrations` |
| 7. Commit | OK — `e81567b` |

---

# Anexo A — Corrección de defectos I-1, I-2, I-3 (revisión del commit `e81567b`)

## A.0 Alcance de este anexo

Pasada correctiva sobre el commit `e81567b` (Tarea 1). **No se implementó
funcionalidad nueva**: solo se repararon los tres defectos señalados por el
revisor. Se modificaron exactamente 2 archivos:

- `migrations/20260926090000_fix-rls-grants-engine-fact.sql`
- `scripts/verify-rls-grants.sql`

El SQL efectivo de los 4 privilegios se conservó. Lo único que cambió en el SQL
fue el envoltorio `DO $$` del `GRANT` condicional (I-1). No se tocó ninguna
política RLS, ni columnas, ni datos.

## A.1 I-1 — La migración no era reproducible en entorno limpio (CRÍTICO, corregido)

### Premisa verificada de forma independiente

`grep -rn "policy_source_registry"` sobre el repo (excluyendo `.git` y
`node_modules`) devuelve menciones **solo** en documentación, en el plan, en el
script de verificación y en la propia línea del `GRANT`. **Ningún `CREATE TABLE`**
en `migrations/` la crea:

```
migrations/20260924101000_phase-6-policy-engine.sql:1   CREATE TABLE IF NOT EXISTS public.engine_runs
migrations/20260924101000_phase-6-policy-engine.sql:17  CREATE TABLE IF NOT EXISTS public.engine_rule_results
migrations/20260923220000_phase-5-fact-model-shadow.sql:1 CREATE TABLE IF NOT EXISTS public.fact_extraction_runs
```

No hay entrada para `policy_source_registry`. Las otras 3 tablas sí existen en el
historial, así que sus `GRANT` incondicionales son seguros; solo el cuarto
necesitaba guard.

### Prueba de que el defecto era real (control negativo)

Un `GRANT` sin guard contra una tabla inexistente **falla de verdad**:

```
$ npx -y @insforge/cli db query -- "GRANT INSERT ON public.tabla_que_no_existe_zzz TO authenticated;"
Error: relation "public.tabla_que_no_existe_zzz" does not exist
EXIT_SIN_GUARD_real=1
```

Es exactamente el fallo que habría roto la cadena de migraciones en un entorno
limpio. El defecto no era hipotético.

### Corrección aplicada

`GRANT INSERT ON public.policy_source_registry` ahora va dentro de un bloque
`DO $$` con guard `to_regclass(...) IS NOT NULL`, siguiendo el estilo ya usado en
`migrations/20260921223222_phase-2-evidence-ingestion.sql:13` y
`migrations/20260924120000_ai-human-comparison.sql:12` (mismo esqueleto
`DO $$ / BEGIN / IF ... THEN / END IF; / END $$;`):

```sql
DO $$
BEGIN
  IF to_regclass('public.policy_source_registry') IS NOT NULL THEN
    GRANT INSERT ON public.policy_source_registry TO authenticated;
  END IF;
END $$;
```

Se eligió `to_regclass` sobre `information_schema.tables` porque no filtra por
privilegios del rol actual: `information_schema` solo muestra tablas sobre las
que el rol tiene algún privilegio, lo que haría el guard silenciosamente falso
justo en el caso que intenta proteger.

### Prueba de que el guard funciona

| Prueba | Resultado |
|---|---|
| `to_regclass` sobre tabla real (`policy_source_registry`) | `true` → el GRANT **se ejecuta** |
| `to_regclass` sobre tabla inexistente | `false` → el GRANT **se omite** |
| Bloque `DO` completo sobre tabla inexistente | `Query executed successfully` / `EXIT_CON_GUARD_real=0` |
| Variante `EXCEPTION WHEN undefined_table THEN NULL` sobre tabla inexistente | `Query executed successfully` / `EXIT_EXCEPTON_BLOCK=0` |
| `GRANT` sin guard sobre tabla inexistente (control negativo) | `Error: relation ... does not exist` / `EXIT_SIN_GUARD=1` |

El guard es un no-op seguro en entorno limpio y sigue otorgando el privilegio en
la BD viva. No es decorativo: sin él el exit code es 1.

## A.2 I-2 — Los comentarios afirmaban una premisa falsa (corregido)

### Premisa verificada de forma independiente

3 de los 4 privilegios **ya estaban declarados** en el historial del repo:

```
migrations/20260924101000_phase-6-policy-engine.sql:32
  GRANT SELECT, INSERT ON public.engine_runs, public.engine_rule_results TO authenticated;

migrations/20260923220000_phase-5-fact-model-shadow.sql:52
  GRANT SELECT, INSERT, UPDATE ON public.fact_extraction_runs TO authenticated;
```

El comentario original ("el privilegio SQL correspondiente no estaba otorgado",
"privilegio SELECT únicamente") describía mal la causa: la divergencia estaba
**entre el historial versionado y la BD viva**, no entre la política y una
omisión del historial. Solo el `INSERT` de `policy_source_registry` era una
omisión real del historial, y por una causa distinta: la tabla nunca se creó en
`migrations/`.

### Corrección aplicada

Se reescribieron el header y los comentarios por línea para registrar el hecho
real, con cita exacta de archivo y línea como fuente:

- El header ahora dice que el historial **ya declaraba** 3 de los 4
  privilegios, cita las dos líneas de historial que los declaran, y aclara que
  esta migración **alinea la BD con el historial**.
- Se marca explícitamente que el cuarto privilegio sí era omisión real del
  historial, y **por qué**: la tabla no está creada en `migrations/`.
- Los comentarios por línea ya no dicen "privilegio SELECT únicamente"; dicen
  qué declaraba el historial y qué le faltaba a la BD viva.
- **Cero** afirmaciones de "nunca se otorgó" sobreviven. Se
  conservó la evidencia de `postgres.logs` y la explicación de por qué importa
  (Postgres evalúa el privilegio antes que RLS), porque ambas siguen siendo
  ciertas.

## A.3 I-3 — El script de verificación declaraba una capacidad inexistente (corregido)

Solo se corrigió el comentario. **No** se añadió lógica de exit code, según lo
indicado (queda para tarea aparte).

El comentario nuevo dice la verdad: es un reporte read-only, una fila por
(tabla, comando) con `OK`/`MISSING`, **no es un gate**, `db query` devuelve exit
0 tanto con filas `MISSING` como con filas `OK`, y **no debe cablearse a CI**
esperando que corte la build.

### Hallazgo que refina el diagnóstico de I-3

Durante la verificación se midió que `db query` **sí** devuelve exit 1 ante un
error SQL duro (`EXIT_SIN_GUARD_real=1`). O sea, la runner no es del todo
inmune: el problema specifico es otro y más preciso que el enunciado en I-3.

> `db query` **sí** propaga exit 1 en error SQL duro. Lo que **no** puede hacer
> un `SELECT` plano es fallar por un resultado: devolver filas `MISSING` es una
> consulta exitosa, luego exit 0.

Consecuencia para la tarea que implementará el gate: no hace falta inventar
mecanismo de propagación de errores en el CLI (esa parte ya funciona); hace falta
convertir "hay filas `MISSING`" en "error", por ejemplo con una función
`plpgsql`/CTE que lance `RAISE EXCEPTION` cuando el conteo de `MISSING` > 0, que
el runner sí traduce a exit 1. Esto **no** se implementó aquí.

## A.4 Verificación ejecutada antes del commit

Todas las órdenes desde `/tmp/opencode/insforge-probe` con
`npx -y @insforge/cli`, usando la forma real `db query -- "<sql>"`.

| # | Verificación | Resultado |
|---|---|---|
| 0 | Baseline del script de verificación antes de editar | 9 filas, todas `OK` |
| 1 | Cuerpo completo de la migración corregida ejecutado contra la BD | `Query executed successfully` / `No rows returned` / exit 0 → SQL válido,incluido el `DO $$` |
| 2 | `scripts/verify-rls-grants.sql` tras la corrección | **9 filas, todas `OK`** |
| 3 | ACL cruda en `information_schema.role_table_grants` | 9 filas: `engine_rule_results` INSERT/SELECT, `engine_runs` INSERT/SELECT, `fact_extraction_runs` INSERT/SELECT/UPDATE, `policy_source_registry` INSERT/SELECT |
| 4 | Guard sobre tabla inexistente | exit 0 (no-op) |
| 5 | Control negativo: `GRANT` sin guard sobre tabla inexistente | `Error: relation ... does not exist`, exit 1 |
| 6 | Migración sigue registrada en `system.custom_migrations` | `20260926090000` / `fix-rls-grants-engine-fact` |

Sobre #1: la migración ya estaba aplicada, así que no se re-aplicó vía
`db migrations up` (que la habría omitido por versión). Se ejecutó el **cuerpo
completo del archivo** vía `db query` para validar de facto la sintaxis del `DO
$$` y confirmar la idempotencia en la BD real. Es seguro por construcción: la
migración es aditiva, sus `GRANT` son idempotentes y no contiene `TRUNCATE`,
`DROP` ni `DELETE`.

Sobre #3: `policy_source_registry/INSERT` sigue presente, lo que confirma que el
guard **no** degradó el privilegio a no-op en la BD viva.

## A.5 Resultado

Los 9 privilegios verificados siguen `OK` después de la corrección. La
migración sigue siendo aditiva e idempotente, ya no rompe un entorno limpio, y
sus comentarios ahora describen la causa real en lugar de una premisa falsa.
