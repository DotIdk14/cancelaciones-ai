CREATE TABLE IF NOT EXISTS public.rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text NOT NULL,
  version text NOT NULL,
  name text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'INFORMATIONAL_RULE' CHECK (category IN ('OUTCOME_RULE','EXCLUSION_RULE','PROCESS_RULE','EVIDENCE_RULE','SLA_RULE','INFORMATIONAL_RULE')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','REVIEW','APPROVED','ACTIVE','RETIRED')),
  policy_code text NOT NULL DEFAULT 'GDM_GAM_PRD_MLG_003',
  policy_version text NOT NULL DEFAULT '5',
  source_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_key, version)
);

CREATE TABLE IF NOT EXISTS public.rule_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.rules(id) ON DELETE CASCADE,
  condition_key text NOT NULL,
  name text,
  description text,
  fact_type text,
  operator text,
  expected_value jsonb,
  required boolean NOT NULL DEFAULT true,
  order_index integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, condition_key),
  CHECK (btrim(condition_key) <> ''),
  CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE TABLE IF NOT EXISTS public.evidence_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.rules(id) ON DELETE CASCADE,
  requirement_key text NOT NULL,
  name text,
  description text,
  evidence_type text NOT NULL CHECK (evidence_type IN ('DOCUMENT','IMAGE','AUDIO','TEXT','SPREADSHEET','PDF','OTHER')),
  evidence_code text,
  document_role text CHECK (document_role IS NULL OR document_role IN ('EVIDENCE','HUMAN_DECISION_DOCUMENT','ADJUDICATION_EVIDENCE')),
  required boolean NOT NULL DEFAULT true,
  min_count integer NOT NULL DEFAULT 1,
  max_count integer,
  order_index integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, requirement_key),
  CHECK (btrim(requirement_key) <> ''),
  CHECK (evidence_code IS NULL OR btrim(evidence_code) <> ''),
  CHECK (min_count >= 0),
  CHECK (max_count IS NULL OR max_count >= min_count),
  CHECK ((required = false) OR min_count >= 1),
  CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS rules_status_idx ON public.rules(status);
CREATE INDEX IF NOT EXISTS rule_conditions_rule_id_order_idx ON public.rule_conditions(rule_id, order_index, created_at);
CREATE INDEX IF NOT EXISTS evidence_requirements_rule_id_order_idx ON public.evidence_requirements(rule_id, order_index, created_at);
CREATE INDEX IF NOT EXISTS evidence_requirements_document_role_idx ON public.evidence_requirements(document_role);

DROP TRIGGER IF EXISTS rules_set_updated_at ON public.rules;
CREATE TRIGGER rules_set_updated_at BEFORE UPDATE ON public.rules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS rule_conditions_set_updated_at ON public.rule_conditions;
CREATE TRIGGER rule_conditions_set_updated_at BEFORE UPDATE ON public.rule_conditions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS evidence_requirements_set_updated_at ON public.evidence_requirements;
CREATE TRIGGER evidence_requirements_set_updated_at BEFORE UPDATE ON public.evidence_requirements FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.rule_is_draft(p_rule_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.rules WHERE id = p_rule_id AND status = 'DRAFT')
$$;

CREATE OR REPLACE FUNCTION public.prevent_protected_rule_child_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule_id uuid;
  v_status text;
BEGIN
  v_rule_id := COALESCE(NEW.rule_id, OLD.rule_id);
  SELECT status INTO v_status FROM public.rules WHERE id = v_rule_id;
  IF TG_OP = 'DELETE' THEN
    IF v_status IS NULL THEN
      RETURN OLD;
    END IF;
    IF v_status <> 'DRAFT' THEN
      RAISE EXCEPTION 'RULE_VERSION_IMMUTABLE: %', v_status;
    END IF;
    RETURN OLD;
  END IF;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'RULE_NOT_FOUND';
  END IF;
  IF v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'RULE_VERSION_IMMUTABLE: %', v_status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rule_conditions_protect_parent_status ON public.rule_conditions;
CREATE TRIGGER rule_conditions_protect_parent_status
BEFORE INSERT OR UPDATE OR DELETE ON public.rule_conditions
FOR EACH ROW EXECUTE FUNCTION public.prevent_protected_rule_child_mutation();

DROP TRIGGER IF EXISTS evidence_requirements_protect_parent_status ON public.evidence_requirements;
CREATE TRIGGER evidence_requirements_protect_parent_status
BEFORE INSERT OR UPDATE OR DELETE ON public.evidence_requirements
FOR EACH ROW EXECUTE FUNCTION public.prevent_protected_rule_child_mutation();

