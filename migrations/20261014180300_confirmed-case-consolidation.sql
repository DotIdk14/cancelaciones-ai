-- Solo administración: exige confirmación humana de identidad de solicitud.
-- Los originales y dictámenes permanecen en su expediente de procedencia.
CREATE FUNCTION public.consolidate_confirmed_cases(p_primary uuid,p_secondary uuid,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.cases; b public.cases;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('flokzu-import-global-lock',0));
  PERFORM pg_catalog.pg_advisory_xact_lock(60131012);
  SELECT * INTO a FROM public.cases WHERE id=p_primary FOR UPDATE;
  SELECT * INTO b FROM public.cases WHERE id=p_secondary FOR UPDATE;
  IF a.id IS NULL OR b.id IS NULL OR a.id=b.id OR a.merged_into_case_id IS NOT NULL OR b.merged_into_case_id IS NOT NULL
    OR a.is_test IS DISTINCT FROM b.is_test OR a.student_identifier IS NULL OR a.student_identifier IS DISTINCT FROM b.student_identifier
    OR p_reason IS NULL OR length(trim(p_reason))<10
    OR b.external_case_id IS NOT NULL
    OR EXISTS(SELECT 1 FROM public.audits WHERE case_id IN(a.id,b.id) AND status='RUNNING')
    OR EXISTS(SELECT 1 FROM public.case_reviews WHERE case_id=b.id)
    OR EXISTS(SELECT 1 FROM public.case_request_relations r WHERE a.id IN(r.case_id,r.other_id) OR b.id IN(r.case_id,r.other_id)) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='La consolidación requiere confirmación y expedientes compatibles sin operaciones en curso';
  END IF;
  INSERT INTO public.case_merge_events(primary_id,secondary_id,before_primary,before_secondary,reason)
    VALUES(a.id,b.id,to_jsonb(a),to_jsonb(b),p_reason);
  UPDATE public.cases SET merged_into_case_id=a.id,assigned_to=NULL,flokzu_audit_eligible=false,updated_at=now() WHERE id=b.id;
END $$;
REVOKE ALL ON FUNCTION public.consolidate_confirmed_cases(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consolidate_confirmed_cases(uuid,uuid,text) TO project_admin;

CREATE OR REPLACE FUNCTION public.audit_relation_preflight(p_case_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
SELECT jsonb_build_object('blocked',
  EXISTS(SELECT 1 FROM public.cases c WHERE c.id=p_case_id AND c.merged_into_case_id IS NOT NULL)
  OR EXISTS(SELECT 1 FROM public.case_request_relations r WHERE r.same_request AND p_case_id IN(r.case_id,r.other_id) AND r.primary_id<>p_case_id)
  OR EXISTS(SELECT 1 FROM public.cases b JOIN public.cases a ON a.id=p_case_id WHERE b.id<>a.id AND a.is_test=b.is_test
    AND a.external_case_id IS NOT NULL AND lower(trim(a.external_case_id))=lower(trim(b.external_case_id))
    AND NOT EXISTS(SELECT 1 FROM public.case_request_relations r WHERE r.case_id=least(a.id,b.id) AND r.other_id=greatest(a.id,b.id))),
  'primaryId',coalesce((SELECT c.merged_into_case_id FROM public.cases c WHERE c.id=p_case_id),
    (SELECT r.primary_id FROM public.case_request_relations r WHERE r.same_request AND p_case_id IN(r.case_id,r.other_id) AND r.primary_id<>p_case_id LIMIT 1)))
$$;
DO $verify$
BEGIN
  IF has_function_privilege('authenticated','public.consolidate_confirmed_cases(uuid,uuid,text)','EXECUTE')
    OR has_function_privilege('anon','public.audit_relation_preflight(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'Consolidación: RPC expuesto';
  END IF;
END $verify$;
