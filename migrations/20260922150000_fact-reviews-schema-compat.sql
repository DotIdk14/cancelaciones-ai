ALTER TABLE public.fact_reviews
  ADD COLUMN IF NOT EXISTS decision text,
  ADD COLUMN IF NOT EXISTS corrected_value jsonb,
  ADD COLUMN IF NOT EXISTS note text;

UPDATE public.fact_reviews
SET decision = CASE status
  WHEN 'ACCEPTED' THEN 'VALID'
  WHEN 'REJECTED' THEN 'INVALID'
  ELSE NULL
END
WHERE decision IS NULL;

ALTER TABLE public.fact_reviews
  DROP CONSTRAINT IF EXISTS fact_reviews_decision_check;

ALTER TABLE public.fact_reviews
  ADD CONSTRAINT fact_reviews_decision_check
  CHECK (decision IS NULL OR decision IN ('VALID', 'INVALID'));
