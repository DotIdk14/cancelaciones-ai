-- =============================================================================
-- 20261014190000 — Una revisión humana por versión de auditoría.
--
-- La revisión del Asesor y la finalización del Coordinador pertenecen a una
-- auditoría concreta. Un caso con evidencia insuficiente puede recibir nueva
-- evidencia y una nueva auditoría; esa versión requiere una revisión humana
-- nueva y no debe sobrescribir la revisión anterior.
--
-- Conserva las filas existentes, elimina la unicidad por expediente y fija la
-- unicidad por auditoría. Forward-only e idempotente. No aplicar hasta seguir
-- docs/MIGRATION-RECONCILIATION.md y el runner oficial de InsForge.
-- =============================================================================

ALTER TABLE public.case_reviews
  DROP CONSTRAINT IF EXISTS case_reviews_case_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS case_reviews_audit_id_key
  ON public.case_reviews (audit_id);

COMMENT ON TABLE public.case_reviews IS
  'Revisión humana inmutable de una auditoría concreta. case_id agrupa el historial del expediente; audit_id es único y fija la versión revisada.';

-- El historial relacionado por matrícula también muestra la resolución y la
-- etapa humana de la auditoría más reciente, nunca una revisión vieja elegida
-- al azar cuando el expediente ya tiene varias versiones.
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
      'latestResult',(SELECT a.result_json->'audit'->>'result' FROM audits a WHERE a.case_id=c.id AND a.status='COMPLETED' AND a.retired_at IS NULL ORDER BY a.created_at DESC,a.id DESC LIMIT 1),
      'normativeSection',(SELECT a.result_json->'audit'->>'procedureSection' FROM audits a WHERE a.case_id=c.id AND a.status='COMPLETED' AND a.retired_at IS NULL ORDER BY a.created_at DESC,a.id DESC LIMIT 1),
      'finalResolution',(SELECT CASE WHEN r.coordinator_decision='CHANGE' THEN r.coordinator_resolution ELSE r.result END FROM case_reviews r WHERE r.case_id=c.id AND r.audit_id=(SELECT a.id FROM audits a WHERE a.case_id=c.id AND a.status='COMPLETED' AND a.retired_at IS NULL ORDER BY a.created_at DESC,a.id DESC LIMIT 1) LIMIT 1),
      'workflowState',coalesce((SELECT CASE WHEN r.coordinator_decision IS NULL THEN 'PENDING_COORDINATOR' ELSE 'FINALIZED' END FROM case_reviews r WHERE r.case_id=c.id AND r.audit_id=(SELECT a.id FROM audits a WHERE a.case_id=c.id AND a.status='COMPLETED' AND a.retired_at IS NULL ORDER BY a.created_at DESC,a.id DESC LIMIT 1) LIMIT 1),'PENDING_ADVISOR'),
      'versions',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'status',a.status,'createdAt',a.created_at,'result',a.result_json->'audit'->>'result','retired',a.retired_at IS NOT NULL) ORDER BY a.created_at DESC,a.id DESC) FROM audits a WHERE a.case_id=c.id),'[]'::jsonb)
    ) ORDER BY c.created_at DESC,c.id DESC) FROM page c),'[]'::jsonb)) INTO payload FROM totals t;
  RETURN payload;
END $$;

DO $verify$
DECLARE
  v_case_unique boolean;
  v_audit_unique boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.case_reviews'::regclass
      AND conname = 'case_reviews_case_id_key'
      AND contype = 'u'
  ) INTO v_case_unique;

  SELECT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'case_reviews'
      AND indexname = 'case_reviews_audit_id_key'
      AND indexdef ILIKE '%UNIQUE%'
      AND indexdef ILIKE '%(audit_id)%'
  ) INTO v_audit_unique;

  IF v_case_unique OR NOT v_audit_unique THEN
    RAISE EXCEPTION 'CASE_REVIEWS_PER_AUDIT_INCOMPLETE: case_id debe aceptar múltiples revisiones y audit_id debe ser único';
  END IF;
END
$verify$;
