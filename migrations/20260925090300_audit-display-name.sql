-- ============================================================================
-- RECONCILIACION DEL LEDGER (sin cambio de contenido normativo)
--
-- Fichero original: migrations/20260922160000_audit-display-name.sql
-- Version original: 20260922160000
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
ALTER TABLE public.audits
  ADD COLUMN IF NOT EXISTS display_name text;
