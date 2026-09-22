DROP POLICY IF EXISTS fact_runs_insert_visible_audits ON public.fact_extraction_runs;
CREATE POLICY fact_runs_insert_visible_audits ON public.fact_extraction_runs
FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND EXISTS (SELECT 1 FROM public.audits WHERE audits.id = fact_extraction_runs.audit_id AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
);

DROP POLICY IF EXISTS fact_runs_update_visible_audits ON public.fact_extraction_runs;
CREATE POLICY fact_runs_update_visible_audits ON public.fact_extraction_runs
FOR UPDATE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.audits WHERE audits.id = fact_extraction_runs.audit_id AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.audits WHERE audits.id = fact_extraction_runs.audit_id AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
);

DROP POLICY IF EXISTS facts_insert_visible_runs ON public.facts;
CREATE POLICY facts_insert_visible_runs ON public.facts
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.fact_extraction_runs r JOIN public.audits a ON a.id = r.audit_id
    WHERE r.id = facts.run_id AND a.id = facts.audit_id AND r.state IN ('DRAFT', 'PROCESSING')
      AND (a.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
);
