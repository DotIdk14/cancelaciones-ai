ALTER TABLE public.fact_extraction_runs
  ADD COLUMN IF NOT EXISTS artifact_set_fingerprint_hash text;

UPDATE public.fact_extraction_runs
SET artifact_set_fingerprint_hash = encode(digest(artifact_set_fingerprint, 'sha256'), 'hex')
WHERE artifact_set_fingerprint_hash IS NULL;

CREATE OR REPLACE FUNCTION public.set_fact_run_long_hashes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.policy_code_hash = encode(digest(NEW.policy_code, 'sha256'), 'hex');
  NEW.artifact_set_fingerprint_hash = encode(digest(NEW.artifact_set_fingerprint, 'sha256'), 'hex');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fact_runs_policy_hash_on_write ON public.fact_extraction_runs;

DROP TRIGGER IF EXISTS fact_runs_long_hashes_on_write ON public.fact_extraction_runs;

CREATE TRIGGER fact_runs_long_hashes_on_write
BEFORE INSERT OR UPDATE OF policy_code, artifact_set_fingerprint ON public.fact_extraction_runs
FOR EACH ROW EXECUTE FUNCTION public.set_fact_run_long_hashes();

ALTER TABLE public.fact_extraction_runs
  ALTER COLUMN artifact_set_fingerprint_hash SET NOT NULL;

DROP INDEX IF EXISTS fact_extraction_runs_idempotency_hash_idx;

CREATE UNIQUE INDEX IF NOT EXISTS fact_extraction_runs_idempotency_hash_idx
ON public.fact_extraction_runs (
  audit_id,
  policy_code_hash,
  policy_version,
  extractor_version,
  artifact_set_fingerprint_hash
);
