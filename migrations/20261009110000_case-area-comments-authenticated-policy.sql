-- Acota las políticas RLS de comentarios al rol authenticated.
--
-- La migración original omitió `TO authenticated`, por lo que PostgreSQL
-- registró las tres políticas para PUBLIC. Hoy `anon` y `authenticated` no
-- tienen privilegios de tabla y el servidor usa project_admin; aun así, la
-- política debe expresar la frontera prevista para evitar que un grant futuro
-- extienda accidentalmente el acceso.

DROP POLICY IF EXISTS case_area_comments_select_own ON public.case_area_comments;
CREATE POLICY case_area_comments_select_own
  ON public.case_area_comments
  FOR SELECT TO authenticated
  USING (created_by = auth.uid());

DROP POLICY IF EXISTS case_area_comments_insert_own ON public.case_area_comments;
CREATE POLICY case_area_comments_insert_own
  ON public.case_area_comments
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS case_area_comments_update_own ON public.case_area_comments;
CREATE POLICY case_area_comments_update_own
  ON public.case_area_comments
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

DO $verify$
DECLARE
  v_invalid text;
BEGIN
  SELECT string_agg(policyname, ', ' ORDER BY policyname)
    INTO v_invalid
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'case_area_comments'
    AND policyname IN (
      'case_area_comments_select_own',
      'case_area_comments_insert_own',
      'case_area_comments_update_own'
    )
    AND roles <> ARRAY['authenticated']::name[];

  IF v_invalid IS NOT NULL OR (
    SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'case_area_comments'
      AND policyname IN (
        'case_area_comments_select_own',
        'case_area_comments_insert_own',
        'case_area_comments_update_own'
      )
  ) <> 3 THEN
    RAISE EXCEPTION
      'CASE_AREA_COMMENTS_POLICY_SCOPE_INVALID: las tres políticas deben limitarse a authenticated. Policies: %',
      COALESCE(v_invalid, 'missing');
  END IF;
END
$verify$;
