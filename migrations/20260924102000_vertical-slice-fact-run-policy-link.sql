DROP POLICY IF EXISTS job_artifacts_update_for_visible_jobs ON public.job_artifacts;
CREATE POLICY job_artifacts_update_for_visible_jobs ON public.job_artifacts
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.jobs
    JOIN public.audits ON audits.id = jobs.audit_id
    WHERE jobs.id = job_artifacts.job_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.jobs
    JOIN public.audits ON audits.id = jobs.audit_id
    WHERE jobs.id = job_artifacts.job_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
  )
);

CREATE INDEX IF NOT EXISTS engine_runs_fact_run_idx ON public.engine_runs (fact_run_id);
