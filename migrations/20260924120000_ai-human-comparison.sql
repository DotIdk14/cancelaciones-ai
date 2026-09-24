-- Phase 9 — Comparación IA vs Dictamen humano (AI_BASELINE / HUMAN_DECISION /
--           AI_COMPARISON / AI_RECONCILIATION / FINAL_ADJUDICATION).
-- Modelo basado en runs versionados (append-only); no se sobrescriben corridas previas.
-- La política GDM_GAM_PRD_MLG_003 permanece intacta; estas tablas solo añaden ejecuciones.

-- ---------------------------------------------------------------------------
-- 1) Roles de documento en evidencias (EVIDENCE / HUMAN_DECISION_DOCUMENT / ADJUDICATION_EVIDENCE)
--    Backward-compatible: default 'EVIDENCE' preserva registros existentes.
-- ---------------------------------------------------------------------------
ALTER TABLE public.evidences ADD COLUMN IF NOT EXISTS document_role text NOT NULL DEFAULT 'EVIDENCE';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evidences_document_role_check') THEN
    ALTER TABLE public.evidences
      ADD CONSTRAINT evidences_document_role_check
      CHECK (document_role IN ('EVIDENCE', 'HUMAN_DECISION_DOCUMENT', 'ADJUDICATION_EVIDENCE'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) audit_runs: ledger general de ejecuciones del caso.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  run_type text NOT NULL CHECK (run_type IN ('AI_BASELINE', 'HUMAN_DECISION', 'AI_COMPARISON', 'AI_RECONCILIATION', 'FINAL_ADJUDICATION')),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  parent_run_id uuid REFERENCES public.audit_runs(id) ON DELETE SET NULL,
  fact_run_id uuid REFERENCES public.fact_extraction_runs(id) ON DELETE SET NULL,
  engine_run_id uuid REFERENCES public.engine_runs(id) ON DELETE SET NULL,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  policy_code text,
  policy_version text,
  prompt_version text,
  model text,
  provider text,
  input_fingerprint text,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS audit_runs_audit_created_idx ON public.audit_runs (audit_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_runs_audit_type_idx ON public.audit_runs (audit_id, run_type, created_at DESC);

-- Idempotencia de baseline: una sola AI_BASELINE por engine_run.
CREATE UNIQUE INDEX IF NOT EXISTS audit_runs_baseline_engine_unique
  ON public.audit_runs (engine_run_id)
  WHERE run_type = 'AI_BASELINE' AND engine_run_id IS NOT NULL;

ALTER TABLE public.audit_runs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.audit_runs TO authenticated;

DROP POLICY IF EXISTS audit_runs_select_visible ON public.audit_runs;
CREATE POLICY audit_runs_select_visible ON public.audit_runs
FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.audits WHERE audits.id = audit_runs.audit_id
    AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
);

DROP POLICY IF EXISTS audit_runs_insert_visible_audits ON public.audit_runs;
CREATE POLICY audit_runs_insert_visible_audits ON public.audit_runs
FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND EXISTS (SELECT 1 FROM public.audits WHERE audits.id = audit_runs.audit_id
    AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
);

DROP POLICY IF EXISTS audit_runs_update_visible_audits ON public.audit_runs;
CREATE POLICY audit_runs_update_visible_audits ON public.audit_runs
FOR UPDATE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.audits WHERE audits.id = audit_runs.audit_id
    AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.audits WHERE audits.id = audit_runs.audit_id
    AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
);

-- ---------------------------------------------------------------------------
-- 3) human_decision_extracts: extracción estructurada del dictamen humano.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.human_decision_extracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.audit_runs(id) ON DELETE CASCADE,
  evidence_id uuid REFERENCES public.evidences(id) ON DELETE SET NULL,
  extractor_version text NOT NULL,
  resolution text,
  decision_date text,
  motives jsonb NOT NULL DEFAULT '[]'::jsonb,
  conditions_considered jsonb NOT NULL DEFAULT '[]'::jsonb,
  dates_considered jsonb NOT NULL DEFAULT '[]'::jsonb,
  facts jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_mentioned jsonb NOT NULL DEFAULT '[]'::jsonb,
  rules_mentioned jsonb NOT NULL DEFAULT '[]'::jsonb,
  observations jsonb NOT NULL DEFAULT '[]'::jsonb,
  areas_involved jsonb NOT NULL DEFAULT '[]'::jsonb,
  external_information jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider text,
  model text,
  prompt_version text,
  raw_text_hash text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS human_decision_extracts_audit_created_idx
  ON public.human_decision_extracts (audit_id, created_at DESC);
