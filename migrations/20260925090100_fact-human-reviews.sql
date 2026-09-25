-- ============================================================================
-- RECONCILIACION DEL LEDGER (sin cambio de contenido normativo)
--
-- Fichero original: migrations/20260922140000_fact-human-reviews.sql
-- Version original: 20260922140000
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
CREATE TABLE IF NOT EXISTS public.fact_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  fact_id uuid NOT NULL REFERENCES public.facts(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('VALID', 'INVALID')),
  corrected_value jsonb,
  note text,
  reviewed_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fact_reviews_audit_fact_idx ON public.fact_reviews (audit_id, fact_id, created_at DESC);
ALTER TABLE public.fact_reviews ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.fact_reviews TO authenticated;

DROP POLICY IF EXISTS fact_reviews_visible_audits ON public.fact_reviews;
CREATE POLICY fact_reviews_visible_audits ON public.fact_reviews
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.audits WHERE audits.id = fact_reviews.audit_id
    AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
);

DROP POLICY IF EXISTS fact_reviews_insert_visible_audits ON public.fact_reviews;
CREATE POLICY fact_reviews_insert_visible_audits ON public.fact_reviews
FOR INSERT TO authenticated WITH CHECK (
  reviewed_by = auth.uid()
  AND EXISTS (SELECT 1 FROM public.audits WHERE audits.id = fact_reviews.audit_id
    AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
);
