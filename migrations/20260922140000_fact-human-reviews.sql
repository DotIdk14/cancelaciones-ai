CREATE TABLE IF NOT EXISTS public.fact_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  fact_id uuid NOT NULL REFERENCES public.facts(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('VALID', 'INVALID')),
  corrected_value jsonb,
  note text,
  reviewed_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fact_reviews_audit_fact_idx ON public.fact_reviews (audit_id, fact_id, created_at DESC);
ALTER TABLE public.fact_reviews ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.fact_reviews TO authenticated;

DROP POLICY IF EXISTS fact_reviews_visible_audits ON public.fact_reviews;
CREATE POLICY fact_reviews_visible_audits ON public.fact_reviews
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.audits WHERE audits.id = fact_reviews.audit_id
    AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
);

DROP POLICY IF EXISTS fact_reviews_insert_visible_audits ON public.fact_reviews;
CREATE POLICY fact_reviews_insert_visible_audits ON public.fact_reviews
FOR INSERT TO authenticated WITH CHECK (
  reviewed_by = auth.uid()
  AND EXISTS (SELECT 1 FROM public.audits WHERE audits.id = fact_reviews.audit_id
    AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
);
