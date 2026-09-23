-- Phase 7 — Dictamen oficial, revisión humana y workflow PDF.
-- 4 tablas: human_reviews, audit_evidence_selection, report_snapshots, dictamen_documents.
-- RLS: mismas reglas de visibilidad por auditoría (creador u OWNER) que las fases previas.

-- 1) Revisión humana explícita (una por auditoría; la decisión de máquina se congela aparte).
CREATE TABLE IF NOT EXISTS public.human_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL UNIQUE REFERENCES public.audits(id) ON DELETE CASCADE,
  machine_decision jsonb NOT NULL,
  decision_type text NOT NULL CHECK (decision_type IN ('APPROVE', 'CORRECT')),
  human_outcome text,
  human_cause text,
  human_reason text,
  reviewed_by uuid NOT NULL REFERENCES auth.users(id),
  reviewed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

DROP TRIGGER IF EXISTS human_reviews_set_updated_at ON public.human_reviews;
CREATE TRIGGER human_reviews_set_updated_at
BEFORE UPDATE ON public.human_reviews
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.human_reviews ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.human_reviews TO authenticated;

DROP POLICY IF EXISTS human_reviews_select_visible ON public.human_reviews;
CREATE POLICY human_reviews_select_visible ON public.human_reviews
FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.audits
    WHERE audits.id = human_reviews.audit_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
);

DROP POLICY IF EXISTS human_reviews_insert_own_audit ON public.human_reviews;
CREATE POLICY human_reviews_insert_own_audit ON public.human_reviews
FOR INSERT TO authenticated
WITH CHECK (
  reviewed_by = auth.uid() AND EXISTS (
    SELECT 1 FROM public.audits
    WHERE audits.id = human_reviews.audit_id
      AND audits.created_by = auth.uid()
  )
);

DROP POLICY IF EXISTS human_reviews_update_own_audit ON public.human_reviews;
CREATE POLICY human_reviews_update_own_audit ON public.human_reviews
FOR UPDATE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.audits
    WHERE audits.id = human_reviews.audit_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
)
WITH CHECK (
  reviewed_by = auth.uid() AND EXISTS (
    SELECT 1 FROM public.audits
    WHERE audits.id = human_reviews.audit_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
  )
);

-- 2) Selección de evidencias determinantes para el PDF (provenance preservada).
CREATE TABLE IF NOT EXISTS public.audit_evidence_selection (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  evidence_id uuid NOT NULL REFERENCES public.evidences(id) ON DELETE CASCADE,
  artifact_id text,
  sha256 text,
  page integer,
  region jsonb,
  timestamp_start numeric,
  timestamp_end numeric,
  cell text,
  original_filename text,
  selected_by uuid NOT NULL REFERENCES auth.users(id),
  selected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (audit_id, evidence_id)
);

CREATE INDEX IF NOT EXISTS audit_evidence_selection_audit_idx
  ON public.audit_evidence_selection (audit_id);

ALTER TABLE public.audit_evidence_selection ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_evidence_selection TO authenticated;

DROP POLICY IF EXISTS audit_evidence_selection_select_visible ON public.audit_evidence_selection;
CREATE POLICY audit_evidence_selection_select_visible ON public.audit_evidence_selection
FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.audits
    WHERE audits.id = audit_evidence_selection.audit_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
);

DROP POLICY IF EXISTS audit_evidence_selection_insert_own_audit ON public.audit_evidence_selection;
CREATE POLICY audit_evidence_selection_insert_own_audit ON public.audit_evidence_selection
FOR INSERT TO authenticated
WITH CHECK (
  selected_by = auth.uid() AND EXISTS (
    SELECT 1 FROM public.audits
    WHERE audits.id = audit_evidence_selection.audit_id
      AND audits.created_by = auth.uid()
  )
);

DROP POLICY IF EXISTS audit_evidence_selection_update_own_audit ON public.audit_evidence_selection;
CREATE POLICY audit_evidence_selection_update_own_audit ON public.audit_evidence_selection
FOR UPDATE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.audits
    WHERE audits.id = audit_evidence_selection.audit_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
)
WITH CHECK (
  selected_by = auth.uid() AND EXISTS (
    SELECT 1 FROM public.audits
    WHERE audits.id = audit_evidence_selection.audit_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
  )
);

