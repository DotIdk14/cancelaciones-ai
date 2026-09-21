CREATE TABLE IF NOT EXISTS public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  job_type text NOT NULL,
  operation_scope text NOT NULL,
  idempotency_key text NOT NULL,
  input_fingerprint text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'SUCCEEDED', 'FAILED', 'CANCELLATION_REQUESTED', 'CANCELLED')),
  priority integer NOT NULL DEFAULT 100,
  progress integer NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  last_error_code text,
  last_error_message_sanitized text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operation_scope, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.job_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL,
  worker_id text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  outcome text CHECK (outcome IN ('SUCCEEDED', 'FAILED_TRANSIENT', 'FAILED_PERMANENT', 'CANCELLED', 'CRASHED')),
  error_code text,
  error_message_sanitized text,
  UNIQUE (job_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS public.job_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  operation_scope text NOT NULL,
  idempotency_key text NOT NULL,
  artifact_type text NOT NULL,
  input_fingerprint text NOT NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operation_scope, idempotency_key, artifact_type, input_fingerprint)
);

CREATE INDEX IF NOT EXISTS jobs_claim_idx ON public.jobs (status, available_at, priority, created_at);
CREATE INDEX IF NOT EXISTS jobs_audit_created_idx ON public.jobs (audit_id, created_at DESC);
CREATE INDEX IF NOT EXISTS job_attempts_job_idx ON public.job_attempts (job_id, attempt_number DESC);
CREATE INDEX IF NOT EXISTS job_artifacts_job_idx ON public.job_artifacts (job_id);

DROP TRIGGER IF EXISTS jobs_set_updated_at ON public.jobs;
CREATE TRIGGER jobs_set_updated_at
BEFORE UPDATE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_artifacts ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.job_attempts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.job_artifacts TO authenticated;

DROP POLICY IF EXISTS jobs_select_for_visible_audits ON public.jobs;
CREATE POLICY jobs_select_for_visible_audits ON public.jobs
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.audits
    WHERE audits.id = jobs.audit_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
  )
);

DROP POLICY IF EXISTS job_attempts_select_for_visible_jobs ON public.job_attempts;
CREATE POLICY job_attempts_select_for_visible_jobs ON public.job_attempts
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.jobs
    JOIN public.audits ON audits.id = jobs.audit_id
    WHERE jobs.id = job_attempts.job_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
  )
);

DROP POLICY IF EXISTS job_artifacts_select_for_visible_jobs ON public.job_artifacts;
CREATE POLICY job_artifacts_select_for_visible_jobs ON public.job_artifacts
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.jobs
    JOIN public.audits ON audits.id = jobs.audit_id
    WHERE jobs.id = job_artifacts.job_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
  )
);

