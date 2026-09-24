ALTER TABLE public.engine_runs
  ADD COLUMN IF NOT EXISTS policy_code_hash text;

UPDATE public.engine_runs
SET policy_code_hash = encode(digest(policy_code, 'sha256'), 'hex')
WHERE policy_code_hash IS NULL;

CREATE OR REPLACE FUNCTION public.set_engine_run_policy_hash()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.policy_code_hash = encode(digest(NEW.policy_code, 'sha256'), 'hex');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS engine_runs_policy_hash_on_write ON public.engine_runs;
CREATE TRIGGER engine_runs_policy_hash_on_write
BEFORE INSERT OR UPDATE OF policy_code ON public.engine_runs
FOR EACH ROW EXECUTE FUNCTION public.set_engine_run_policy_hash();

ALTER TABLE public.engine_runs
  ALTER COLUMN policy_code_hash SET NOT NULL;

DROP INDEX IF EXISTS engine_runs_idempotency_idx;
CREATE UNIQUE INDEX IF NOT EXISTS engine_runs_idempotency_idx ON public.engine_runs
  (audit_id, facts_fingerprint, policy_code_hash, policy_version, rules_fingerprint,
   COALESCE(owner_precedence_version, ''));

CREATE INDEX IF NOT EXISTS engine_runs_policy_code_hash_idx ON public.engine_runs
  (audit_id, policy_code_hash, policy_version);
