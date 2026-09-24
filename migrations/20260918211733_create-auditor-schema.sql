CREATE TABLE public.tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folio TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'BORRADOR',
  estudiante JSONB NOT NULL DEFAULT '{}'::jsonb,
  fechas JSONB NOT NULL DEFAULT '{}'::jsonb,
  solicitud JSONB NOT NULL DEFAULT '{}'::jsonb,
  resultado JSONB NOT NULL DEFAULT '{}'::jsonb,
  comentarios JSONB NOT NULL DEFAULT '{}'::jsonb,
  decision_data JSONB,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX tickets_folio_idx ON public.tickets (folio);

CREATE INDEX tickets_status_idx ON public.tickets (status);

CREATE INDEX tickets_created_at_idx ON public.tickets (created_at DESC);

CREATE INDEX tickets_completed_at_idx ON public.tickets (completed_at);

CREATE TABLE public.evidences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  nombre_archivo TEXT NOT NULL,
  tipo TEXT NOT NULL,
  fuente TEXT NOT NULL,
  storage_key TEXT,
  storage_url TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  sha256 TEXT,
  fecha_evidencia TIMESTAMPTZ,
  fecha_carga TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  orden_cronologico INTEGER,
  estado_lectura TEXT NOT NULL DEFAULT 'PENDIENTE',
  extraccion JSONB,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX evidences_ticket_id_idx ON public.evidences (ticket_id);

CREATE INDEX evidences_tipo_idx ON public.evidences (tipo);

CREATE INDEX evidences_fuente_idx ON public.evidences (fuente);

CREATE INDEX evidences_sha256_idx ON public.evidences (sha256);

CREATE TABLE public.transcript_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id UUID NOT NULL REFERENCES public.evidences(id) ON DELETE CASCADE,
  speaker TEXT,
  speaker_name TEXT,
  start_time TEXT,
  end_time TEXT,
  start_seconds INTEGER,
  end_seconds INTEGER,
  text TEXT NOT NULL,
  sentiment TEXT,
  key_moment JSONB,
  orden INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX transcript_segments_evidence_id_idx ON public.transcript_segments (evidence_id, orden);

CREATE TABLE public.extracted_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id UUID NOT NULL REFERENCES public.evidences(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  valor TEXT,
  confianza TEXT NOT NULL DEFAULT 'BAJA',
  pagina INTEGER,
  timestamp_ref TEXT,
  texto_citado TEXT,
  extra JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX extracted_facts_evidence_id_idx ON public.extracted_facts (evidence_id);

CREATE INDEX extracted_facts_tipo_idx ON public.extracted_facts (tipo);

CREATE TABLE public.decision_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  input JSONB NOT NULL,
  output JSONB NOT NULL,
  classification TEXT,
  classification_name TEXT,
  confidence NUMERIC(6,3),
  root_cause TEXT,
  status TEXT,
  hard_blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
  missing_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  inconsistencies JSONB NOT NULL DEFAULT '[]'::jsonb,
  dictamen_sugerido TEXT,
  politica_articulo TEXT,
  engine_version TEXT,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX decision_runs_ticket_id_idx ON public.decision_runs (ticket_id);

CREATE INDEX decision_runs_classification_idx ON public.decision_runs (classification);

CREATE INDEX decision_runs_run_at_idx ON public.decision_runs (run_at);

CREATE TABLE public.rule_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_run_id UUID NOT NULL REFERENCES public.decision_runs(id) ON DELETE CASCADE,
  rule_id TEXT,
  rule_name TEXT,
  rule_priority INTEGER,
  article TEXT,
  description TEXT,
  status TEXT NOT NULL,
  reason TEXT,
  suggested_classification TEXT,
  suggested_root_cause TEXT,
  confidence_impact NUMERIC(6,3),
  missing_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  orden INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX rule_evaluations_run_id_idx ON public.rule_evaluations (decision_run_id);

CREATE INDEX rule_evaluations_rule_id_idx ON public.rule_evaluations (rule_id);

CREATE INDEX rule_evaluations_status_idx ON public.rule_evaluations (status);

CREATE TABLE public.dictamen_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'BORRADOR',
  classification TEXT,
  confidence NUMERIC(6,3),
  root_cause TEXT,
  article TEXT,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  reviewer_notes TEXT,
  modified_by_auditor BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ticket_id, version)
);

