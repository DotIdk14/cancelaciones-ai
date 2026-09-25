-- ============================================================================
-- RECONCILIACION DEL LEDGER (sin cambio de contenido normativo)
--
-- Fichero original: migrations/20260922170000_audit-manual-comments.sql
-- Version original: 20260922170000
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
CREATE TABLE IF NOT EXISTS public.audit_manual_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL UNIQUE REFERENCES public.audits(id) ON DELETE CASCADE,
  back_office_comment text,
  helpdesk_comment text,
  school_services_comment text,
  finance_comment text,
  additional_comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

DROP TRIGGER IF EXISTS audit_manual_comments_set_updated_at ON public.audit_manual_comments;
CREATE TRIGGER audit_manual_comments_set_updated_at
BEFORE UPDATE ON public.audit_manual_comments
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.audit_manual_comments ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.audit_manual_comments TO authenticated;

DROP POLICY IF EXISTS audit_manual_comments_select_visible ON public.audit_manual_comments;
CREATE POLICY audit_manual_comments_select_visible ON public.audit_manual_comments
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.audits
    WHERE audits.id = audit_manual_comments.audit_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
  )
);

DROP POLICY IF EXISTS audit_manual_comments_insert_own_audit ON public.audit_manual_comments;
CREATE POLICY audit_manual_comments_insert_own_audit ON public.audit_manual_comments
FOR INSERT TO authenticated
WITH CHECK (
  updated_by = auth.uid() AND EXISTS (
    SELECT 1 FROM public.audits
    WHERE audits.id = audit_manual_comments.audit_id
      AND audits.created_by = auth.uid()
  )
);

DROP POLICY IF EXISTS audit_manual_comments_update_own_audit ON public.audit_manual_comments;
CREATE POLICY audit_manual_comments_update_own_audit ON public.audit_manual_comments
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.audits
    WHERE audits.id = audit_manual_comments.audit_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
  )
)
WITH CHECK (
  updated_by = auth.uid() AND EXISTS (
    SELECT 1 FROM public.audits
    WHERE audits.id = audit_manual_comments.audit_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
  )
);
