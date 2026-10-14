-- La ficha archivada sigue en el historial, pero comparte identidad de solicitud.
CREATE FUNCTION public.case_request_identity(p_case_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH selected AS (SELECT coalesce(c.merged_into_case_id,c.id) id FROM public.cases c WHERE c.id=p_case_id),
  principal AS (SELECT coalesce((SELECT r.primary_id FROM public.case_request_relations r
    WHERE r.same_request AND s.id IN(r.case_id,r.other_id) AND r.primary_id<>s.id LIMIT 1),s.id) id FROM selected s)
  SELECT CASE WHEN c.external_case_id IS NOT NULL THEN 'ticket:'||lower(trim(c.external_case_id)) ELSE 'case:'||c.id::text END
    FROM public.cases c JOIN principal p ON p.id=c.id
$$;
REVOKE ALL ON FUNCTION public.case_request_identity(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.case_request_identity(uuid) TO project_admin;
CREATE OR REPLACE FUNCTION public.student_case_history(p_case_id uuid,p_actor uuid,p_offset integer DEFAULT 0,p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE target public.cases; payload jsonb;
BEGIN
  IF p_offset<0 OR p_limit<1 OR p_limit>50 THEN RAISE EXCEPTION 'Paginación inválida'; END IF;
  IF NOT EXISTS(SELECT 1 FROM app_memberships WHERE user_id=p_actor AND role IN ('user','coordinator','manager')) THEN RAISE EXCEPTION 'Sin permiso'; END IF;
  SELECT * INTO STRICT target FROM cases WHERE id=p_case_id;
  WITH scoped AS (
    SELECT c.* FROM cases c WHERE (target.student_identifier IS NOT NULL AND c.student_identifier=target.student_identifier) OR c.id=target.id
  ), totals AS (
    SELECT count(*) n, max(coalesce(c.flokzu_data->'procedure'->>'requestDate',c.created_at::text)) last_request,
      count(DISTINCT lower(trim(c.external_case_id))) tickets,
      count(DISTINCT public.case_request_identity(c.id)) requests,
      (SELECT count(*) FROM audits a WHERE a.case_id IN(SELECT id FROM scoped)) audits,
      (SELECT count(*) FROM evidence e WHERE e.case_id IN(SELECT id FROM scoped)) evidences FROM scoped c
  ), page AS (SELECT * FROM scoped ORDER BY created_at DESC,id DESC OFFSET p_offset LIMIT p_limit)
  SELECT jsonb_build_object('studentIdentifier',target.student_identifier,'totalCases',t.n,'uniqueTickets',t.tickets,'uniqueRequests',t.requests,
    'totalAudits',t.audits,'totalEvidence',t.evidences,'lastRequest',t.last_request,
    'nextOffset',CASE WHEN p_offset+p_limit<t.n THEN p_offset+p_limit ELSE NULL END,
    'items',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'mergedIntoCaseId',c.merged_into_case_id,'id',c.id,'externalCaseId',c.external_case_id,'createdAt',c.created_at,'status',c.status,'studentName',c.student_name,
      'creatorId',c.created_by,'assignedTo',c.assigned_to,'isTest',c.is_test,'flokzuData',c.flokzu_data,
      'evidenceCount',(SELECT count(*) FROM evidence e WHERE e.case_id=c.id),
      'auditCount',(SELECT count(*) FROM audits a WHERE a.case_id=c.id),
      'latestResult',(SELECT a.result_json->'audit'->>'result' FROM audits a WHERE a.case_id=c.id AND a.status='COMPLETED' ORDER BY a.created_at DESC,a.id DESC LIMIT 1),
      'normativeSection',(SELECT a.result_json->'audit'->>'procedureSection' FROM audits a WHERE a.case_id=c.id AND a.status='COMPLETED' ORDER BY a.created_at DESC,a.id DESC LIMIT 1),
      'finalResolution',(SELECT CASE WHEN r.coordinator_decision='CHANGE' THEN r.coordinator_resolution ELSE r.result END FROM case_reviews r WHERE r.case_id=c.id AND r.coordinator_decision IS NOT NULL LIMIT 1),
      'workflowState',coalesce((SELECT CASE WHEN r.coordinator_decision IS NULL THEN 'PENDING_COORDINATOR' ELSE 'FINALIZED' END FROM case_reviews r WHERE r.case_id=c.id LIMIT 1),'PENDING_ADVISOR'),
      'versions',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'status',a.status,'createdAt',a.created_at,'result',a.result_json->'audit'->>'result','retired',a.retired_at IS NOT NULL) ORDER BY a.created_at DESC,a.id DESC) FROM audits a WHERE a.case_id=c.id),'[]'::jsonb)
    ) ORDER BY c.created_at DESC,c.id DESC) FROM page c),'[]'::jsonb)) INTO payload FROM totals t;
  RETURN payload;
END $$;

CREATE OR REPLACE FUNCTION public.dashboard_request_identities(p_case_ids uuid[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('students',count(DISTINCT c.student_identifier),'tickets',count(DISTINCT lower(trim(c.external_case_id))),
    'caseFiles',count(*),'requests',count(DISTINCT public.case_request_identity(c.id)))
    FROM public.cases c WHERE NOT c.is_test AND c.merged_into_case_id IS NULL AND c.id=ANY(p_case_ids)
$$;
DO $verify$
BEGIN
  IF has_function_privilege('anon','public.case_request_identity(uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.student_case_history(uuid,uuid,integer,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'Historial de consolidación: RPC expuesto';
  END IF;
END $verify$;
