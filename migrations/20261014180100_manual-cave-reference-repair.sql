-- Reparación administrativa con referencia explícita de un archivo original.
-- No interpreta el procedimiento, no genera dictámenes ni modifica originales.
CREATE FUNCTION public.link_manual_cave_reference(p_case_id uuid,p_external_case_id text,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.cases; refs text[];
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('flokzu-import-global-lock',0));
  SELECT * INTO c FROM public.cases WHERE id=p_case_id FOR UPDATE;
  SELECT array_agg(DISTINCT 'CaVe-'||substring(r[1] FROM 6)) INTO refs
    FROM public.evidence e CROSS JOIN LATERAL regexp_matches(e.filename,'CaVe-[0-9]{1,16}','gi') r WHERE e.case_id=p_case_id;
  IF c.id IS NULL OR c.external_source IS NOT NULL OR c.merged_into_case_id IS NOT NULL OR c.is_test
    OR p_external_case_id IS NULL OR p_external_case_id !~ '^CaVe-[0-9]{1,16}$'
    OR coalesce(cardinality(refs),0)<>1 OR refs[1] IS DISTINCT FROM p_external_case_id
    OR p_reason IS NULL OR length(trim(p_reason))<10
    OR EXISTS(SELECT 1 FROM public.cases WHERE external_case_id=p_external_case_id)
    OR EXISTS(SELECT 1 FROM public.audits WHERE case_id=p_case_id AND status='RUNNING') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='La vinculación requiere una referencia de archivo inequívoca y libre';
  END IF;
  UPDATE public.cases SET external_source='FLOKZU',external_case_id=p_external_case_id,
    flokzu_reason=p_reason,updated_at=now() WHERE id=c.id;
  INSERT INTO public.flokzu_admin_events(case_id,action,reason,before_snapshot,after_snapshot)
    SELECT c.id,'IMPORT',p_reason,public.flokzu_admin_snapshot(c),public.flokzu_admin_snapshot(current_case)
    FROM public.cases current_case WHERE current_case.id=c.id;
END $$;
REVOKE ALL ON FUNCTION public.link_manual_cave_reference(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.link_manual_cave_reference(uuid,text,text) TO project_admin;
DO $verify$
BEGIN
  IF has_function_privilege('authenticated','public.link_manual_cave_reference(uuid,text,text)','EXECUTE')
    OR has_function_privilege('anon','public.link_manual_cave_reference(uuid,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Referencia CaVe: RPC expuesto';
  END IF;
END $verify$;
