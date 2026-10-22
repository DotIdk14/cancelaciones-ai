-- Retira exclusivamente el flujo administrativo de la importación Excel.
-- Conserva casos, asignaciones, datos de origen, originales, auditorías y revisiones humanas.
-- Aplicación por runner oficial, en una única transacción; nunca CASCADE.
CREATE OR REPLACE FUNCTION public.choose_case_advisor()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$

  SELECT m.user_id FROM public.app_memberships m

  LEFT JOIN (SELECT c.assigned_to, count(*) n FROM public.cases c

    WHERE c.assigned_to IS NOT NULL AND c.status <> 'COMPLETED'

      AND NOT c.is_test AND c.merged_into_case_id IS NULL

      AND NOT EXISTS (SELECT 1 FROM public.case_reviews r WHERE r.case_id=c.id AND r.coordinator_decision IS NOT NULL)

    GROUP BY c.assigned_to) l ON l.assigned_to=m.user_id

  WHERE m.role='user' ORDER BY coalesce(l.n,0),m.user_id LIMIT 1

$function$
;
CREATE OR REPLACE FUNCTION public.assign_case(p_case_id uuid, p_assigned_to uuid, p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$

BEGIN

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('flokzu-import-global-lock',0));

  IF NOT EXISTS(SELECT 1 FROM public.app_memberships WHERE user_id=p_actor AND role='coordinator') THEN

    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Sin permiso';

  END IF;

  PERFORM 1 FROM public.cases WHERE id=p_case_id AND merged_into_case_id IS NULL FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Expediente no encontrado'; END IF;

  IF EXISTS(SELECT 1 FROM public.case_reviews WHERE case_id=p_case_id AND coordinator_decision IS NOT NULL) THEN

    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Expediente finalizado';

  END IF;

  IF p_assigned_to IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.app_memberships WHERE user_id=p_assigned_to AND role='user') THEN

    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Responsable no elegible';

  END IF;

  UPDATE public.cases SET assigned_to=p_assigned_to,updated_at=now() WHERE id=p_case_id;

END $function$
;
REVOKE ALL ON FUNCTION public.assign_case(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assign_case(uuid,uuid,uuid) TO project_admin;
CREATE OR REPLACE FUNCTION public.consolidate_confirmed_cases(p_primary uuid, p_secondary uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$

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

  UPDATE public.cases SET merged_into_case_id=a.id,assigned_to=NULL,updated_at=now() WHERE id=b.id;

END $function$
;
DROP FUNCTION public.commit_flokzu_import(uuid,uuid,jsonb);
DROP FUNCTION public.expire_flokzu_import_previews();
DROP FUNCTION public.get_flokzu_manual_matches(jsonb);
DROP FUNCTION public.merge_empty_flokzu_shell(uuid,uuid,text);
DROP FUNCTION public.sync_flokzu_administration(uuid,text,text,boolean,jsonb,uuid,uuid);
DROP FUNCTION public.decide_flokzu_ticket(uuid,jsonb);
DROP FUNCTION public.link_manual_cave_reference(uuid,text,text);
DROP FUNCTION public.flokzu_admin_snapshot(cases);
DROP FUNCTION public.assign_manual_case(uuid,uuid,uuid);
DROP TABLE public.flokzu_admin_events;
DROP TABLE public.case_import_batches;
DROP INDEX public.cases_flokzu_review_idx;
ALTER TABLE public.cases
  DROP COLUMN flokzu_classification,
  DROP COLUMN flokzu_review_state,
  DROP COLUMN flokzu_audit_eligible,
  DROP COLUMN flokzu_discrepancy,
  DROP COLUMN flokzu_reason,
  DROP COLUMN flokzu_revision;
DO $verify$
BEGIN
 IF to_regclass('public.case_import_batches') IS NOT NULL OR to_regclass('public.flokzu_admin_events') IS NOT NULL
 OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cases'
 AND column_name IN ('flokzu_classification','flokzu_review_state','flokzu_audit_eligible','flokzu_discrepancy','flokzu_reason','flokzu_revision'))
 THEN RAISE EXCEPTION 'La limpieza administrativa quedó incompleta'; END IF;
 IF has_function_privilege('anon','public.assign_case(uuid,uuid,uuid)','EXECUTE')
 OR has_function_privilege('authenticated','public.assign_case(uuid,uuid,uuid)','EXECUTE')
 OR NOT has_function_privilege('project_admin','public.assign_case(uuid,uuid,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'Permisos incorrectos en la asignación de expedientes'; END IF;
 IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'
 AND (p.prosrc LIKE '%flokzu_audit_eligible%' OR p.prosrc LIKE '%flokzu_review_state%' OR p.prosrc LIKE '%flokzu_admin_events%' OR p.prosrc LIKE '%case_import_batches%'))
 THEN RAISE EXCEPTION 'Quedaron funciones dependientes del flujo retirado'; END IF;
END $verify$;
