ALTER TABLE public.evidences
  ADD COLUMN IF NOT EXISTS audit_id uuid REFERENCES public.audits(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS original_filename text,
  ADD COLUMN IF NOT EXISTS safe_filename text,
  ADD COLUMN IF NOT EXISTS detected_mime_type text,
  ADD COLUMN IF NOT EXISTS storage_bucket text NOT NULL DEFAULT 'dictamen-evidencias',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS uploaded_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS failure_reason text,
  ADD COLUMN IF NOT EXISTS retired_at timestamptz,
  ADD COLUMN IF NOT EXISTS retired_by uuid REFERENCES auth.users(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'evidences_status_check'
  ) THEN
    ALTER TABLE public.evidences
      ADD CONSTRAINT evidences_status_check CHECK (status IN ('PENDING', 'STORED', 'FAILED', 'RETIRED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS evidences_audit_id_created_at_idx ON public.evidences (audit_id, created_at DESC);
CREATE INDEX IF NOT EXISTS evidences_storage_lookup_idx ON public.evidences (storage_bucket, storage_key);

ALTER TABLE public.evidences ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.evidences TO authenticated;

DROP POLICY IF EXISTS evidences_select_for_visible_audits ON public.evidences;
CREATE POLICY evidences_select_for_visible_audits ON public.evidences
FOR SELECT TO authenticated
USING (
  audit_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.audits
    WHERE audits.id = evidences.audit_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
  )
);

DROP POLICY IF EXISTS evidences_insert_for_own_audits ON public.evidences;
CREATE POLICY evidences_insert_for_own_audits ON public.evidences
FOR INSERT TO authenticated
WITH CHECK (
  uploaded_by = auth.uid()
  AND audit_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.audits
    WHERE audits.id = evidences.audit_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
  )
);

DROP POLICY IF EXISTS evidences_update_for_visible_audits ON public.evidences;
CREATE POLICY evidences_update_for_visible_audits ON public.evidences
FOR UPDATE TO authenticated
USING (
  audit_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.audits
    WHERE audits.id = evidences.audit_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
  )
)
WITH CHECK (
  audit_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.audits
    WHERE audits.id = evidences.audit_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
  )
);
