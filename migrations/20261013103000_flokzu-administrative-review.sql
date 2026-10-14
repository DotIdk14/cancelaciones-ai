-- Aditiva. Aplicar solo con el runner oficial y el procedimiento de reconciliación.
-- Reutiliza la identidad CaVe y conserva auditorías, evidencias y revisión humana.
ALTER TABLE public.cases
  ADD COLUMN flokzu_classification text NOT NULL DEFAULT 'VERIFY' CHECK (flokzu_classification IN ('ACTIVE','REJECTED','FINALIZED','OTHER_STAGE','VERIFY')),
  ADD COLUMN flokzu_review_state text NOT NULL DEFAULT 'OPEN' CHECK (flokzu_review_state IN ('OPEN','CLOSED','REACTIVATED','PENDING')),
  ADD COLUMN flokzu_audit_eligible boolean NOT NULL DEFAULT true,
  ADD COLUMN flokzu_discrepancy boolean NOT NULL DEFAULT false,
  ADD COLUMN flokzu_reason text NOT NULL DEFAULT '',
  ADD COLUMN flokzu_revision integer NOT NULL DEFAULT 0 CHECK (flokzu_revision >= 0);

CREATE TABLE public.flokzu_admin_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE RESTRICT,
  batch_id uuid REFERENCES public.case_import_batches(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('BASELINE','IMPORT','CLOSE','REACTIVATE','REASSIGN','PENDING','DISCREPANCY')),
  actor uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text,
  before_snapshot jsonb,
  after_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX flokzu_admin_events_case_time_idx ON public.flokzu_admin_events(case_id, created_at DESC, id DESC);
CREATE INDEX cases_flokzu_review_idx ON public.cases(flokzu_audit_eligible, flokzu_review_state, updated_at DESC, id DESC) WHERE external_source='FLOKZU';
ALTER TABLE public.flokzu_admin_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.flokzu_admin_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.flokzu_admin_events TO project_admin;

-- Contexto original completo en cada cambio. El historial no se modifica ni elimina.
CREATE FUNCTION public.flokzu_admin_snapshot(p_case public.cases) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $fn$
  SELECT jsonb_build_object('externalCaseId', p_case.external_case_id,
    'studentIdentifier',p_case.student_identifier,'studentName',p_case.student_name,
    'data',p_case.flokzu_data,'classification',p_case.flokzu_classification,
    'reviewState',p_case.flokzu_review_state,'eligible',p_case.flokzu_audit_eligible,
    'discrepancy',p_case.flokzu_discrepancy,'reason',p_case.flokzu_reason,
    'assignedTo',p_case.assigned_to,'revision',p_case.flokzu_revision);
$fn$;

-- Los tickets históricos se verifican antes de volver al reparto automático.
-- No cambia responsables, autor, IDs ni relaciones. Los expedientes siguen accesibles por ID.
UPDATE public.cases SET flokzu_audit_eligible=false,
  flokzu_reason='Ticket importado previamente: requiere conciliación con la próxima exportación o decisión del Coordinador.'
WHERE external_source='FLOKZU';
INSERT INTO public.flokzu_admin_events(case_id,action,reason,after_snapshot)
SELECT id,'BASELINE','Conciliación inicial sin pérdida de relaciones.',public.flokzu_admin_snapshot(c)
FROM public.cases c WHERE external_source='FLOKZU';

