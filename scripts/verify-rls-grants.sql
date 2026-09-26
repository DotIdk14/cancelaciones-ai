-- Reporte read-only de paridad entre políticas RLS y privilegios SQL del rol
-- `authenticated`: una fila por (tabla, comando de política) con estado OK/MISSING.
-- No modifica nada.
--
-- NO es un gate. Es un SELECT plano y no controla el código de salida: el runner
-- `db query` devuelve exit 0 tanto si hay filas MISSING como si hay filas OK, así
-- que una divergencia no hace fallar nada por sí sola y este archivo no debe
-- cablearse a CI esperando que corte la build. La propagación de exit code se
-- implementa en una tarea aparte, cuando esté verificada.
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
