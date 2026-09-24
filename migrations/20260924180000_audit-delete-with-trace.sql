-- ---------------------------------------------------------------------------
-- Borrado de auditorías con trazabilidad obligatoria.
--
-- Todo borrado de auditorías pasa por public.delete_audit(): la función valida
-- autorización (creador de la auditoría o rol OWNER) y escribe SIEMPRE una
-- entrada permanente en public.audit_log registrando quién lo hizo (actor),
-- cuándo y sobre qué expediente, incluso después de eliminar la auditoría.
-- ---------------------------------------------------------------------------

-- 1) El log sobrevive al borrado de la auditoría: al eliminar el padre,
--    audit_id pasa a NULL (queda como registro global de trazabilidad).
ALTER TABLE public.audit_log
  DROP CONSTRAINT IF EXISTS audit_log_audit_id_fkey;

ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_audit_id_fkey
  FOREIGN KEY (audit_id) REFERENCES public.audits(id) ON DELETE SET NULL;

-- 2) Bloquear el DELETE directo sobre audits: solo public.delete_audit() puede
--    eliminar auditorías, garantizando la bitácora.
REVOKE DELETE ON public.audits FROM anon, authenticated;

-- 3) Función RPC de borrado con autorización y trazabilidad.
CREATE OR REPLACE FUNCTION public.delete_audit(
  p_audit_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS TABLE (
  audit_id uuid,
  external_case_id text,
  display_name text,
  status text,
  deleted_by uuid,
  deleted_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_audit public.audits;
  v_role text := COALESCE(public.current_app_role(), '');
BEGIN
  -- Solo usuarios autenticados pueden eliminar auditorías.
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT * INTO v_audit
  FROM public.audits
  WHERE id = p_audit_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AUDIT_NOT_FOUND';
  END IF;

  -- Misma regla que el resto de la app: el creador de la auditoría o rol OWNER.
  IF NOT (v_audit.created_by = v_actor_id OR v_role = 'OWNER') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  -- Bitácora permanente (sobrevive al DELETE gracias al FK en SET NULL).
  INSERT INTO public.audit_log (audit_id, event_type, actor_id, metadata)
  VALUES (
    p_audit_id,
    'AUDIT_DELETED',
    v_actor_id,
    jsonb_build_object(
      'reason', p_reason,
      'externalCaseId', v_audit.external_case_id,
      'displayName', v_audit.display_name,
      'status', v_audit.status,
      'createdBy', v_audit.created_by,
      'deletedByRole', NULLIF(v_role, '')
    )
  );

  -- Borrado real; los datos hijos se van por CASCADE y el log queda global.
  DELETE FROM public.audits
  WHERE id = p_audit_id;

  RETURN QUERY
  SELECT
    p_audit_id,
    v_audit.external_case_id,
    v_audit.display_name,
    v_audit.status,
    v_actor_id,
    now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_audit(uuid, text) TO authenticated;