DROP POLICY IF EXISTS audit_evidence_selection_delete_own_audit ON public.audit_evidence_selection;
CREATE POLICY audit_evidence_selection_delete_own_audit ON public.audit_evidence_selection
FOR DELETE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.audits
    WHERE audits.id = audit_evidence_selection.audit_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
);

-- 3) Snapshot durable: congela todo lo necesario para reproducir el documento.
CREATE TABLE IF NOT EXISTS public.report_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  fact_run_id uuid REFERENCES public.fact_extraction_runs(id) ON DELETE SET NULL,
  engine_run_id uuid NOT NULL REFERENCES public.engine_runs(id) ON DELETE CASCADE,
  policy_code text NOT NULL,
  policy_version text NOT NULL,
  snapshot_fingerprint text NOT NULL,
  machine jsonb NOT NULL,
  human jsonb,
  manual_comments jsonb NOT NULL,
  selected_evidence jsonb NOT NULL,
  template_hash text NOT NULL,
  rule_trace jsonb NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'FINAL')),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Solo un snapshot FINAL por auditoría (después de aprobación humana).
CREATE UNIQUE INDEX IF NOT EXISTS report_snapshots_one_final_per_audit
  ON public.report_snapshots (audit_id) WHERE status = 'FINAL';

ALTER TABLE public.report_snapshots ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.report_snapshots TO authenticated;

DROP POLICY IF EXISTS report_snapshots_select_visible ON public.report_snapshots;
CREATE POLICY report_snapshots_select_visible ON public.report_snapshots
FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.audits
    WHERE audits.id = report_snapshots.audit_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
);

DROP POLICY IF EXISTS report_snapshots_insert_own_audit ON public.report_snapshots;
CREATE POLICY report_snapshots_insert_own_audit ON public.report_snapshots
FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid() AND EXISTS (
    SELECT 1 FROM public.audits
    WHERE audits.id = report_snapshots.audit_id
      AND audits.created_by = auth.uid()
  )
);

DROP POLICY IF EXISTS report_snapshots_update_own_audit ON public.report_snapshots;
CREATE POLICY report_snapshots_update_own_audit ON public.report_snapshots
FOR UPDATE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.audits
    WHERE audits.id = report_snapshots.audit_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
)
WITH CHECK (
  created_by = auth.uid() AND EXISTS (
    SELECT 1 FROM public.audits
    WHERE audits.id = report_snapshots.audit_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
  )
);

-- 4) Documentos Dictamen generados (borrador y final) desde un snapshot.
CREATE TABLE IF NOT EXISTS public.dictamen_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES public.report_snapshots(id) ON DELETE CASCADE,
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('DRAFT', 'FINAL')),
  doc_fingerprint text NOT NULL,
  pdf_sha256 text NOT NULL,
  storage_bucket text NOT NULL,
  storage_key text NOT NULL,
  template_hash text NOT NULL,
  generated_by uuid NOT NULL REFERENCES auth.users(id),
  generated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Un borrador y un final por snapshot (el final es inmutable/unique).
CREATE UNIQUE INDEX IF NOT EXISTS dictamen_documents_one_per_snapshot_kind
  ON public.dictamen_documents (snapshot_id, kind);

ALTER TABLE public.dictamen_documents ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.dictamen_documents TO authenticated;

DROP POLICY IF EXISTS dictamen_documents_select_visible ON public.dictamen_documents;
CREATE POLICY dictamen_documents_select_visible ON public.dictamen_documents
FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.audits
    WHERE audits.id = dictamen_documents.audit_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
);

DROP POLICY IF EXISTS dictamen_documents_insert_own_audit ON public.dictamen_documents;
CREATE POLICY dictamen_documents_insert_own_audit ON public.dictamen_documents
FOR INSERT TO authenticated
WITH CHECK (
  generated_by = auth.uid() AND EXISTS (
    SELECT 1 FROM public.audits
    WHERE audits.id = dictamen_documents.audit_id
      AND audits.created_by = auth.uid()
  )
);