CREATE OR REPLACE FUNCTION public.enqueue_job(
  p_audit_id uuid,
  p_job_type text,
  p_operation_scope text,
  p_idempotency_key text,
  p_input_fingerprint text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_priority integer DEFAULT 100,
  p_max_attempts integer DEFAULT 3,
  p_actor_id uuid DEFAULT NULL
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
  VALUES (v_job.audit_id, 'JOB_QUEUED', p_actor_id, jsonb_build_object('jobId', v_job.id, 'jobType', v_job.job_type))
  ON CONFLICT DO NOTHING;

  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_next_job(
  p_worker_id text,
  p_lease_seconds integer DEFAULT 60
)
RETURNS TABLE (
  job_id uuid,
  attempt_id uuid,
  audit_id uuid,
  job_type text,
  payload jsonb,
  attempt_number integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.jobs;
  v_attempt public.job_attempts;
BEGIN
  WITH candidate AS (
    SELECT id
    FROM public.jobs
    WHERE (
      status IN ('QUEUED', 'RETRY_SCHEDULED')
      OR (status = 'RUNNING' AND lease_expires_at < now())
    )
      AND available_at <= now()
      AND attempt_count < max_attempts
    ORDER BY priority ASC, available_at ASC, created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.jobs j
  SET status = 'RUNNING',
      lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      started_at = COALESCE(j.started_at, now()),
      attempt_count = j.attempt_count + 1,
      progress = CASE WHEN j.progress = 0 THEN 5 ELSE j.progress END,
      last_error_code = NULL,
      last_error_message_sanitized = NULL
  FROM candidate
  WHERE j.id = candidate.id
  RETURNING j.* INTO v_job;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO public.job_attempts (job_id, attempt_number, worker_id)
  VALUES (v_job.id, v_job.attempt_count, p_worker_id)
  RETURNING * INTO v_attempt;

  INSERT INTO public.audit_log (audit_id, event_type, metadata)
  VALUES (v_job.audit_id, 'JOB_STARTED', jsonb_build_object('jobId', v_job.id, 'jobType', v_job.job_type, 'attempt', v_job.attempt_count));

  job_id := v_job.id;
  attempt_id := v_attempt.id;
  audit_id := v_job.audit_id;
  job_type := v_job.job_type;
  payload := v_job.payload;
  attempt_number := v_job.attempt_count;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_job_artifact(
  p_job_id uuid,
  p_artifact_type text,
  p_result jsonb DEFAULT '{}'::jsonb
)
RETURNS public.job_artifacts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.jobs;
  v_artifact public.job_artifacts;
BEGIN
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOB_NOT_FOUND';
  END IF;

  INSERT INTO public.job_artifacts (job_id, operation_scope, idempotency_key, artifact_type, input_fingerprint, result)
  VALUES (v_job.id, v_job.operation_scope, v_job.idempotency_key, p_artifact_type, v_job.input_fingerprint, COALESCE(p_result, '{}'::jsonb))
  ON CONFLICT (operation_scope, idempotency_key, artifact_type, input_fingerprint) DO UPDATE
    SET result = public.job_artifacts.result
  RETURNING * INTO v_artifact;

  RETURN v_artifact;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_job(
  p_job_id uuid,
  p_worker_id text,
  p_progress integer DEFAULT 100
)
RETURNS public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.jobs;
BEGIN
  UPDATE public.jobs
  SET status = 'SUCCEEDED',
      progress = LEAST(GREATEST(p_progress, 0), 100),
      completed_at = now(),
      lease_owner = NULL,
      lease_expires_at = NULL
  WHERE id = p_job_id
    AND status = 'RUNNING'
    AND lease_owner = p_worker_id
  RETURNING * INTO v_job;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_JOB_TRANSITION';
  END IF;

  UPDATE public.job_attempts
  SET finished_at = now(), outcome = 'SUCCEEDED'
  WHERE job_id = p_job_id AND worker_id = p_worker_id AND finished_at IS NULL;

  INSERT INTO public.audit_log (audit_id, event_type, metadata)
  VALUES (v_job.audit_id, 'JOB_SUCCEEDED', jsonb_build_object('jobId', v_job.id, 'jobType', v_job.job_type, 'attempt', v_job.attempt_count));

  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.schedule_job_retry(
  p_job_id uuid,
  p_worker_id text,
  p_error_code text,
  p_error_message_sanitized text,
  p_delay_seconds integer DEFAULT 30
)
RETURNS public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.jobs;
  v_next_status text;
BEGIN
  SELECT CASE WHEN attempt_count >= max_attempts THEN 'FAILED' ELSE 'RETRY_SCHEDULED' END
  INTO v_next_status
  FROM public.jobs
  WHERE id = p_job_id AND status = 'RUNNING' AND lease_owner = p_worker_id;

  IF v_next_status IS NULL THEN
    RAISE EXCEPTION 'INVALID_JOB_TRANSITION';
  END IF;

  UPDATE public.jobs
  SET status = v_next_status,
      available_at = CASE WHEN v_next_status = 'FAILED' THEN available_at ELSE now() + make_interval(secs => p_delay_seconds) END,
      failed_at = CASE WHEN v_next_status = 'FAILED' THEN now() ELSE failed_at END,
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error_code = p_error_code,
      last_error_message_sanitized = left(COALESCE(p_error_message_sanitized, ''), 500)
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  UPDATE public.job_attempts
  SET finished_at = now(), outcome = 'FAILED_TRANSIENT', error_code = p_error_code, error_message_sanitized = left(COALESCE(p_error_message_sanitized, ''), 500)
  WHERE job_id = p_job_id AND worker_id = p_worker_id AND finished_at IS NULL;

  INSERT INTO public.audit_log (audit_id, event_type, metadata)
  VALUES (v_job.audit_id, CASE WHEN v_job.status = 'FAILED' THEN 'JOB_FAILED' ELSE 'JOB_RETRY_SCHEDULED' END, jsonb_build_object('jobId', v_job.id, 'jobType', v_job.job_type, 'attempt', v_job.attempt_count, 'errorCode', p_error_code));

  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_job_permanent(
  p_job_id uuid,
  p_worker_id text,
  p_error_code text,
  p_error_message_sanitized text
)
RETURNS public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.jobs;
BEGIN
  UPDATE public.jobs
  SET status = 'FAILED',
      failed_at = now(),
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error_code = p_error_code,
      last_error_message_sanitized = left(COALESCE(p_error_message_sanitized, ''), 500)
  WHERE id = p_job_id AND status = 'RUNNING' AND lease_owner = p_worker_id
  RETURNING * INTO v_job;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_JOB_TRANSITION';
  END IF;

  UPDATE public.job_attempts
  SET finished_at = now(), outcome = 'FAILED_PERMANENT', error_code = p_error_code, error_message_sanitized = left(COALESCE(p_error_message_sanitized, ''), 500)
  WHERE job_id = p_job_id AND worker_id = p_worker_id AND finished_at IS NULL;

  INSERT INTO public.audit_log (audit_id, event_type, metadata)
  VALUES (v_job.audit_id, 'JOB_FAILED', jsonb_build_object('jobId', v_job.id, 'jobType', v_job.job_type, 'attempt', v_job.attempt_count, 'errorCode', p_error_code));

  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.renew_job_lease(
  p_job_id uuid,
  p_worker_id text,
  p_lease_seconds integer DEFAULT 60,
  p_progress integer DEFAULT NULL
)
RETURNS public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.jobs;
BEGIN
  UPDATE public.jobs
  SET lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      progress = COALESCE(LEAST(GREATEST(p_progress, 0), 100), progress)
  WHERE id = p_job_id AND status = 'RUNNING' AND lease_owner = p_worker_id
  RETURNING * INTO v_job;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_JOB_LEASE';
  END IF;

  RETURN v_job;
END;
$$;
