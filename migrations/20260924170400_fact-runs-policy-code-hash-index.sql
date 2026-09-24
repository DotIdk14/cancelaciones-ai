ALTER TABLE public.fact_extraction_runs
  ADD COLUMN IF NOT EXISTS policy_code_hash text;

UPDATE public.fact_extraction_runs
SET policy_code_hash = encode(digest(policy_code, 'sha256'), 'hex')
WHERE policy_code_hash IS NULL;

CREATE OR REPLACE FUNCTION public.set_fact_run_policy_hash()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.policy_code_hash = encode(digest(NEW.policy_code, 'sha256'), 'hex');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fact_runs_policy_hash_on_write ON public.fact_extraction_runs;

CREATE TRIGGER fact_runs_policy_hash_on_write
BEFORE INSERT OR UPDATE OF policy_code ON public.fact_extraction_runs
FOR EACH ROW EXECUTE FUNCTION public.set_fact_run_policy_hash();

ALTER TABLE public.fact_extraction_runs
  ALTER COLUMN policy_code_hash SET NOT NULL;

ALTER TABLE public.fact_extraction_runs
  DROP CONSTRAINT IF EXISTS fact_extraction_runs_audit_id_policy_code_policy_version_ex_key;

CREATE UNIQUE INDEX IF NOT EXISTS fact_extraction_runs_idempotency_hash_idx
ON public.fact_extraction_runs (
  audit_id,
  policy_code_hash,
  policy_version,
  extractor_version,
  artifact_set_fingerprint
);