-- Helper invocado dentro de commit_flokzu_import, bajo el mismo bloqueo global.
CREATE FUNCTION public.sync_flokzu_administration(p_case_id uuid, p_classification text, p_reason text,
  p_discrepancy boolean, p_before jsonb, p_actor uuid, p_batch uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_case public.cases%ROWTYPE; v_changed boolean; v_eligible boolean; v_assigned uuid;
BEGIN
  SELECT * INTO STRICT v_case FROM public.cases WHERE id=p_case_id FOR UPDATE;
  IF p_classification IS NULL OR p_classification NOT IN ('ACTIVE','REJECTED','FINALIZED','OTHER_STAGE','VERIFY') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Clasificación administrativa inválida';
  END IF;
  v_eligible := v_case.flokzu_review_state='REACTIVATED'
    OR (v_case.flokzu_review_state='OPEN' AND p_classification='ACTIVE');
  v_changed := p_before IS NULL OR p_before->'data' IS DISTINCT FROM v_case.flokzu_data
    OR p_before->>'studentIdentifier' IS DISTINCT FROM v_case.student_identifier
    OR p_before->>'studentName' IS DISTINCT FROM v_case.student_name;
  v_assigned := v_case.assigned_to;
  IF v_eligible AND v_assigned IS NULL AND v_case.flokzu_review_state='OPEN' THEN
    SELECT m.user_id INTO v_assigned FROM public.app_memberships m
    LEFT JOIN (SELECT assigned_to, count(*) AS load FROM public.cases
      WHERE assigned_to IS NOT NULL AND status<>'COMPLETED' AND flokzu_audit_eligible GROUP BY assigned_to) l ON l.assigned_to=m.user_id
    WHERE m.role='user' ORDER BY COALESCE(l.load,0),m.user_id LIMIT 1;
  END IF;
  UPDATE public.cases SET flokzu_classification=p_classification, flokzu_reason=p_reason,
    flokzu_audit_eligible=v_eligible, assigned_to=v_assigned,
    flokzu_discrepancy=flokzu_discrepancy OR p_discrepancy OR (v_changed AND (
      (flokzu_review_state='REACTIVATED' AND p_classification<>'ACTIVE') OR
      (flokzu_review_state='CLOSED' AND p_classification IN ('ACTIVE','VERIFY')) OR
      (flokzu_review_state='PENDING' AND p_classification='ACTIVE'))),
    flokzu_revision=flokzu_revision+1
  WHERE id=p_case_id AND (v_changed OR flokzu_classification<>p_classification OR assigned_to IS DISTINCT FROM v_assigned);
  IF FOUND THEN
    SELECT * INTO v_case FROM public.cases WHERE id=p_case_id;
    INSERT INTO public.flokzu_admin_events(case_id,batch_id,action,actor,reason,before_snapshot,after_snapshot)
    VALUES(p_case_id,p_batch,'IMPORT',p_actor,p_reason,p_before,public.flokzu_admin_snapshot(v_case));
  END IF;
END;
$fn$;

CREATE FUNCTION public.decide_flokzu_ticket(p_actor uuid, p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_case public.cases%ROWTYPE; v_before jsonb; v_action text; v_assigned uuid;
  v_reason text; v_observation text; v_state text; v_eligible boolean; v_discrepancy boolean;
BEGIN
  -- Mismo orden que la importación: evita interbloqueos y decisiones perdidas.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('flokzu-import-global-lock',0));
  IF NOT EXISTS(SELECT 1 FROM public.app_memberships WHERE user_id=p_actor AND role='coordinator') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Solo un Coordinador puede administrar Flokzu';
  END IF;
  SELECT * INTO v_case FROM public.cases WHERE id=(p_input->>'caseId')::uuid AND external_source='FLOKZU' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='Ticket no encontrado'; END IF;
  IF v_case.flokzu_revision IS DISTINCT FROM (p_input->>'revision')::integer THEN
    RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='El ticket cambió';
  END IF;
  v_before:=public.flokzu_admin_snapshot(v_case); v_action:=p_input->>'action';
  v_reason:=NULLIF(btrim(p_input->>'reason'),''); v_observation:=NULLIF(btrim(p_input->>'observation'),'');
  v_state:=v_case.flokzu_review_state; v_eligible:=v_case.flokzu_audit_eligible;
  v_assigned:=v_case.assigned_to; v_discrepancy:=v_case.flokzu_discrepancy;
  IF v_action='CLOSE' THEN
    IF (p_input->>'confirmed')::boolean IS DISTINCT FROM true THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Confirma el cierre'; END IF;
    v_state:='CLOSED'; v_eligible:=false; v_discrepancy:=false;
  ELSIF v_action='REACTIVATE' THEN
    IF v_reason IS NULL OR p_input->>'assignedTo' IS NULL OR (v_discrepancy AND v_observation IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Faltan motivo, responsable u observación de discrepancia'; END IF;
    v_state:='REACTIVATED'; v_eligible:=true; v_discrepancy:=false;
    v_assigned:=(p_input->>'assignedTo')::uuid;
  ELSIF v_action='REASSIGN' THEN
    IF NOT p_input ? 'assignedTo' THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Falta responsable'; END IF;
    v_assigned:=(p_input->>'assignedTo')::uuid;
  ELSIF v_action='PENDING' THEN v_state:='PENDING'; v_eligible:=false;
  ELSIF v_action='DISCREPANCY' THEN
    IF v_reason IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Falta motivo'; END IF;
    v_discrepancy:=true;
  ELSE RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Acción inválida'; END IF;
  IF v_assigned IS NOT NULL AND v_action IN ('REASSIGN','REACTIVATE') AND NOT EXISTS(
    SELECT 1 FROM public.app_memberships WHERE user_id=v_assigned AND role='user') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Responsable no elegible'; END IF;
  UPDATE public.cases SET assigned_to=v_assigned, flokzu_review_state=v_state,
    flokzu_audit_eligible=v_eligible, flokzu_discrepancy=v_discrepancy, flokzu_revision=flokzu_revision+1
  WHERE id=v_case.id RETURNING * INTO v_case;
  INSERT INTO public.flokzu_admin_events(case_id,action,actor,reason,before_snapshot,after_snapshot)
  VALUES(v_case.id,v_action,p_actor,concat_ws(E'\n',v_reason,v_observation),v_before,public.flokzu_admin_snapshot(v_case));
  RETURN public.flokzu_admin_snapshot(v_case);
END;
$fn$;

REVOKE ALL ON FUNCTION public.flokzu_admin_snapshot(public.cases) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.sync_flokzu_administration(uuid,text,text,boolean,jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.decide_flokzu_ticket(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.flokzu_admin_snapshot(public.cases) TO project_admin;
GRANT EXECUTE ON FUNCTION public.sync_flokzu_administration(uuid,text,text,boolean,jsonb,uuid,uuid) TO project_admin;
GRANT EXECUTE ON FUNCTION public.decide_flokzu_ticket(uuid,jsonb) TO project_admin;

CREATE OR REPLACE FUNCTION public.commit_flokzu_import(p_batch_id uuid, p_actor uuid)
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
  FOR v_row IN SELECT value FROM pg_catalog.jsonb_array_elements(v_batch.staged_rows)
  LOOP
    v_id := v_row ->> 'externalCaseId';
    v_student_identifier := v_row ->> 'studentIdentifier';
    v_student_name := v_row ->> 'studentName';
    v_data := v_row -> 'flokzuData';
    v_assigned_to := NULL;
    v_inserted := false;
    v_case_id := NULL;

    SELECT * INTO v_existing
    FROM public.cases
    WHERE external_source = 'FLOKZU' AND external_case_id = v_id
    FOR UPDATE;

    v_before := CASE WHEN FOUND THEN public.flokzu_admin_snapshot(v_existing) ELSE NULL END;
    IF v_before IS NULL THEN
      IF (v_row ->> 'eligibleForAuditAssignment')::boolean THEN
        SELECT membership.user_id INTO v_assigned_to
        FROM public.app_memberships AS membership
        LEFT JOIN (
          SELECT assigned_to, count(*) AS pending_count
          FROM public.cases
          WHERE assigned_to IS NOT NULL AND status <> 'COMPLETED' AND flokzu_audit_eligible
          GROUP BY assigned_to
        ) AS workload ON workload.assigned_to = membership.user_id
        WHERE membership.role = 'user'
        ORDER BY COALESCE(workload.pending_count, 0), membership.user_id
        LIMIT 1;
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

    IF v_inserted THEN
      v_created := v_created + 1;
      IF (v_row ->> 'eligibleForAuditAssignment')::boolean AND v_assigned_to IS NULL THEN
        v_unassigned := v_unassigned + 1;
      END IF;
      v_assignments := v_assignments || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'externalCaseId', v_id, 'caseId', v_case_id, 'assignedTo', v_assigned_to
      ));
    ELSE
      IF v_existing.student_identifier IS DISTINCT FROM v_student_identifier
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


DO $verify$
BEGIN
  IF has_function_privilege('authenticated','public.decide_flokzu_ticket(uuid,jsonb)','EXECUTE')
    OR has_function_privilege('anon','public.decide_flokzu_ticket(uuid,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'flokzu: RPC administrativo expuesto';
  END IF;
  IF EXISTS(SELECT 1 FROM public.cases WHERE external_source='FLOKZU' AND flokzu_revision=0 AND flokzu_audit_eligible) THEN
    RAISE EXCEPTION 'flokzu: baseline requiere conciliación';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.flokzu_admin_events'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'flokzu: falta RLS';
  END IF;
END
$verify$;
