ALTER TABLE public.engine_runs
  ADD COLUMN IF NOT EXISTS decision_status text;

UPDATE public.engine_runs
SET decision_status = CASE
  WHEN outcome_status = 'CONFLICTED' THEN 'CONFLICTED'
  WHEN outcome_status = 'INDETERMINATE' THEN 'INDETERMINATE'
  WHEN outcome_status = 'DETERMINED_WITH_WARNINGS' THEN 'REVIEW_REQUIRED'
  ELSE 'READY_TO_APPROVE'
END
WHERE decision_status IS NULL;

ALTER TABLE public.engine_runs
  ALTER COLUMN decision_status SET DEFAULT 'INDETERMINATE';

ALTER TABLE public.engine_runs
  DROP CONSTRAINT IF EXISTS engine_runs_decision_status_check;

ALTER TABLE public.engine_runs
  ADD CONSTRAINT engine_runs_decision_status_check
  CHECK (decision_status IN ('READY_TO_APPROVE', 'REVIEW_REQUIRED', 'CONFLICTED', 'INDETERMINATE'));
