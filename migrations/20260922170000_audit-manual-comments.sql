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
