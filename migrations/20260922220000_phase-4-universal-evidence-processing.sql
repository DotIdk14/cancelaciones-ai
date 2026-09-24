ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS evidence_id uuid REFERENCES public.evidences(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS jobs_evidence_created_idx ON public.jobs (evidence_id, created_at DESC);

ALTER TABLE public.job_artifacts
  ADD COLUMN IF NOT EXISTS evidence_id uuid REFERENCES public.evidences(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS attempt_id uuid REFERENCES public.job_attempts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS extractor_version text,
  ADD COLUMN IF NOT EXISTS provider text CHECK (provider IN ('LOCAL', 'ASSEMBLYAI', 'OPENROUTER')),
  ADD COLUMN IF NOT EXISTS provider_operation_id uuid,
  ADD COLUMN IF NOT EXISTS storage_bucket text,
  ADD COLUMN IF NOT EXISTS storage_key text,
  ADD COLUMN IF NOT EXISTS content_sha256 text,
  ADD COLUMN IF NOT EXISTS warnings jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS job_artifacts_evidence_idx ON public.job_artifacts (evidence_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.provider_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  attempt_id uuid REFERENCES public.job_attempts(id) ON DELETE SET NULL,
  evidence_id uuid REFERENCES public.evidences(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('ASSEMBLYAI', 'OPENROUTER')),
  operation_type text NOT NULL,
  external_operation_id text NOT NULL,
  request_fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_code text,
  error_message_sanitized text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, operation_type, request_fingerprint)
);

CREATE INDEX IF NOT EXISTS provider_operations_evidence_idx ON public.provider_operations (evidence_id);

CREATE INDEX IF NOT EXISTS provider_operations_job_idx ON public.provider_operations (job_id);

DROP TRIGGER IF EXISTS provider_operations_set_updated_at ON public.provider_operations;

CREATE TRIGGER provider_operations_set_updated_at
BEFORE UPDATE ON public.provider_operations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  evidence_id uuid REFERENCES public.evidences(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  attempt_id uuid REFERENCES public.job_attempts(id) ON DELETE SET NULL,
  provider_operation_id uuid REFERENCES public.provider_operations(id) ON DELETE SET NULL,
  provider text NOT NULL CHECK (provider IN ('ASSEMBLYAI', 'OPENROUTER')),
  operation text NOT NULL,
  request_fingerprint text NOT NULL,
  model text,
  unit_type text NOT NULL,
  input_units numeric NOT NULL DEFAULT 0 CHECK (input_units >= 0),
  output_units numeric NOT NULL DEFAULT 0 CHECK (output_units >= 0),
  unit_price_usd numeric NOT NULL DEFAULT 0 CHECK (unit_price_usd >= 0),
  estimated_cost_usd numeric NOT NULL DEFAULT 0 CHECK (estimated_cost_usd >= 0),
  currency text NOT NULL DEFAULT 'USD',
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, operation, request_fingerprint)
);

CREATE INDEX IF NOT EXISTS ai_usage_audit_idx ON public.ai_usage (audit_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS ai_usage_evidence_idx ON public.ai_usage (evidence_id);

CREATE TABLE IF NOT EXISTS public.speaker_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id uuid NOT NULL REFERENCES public.evidences(id) ON DELETE CASCADE,
  artifact_id uuid NOT NULL REFERENCES public.job_artifacts(id) ON DELETE CASCADE,
  provider_speaker_label text NOT NULL,
  assigned_role text NOT NULL CHECK (assigned_role IN ('AGENT', 'CLIENT', 'THIRD_PARTY', 'UNKNOWN')),
  assigned_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, provider_speaker_label)
);

CREATE INDEX IF NOT EXISTS speaker_assignments_evidence_idx ON public.speaker_assignments (evidence_id);

DROP TRIGGER IF EXISTS speaker_assignments_set_updated_at ON public.speaker_assignments;

CREATE TRIGGER speaker_assignments_set_updated_at
BEFORE UPDATE ON public.speaker_assignments
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.provider_operations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.speaker_assignments ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.provider_operations TO authenticated;

GRANT SELECT ON public.ai_usage TO authenticated;

