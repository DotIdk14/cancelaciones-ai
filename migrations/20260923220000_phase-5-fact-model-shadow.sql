CREATE TABLE IF NOT EXISTS public.fact_extraction_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  policy_code text NOT NULL,
  policy_version text NOT NULL,
  extractor_version text NOT NULL,
  artifact_set_fingerprint text NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT', 'PROCESSING', 'FAILED', 'FROZEN')),
  frozen_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.fact_extraction_runs(id) ON DELETE CASCADE,
  fact_type text NOT NULL,
  classification text NOT NULL DEFAULT 'OBSERVABLE' CHECK (classification IN ('OBSERVABLE', 'HUMAN_CONFIRMED', 'HUMAN_CORRECTED')),
  value jsonb NOT NULL,
  source_ref jsonb NOT NULL,
  confidence numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.job_artifacts
  ADD COLUMN IF NOT EXISTS evidence_id uuid REFERENCES public.evidences(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attempt_id uuid REFERENCES public.job_attempts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS extractor_version text,
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_operation_id uuid,
  ADD COLUMN IF NOT EXISTS storage_bucket text,
  ADD COLUMN IF NOT EXISTS storage_key text,
  ADD COLUMN IF NOT EXISTS content_sha256 text,
  ADD COLUMN IF NOT EXISTS warnings jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS fact_extraction_runs_audit_created_idx ON public.fact_extraction_runs (audit_id, created_at DESC);
CREATE INDEX IF NOT EXISTS fact_extraction_runs_audit_state_idx ON public.fact_extraction_runs (audit_id, state);
CREATE INDEX IF NOT EXISTS facts_run_idx ON public.facts (run_id, fact_type);
CREATE INDEX IF NOT EXISTS facts_audit_idx ON public.facts (audit_id, run_id);
CREATE INDEX IF NOT EXISTS job_artifacts_evidence_idx ON public.job_artifacts (evidence_id);

DROP TRIGGER IF EXISTS fact_extraction_runs_set_updated_at ON public.fact_extraction_runs;
CREATE TRIGGER fact_extraction_runs_set_updated_at
BEFORE UPDATE ON public.fact_extraction_runs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.fact_extraction_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facts ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.fact_extraction_runs TO authenticated;
GRANT SELECT, INSERT ON public.facts TO authenticated;

DROP POLICY IF EXISTS fact_runs_visible_audits ON public.fact_extraction_runs;
CREATE POLICY fact_runs_visible_audits ON public.fact_extraction_runs FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.audits WHERE audits.id = fact_extraction_runs.audit_id AND
    (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
);

DROP POLICY IF EXISTS fact_runs_insert_visible_audits ON public.fact_extraction_runs;
CREATE POLICY fact_runs_insert_visible_audits ON public.fact_extraction_runs FOR INSERT TO authenticated WITH CHECK (
  created_by = auth.uid() AND EXISTS (SELECT 1 FROM public.audits WHERE audits.id = fact_extraction_runs.audit_id AND
    (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
);

DROP POLICY IF EXISTS fact_runs_update_visible_audits ON public.fact_extraction_runs;
CREATE POLICY fact_runs_update_visible_audits ON public.fact_extraction_runs FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.audits WHERE audits.id = fact_extraction_runs.audit_id AND
    (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.audits WHERE audits.id = fact_extraction_runs.audit_id AND
    (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
);

DROP POLICY IF EXISTS facts_visible_runs ON public.facts;
CREATE POLICY facts_visible_runs ON public.facts FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.fact_extraction_runs r JOIN public.audits a ON a.id = r.audit_id
    WHERE r.id = facts.run_id AND a.id = facts.audit_id AND (a.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
);

DROP POLICY IF EXISTS facts_insert_visible_runs ON public.facts;
CREATE POLICY facts_insert_visible_runs ON public.facts FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.fact_extraction_runs r JOIN public.audits a ON a.id = r.audit_id
    WHERE r.id = facts.run_id AND a.id = facts.audit_id AND r.state IN ('DRAFT', 'PROCESSING')
      AND (a.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
);
