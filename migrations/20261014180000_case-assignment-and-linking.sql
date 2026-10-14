-- Aplicar por el runner oficial después de reconciliar el ledger.
-- Comparte el bloqueo con Flokzu: reparto, creación y vinculación atómicos.
CREATE INDEX cases_manual_student_idx ON public.cases (student_identifier)
  WHERE external_source IS NULL AND NOT is_test;

ALTER TABLE public.cases ADD COLUMN separate_request_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN merged_into_case_id uuid REFERENCES public.cases(id) ON DELETE RESTRICT,
  ADD CONSTRAINT cases_not_merged_into_self CHECK (merged_into_case_id IS NULL OR merged_into_case_id<>id);
CREATE TABLE public.case_merge_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), primary_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE RESTRICT,
  secondary_id uuid NOT NULL UNIQUE REFERENCES public.cases(id) ON DELETE RESTRICT,
  before_primary jsonb NOT NULL, before_secondary jsonb NOT NULL,
  reason text NOT NULL, executed_by text NOT NULL DEFAULT current_user,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.case_merge_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.case_merge_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.case_merge_events TO project_admin;

CREATE FUNCTION public.choose_case_advisor() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.user_id FROM public.app_memberships m
  LEFT JOIN (SELECT c.assigned_to, count(*) n FROM public.cases c
    WHERE c.assigned_to IS NOT NULL AND c.status <> 'COMPLETED'
      AND c.flokzu_audit_eligible AND NOT c.is_test AND c.merged_into_case_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.case_reviews r WHERE r.case_id=c.id AND r.coordinator_decision IS NOT NULL)
    GROUP BY c.assigned_to) l ON l.assigned_to=m.user_id
  WHERE m.role='user' ORDER BY coalesce(l.n,0),m.user_id LIMIT 1
$$;

CREATE FUNCTION public.create_assigned_case(p_actor uuid,p_student_identifier text,p_student_name text,
  p_request_id uuid DEFAULT NULL,p_external_case_id text DEFAULT NULL,p_assigned_to uuid DEFAULT NULL,p_separate_request boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.cases; v_role text; v_assigned uuid;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('flokzu-import-global-lock',0));
  SELECT role INTO v_role FROM public.app_memberships WHERE user_id=p_actor;
  IF v_role IS NULL OR v_role NOT IN ('user','coordinator') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Sin permiso';
  END IF;
  IF p_request_id IS NOT NULL THEN
    SELECT * INTO c FROM public.cases WHERE id=p_request_id;
    IF FOUND THEN
      IF c.created_by<>p_actor THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Expediente no encontrado'; END IF;
      IF c.student_identifier IS DISTINCT FROM p_student_identifier OR c.student_name IS DISTINCT FROM p_student_name
        OR (p_external_case_id IS NOT NULL AND c.external_case_id IS DISTINCT FROM p_external_case_id) THEN
        RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Solicitud ya utilizada';
      END IF;
      RETURN to_jsonb(c);
    END IF;
  END IF;
  IF p_external_case_id IS NOT NULL AND p_external_case_id !~ '^CaVe-[0-9]{1,16}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CaVe inválido';
  END IF;
  IF v_role='user' THEN
    IF p_assigned_to IS NOT NULL AND p_assigned_to<>p_actor THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='El Asesor se asigna a sí mismo';
    END IF;
    v_assigned:=p_actor;
  ELSE
    IF p_assigned_to IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.app_memberships WHERE user_id=p_assigned_to AND role='user') THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Responsable no elegible';
    END IF;
    v_assigned:=coalesce(p_assigned_to,public.choose_case_advisor());
  END IF;
  INSERT INTO public.cases(id,status,student_identifier,student_name,created_by,assigned_to,external_source,external_case_id,is_test,separate_request_confirmed)
  VALUES(coalesce(p_request_id,gen_random_uuid()),'DRAFT',p_student_identifier,p_student_name,p_actor,v_assigned,
    CASE WHEN p_external_case_id IS NOT NULL THEN 'FLOKZU' END,p_external_case_id,false,coalesce(p_separate_request,false)) RETURNING * INTO c;
  RETURN to_jsonb(c);
END $$;

