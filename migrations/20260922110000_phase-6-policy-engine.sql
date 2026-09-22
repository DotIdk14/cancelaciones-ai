CREATE TABLE IF NOT EXISTS public.engine_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  fact_run_id uuid,
  policy_code text NOT NULL,
  policy_version text NOT NULL,
  rules_fingerprint text NOT NULL,
  facts_fingerprint text NOT NULL,
  owner_precedence_version text,
  status text NOT NULL CHECK (status IN ('COMPLETED', 'FAILED')),
  suggested_outcome text,
  outcome_status text NOT NULL,
  evaluation jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.engine_rule_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engine_run_id uuid NOT NULL REFERENCES public.engine_runs(id) ON DELETE CASCADE,
  rule_id text NOT NULL,
  status text NOT NULL,
  result jsonb NOT NULL,
  UNIQUE (engine_run_id, rule_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS engine_runs_idempotency_idx ON public.engine_runs
  (audit_id, facts_fingerprint, policy_code, policy_version, rules_fingerprint,
   COALESCE(owner_precedence_version, ''));

ALTER TABLE public.engine_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engine_rule_results ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.engine_runs, public.engine_rule_results TO authenticated;

CREATE POLICY engine_runs_visible_audits ON public.engine_runs FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.audits WHERE audits.id = engine_runs.audit_id AND
    (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
);
CREATE POLICY engine_runs_insert_visible_audits ON public.engine_runs FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.audits WHERE audits.id = engine_runs.audit_id AND
    (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
);
CREATE POLICY engine_rule_results_visible_runs ON public.engine_rule_results FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.engine_runs WHERE engine_runs.id = engine_rule_results.engine_run_id AND
    EXISTS (SELECT 1 FROM public.audits WHERE audits.id = engine_runs.audit_id AND
      (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')))
);
CREATE POLICY engine_rule_results_insert_visible_runs ON public.engine_rule_results FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.engine_runs WHERE engine_runs.id = engine_rule_results.engine_run_id AND
    EXISTS (SELECT 1 FROM public.audits WHERE audits.id = engine_runs.audit_id AND
      (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')))
);
