### Tarea 1: Migración correctiva de GRANT RLS

**Archivos:**
- Crear: `migrations/20260926090000_fix-rls-grants-engine-fact.sql`
- Crear: `scripts/verify-rls-grants.sql`

**Interfaces:**
- Consume: políticas RLS existentes en `fact_extraction_runs`, `engine_runs`, `engine_rule_results`, `policy_source_registry`.
- Produce: las 4 tablas con privilegios que coinciden con sus políticas.

**Contexto verificado en producción.** Hay 9 políticas para el rol `authenticated` en 4 tablas, pero los privilegios SQL no las respaldan:

| Tabla | Políticas `cmd` | `GRANT` actual | Falta |
|---|---|---|---|
| `engine_runs` | `INSERT`, `SELECT` | `SELECT` | `INSERT` |
| `engine_rule_results` | `INSERT`, `SELECT` | `SELECT` | `INSERT` |
| `fact_extraction_runs` | `INSERT`, `SELECT`, `UPDATE` | `INSERT, SELECT` | `UPDATE` |
| `policy_source_registry` | `INSERT`, `SELECT` | `SELECT` | `INSERT` |

Sin el privilegio, Postgres responde `permission denied for table ...` antes de evaluar RLS, así que la política nunca llega a aplicarse. Evidencia en producción: `permission denied for table fact_extraction_runs`.

- [ ] **Paso 1: Escribir el script de verificación que falla hoy**

Este script debe reportar divergencias entre política y privilegio. Lo escribes primero para confirmar que detecta el bug antes de arreglarlo.

Crea `scripts/verify-rls-grants.sql`:

```sql
-- Verificación read-only de paridad entre políticas RLS y privilegios SQL.
-- No modifica nada. Sale con código 1 si hay divergencias.
WITH policy_cmds AS (
  SELECT tablename, cmd
  FROM pg_policies
  WHERE schemaname = 'public'
    AND roles @> ARRAY['authenticated']::name[]
    AND tablename IN (
      'engine_runs',
      'engine_rule_results',
      'fact_extraction_runs',
      'policy_source_registry'
    )
),
granted AS (
  SELECT table_name, privilege_type
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND grantee = 'authenticated'
    AND table_name IN (
      'engine_runs',
      'engine_rule_results',
      'fact_extraction_runs',
      'policy_source_registry'
    )
)
SELECT
  p.tablename                AS table_name,
  p.cmd                      AS policy_command,
  CASE WHEN g.privilege_type IS NULL THEN 'MISSING' ELSE 'OK' END AS privilege_state
FROM policy_cmds p
LEFT JOIN granted g
  ON g.table_name = p.tablename
 AND upper(g.privilege_type) = upper(p.cmd)
ORDER BY p.tablename, p.cmd;
```

- [ ] **Paso 2: Ejecutar la verificación y confirmar que falla**

```bash
cd /tmp/opencode/insforge-probe
npx @insforge/cli db query "$(cat /home/idk/Escritorio/cancelaciones-ai/scripts/verify-rls-grants.sql)" 2>&1 | tail -20
```

Esperado: 4 filas con `privilege_state = MISSING` (`engine_runs/INSERT`, `engine_rule_results/INSERT`, `fact_extraction_runs/UPDATE`, `policy_source_registry/INSERT`).

Si no aparecen las 4, **para**. La premisa del plan es incorrecta y hay que reevaluar.

- [ ] **Paso 3: Escribir la migración correctiva**

Crea `migrations/20260926090000_fix-rls-grants-engine-fact.sql`. Solo otorga privilegios. No toca políticas, no toca datos, no elimina nada.

```sql
-- Corrige paridad entre políticas RLS y privilegios SQL.
-- Contexto: las políticas ya existían para el rol `authenticated`, pero el
-- privilegio SQL correspondiente no estaba otorgado. Postgres responde
-- `permission denied for table ...` ANTES de evaluar RLS, por lo que las
-- políticas nunca se aplicaban. Evidencia: postgres.logs ->
-- "permission denied for table fact_extraction_runs" (2026-09-26T00:09:51Z).
--
-- Aditive e idempotente: GRANT es idempotente por definición.
-- No se modifica ninguna política.

-- engine_runs: política INSERT existente, privilegio SELECT únicamente.
GRANT INSERT ON public.engine_runs TO authenticated;

-- engine_rule_results: política INSERT existente, privilegio SELECT únicamente.
GRANT INSERT ON public.engine_rule_results TO authenticated;

-- fact_extraction_runs: política UPDATE existente (congelamiento del run).
GRANT UPDATE ON public.fact_extraction_runs TO authenticated;

-- policy_source_registry: política INSERT existente (registro de fuentes).
GRANT INSERT ON public.policy_source_registry TO authenticated;
```

- [ ] **Paso 4: Aplicar la migración en el entorno de desarrollo**

```bash
cd /tmp/opencode/insforge-probe
npx @insforge/cli db apply /home/idk/Escritorio/cancelaciones-ai/migrations/20260926090000_fix-rls-grants-engine-fact.sql
```

Esperado: la operación reporta éxito. Si reporta error de sintaxis o de privilegio, **para** y lee el error completo antes de continuar.

- [ ] **Paso 5: Re-ejecutar la verificación y confirmar que ya no hay MISSING**

```bash
cd /tmp/opencode/insforge-probe
npx @insforge/cli db query "$(cat /home/idk/Escritorio/cancelaciones-ai/scripts/verify-rls-grants.sql)" 2>&1 | tail -20
```

Esperado: 9 filas, todas con `privilege_state = OK`.

- [ ] **Paso 6: Confirmar que la migración quedó registrada como aplicada**

```bash
cd /tmp/opencode/insforge-probe
npx @insforge/cli db query "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;" 2>&1 | tail -15
```

Si la tabla de migraciones tiene otro nombre, lista primero las tablas para encontrar el registro real. Esperado: aparece `20260926090000` en el historial.

- [ ] **Paso 7: Commit**

```bash
cd /home/idk/Escritorio/cancelaciones-ai
git add migrations/20260926090000_fix-rls-grants-engine-fact.sql scripts/verify-rls-grants.sql
git commit -m "fix(db): alinear GRANT con políticas RLS en tablas de engine y fact runs"
```

---