CREATE FUNCTION public.assign_manual_case(p_case_id uuid,p_assigned_to uuid,p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('flokzu-import-global-lock',0));
  IF NOT EXISTS(SELECT 1 FROM public.app_memberships WHERE user_id=p_actor AND role='coordinator') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Sin permiso';
  END IF;
  PERFORM 1 FROM public.cases WHERE id=p_case_id AND external_source IS NULL AND merged_into_case_id IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Expediente no encontrado'; END IF;
  IF EXISTS(SELECT 1 FROM public.case_reviews WHERE case_id=p_case_id AND coordinator_decision IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Expediente finalizado';
  END IF;
  IF p_assigned_to IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.app_memberships WHERE user_id=p_assigned_to AND role='user') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Responsable no elegible';
  END IF;
  UPDATE public.cases SET assigned_to=p_assigned_to,updated_at=now() WHERE id=p_case_id;
END $$;

-- Una matrícula no es identidad de solicitud. La confirmación muestra las
-- coincidencias y exige resolver toda ambigüedad antes de crear otra ficha.
CREATE FUNCTION public.get_flokzu_manual_matches(p_rows jsonb) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH rows AS (SELECT x FROM jsonb_array_elements(p_rows) x),
  fresh AS (SELECT x FROM rows WHERE NOT EXISTS(SELECT 1 FROM public.cases c
    WHERE c.external_source='FLOKZU' AND c.external_case_id=x->>'externalCaseId')),
  matches AS (SELECT f.x,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'studentName',c.student_name,
      'assignedTo',c.assigned_to,'createdAt',c.created_at,'status',c.status,'updatedAt',c.updated_at)
      ORDER BY c.created_at,c.id) FROM public.cases c
      WHERE c.external_source IS NULL AND NOT c.is_test AND c.merged_into_case_id IS NULL AND c.student_identifier=f.x->>'studentIdentifier'
        AND NOT EXISTS(SELECT 1 FROM public.case_request_relations r WHERE c.id IN (r.case_id,r.other_id))), '[]'::jsonb) candidates
    FROM fresh f),
  decisions AS (SELECT x,candidates,
    CASE WHEN jsonb_array_length(candidates)=1
      AND (SELECT count(*) FROM fresh f WHERE f.x->>'studentIdentifier'=m.x->>'studentIdentifier')=1
      AND lower(trim(candidates->0->>'studentName'))=lower(trim(x->>'studentName'))
      AND (candidates->0->>'createdAt')::timestamptz>=now()-interval '7 days'
      AND NOT EXISTS(SELECT 1 FROM public.case_reviews r WHERE r.case_id=(candidates->0->>'id')::uuid AND r.coordinator_decision IS NOT NULL)
      THEN candidates->0->>'id' END link_id FROM matches m)
  SELECT coalesce(jsonb_object_agg(x->>'externalCaseId',jsonb_build_object('candidates',candidates,
    'linkCaseId',link_id,'requiresSelection',jsonb_array_length(candidates)>0 AND link_id IS NULL)), '{}'::jsonb) FROM decisions
$$;

REVOKE ALL ON FUNCTION public.choose_case_advisor(), public.create_assigned_case(uuid,text,text,uuid,text,uuid,boolean),
  public.assign_manual_case(uuid,uuid,uuid), public.get_flokzu_manual_matches(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.choose_case_advisor(), public.create_assigned_case(uuid,text,text,uuid,text,uuid,boolean),
  public.assign_manual_case(uuid,uuid,uuid), public.get_flokzu_manual_matches(jsonb) TO project_admin;

-- Atribución inequívoca: manual creado por Asesor, todavía sin responsable.
UPDATE public.cases c SET assigned_to=c.created_by
FROM public.app_memberships m WHERE c.external_source IS NULL AND c.assigned_to IS NULL
  AND c.merged_into_case_id IS NULL AND m.user_id=c.created_by AND m.role='user';

-- También cubre inserciones del servidor que ya está desplegado.
CREATE FUNCTION public.assign_new_manual_case() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_role text;
BEGIN
  IF NEW.external_source IS NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('flokzu-import-global-lock',0));
    IF NOT NEW.is_test AND NEW.student_identifier IS NOT NULL
      AND NOT NEW.separate_request_confirmed
      AND EXISTS(SELECT 1 FROM public.cases c WHERE c.student_identifier=NEW.student_identifier AND NOT c.is_test
        AND c.merged_into_case_id IS NULL
        AND NOT EXISTS(SELECT 1 FROM public.case_reviews r WHERE r.case_id=c.id AND r.coordinator_decision IS NOT NULL)) THEN
      RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Ya existe un expediente para esta matrícula; confirma una solicitud diferente';
    END IF;
    SELECT role INTO v_role FROM public.app_memberships WHERE user_id=NEW.created_by;
    IF NEW.assigned_to IS NULL THEN
      IF v_role='user' THEN NEW.assigned_to:=NEW.created_by;
      ELSIF v_role='coordinator' THEN NEW.assigned_to:=public.choose_case_advisor(); END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cases_assign_manual BEFORE INSERT ON public.cases
  FOR EACH ROW EXECUTE FUNCTION public.assign_new_manual_case();
