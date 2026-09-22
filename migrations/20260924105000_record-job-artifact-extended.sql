CREATE OR REPLACE FUNCTION public.record_job_artifact(
  p_job_id uuid,
  p_artifact_type text,
  p_result jsonb DEFAULT '{}'::jsonb,
  p_evidence_id uuid DEFAULT NULL,
  p_attempt_id uuid DEFAULT NULL,
  p_extractor_version text DEFAULT NULL,
  p_provider text DEFAULT NULL,
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

  INSERT INTO public.job_artifacts (job_id, operation_scope, idempotency_key, artifact_type, input_fingerprint, result, evidence_id, attempt_id, extractor_version, provider, provider_operation_id, storage_bucket, storage_key, content_sha256, warnings)
  VALUES (v_job.id, v_job.operation_scope, v_job.idempotency_key, p_artifact_type, v_job.input_fingerprint, COALESCE(p_result, '{}'::jsonb), p_evidence_id, p_attempt_id, p_extractor_version, p_provider, p_provider_operation_id, p_storage_bucket, p_storage_key, p_content_sha256, COALESCE(p_warnings, '[]'::jsonb))
  ON CONFLICT (operation_scope, idempotency_key, artifact_type, input_fingerprint) DO UPDATE
    SET result = public.job_artifacts.result
  RETURNING * INTO v_artifact;

  RETURN v_artifact;
END;
$$;