CREATE INDEX dictamen_versions_ticket_id_idx ON public.dictamen_versions (ticket_id, version);

CREATE TABLE public.generated_pdfs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  version INTEGER,
  storage_key TEXT,
  storage_url TEXT,
  sha256 TEXT,
  generated_automatic BOOLEAN NOT NULL DEFAULT TRUE,
  generated_after_exception BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX generated_pdfs_ticket_id_idx ON public.generated_pdfs (ticket_id);

CREATE TABLE public.audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  before_data JSONB,
  after_data JSONB,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX audit_events_ticket_id_idx ON public.audit_events (ticket_id, created_at);

CREATE INDEX audit_events_event_type_idx ON public.audit_events (event_type);

CREATE INDEX decision_runs_intel_idx ON public.decision_runs (classification, root_cause, run_at);

CREATE OR REPLACE FUNCTION public.is_admin_or_owner(ticket_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = ticket_id
      AND (t.created_by = auth.uid() OR t.created_by IS NULL)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin_or_owner_by_evidence(evidence_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.evidences e
    JOIN public.tickets t ON t.id = e.ticket_id
    WHERE e.id = evidence_id
      AND (t.created_by = auth.uid() OR t.created_by IS NULL)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin_or_owner_by_run(decision_run_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.decision_runs r
    JOIN public.tickets t ON t.id = r.ticket_id
    WHERE r.id = decision_run_id
      AND (t.created_by = auth.uid() OR t.created_by IS NULL)
  );
$$;

ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.evidences ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.transcript_segments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.extracted_facts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.decision_runs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.rule_evaluations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.dictamen_versions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.generated_pdfs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.tickets, public.evidences, public.transcript_segments,
    public.extracted_facts, public.decision_runs, public.rule_evaluations,
    public.dictamen_versions, public.generated_pdfs, public.audit_events
  FROM anon;

GRANT USAGE ON SCHEMA public TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tickets TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.evidences TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.transcript_segments TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.extracted_facts TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.decision_runs TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rule_evaluations TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dictamen_versions TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.generated_pdfs TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_events TO authenticated;

CREATE POLICY "tickets_select_own" ON public.tickets
  FOR SELECT TO authenticated USING ((created_by = auth.uid()));

CREATE POLICY "tickets_insert_own" ON public.tickets
  FOR INSERT TO authenticated WITH CHECK ((created_by = auth.uid()));

CREATE POLICY "tickets_update_own" ON public.tickets
  FOR UPDATE TO authenticated USING ((created_by = auth.uid())) WITH CHECK ((created_by = auth.uid()));

CREATE POLICY "tickets_delete_own" ON public.tickets
  FOR DELETE TO authenticated USING ((created_by = auth.uid()));

CREATE POLICY "evidences_access_via_ticket" ON public.evidences
  FOR SELECT TO authenticated USING ((public.is_admin_or_owner(ticket_id)));

CREATE POLICY "evidences_insert_via_ticket" ON public.evidences
  FOR INSERT TO authenticated WITH CHECK ((public.is_admin_or_owner(ticket_id)));

CREATE POLICY "evidences_update_via_ticket" ON public.evidences
  FOR UPDATE TO authenticated USING ((public.is_admin_or_owner(ticket_id))) WITH CHECK ((public.is_admin_or_owner(ticket_id)));

CREATE POLICY "evidences_delete_via_ticket" ON public.evidences
  FOR DELETE TO authenticated USING ((public.is_admin_or_owner(ticket_id)));

CREATE POLICY "transcript_access_via_evidence" ON public.transcript_segments
  FOR SELECT TO authenticated USING ((public.is_admin_or_owner_by_evidence(evidence_id)));

CREATE POLICY "transcript_insert_via_evidence" ON public.transcript_segments
  FOR INSERT TO authenticated WITH CHECK ((public.is_admin_or_owner_by_evidence(evidence_id)));

CREATE POLICY "facts_access_via_evidence" ON public.extracted_facts
  FOR SELECT TO authenticated USING ((public.is_admin_or_owner_by_evidence(evidence_id)));

CREATE POLICY "facts_insert_via_evidence" ON public.extracted_facts
  FOR INSERT TO authenticated WITH CHECK ((public.is_admin_or_owner_by_evidence(evidence_id)));

CREATE POLICY "runs_access_via_ticket" ON public.decision_runs
  FOR SELECT TO authenticated USING ((public.is_admin_or_owner(ticket_id)));

CREATE POLICY "runs_insert_via_ticket" ON public.decision_runs
  FOR INSERT TO authenticated WITH CHECK ((public.is_admin_or_owner(ticket_id)));

CREATE POLICY "rules_access_via_run" ON public.rule_evaluations
  FOR SELECT TO authenticated USING ((public.is_admin_or_owner_by_run(decision_run_id)));

CREATE POLICY "rules_insert_via_run" ON public.rule_evaluations
  FOR INSERT TO authenticated WITH CHECK ((public.is_admin_or_owner_by_run(decision_run_id)));

CREATE POLICY "dictamen_access_via_ticket" ON public.dictamen_versions
  FOR SELECT TO authenticated USING ((public.is_admin_or_owner(ticket_id)));

CREATE POLICY "dictamen_insert_via_ticket" ON public.dictamen_versions
  FOR INSERT TO authenticated WITH CHECK ((public.is_admin_or_owner(ticket_id)));

CREATE POLICY "dictamen_update_via_ticket" ON public.dictamen_versions
  FOR UPDATE TO authenticated USING ((public.is_admin_or_owner(ticket_id))) WITH CHECK ((public.is_admin_or_owner(ticket_id)));

CREATE POLICY "pdfs_access_via_ticket" ON public.generated_pdfs
  FOR SELECT TO authenticated USING ((public.is_admin_or_owner(ticket_id)));

CREATE POLICY "pdfs_insert_via_ticket" ON public.generated_pdfs
  FOR INSERT TO authenticated WITH CHECK ((public.is_admin_or_owner(ticket_id)));

CREATE POLICY "events_access_via_ticket" ON public.audit_events
  FOR SELECT TO authenticated USING ((public.is_admin_or_owner(ticket_id)));

CREATE POLICY "events_insert_via_ticket" ON public.audit_events
  FOR INSERT TO authenticated WITH CHECK ((public.is_admin_or_owner(ticket_id)));

CREATE TRIGGER tickets_updated_at
  BEFORE UPDATE ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION system.update_updated_at();

CREATE TRIGGER evidences_updated_at
  BEFORE UPDATE ON public.evidences
  FOR EACH ROW
  EXECUTE FUNCTION system.update_updated_at();

CREATE OR REPLACE FUNCTION public.set_current_decision_run()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.decision_runs
     SET is_current = FALSE
   WHERE ticket_id = NEW.ticket_id
     AND id <> NEW.id;
  NEW.is_current := TRUE;

  UPDATE public.tickets
     SET resultado = jsonb_build_object(
           'principal', NEW.classification,
           'classificationName', NEW.classification_name,
           'confianza', NEW.confidence,
           'rootCause', NEW.root_cause,
           'automatico', (NEW.status IS NOT NULL AND NEW.status NOT IN ('REQUIERE_REVISION','PENDIENTE_REVISION')),
           'requiereRevision', COALESCE(NEW.status IN ('REQUIERE_REVISION','PENDIENTE_REVISION'), FALSE),
           'motivoRevision', NEW.inconsistencies,
           'textoDictamen', NEW.dictamen_sugerido,
           'politicaArticulo', NEW.politica_articulo,
           'updatedAt', NEW.run_at
         ),
         decision_data = NEW.input
   WHERE id = NEW.ticket_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER decision_runs_set_current
  BEFORE INSERT ON public.decision_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_current_decision_run();