REVOKE ALL ON FUNCTION public.assign_new_manual_case() FROM PUBLIC,anon,authenticated;

DO $backfill$
DECLARE task_case record;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('flokzu-import-global-lock',0));
  FOR task_case IN SELECT c.id FROM public.cases c JOIN public.app_memberships m ON m.user_id=c.created_by
    WHERE c.external_source IS NULL AND c.assigned_to IS NULL AND c.merged_into_case_id IS NULL
      AND NOT c.is_test AND m.role='coordinator' ORDER BY c.created_at,c.id FOR UPDATE OF c
  LOOP
    UPDATE public.cases SET assigned_to=public.choose_case_advisor() WHERE id=task_case.id;
  END LOOP;
END $backfill$;

-- Consolidación administrativa solo de una ficha Flokzu vacía: no traslada ni
-- borra evidencias, auditorías, revisiones, comentarios o eventos históricos.
CREATE FUNCTION public.merge_empty_flokzu_shell(p_primary uuid,p_secondary uuid,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.cases; b public.cases;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('flokzu-import-global-lock',0));
  SELECT * INTO a FROM public.cases WHERE id=p_primary FOR UPDATE;
  SELECT * INTO b FROM public.cases WHERE id=p_secondary FOR UPDATE;
  IF a.id IS NULL OR b.id IS NULL OR a.id=b.id OR a.external_source IS NOT NULL OR b.external_source IS DISTINCT FROM 'FLOKZU'
    OR a.is_test OR b.is_test OR a.merged_into_case_id IS NOT NULL OR b.merged_into_case_id IS NOT NULL
    OR a.student_identifier IS NULL OR a.student_identifier IS DISTINCT FROM b.student_identifier
    OR a.student_name IS NULL OR lower(trim(a.student_name)) IS DISTINCT FROM lower(trim(b.student_name))
    OR abs(extract(epoch FROM a.created_at-b.created_at))>7*86400 OR p_reason IS NULL OR length(trim(p_reason))<10
    OR (SELECT count(*) FROM public.cases c WHERE c.student_identifier=a.student_identifier AND NOT c.is_test AND c.merged_into_case_id IS NULL)<>2
    OR EXISTS(SELECT 1 FROM public.evidence WHERE case_id=b.id)
    OR EXISTS(SELECT 1 FROM public.audits WHERE case_id=b.id)
    OR EXISTS(SELECT 1 FROM public.case_reviews WHERE case_id=b.id)
    OR EXISTS(SELECT 1 FROM public.case_area_comments WHERE case_id=b.id)
    OR EXISTS(SELECT 1 FROM public.case_request_relations r WHERE a.id IN(r.case_id,r.other_id) OR b.id IN(r.case_id,r.other_id))
    OR EXISTS(SELECT 1 FROM public.audits WHERE case_id=a.id AND status='RUNNING') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='La consolidación requiere un par inequívoco y un importado vacío';
  END IF;
  INSERT INTO public.case_merge_events(primary_id,secondary_id,before_primary,before_secondary,reason)
    VALUES(a.id,b.id,to_jsonb(a),to_jsonb(b),p_reason);
  UPDATE public.cases SET external_source=NULL,external_case_id=NULL,assigned_to=NULL,merged_into_case_id=a.id,
    flokzu_audit_eligible=false,updated_at=now() WHERE id=b.id;
  UPDATE public.cases SET external_source='FLOKZU',external_case_id=b.external_case_id,flokzu_data=b.flokzu_data,
    assigned_to=coalesce(a.assigned_to,b.assigned_to),flokzu_classification=b.flokzu_classification,
    flokzu_review_state=CASE WHEN a.flokzu_audit_eligible AND NOT b.flokzu_audit_eligible THEN 'REACTIVATED' ELSE b.flokzu_review_state END,
    flokzu_audit_eligible=a.flokzu_audit_eligible OR b.flokzu_audit_eligible,
    flokzu_discrepancy=b.flokzu_discrepancy OR (a.flokzu_audit_eligible AND NOT b.flokzu_audit_eligible),
    flokzu_reason=b.flokzu_reason || CASE WHEN a.flokzu_audit_eligible AND NOT b.flokzu_audit_eligible THEN ' Vinculación administrativa: se conserva el trabajo manual activo; el Coordinador debe verificar la discrepancia.' ELSE '' END,
    flokzu_revision=b.flokzu_revision+1,updated_at=now()
    WHERE id=a.id;
  INSERT INTO public.flokzu_admin_events(case_id,action,reason,before_snapshot,after_snapshot)
    SELECT a.id,'IMPORT',p_reason,public.flokzu_admin_snapshot(a),public.flokzu_admin_snapshot(c) FROM public.cases c WHERE c.id=a.id;
