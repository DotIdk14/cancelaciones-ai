-- Mejora continua controlada: retroalimentación inmutable, ejemplos aprobados,
-- snapshots de versiones y evaluaciones durables. Solo el servidor usa la clave
-- project_admin; la UI nunca recibe acceso directo a estas tablas.
-- No aplicar hasta seguir docs/MIGRATION-RECONCILIATION.md y el runner oficial.

CREATE TABLE IF NOT EXISTS public.audit_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE RESTRICT,
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE RESTRICT,
  case_review_id uuid NOT NULL REFERENCES public.case_reviews(id) ON DELETE RESTRICT,
  ai_resolution text NOT NULL,
  advisor_resolution text NOT NULL,
  coordinator_resolution text NOT NULL,
  ai_procedure_section text NOT NULL,
  corrected_procedure_section text,
  conclusion text NOT NULL CHECK (conclusion IN ('AI_ERROR','HUMAN_ERROR','INSUFFICIENT_EVIDENCE','PENDING_CRITERION')),
  error_type text NOT NULL CHECK (error_type IN ('MISSED_EVIDENCE','MISINTERPRETED_EVIDENCE','MISAPPLIED_PROCEDURE','WRONG_RESOLUTION','DATE_CHRONOLOGY','MISSED_CONTACT_REQUIREMENT','INSUFFICIENT_INFORMATION','FACT_RESOLUTION_CONTRADICTION','EXTRACTION_TRANSCRIPTION','HUMAN_CRITERION_PENDING','OTHER')),
  justification text NOT NULL,
  evidence_ids uuid[] NOT NULL DEFAULT '{}',
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  validator_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (status IN ('PENDING_REVIEW','VALIDATED','REJECTED','NEEDS_CLARIFICATION','IN_EVALUATION_SET')),
  validation_note text,
  validation_checks jsonb,
  auditor_version text,
  model text,
  procedure_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  validated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (audit_id),
  CHECK ((status = 'PENDING_REVIEW' AND validator_id IS NULL) OR (status <> 'PENDING_REVIEW' AND validator_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.approved_examples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_id uuid NOT NULL UNIQUE REFERENCES public.audit_feedback(id) ON DELETE RESTRICT,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE RESTRICT,
  facts jsonb NOT NULL,
  resolution text NOT NULL,
  procedure_section text NOT NULL,
  procedure_version text NOT NULL,
  error_type text NOT NULL,
  rationale text NOT NULL,
  evidence_ids uuid[] NOT NULL DEFAULT '{}',
  eligibility text NOT NULL DEFAULT 'EVALUATION_ONLY' CHECK (eligibility IN ('CONTEXTUAL','EVALUATION_ONLY','EXCLUDED')),
  validated_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  validated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL,
  procedure_version text NOT NULL,
  procedure_sha256 text NOT NULL,
  instructions text NOT NULL,
  instructions_sha256 text NOT NULL,
  model text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}',
  pipeline_version text NOT NULL,
  output_schema_version text NOT NULL,
  snapshot_sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','EVALUATING','APPROVED','ACTIVE','ARCHIVED')),
  parent_version_id uuid REFERENCES public.audit_versions(id) ON DELETE RESTRICT,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  approved_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  CHECK ((status IN ('APPROVED','ACTIVE','ARCHIVED') AND approved_by IS NOT NULL) OR status IN ('DRAFT','EVALUATING'))
);

CREATE UNIQUE INDEX IF NOT EXISTS audit_versions_single_active_idx
  ON public.audit_versions ((status)) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS public.audit_evaluation_datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  split text NOT NULL CHECK (split IN ('IMPROVEMENT','HELD_OUT')),
  example_ids uuid[] NOT NULL,
  snapshot_sha256 text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, version)
);