GRANT SELECT, INSERT, UPDATE ON public.speaker_assignments TO authenticated;

DROP POLICY IF EXISTS provider_operations_select_for_visible_audits ON public.provider_operations;

CREATE POLICY provider_operations_select_for_visible_audits ON public.provider_operations
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.evidences
    JOIN public.audits ON audits.id = evidences.audit_id
    WHERE evidences.id = provider_operations.evidence_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
  )
);

DROP POLICY IF EXISTS ai_usage_select_for_visible_audits ON public.ai_usage;

CREATE POLICY ai_usage_select_for_visible_audits ON public.ai_usage
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.audits
    WHERE audits.id = ai_usage.audit_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
  )
);

DROP POLICY IF EXISTS speaker_assignments_select_for_visible_audits ON public.speaker_assignments;

CREATE POLICY speaker_assignments_select_for_visible_audits ON public.speaker_assignments
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.evidences
    JOIN public.audits ON audits.id = evidences.audit_id
    WHERE evidences.id = speaker_assignments.evidence_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
  )
);

DROP POLICY IF EXISTS speaker_assignments_insert_for_visible_audits ON public.speaker_assignments;

CREATE POLICY speaker_assignments_insert_for_visible_audits ON public.speaker_assignments
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.evidences
    JOIN public.audits ON audits.id = evidences.audit_id
    WHERE evidences.id = speaker_assignments.evidence_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
  )
);

DROP POLICY IF EXISTS speaker_assignments_update_for_visible_audits ON public.speaker_assignments;