END $$;
REVOKE ALL ON FUNCTION public.merge_empty_flokzu_shell(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.merge_empty_flokzu_shell(uuid,uuid,text) TO project_admin;

DROP FUNCTION public.commit_flokzu_import(uuid,uuid);
CREATE OR REPLACE FUNCTION public.commit_flokzu_import(p_batch_id uuid, p_actor uuid, p_resolutions jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_batch public.case_import_batches%ROWTYPE;
  v_row jsonb;
  v_id text;
  v_student_identifier text;
  v_student_name text;
  v_data jsonb;
  v_existing public.cases%ROWTYPE;
  v_case_id uuid;
  v_assigned_to uuid;
  v_inserted boolean;
  v_created integer := 0;
  v_updated integer := 0;
  v_unchanged integer := 0;
  v_unassigned integer := 0;
  v_assignments jsonb := '[]'::jsonb;
  v_result jsonb;
  v_before jsonb;
  v_matches jsonb;
  v_match jsonb;
  v_resolution jsonb;
  v_link uuid;
  v_linked integer := 0;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('flokzu-import-global-lock', 0));

  SELECT * INTO v_batch
  FROM public.case_import_batches
  WHERE id = p_batch_id AND imported_by = p_actor
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Importación no encontrada';
  END IF;
  IF v_batch.status = 'COMPLETED' THEN
    RETURN v_batch.result_json;
  END IF;
  IF v_batch.status = 'EXPIRED' OR v_batch.expires_at <= pg_catalog.now() THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'La vista previa venció; vuelve a subir el archivo';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.app_memberships
    WHERE user_id = p_actor AND role = 'coordinator'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Solo un Coordinador puede confirmar una importación';
  END IF;

  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_batch.staged_rows) x WHERE x->>'classification' IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='La vista previa venció; vuelve a subir el archivo';
  END IF;
  IF jsonb_typeof(p_resolutions)<>'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_resolutions) x
      WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_batch.staged_rows) y WHERE y->>'externalCaseId'=x->>'externalCaseId'))
    OR (SELECT count(*) FROM jsonb_array_elements(p_resolutions))<>(SELECT count(DISTINCT x->>'externalCaseId') FROM jsonb_array_elements(p_resolutions) x) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Resoluciones inválidas';
  END IF;
  v_matches := public.get_flokzu_manual_matches(v_batch.staged_rows);
  FOR v_row IN SELECT value FROM pg_catalog.jsonb_array_elements(v_batch.staged_rows)
  LOOP
    v_id := v_row ->> 'externalCaseId';
    v_student_identifier := v_row ->> 'studentIdentifier';
    v_student_name := v_row ->> 'studentName';
    v_data := v_row -> 'flokzuData';
    v_assigned_to := NULL;
    v_inserted := false;
    v_case_id := NULL;
    v_link := NULL;

    SELECT * INTO v_existing
    FROM public.cases
    WHERE external_source = 'FLOKZU' AND external_case_id = v_id
    FOR UPDATE;

    v_before := CASE WHEN FOUND THEN public.flokzu_admin_snapshot(v_existing) ELSE NULL END;
    IF v_before IS NULL THEN
      v_match := v_matches->v_id;
      IF v_row ? 'manualMatch' AND v_row->'manualMatch' IS DISTINCT FROM v_match THEN
        RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='Las coincidencias cambiaron; vuelve a generar la vista previa';
      END IF;
      SELECT x INTO v_resolution FROM jsonb_array_elements(p_resolutions) x WHERE x->>'externalCaseId'=v_id;
      IF v_resolution IS NULL AND (v_match->>'requiresSelection')::boolean THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Selecciona el expediente manual o confirma una solicitud diferente';
      END IF;
      v_link := CASE WHEN v_resolution IS NOT NULL THEN (v_resolution->>'caseId')::uuid ELSE (v_match->>'linkCaseId')::uuid END;
      IF v_link IS NOT NULL THEN
        IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_match->'candidates') x WHERE x->>'id'=v_link::text) THEN
          RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Expediente no coincidente';
        END IF;
        SELECT * INTO v_existing FROM public.cases WHERE id=v_link AND external_source IS NULL AND NOT is_test FOR UPDATE;
        IF NOT FOUND OR EXISTS(SELECT 1 FROM public.audits WHERE case_id=v_link AND status='RUNNING') THEN
          RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Expediente ocupado o ya vinculado';
        END IF;
        v_before := public.flokzu_admin_snapshot(v_existing);
        UPDATE public.cases SET external_source='FLOKZU',external_case_id=v_id,
          student_identifier=v_student_identifier,student_name=v_student_name,flokzu_data=v_data,
          updated_at=now() WHERE id=v_link;
        SELECT * INTO v_existing FROM public.cases WHERE id=v_link;
        v_case_id:=v_link;
        v_linked:=v_linked+1;
      ELSE
        IF (v_row ->> 'eligibleForAuditAssignment')::boolean THEN
          v_assigned_to:=public.choose_case_advisor();
        END IF;

      INSERT INTO public.cases (
        status, student_identifier, student_name, created_by, assigned_to,
        external_source, external_case_id, flokzu_data, is_test
      ) VALUES (
        'DRAFT', v_student_identifier, v_student_name, p_actor, v_assigned_to,
        'FLOKZU', v_id, v_data, false
      )
      ON CONFLICT (external_source, external_case_id) DO NOTHING
      RETURNING id INTO v_case_id;
      v_inserted := FOUND;

      IF NOT v_inserted THEN
        SELECT * INTO v_existing FROM public.cases
        WHERE external_source = 'FLOKZU' AND external_case_id = v_id
        FOR UPDATE;
      END IF;
    END IF;

      END IF;
    IF v_inserted THEN
      v_created := v_created + 1;
      IF (v_row ->> 'eligibleForAuditAssignment')::boolean AND v_assigned_to IS NULL THEN
        v_unassigned := v_unassigned + 1;
      END IF;
      v_assignments := v_assignments || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'externalCaseId', v_id, 'caseId', v_case_id, 'assignedTo', v_assigned_to
      ));
    ELSE
      IF v_link IS NOT NULL THEN
        v_updated := v_updated + 1;
      ELSIF v_existing.student_identifier IS DISTINCT FROM v_student_identifier
        OR v_existing.student_name IS DISTINCT FROM v_student_name
        OR v_existing.flokzu_data IS DISTINCT FROM v_data THEN
        UPDATE public.cases SET
          student_identifier = v_student_identifier,
          student_name = v_student_name,
          flokzu_data = v_data,
          updated_at = pg_catalog.now()
        WHERE id = v_existing.id;
        v_updated := v_updated + 1;
      ELSE
        v_unchanged := v_unchanged + 1;
      END IF;
      v_assignments := v_assignments || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'externalCaseId', v_id, 'caseId', v_existing.id, 'assignedTo', v_existing.assigned_to
      ));
    END IF;
    PERFORM public.sync_flokzu_administration(COALESCE(v_case_id,v_existing.id), v_row->>'classification',
      v_row->>'classificationReason', (v_row->>'discrepancy')::boolean, v_before, p_actor, p_batch_id);
  END LOOP;

  v_result := pg_catalog.jsonb_build_object(
    'created', v_created,
    'linked', v_linked,
    'updated', v_updated,
    'unchanged', v_unchanged,
    'errors', v_batch.error_rows,
    'unassigned', v_unassigned,
    'assignments', v_assignments
  );
  UPDATE public.case_import_batches SET
    status = 'COMPLETED',
    staged_rows = '[]'::jsonb,
    result_json = v_result,
    completed_at = pg_catalog.now()
  WHERE id = v_batch.id;
  RETURN v_result;
END
$function$;
REVOKE ALL ON FUNCTION public.commit_flokzu_import(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_flokzu_import(uuid,uuid,jsonb) TO project_admin;
DO $verify$
BEGIN
  IF has_function_privilege('authenticated','public.create_assigned_case(uuid,text,text,uuid,text,uuid,boolean)','EXECUTE')
    OR has_function_privilege('anon','public.get_flokzu_manual_matches(jsonb)','EXECUTE')
    OR has_function_privilege('authenticated','public.commit_flokzu_import(uuid,uuid,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'Asignación: RPC expuesto';
  END IF;
END $verify$;
