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
