-- ============================================================================
-- RECONCILIACION DEL LEDGER (sin cambio de contenido normativo)
--
-- Fichero original: migrations/20260924103001_actionable-decision-status.sql
-- Version original: 20260924103001
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
ALTER TABLE public.engine_runs
  ADD COLUMN IF NOT EXISTS decision_status text;

UPDATE public.engine_runs
SET decision_status = CASE
  WHEN outcome_status = 'CONFLICTED' THEN 'CONFLICTED'
  WHEN outcome_status = 'INDETERMINATE' THEN 'INDETERMINATE'
  WHEN outcome_status = 'DETERMINED_WITH_WARNINGS' THEN 'REVIEW_REQUIRED'
  ELSE 'READY_TO_APPROVE'
END
WHERE decision_status IS NULL;

ALTER TABLE public.engine_runs
  ALTER COLUMN decision_status SET DEFAULT 'INDETERMINATE';

ALTER TABLE public.engine_runs
  DROP CONSTRAINT IF EXISTS engine_runs_decision_status_check;

ALTER TABLE public.engine_runs
  ADD CONSTRAINT engine_runs_decision_status_check
  CHECK (decision_status IN ('READY_TO_APPROVE', 'REVIEW_REQUIRED', 'CONFLICTED', 'INDETERMINATE'));