CREATE POLICY speaker_assignments_update_for_visible_audits ON public.speaker_assignments
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.evidences
    JOIN public.audits ON audits.id = evidences.audit_id
    WHERE evidences.id = speaker_assignments.evidence_id
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
  INSERT INTO public.jobs (audit_id, evidence_id, job_type, operation_scope, idempotency_key, input_fingerprint, payload, priority, max_attempts)
  VALUES (p_audit_id, p_evidence_id, p_job_type, p_operation_scope, p_idempotency_key, p_input_fingerprint, COALESCE(p_payload, '{}'::jsonb), p_priority, p_max_attempts)
  ON CONFLICT (operation_scope, idempotency_key) DO UPDATE
    SET updated_at = public.jobs.updated_at
  RETURNING * INTO v_job;

  INSERT INTO public.audit_log (audit_id, event_type, actor_id, metadata)
  VALUES (v_job.audit_id, 'JOB_QUEUED', p_actor_id, jsonb_build_object('jobId', v_job.id, 'jobType', v_job.job_type, 'evidenceId', v_job.evidence_id))
  ON CONFLICT DO NOTHING;

  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_job_artifact(
  p_job_id uuid,
  p_artifact_type text,
  p_result jsonb DEFAULT '{}'::jsonb,
  p_evidence_id uuid DEFAULT NULL,
  p_attempt_id uuid DEFAULT NULL,
  p_extractor_version text DEFAULT NULL,
  p_provider text DEFAULT 'LOCAL',
  p_provider_operation_id uuid DEFAULT NULL,
  p_storage_bucket text DEFAULT NULL,
  p_storage_key text DEFAULT NULL,
  p_content_sha256 text DEFAULT NULL,
  p_warnings jsonb DEFAULT '[]'::jsonb
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

  INSERT INTO public.job_artifacts (
    job_id, operation_scope, idempotency_key, artifact_type, input_fingerprint,
    result, evidence_id, attempt_id, extractor_version, provider, provider_operation_id,
    storage_bucket, storage_key, content_sha256, warnings
  )
  VALUES (
    v_job.id, v_job.operation_scope, v_job.idempotency_key, p_artifact_type, v_job.input_fingerprint,
    COALESCE(p_result, '{}'::jsonb),
    COALESCE(p_evidence_id, v_job.evidence_id), p_attempt_id, p_extractor_version,
    p_provider, p_provider_operation_id, p_storage_bucket, p_storage_key, p_content_sha256,
    COALESCE(p_warnings, '[]'::jsonb)
  )
  ON CONFLICT (operation_scope, idempotency_key, artifact_type, input_fingerprint) DO UPDATE
    SET result = public.job_artifacts.result
  RETURNING * INTO v_artifact;

  RETURN v_artifact;
END;
$$;

CREATE OR REPLACE FUNCTION public.persist_provider_operation(
  p_provider text,
  p_operation_type text,
  p_external_operation_id text,
  p_request_fingerprint text,
  p_job_id uuid,
  p_attempt_id uuid,
  p_evidence_id uuid
)
RETURNS public.provider_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operation public.provider_operations;
BEGIN
  INSERT INTO public.provider_operations (provider, operation_type, external_operation_id, request_fingerprint, job_id, attempt_id, evidence_id)
  VALUES (p_provider, p_operation_type, p_external_operation_id, p_request_fingerprint, p_job_id, p_attempt_id, p_evidence_id)
  ON CONFLICT (provider, operation_type, request_fingerprint) DO NOTHING;

  SELECT * INTO v_operation
  FROM public.provider_operations
  WHERE provider = p_provider
    AND operation_type = p_operation_type
    AND request_fingerprint = p_request_fingerprint;

  IF v_operation.job_id IS NULL THEN
    UPDATE public.provider_operations
    SET job_id = p_job_id, attempt_id = p_attempt_id
    WHERE id = v_operation.id;
  END IF;

  RETURN v_operation;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_provider_operation_status(
  p_provider text,
  p_operation_type text,
  p_request_fingerprint text,
  p_status text,
  p_error_code text DEFAULT NULL,
  p_error_message_sanitized text DEFAULT NULL
)
RETURNS public.provider_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operation public.provider_operations;
BEGIN
  UPDATE public.provider_operations
  SET status = p_status,
      completed_at = CASE WHEN p_status IN ('COMPLETED', 'FAILED', 'CANCELLED') THEN now() ELSE completed_at END,
      error_code = COALESCE(p_error_code, error_code),
      error_message_sanitized = COALESCE(left(p_error_message_sanitized, 500), error_message_sanitized)
  WHERE provider = p_provider
    AND operation_type = p_operation_type
    AND request_fingerprint = p_request_fingerprint
    AND status IN ('SUBMITTED', 'RUNNING')
  RETURNING * INTO v_operation;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROVIDER_OPERATION_NOT_FOUND_OR_FINAL';
  END IF;

  RETURN v_operation;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_ai_usage(
  p_audit_id uuid,
  p_evidence_id uuid,
  p_job_id uuid,
  p_attempt_id uuid,
  p_provider_operation_id uuid,
  p_provider text,
  p_operation text,
  p_request_fingerprint text,
  p_model text,
  p_unit_type text,
  p_input_units numeric,
  p_output_units numeric,
  p_unit_price_usd numeric,
  p_estimated_cost_usd numeric
)
RETURNS public.ai_usage
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usage public.ai_usage;
BEGIN
  INSERT INTO public.ai_usage (
    audit_id, evidence_id, job_id, attempt_id, provider_operation_id, provider, operation,
    request_fingerprint, model, unit_type, input_units, output_units, unit_price_usd, estimated_cost_usd
  )
  VALUES (
    p_audit_id, p_evidence_id, p_job_id, p_attempt_id, p_provider_operation_id, p_provider, p_operation,
    p_request_fingerprint, p_model, p_unit_type, p_input_units, p_output_units, p_unit_price_usd, p_estimated_cost_usd
  )
  ON CONFLICT (provider, operation, request_fingerprint) DO NOTHING;

  SELECT * INTO v_usage
  FROM public.ai_usage
  WHERE provider = p_provider AND operation = p_operation AND request_fingerprint = p_request_fingerprint;

  RETURN v_usage;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_job(
  uuid, text, text, text, text, jsonb, integer, integer, uuid, uuid
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.record_job_artifact(
  uuid, text, jsonb, uuid, uuid, text, text, uuid, text, text, text, jsonb
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.persist_provider_operation(text, text, text, text, uuid, uuid, uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.update_provider_operation_status(text, text, text, text, text, text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.record_ai_usage(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, numeric, numeric, numeric, numeric
) TO authenticated;
