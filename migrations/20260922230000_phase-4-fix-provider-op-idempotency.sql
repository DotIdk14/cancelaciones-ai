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
  SELECT * INTO v_operation
  FROM public.provider_operations
  WHERE provider = p_provider
    AND operation_type = p_operation_type
    AND request_fingerprint = p_request_fingerprint;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROVIDER_OPERATION_NOT_FOUND';
  END IF;

  IF v_operation.status IN ('COMPLETED', 'FAILED', 'CANCELLED') AND v_operation.status <> p_status THEN
    RAISE EXCEPTION 'PROVIDER_OPERATION_FINAL_STATE: %', v_operation.status;
  END IF;

  UPDATE public.provider_operations
  SET status = p_status,
      completed_at = CASE WHEN p_status IN ('COMPLETED', 'FAILED', 'CANCELLED') THEN COALESCE(completed_at, now()) ELSE completed_at END,
      error_code = COALESCE(p_error_code, error_code),
      error_message_sanitized = COALESCE(left(p_error_message_sanitized, 500), error_message_sanitized),
      updated_at = now()
  WHERE id = v_operation.id;

  RETURN v_operation;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_provider_operation_status(text, text, text, text, text, text) TO authenticated;