CREATE TABLE IF NOT EXISTS public.audit_evaluation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid NOT NULL REFERENCES public.audit_evaluation_datasets(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','COMPLETED','ERROR','CANCELLED')),
  idempotency_key text NOT NULL UNIQUE,
  version_ids uuid[] NOT NULL,
  budget_limit numeric(12,6) NOT NULL CHECK (budget_limit >= 0),
  cost_total numeric(12,6),
  started_at timestamptz,
  finished_at timestamptz,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  lease_expires_at timestamptz,
  error_category text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_evaluation_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.audit_evaluation_runs(id) ON DELETE RESTRICT,
  version_id uuid NOT NULL REFERENCES public.audit_versions(id) ON DELETE RESTRICT,
  example_id uuid NOT NULL REFERENCES public.approved_examples(id) ON DELETE RESTRICT,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE RESTRICT,
  input_fingerprint text NOT NULL,
  input_snapshot jsonb NOT NULL,
  assessment jsonb,
  model text NOT NULL,
  prompt_sha256 text NOT NULL,
  procedure_sha256 text NOT NULL,
  tokens_prompt integer,
  tokens_completion integer,
  cost numeric(12,6),
  latency_ms integer,
  resolution_match boolean,
  procedure_match boolean,
  evidence_omissions uuid[] NOT NULL DEFAULT '{}',
  technical_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, version_id, example_id)
);

CREATE INDEX IF NOT EXISTS audit_feedback_status_created_idx ON public.audit_feedback(status, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_feedback_case_created_idx ON public.audit_feedback(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS approved_examples_eligibility_idx ON public.approved_examples(eligibility, procedure_version, procedure_section);
CREATE INDEX IF NOT EXISTS audit_evaluation_results_run_idx ON public.audit_evaluation_results(run_id, version_id);

ALTER TABLE public.audit_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approved_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_evaluation_datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_evaluation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_evaluation_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_feedback, public.approved_examples, public.audit_versions,
  public.audit_evaluation_datasets, public.audit_evaluation_runs, public.audit_evaluation_results FROM anon, authenticated;
GRANT ALL ON public.audit_feedback, public.approved_examples, public.audit_versions,
  public.audit_evaluation_datasets, public.audit_evaluation_runs, public.audit_evaluation_results TO project_admin;

CREATE OR REPLACE FUNCTION public.prevent_audit_version_snapshot_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF ROW(NEW.version_key, NEW.name, NEW.description, NEW.procedure_version, NEW.procedure_sha256,
    NEW.instructions, NEW.instructions_sha256, NEW.model, NEW.config, NEW.pipeline_version,
    NEW.output_schema_version, NEW.snapshot_sha256, NEW.parent_version_id, NEW.author_id, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.version_key, OLD.name, OLD.description, OLD.procedure_version, OLD.procedure_sha256,
    OLD.instructions, OLD.instructions_sha256, OLD.model, OLD.config, OLD.pipeline_version,
    OLD.output_schema_version, OLD.snapshot_sha256, OLD.parent_version_id, OLD.author_id, OLD.created_at) THEN
    RAISE EXCEPTION 'AUDIT_VERSION_SNAPSHOT_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS audit_versions_snapshot_immutable ON public.audit_versions;
CREATE TRIGGER audit_versions_snapshot_immutable BEFORE UPDATE ON public.audit_versions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_version_snapshot_mutation();

DO $verify$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.audit_feedback'::regclass)
    OR has_table_privilege('anon','public.audit_feedback','SELECT')
    OR has_table_privilege('authenticated','public.audit_feedback','SELECT')
    OR NOT has_table_privilege('project_admin','public.audit_feedback','SELECT') THEN
    RAISE EXCEPTION 'AI_CONTINUOUS_IMPROVEMENT_ACCESS_INCOMPLETE';
  END IF;
  IF (SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname IN
    ('audit_versions_single_active_idx','audit_feedback_status_created_idx','approved_examples_eligibility_idx','audit_evaluation_results_run_idx')) <> 4 THEN
    RAISE EXCEPTION 'AI_CONTINUOUS_IMPROVEMENT_INDEXES_INCOMPLETE';
  END IF;
END
$verify$;