-- Prohíbe borrar reglas no-DRAFT a nivel padre (cierra la vía del DELETE en
-- cascada que de otro modo saltaría la inmutabilidad de versión).
CREATE OR REPLACE FUNCTION public.prevent_protected_rule_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'RULE_VERSION_IMMUTABLE: %', OLD.status;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS rules_protect_status_delete ON public.rules;
CREATE TRIGGER rules_protect_status_delete
BEFORE DELETE ON public.rules
FOR EACH ROW EXECUTE FUNCTION public.prevent_protected_rule_delete();

ALTER TABLE public.rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rule_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_requirements ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.rules TO authenticated;
GRANT SELECT ON public.rule_conditions TO authenticated;
GRANT SELECT ON public.evidence_requirements TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.rules TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.rule_conditions TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.evidence_requirements TO authenticated;

DROP POLICY IF EXISTS rules_select_authenticated ON public.rules;
CREATE POLICY rules_select_authenticated ON public.rules FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS rules_owner_write ON public.rules;
CREATE POLICY rules_owner_write ON public.rules FOR INSERT TO authenticated WITH CHECK (public.current_app_role() = 'OWNER');

DROP POLICY IF EXISTS rules_owner_update_draft ON public.rules;
CREATE POLICY rules_owner_update_draft ON public.rules FOR UPDATE TO authenticated USING (public.current_app_role() = 'OWNER' AND status = 'DRAFT') WITH CHECK (public.current_app_role() = 'OWNER');

DROP POLICY IF EXISTS rules_owner_delete_draft ON public.rules;
CREATE POLICY rules_owner_delete_draft ON public.rules FOR DELETE TO authenticated USING (public.current_app_role() = 'OWNER' AND status = 'DRAFT');

DROP POLICY IF EXISTS rule_conditions_select_authenticated ON public.rule_conditions;
CREATE POLICY rule_conditions_select_authenticated ON public.rule_conditions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.rules r WHERE r.id = rule_conditions.rule_id));

DROP POLICY IF EXISTS rule_conditions_owner_write_draft ON public.rule_conditions;
CREATE POLICY rule_conditions_owner_write_draft ON public.rule_conditions FOR INSERT TO authenticated WITH CHECK (public.current_app_role() = 'OWNER' AND public.rule_is_draft(rule_id));

DROP POLICY IF EXISTS rule_conditions_owner_update_draft ON public.rule_conditions;
CREATE POLICY rule_conditions_owner_update_draft ON public.rule_conditions FOR UPDATE TO authenticated USING (public.current_app_role() = 'OWNER' AND public.rule_is_draft(rule_id)) WITH CHECK (public.current_app_role() = 'OWNER' AND public.rule_is_draft(rule_id));

DROP POLICY IF EXISTS rule_conditions_owner_delete_draft ON public.rule_conditions;
CREATE POLICY rule_conditions_owner_delete_draft ON public.rule_conditions FOR DELETE TO authenticated USING (public.current_app_role() = 'OWNER' AND public.rule_is_draft(rule_id));

DROP POLICY IF EXISTS evidence_requirements_select_authenticated ON public.evidence_requirements;
CREATE POLICY evidence_requirements_select_authenticated ON public.evidence_requirements FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.rules r WHERE r.id = evidence_requirements.rule_id));

DROP POLICY IF EXISTS evidence_requirements_owner_write_draft ON public.evidence_requirements;
CREATE POLICY evidence_requirements_owner_write_draft ON public.evidence_requirements FOR INSERT TO authenticated WITH CHECK (public.current_app_role() = 'OWNER' AND public.rule_is_draft(rule_id));

DROP POLICY IF EXISTS evidence_requirements_owner_update_draft ON public.evidence_requirements;
CREATE POLICY evidence_requirements_owner_update_draft ON public.evidence_requirements FOR UPDATE TO authenticated USING (public.current_app_role() = 'OWNER' AND public.rule_is_draft(rule_id)) WITH CHECK (public.current_app_role() = 'OWNER' AND public.rule_is_draft(rule_id));

DROP POLICY IF EXISTS evidence_requirements_owner_delete_draft ON public.evidence_requirements;
CREATE POLICY evidence_requirements_owner_delete_draft ON public.evidence_requirements FOR DELETE TO authenticated USING (public.current_app_role() = 'OWNER' AND public.rule_is_draft(rule_id));