CREATE INDEX IF NOT EXISTS human_decision_extracts_run_idx
  ON public.human_decision_extracts (run_id);

ALTER TABLE public.human_decision_extracts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.human_decision_extracts TO authenticated;

DROP POLICY IF EXISTS human_decision_extracts_select_visible ON public.human_decision_extracts;
CREATE POLICY human_decision_extracts_select_visible ON public.human_decision_extracts
FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.audits WHERE audits.id = human_decision_extracts.audit_id
    AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
);

DROP POLICY IF EXISTS human_decision_extracts_insert_visible_audits ON public.human_decision_extracts;
CREATE POLICY human_decision_extracts_insert_visible_audits ON public.human_decision_extracts
FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND EXISTS (SELECT 1 FROM public.audits WHERE audits.id = human_decision_extracts.audit_id
    AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
);

-- ---------------------------------------------------------------------------
-- 4) audit_comparisons: resultado de la comparación IA vs humano.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_comparisons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.audit_runs(id) ON DELETE CASCADE,
  ai_run_id uuid NOT NULL REFERENCES public.audit_runs(id) ON DELETE CASCADE,
  human_run_id uuid NOT NULL REFERENCES public.audit_runs(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('MATCH', 'DISCREPANCY')),
  discrepancy_type text,
  explanation text,
  counterfactuals jsonb NOT NULL DEFAULT '[]'::jsonb,
  rules_involved jsonb NOT NULL DEFAULT '[]'::jsonb,
  unverified_human_claims jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_outcome text,
  human_outcome text,
  ai_outcome_status text,
  human_resolution text,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_comparisons_audit_created_idx
  ON public.audit_comparisons (audit_id, created_at DESC);

ALTER TABLE public.audit_comparisons ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.audit_comparisons TO authenticated;

DROP POLICY IF EXISTS audit_comparisons_select_visible ON public.audit_comparisons;
CREATE POLICY audit_comparisons_select_visible ON public.audit_comparisons
FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.audits WHERE audits.id = audit_comparisons.audit_id
    AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
);

DROP POLICY IF EXISTS audit_comparisons_insert_visible_audits ON public.audit_comparisons;
CREATE POLICY audit_comparisons_insert_visible_audits ON public.audit_comparisons
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.audit_runs r JOIN public.audits a ON a.id = r.audit_id
    WHERE r.id = audit_comparisons.run_id AND a.id = audit_comparisons.audit_id
      AND (a.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
);

-- ---------------------------------------------------------------------------
-- 5) final_adjudications: resolución final validada por persona (posterior a IA/humano).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.final_adjudications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.audit_runs(id) ON DELETE CASCADE,
  adjudication_type text NOT NULL CHECK (adjudication_type IN (
    'CONFIRM_AI', 'CONFIRM_HUMAN', 'BOTH_INCORRECT', 'INSUFFICIENT_INFORMATION', 'CUSTOM_FINAL_DECISION')),
  final_outcome text,
  comment text,
  evidence_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  adjudicated_by uuid NOT NULL REFERENCES auth.users(id),
  adjudicated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS final_adjudications_audit_created_idx
  ON public.final_adjudications (audit_id, created_at DESC);

ALTER TABLE public.final_adjudications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.final_adjudications TO authenticated;

DROP POLICY IF EXISTS final_adjudications_select_visible ON public.final_adjudications;
CREATE POLICY final_adjudications_select_visible ON public.final_adjudications
FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.audits WHERE audits.id = final_adjudications.audit_id
    AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
);

DROP POLICY IF EXISTS final_adjudications_insert_visible_audits ON public.final_adjudications;
CREATE POLICY final_adjudications_insert_visible_audits ON public.final_adjudications
FOR INSERT TO authenticated
WITH CHECK (
  adjudicated_by = auth.uid()
  AND EXISTS (SELECT 1 FROM public.audit_runs r JOIN public.audits a ON a.id = r.audit_id
    WHERE r.id = final_adjudications.run_id AND a.id = final_adjudications.audit_id
      AND (a.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
);