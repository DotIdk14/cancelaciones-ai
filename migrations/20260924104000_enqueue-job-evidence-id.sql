CREATE OR REPLACE FUNCTION public.enqueue_job(
  p_audit_id uuid,
  p_job_type text,
  p_operation_scope text,
  p_idempotency_key text,
  p_input_fingerprint text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_priority integer DEFAULT 100,
  p_max_attempts integer DEFAULT 3,
  p_actor_id uuid DEFAULT NULL,
  p_evidence_id uuid DEFAULT NULL
)
RETURNS public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.jobs;
BEGIN
  INSERT INTO public.jobs (audit_id, job_type, operation_scope, idempotency_key, input_fingerprint, payload, priority, max_attempts)
  VALUES (p_audit_id, p_job_type, p_operation_scope, p_idempotency_key, p_input_fingerprint, COALESCE(p_payload, '{}'::jsonb), p_priority, p_max_attempts)
  ON CONFLICT (operation_scope, idempotency_key) DO UPDATE
    SET updated_at = public.jobs.updated_at
  RETURNING * INTO v_job;

  INSERT INTO public.audit_log (audit_id, event_type, actor_id, metadata)
  VALUES (v_job.audit_id, 'JOB_QUEUED', p_actor_id, jsonb_build_object('jobId', v_job.id, 'jobType', v_job.job_type, 'evidenceId', p_evidence_id))
  ON CONFLICT DO NOTHING;

  RETURN v_job;
END;
$$;
