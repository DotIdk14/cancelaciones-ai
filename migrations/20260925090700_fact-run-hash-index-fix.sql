-- ============================================================================
-- RECONCILIACION DEL LEDGER (sin cambio de contenido normativo)
--
-- Fichero original: migrations/20260924131000_fact-run-hash-index-fix.sql
-- Version original: 20260924131000
--
-- Este fichero NUNCA llego a registrarse en el ledger del backend, aunque su
-- esquema ya estaba materializado (la rama se creo con el esquema copiado y el
-- ledger quedo incompleto). El CLI rechaza aplicar en desorden un fichero
-- pendiente mas antiguo que la cabeza remota, asi que no habia forma de llegar
-- a la migracion Foundation sin reconciliar antes.
--
-- Se renombra con timestamp nuevo conservando el original en la cabecera. NO se
-- altera ninguna sentencia: el cuerpo es byte-identico al original. Aplicarlo
-- es idempotente (IF NOT EXISTS / DROP IF EXISTS + CREATE), de modo que sobre
-- el esquema ya presente no cambia nada, y sobre el delta genuinely ausente si
-- lo crea.
-- ============================================================================
ALTER TABLE public.fact_extraction_runs
  ADD COLUMN IF NOT EXISTS policy_code_hash text,
  ADD COLUMN IF NOT EXISTS artifact_set_fingerprint_hash text;

UPDATE public.fact_extraction_runs
SET
  policy_code_hash = encode(digest(policy_code, 'sha256'), 'hex'),
  artifact_set_fingerprint_hash = encode(digest(artifact_set_fingerprint, 'sha256'), 'hex')
WHERE policy_code_hash IS NULL OR artifact_set_fingerprint_hash IS NULL;

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
  ALTER COLUMN policy_code_hash SET NOT NULL,
  ALTER COLUMN artifact_set_fingerprint_hash SET NOT NULL;

ALTER TABLE public.fact_extraction_runs
  DROP CONSTRAINT IF EXISTS fact_extraction_runs_audit_id_policy_code_policy_version_ex_key;

DROP INDEX IF EXISTS fact_extraction_runs_idempotency_hash_idx;

CREATE UNIQUE INDEX IF NOT EXISTS fact_extraction_runs_idempotency_hash_idx
ON public.fact_extraction_runs (
  audit_id,
  policy_code_hash,
  policy_version,
  extractor_version,
  artifact_set_fingerprint_hash
);
