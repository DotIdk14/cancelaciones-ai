-- Restringe los RPC SECURITY DEFINER heredados que no son una API pública.
-- La aplicación actual usa el cliente administrativo server-side y solo las
-- funciones citadas directamente por políticas RLS conservan EXECUTE para
-- authenticated. Los triggers se ejecutan sin grants de llamada directa.
DO $restrict_security_definer$
DECLARE
  v_function record;
BEGIN
  FOR v_function IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      v_function.signature
    );
  END LOOP;
END
$restrict_security_definer$;

-- These six SECURITY DEFINER helpers are invoked by existing authenticated
-- RLS policies; preserve their policy evaluation while closing direct RPCs.
GRANT EXECUTE ON FUNCTION
  public.can_see_audit(uuid),
  public.current_app_role(),
  public.is_admin_or_owner_by_evidence(uuid),
  public.is_admin_or_owner_by_run(uuid),
  public.is_admin_or_owner(uuid),
  public.rule_is_draft(uuid)
TO authenticated;

DO $verify_security_definer$
DECLARE
  v_unsafe text;
  v_missing_policy_functions text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text)
    INTO v_unsafe
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND (
      has_function_privilege('anon', p.oid, 'EXECUTE')
      OR (
        has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND p.oid::regprocedure::text NOT IN (
          'can_see_audit(uuid)',
          'current_app_role()',
          'is_admin_or_owner_by_evidence(uuid)',
          'is_admin_or_owner_by_run(uuid)',
          'is_admin_or_owner(uuid)',
          'rule_is_draft(uuid)'
        )
      )
    );

  IF v_unsafe IS NOT NULL THEN
    RAISE EXCEPTION 'security_definer_public_execute_remains: %', v_unsafe;
  END IF;

  SELECT string_agg(required.signature, ', ' ORDER BY required.signature)
    INTO v_missing_policy_functions
  FROM (VALUES
    ('can_see_audit(uuid)'),
    ('current_app_role()'),
    ('is_admin_or_owner_by_evidence(uuid)'),
    ('is_admin_or_owner_by_run(uuid)'),
    ('is_admin_or_owner(uuid)'),
    ('rule_is_draft(uuid)')
  ) AS required(signature)
  WHERE NOT has_function_privilege(
    'authenticated',
    required.signature::regprocedure,
    'EXECUTE'
  );

  IF v_missing_policy_functions IS NOT NULL THEN
    RAISE EXCEPTION 'security_definer_policy_execute_missing: %', v_missing_policy_functions;
  END IF;
END
$verify_security_definer$;
