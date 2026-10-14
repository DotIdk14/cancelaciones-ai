-- Pendiente de validación explícita y reconciliación del ledger; no aplicar automáticamente.
ALTER TABLE public.audits ADD COLUMN IF NOT EXISTS retired_at timestamptz;
ALTER TABLE public.audits ADD COLUMN IF NOT EXISTS retired_by uuid REFERENCES auth.users(id);
CREATE INDEX IF NOT EXISTS cases_student_history_idx ON public.cases(student_identifier, created_at DESC, id DESC);
-- Decisiones administrativas inmutables. No contienen política ni dictámenes.
CREATE TABLE public.case_request_relations (
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE RESTRICT,
  other_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE RESTRICT,
  same_request boolean NOT NULL,
  primary_id uuid REFERENCES public.cases(id) ON DELETE RESTRICT,
  note text NOT NULL CHECK (length(note) BETWEEN 1 AND 2000),
  decided_by uuid NOT NULL REFERENCES auth.users(id),
  decided_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(case_id,other_id), CHECK(case_id < other_id),
  CHECK ((same_request AND primary_id IN (case_id,other_id)) OR (NOT same_request AND primary_id IS NULL))
);
ALTER TABLE public.case_request_relations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.case_request_relations FROM anon, authenticated;
GRANT SELECT, INSERT ON public.case_request_relations TO project_admin;
CREATE FUNCTION public.reconcile_case_requests(p_case_id uuid,p_other_id uuid,p_primary_id uuid,p_same_request boolean,p_note text,p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.cases; b public.cases; secondary uuid;
BEGIN
  -- Serializa conciliaciones para impedir ciclos y principales incompatibles.
  PERFORM pg_advisory_xact_lock(60131012);
  IF NOT EXISTS(SELECT 1 FROM app_memberships WHERE user_id=p_actor AND role='coordinator') THEN RAISE EXCEPTION 'Sin permiso'; END IF;
  SELECT * INTO STRICT a FROM cases WHERE id=p_case_id FOR UPDATE;
  SELECT * INTO STRICT b FROM cases WHERE id=p_other_id FOR UPDATE;
  IF a.id=b.id OR a.is_test IS DISTINCT FROM b.is_test THEN RAISE EXCEPTION 'Expedientes incompatibles'; END IF;
  IF NOT p_same_request AND a.external_case_id IS NOT NULL AND lower(trim(a.external_case_id))=lower(trim(b.external_case_id)) THEN RAISE EXCEPTION 'Un mismo ticket no admite solicitudes diferentes'; END IF;
  IF p_same_request THEN
    IF p_primary_id NOT IN (a.id,b.id) OR p_primary_id IS NULL THEN RAISE EXCEPTION 'Principal inválido'; END IF;
    secondary := CASE WHEN p_primary_id=a.id THEN b.id ELSE a.id END;
    IF EXISTS(SELECT 1 FROM case_request_relations r WHERE r.same_request AND
      ((r.primary_id<>p_primary_id AND p_primary_id IN (r.case_id,r.other_id)) OR
       secondary IN (r.case_id,r.other_id))) THEN RAISE EXCEPTION 'Relación previa incompatible'; END IF;
    IF EXISTS(SELECT 1 FROM audits WHERE case_id IN (a.id,b.id) AND status='RUNNING') THEN RAISE EXCEPTION 'Auditoría en curso'; END IF;
  END IF;
  INSERT INTO case_request_relations VALUES(least(a.id,b.id),greatest(a.id,b.id),p_same_request,p_primary_id,trim(p_note),p_actor,now());
END $$;
CREATE FUNCTION public.audit_relation_preflight(p_case_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
SELECT jsonb_build_object('blocked',
  EXISTS(SELECT 1 FROM case_request_relations r WHERE r.same_request AND p_case_id IN(r.case_id,r.other_id) AND r.primary_id<>p_case_id)
  OR EXISTS(SELECT 1 FROM cases b JOIN cases a ON a.id=p_case_id WHERE b.id<>a.id AND a.is_test=b.is_test
    AND a.external_case_id IS NOT NULL AND lower(trim(a.external_case_id))=lower(trim(b.external_case_id))
    AND NOT EXISTS(SELECT 1 FROM case_request_relations r WHERE r.case_id=least(a.id,b.id) AND r.other_id=greatest(a.id,b.id))),
  'primaryId',(SELECT r.primary_id FROM case_request_relations r WHERE r.same_request AND p_case_id IN(r.case_id,r.other_id) AND r.primary_id<>p_case_id LIMIT 1))
$$;
CREATE FUNCTION public.student_case_history(p_case_id uuid,p_actor uuid,p_offset integer DEFAULT 0,p_limit integer DEFAULT 20) RETURNS jsonb
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
      count(DISTINCT coalesce((SELECT CASE WHEN p.external_case_id IS NOT NULL THEN 'ticket:'||lower(trim(p.external_case_id)) ELSE 'case:'||p.id::text END FROM case_request_relations r JOIN cases p ON p.id=r.primary_id WHERE r.same_request AND c.id IN(r.case_id,r.other_id) AND r.primary_id<>c.id LIMIT 1),CASE WHEN c.external_case_id IS NOT NULL THEN 'ticket:'||lower(trim(c.external_case_id)) ELSE 'case:'||c.id::text END)) requests,
      (SELECT count(*) FROM audits a WHERE a.case_id IN(SELECT id FROM scoped)) audits,
      (SELECT count(*) FROM evidence e WHERE e.case_id IN(SELECT id FROM scoped)) evidences FROM scoped c
  ), page AS (SELECT * FROM scoped ORDER BY created_at DESC,id DESC OFFSET p_offset LIMIT p_limit)
  SELECT jsonb_build_object('studentIdentifier',target.student_identifier,'totalCases',t.n,'uniqueTickets',t.tickets,'uniqueRequests',t.requests,
    'totalAudits',t.audits,'totalEvidence',t.evidences,'lastRequest',t.last_request,
    'nextOffset',CASE WHEN p_offset+p_limit<t.n THEN p_offset+p_limit ELSE NULL END,
    'items',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',c.id,'externalCaseId',c.external_case_id,'createdAt',c.created_at,'status',c.status,'studentName',c.student_name,
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
REVOKE ALL ON FUNCTION public.student_case_history(uuid,uuid,integer,integer),public.audit_relation_preflight(uuid),public.reconcile_case_requests(uuid,uuid,uuid,boolean,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.student_case_history(uuid,uuid,integer,integer),public.audit_relation_preflight(uuid),public.reconcile_case_requests(uuid,uuid,uuid,boolean,text,uuid) TO project_admin;
DO $verify$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='cases_student_history_idx') THEN RAISE EXCEPTION 'Índice ausente'; END IF;
 IF has_function_privilege('authenticated','public.student_case_history(uuid,uuid,integer,integer)','EXECUTE') THEN RAISE EXCEPTION 'RPC expuesta'; END IF;
END $verify$;

CREATE FUNCTION public.dashboard_request_identities(p_case_ids uuid[]) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('students',count(DISTINCT c.student_identifier),'tickets',count(DISTINCT lower(trim(c.external_case_id))), 'caseFiles',count(*),
 'requests',count(DISTINCT coalesce((SELECT CASE WHEN p.external_case_id IS NOT NULL THEN 'ticket:'||lower(trim(p.external_case_id)) ELSE 'case:'||p.id::text END FROM case_request_relations r JOIN cases p ON p.id=r.primary_id WHERE r.same_request AND c.id IN(r.case_id,r.other_id) AND r.primary_id<>c.id LIMIT 1),CASE WHEN c.external_case_id IS NOT NULL THEN 'ticket:'||lower(trim(c.external_case_id)) ELSE 'case:'||c.id::text END))) FROM cases c WHERE NOT c.is_test AND c.id=ANY(p_case_ids)
$$;
REVOKE ALL ON FUNCTION public.dashboard_request_identities(uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_request_identities(uuid[]) TO project_admin;

DO $views$ BEGIN
 IF to_regclass('public.current_audit_evaluation_metrics') IS NOT NULL THEN
  EXECUTE 'CREATE OR REPLACE VIEW public.current_audit_evaluation_metrics AS SELECT e.* FROM public.audit_evaluation_metrics e JOIN public.audits a ON a.id=e.id WHERE e.is_current_version AND a.retired_at IS NULL';
 END IF;
END $views$;
