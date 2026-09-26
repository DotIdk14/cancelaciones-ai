-- Baseline V2 rebuild lineage for Cancelaciones clean-slate runtime.
-- Version: baseline-v2
-- Scope: app-owned public schema objects required by current KEEP runtime only.
-- Normative boundary: AUDIT_ENGINE_NOT_IMPLEMENTED remains in application code.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.schema_baseline_v2_manifest (
  version text PRIMARY KEY,
  git_commit text NOT NULL,
  artifact_sha256 text NOT NULL CHECK (artifact_sha256 ~ '^[a-f0-9]{64}$'),
  postgres_version text NOT NULL,
  provider_assumptions jsonb NOT NULL DEFAULT '{}'::jsonb,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('OWNER','AUDITOR','VIEWER')),
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PROCESSING','FAILED','COMPLETED','CANCELLED')),
  external_case_id text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audits_created_by_created_at_idx ON public.audits(created_by, created_at DESC);

CREATE TABLE public.evidences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid,
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  original_filename text,
  safe_filename text,
  nombre_archivo text NOT NULL,
  tipo text,
  fuente text,
  mime_type text,
  detected_mime_type text,
  size_bytes bigint,
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'),
  storage_bucket text NOT NULL DEFAULT 'dictamen-evidencias',
  storage_key text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','STORED','FAILED')),
  estado_lectura text NOT NULL DEFAULT 'PENDING',
  failure_reason text,
  document_role text NOT NULL DEFAULT 'EVIDENCE' CHECK (document_role IN ('EVIDENCE','HUMAN_DECISION_DOCUMENT','ADJUDICATION_EVIDENCE')),
  uploaded_by uuid REFERENCES auth.users(id),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evidences_audit_created_idx ON public.evidences(audit_id, created_at DESC);
CREATE INDEX evidences_audit_role_status_idx ON public.evidences(audit_id, document_role, status);

CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_id uuid REFERENCES auth.users(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_audit_time_idx ON public.audit_log(audit_id, occurred_at);

CREATE TABLE public.audit_manual_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL UNIQUE REFERENCES public.audits(id) ON DELETE CASCADE,
  back_office_comment text,
  helpdesk_comment text,
  school_services_comment text,
  finance_comment text,
  additional_comment text,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  job_type text NOT NULL CHECK (job_type IN ('FACT_EXTRACTION','EVIDENCE_PROCESSING')),
  operation_scope text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  input_fingerprint text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority integer NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','PROCESSING','COMPLETED','FAILED_RETRYABLE','FAILED_PERMANENT')),
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  worker_id text,
  lease_expires_at timestamptz,
  last_error_code text,
  last_error_message_sanitized text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_audit_created_idx ON public.jobs(audit_id, created_at DESC);
CREATE INDEX jobs_claim_idx ON public.jobs(status, priority, created_at);

CREATE TABLE public.job_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  worker_id text NOT NULL,
  attempt_number integer NOT NULL,
  status text NOT NULL CHECK (status IN ('PROCESSING','COMPLETED','FAILED')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_code text,
  error_message_sanitized text,
  UNIQUE(job_id, attempt_number)
);

CREATE TABLE public.job_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  evidence_id uuid REFERENCES public.evidences(id) ON DELETE SET NULL,
  attempt_id uuid REFERENCES public.job_attempts(id) ON DELETE SET NULL,
  artifact_type text NOT NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  extractor_version text,
  provider text,
  provider_operation_id text,
  storage_bucket text,
  storage_key text,
  content_sha256 text CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[a-f0-9]{64}$'),
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_artifacts_job_created_idx ON public.job_artifacts(job_id, created_at DESC);

CREATE TABLE public.fact_extraction_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  policy_code text NOT NULL,
  policy_version text NOT NULL,
  extractor_version text NOT NULL,
  artifact_set_fingerprint text NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','PROCESSING','FAILED','FROZEN')),
  frozen_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fact_extraction_runs_audit_created_idx ON public.fact_extraction_runs(audit_id, created_at DESC);

CREATE TABLE public.facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.fact_extraction_runs(id) ON DELETE CASCADE,
  fact_type text NOT NULL,
  classification text NOT NULL,
  value jsonb NOT NULL,
  source_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX facts_run_created_idx ON public.facts(run_id, created_at);

CREATE TABLE public.fact_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  fact_id uuid NOT NULL REFERENCES public.facts(id) ON DELETE CASCADE,
  decision text CHECK (decision IS NULL OR decision IN ('VALID','INVALID')),
  corrected_value jsonb,
  note text,
  reviewed_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fact_reviews_audit_fact_idx ON public.fact_reviews(audit_id, fact_id, created_at DESC);

CREATE TABLE public.policy_source_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_code text NOT NULL CHECK (btrim(policy_code) <> ''),
  policy_version text NOT NULL CHECK (btrim(policy_version) <> ''),
  document_id text NOT NULL UNIQUE CHECK (btrim(document_id) <> ''),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('CANONICAL','LEGACY','PENDING_VERIFICATION','SUPERSEDED')),
  effective_from date,
  effective_to date,
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(policy_code, policy_version),
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
  CHECK (status <> 'CANONICAL' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE INDEX policy_source_registry_status_idx ON public.policy_source_registry(status);

CREATE TABLE public.fact_run_frozen_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  fact_run_id uuid NOT NULL UNIQUE REFERENCES public.fact_extraction_runs(id) ON DELETE CASCADE,
  facts jsonb NOT NULL,
  provenance jsonb NOT NULL,
  fact_reviews_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  extractor_version text NOT NULL,
  policy_source_id text NOT NULL REFERENCES public.policy_source_registry(document_id),
  canonical_facts_fingerprint text NOT NULL,
  effective_facts_fingerprint text NOT NULL,
  fact_count integer NOT NULL,
  integrity_hash text NOT NULL,
  frozen_by uuid REFERENCES auth.users(id),
  frozen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text NOT NULL,
  version text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','REVIEW','APPROVED','ACTIVE','RETIRED')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(rule_key, version)
);

CREATE TABLE public.evidence_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.rules(id) ON DELETE CASCADE,
  requirement_key text NOT NULL,
  name text,
  description text,
  evidence_type text NOT NULL CHECK (evidence_type IN ('DOCUMENT','IMAGE','AUDIO','TEXT','SPREADSHEET','PDF','OTHER')),
  evidence_code text,
  document_role text CHECK (document_role IS NULL OR document_role IN ('EVIDENCE','HUMAN_DECISION_DOCUMENT','ADJUDICATION_EVIDENCE')),
  required boolean NOT NULL DEFAULT true,
  min_count integer NOT NULL DEFAULT 1 CHECK (min_count >= 0),
  max_count integer CHECK (max_count IS NULL OR max_count >= 0),
  order_index integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(rule_id, requirement_key),
  CHECK (max_count IS NULL OR max_count >= min_count)
);

CREATE TABLE public.audit_evidence_selection (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  evidence_id uuid NOT NULL REFERENCES public.evidences(id) ON DELETE CASCADE,
  artifact_id uuid REFERENCES public.job_artifacts(id) ON DELETE SET NULL,
  sha256 text,
  page integer,
  region jsonb,
  timestamp_start numeric,
  timestamp_end numeric,
  cell text,
  original_filename text,
  selected_by uuid NOT NULL REFERENCES auth.users(id),
  selected_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_evidence_selection_audit_idx ON public.audit_evidence_selection(audit_id, selected_at);

CREATE TABLE public.audit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  run_type text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  parent_run_id uuid REFERENCES public.audit_runs(id),
  fact_run_id uuid REFERENCES public.fact_extraction_runs(id),
  engine_run_id uuid,
  job_id uuid REFERENCES public.jobs(id),
  policy_code text,
  policy_version text,
  prompt_version text,
  model text,
  provider text,
  input_fingerprint text,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX audit_runs_audit_created_idx ON public.audit_runs(audit_id, created_at DESC);

CREATE TABLE public.dictamen_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL,
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('DRAFT','FINAL')),
  doc_fingerprint text NOT NULL,
  pdf_sha256 text NOT NULL CHECK (pdf_sha256 ~ '^[a-f0-9]{64}$'),
  storage_bucket text NOT NULL,
  storage_key text NOT NULL,
  template_hash text NOT NULL,
  generated_by uuid NOT NULL REFERENCES auth.users(id),
  generated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(snapshot_id, kind)
);

CREATE TABLE public.ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid REFERENCES public.audits(id) ON DELETE SET NULL,
  provider text,
  model text,
  operation text,
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  cost_source text,
  cost_usd numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE((SELECT role FROM public.profiles WHERE id = auth.uid()), 'VIEWER')
$$;

CREATE OR REPLACE FUNCTION public.delete_audit(p_audit_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  INSERT INTO public.audit_log(audit_id, event_type, actor_id, metadata)
  VALUES (p_audit_id, 'AUDIT_DELETE', v_actor, jsonb_build_object('reason', p_reason));
  DELETE FROM public.audits WHERE id = p_audit_id;
  RETURN jsonb_build_object('deleted', true, 'audit_id', p_audit_id);
END $$;

CREATE OR REPLACE FUNCTION public.enqueue_job(
  p_audit_id uuid, p_job_type text, p_operation_scope text, p_idempotency_key text,
  p_input_fingerprint text, p_payload jsonb DEFAULT '{}'::jsonb, p_priority integer DEFAULT 100,
  p_max_attempts integer DEFAULT 3, p_actor_id uuid DEFAULT NULL, p_evidence_id uuid DEFAULT NULL
)
RETURNS public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_job public.jobs;
BEGIN
  INSERT INTO public.jobs(audit_id, job_type, operation_scope, idempotency_key, input_fingerprint, payload, priority, max_attempts, created_by)
  VALUES (p_audit_id, p_job_type, p_operation_scope, p_idempotency_key, p_input_fingerprint, p_payload, p_priority, p_max_attempts, p_actor_id)
  ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = public.jobs.updated_at
  RETURNING * INTO v_job;
  IF p_evidence_id IS NOT NULL THEN
    INSERT INTO public.job_artifacts(job_id, evidence_id, artifact_type, result)
    VALUES (v_job.id, p_evidence_id, 'INPUT_EVIDENCE', '{}'::jsonb)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN v_job;
END $$;

CREATE OR REPLACE FUNCTION public.claim_next_job(p_worker_id text, p_lease_seconds integer DEFAULT 60)
RETURNS TABLE(job_id uuid, attempt_id uuid, audit_id uuid, job_type text, payload jsonb, attempt_number integer)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_job public.jobs; v_attempt public.job_attempts;
BEGIN
  SELECT * INTO v_job FROM public.jobs
  WHERE status IN ('QUEUED','FAILED_RETRYABLE')
  ORDER BY priority ASC, created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.jobs
  SET status = 'PROCESSING', worker_id = p_worker_id, lease_expires_at = now() + make_interval(secs => p_lease_seconds), attempt_count = attempt_count + 1, updated_at = now()
  WHERE id = v_job.id
  RETURNING * INTO v_job;
  INSERT INTO public.job_attempts(job_id, worker_id, attempt_number, status)
  VALUES (v_job.id, p_worker_id, v_job.attempt_count, 'PROCESSING')
  RETURNING * INTO v_attempt;
  job_id := v_job.id; attempt_id := v_attempt.id; audit_id := v_job.audit_id; job_type := v_job.job_type; payload := v_job.payload; attempt_number := v_job.attempt_count;
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION public.record_job_artifact(
  p_job_id uuid, p_artifact_type text, p_result jsonb, p_evidence_id uuid DEFAULT NULL,
  p_attempt_id uuid DEFAULT NULL, p_extractor_version text DEFAULT NULL, p_provider text DEFAULT NULL,
  p_provider_operation_id text DEFAULT NULL, p_storage_bucket text DEFAULT NULL, p_storage_key text DEFAULT NULL,
  p_content_sha256 text DEFAULT NULL, p_warnings jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.job_artifacts(job_id, evidence_id, attempt_id, artifact_type, result, extractor_version, provider, provider_operation_id, storage_bucket, storage_key, content_sha256, warnings)
  VALUES (p_job_id, p_evidence_id, p_attempt_id, p_artifact_type, p_result, p_extractor_version, p_provider, p_provider_operation_id, p_storage_bucket, p_storage_key, p_content_sha256, p_warnings)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.complete_job(p_job_id uuid, p_worker_id text, p_progress integer DEFAULT 100)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.jobs SET status='COMPLETED', progress=p_progress, updated_at=now() WHERE id=p_job_id AND worker_id=p_worker_id;
  UPDATE public.job_attempts SET status='COMPLETED', completed_at=now() WHERE job_id=p_job_id AND worker_id=p_worker_id AND status='PROCESSING';
END $$;

CREATE OR REPLACE FUNCTION public.schedule_job_retry(p_job_id uuid, p_worker_id text, p_error_code text, p_error_message_sanitized text, p_delay_seconds integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.jobs SET status='FAILED_RETRYABLE', last_error_code=p_error_code, last_error_message_sanitized=p_error_message_sanitized, worker_id=NULL, lease_expires_at=NULL, updated_at=now() WHERE id=p_job_id AND worker_id=p_worker_id;
END $$;

CREATE OR REPLACE FUNCTION public.fail_job_permanent(p_job_id uuid, p_worker_id text, p_error_code text, p_error_message_sanitized text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.jobs SET status='FAILED_PERMANENT', last_error_code=p_error_code, last_error_message_sanitized=p_error_message_sanitized, updated_at=now() WHERE id=p_job_id AND worker_id=p_worker_id;
END $$;

CREATE OR REPLACE FUNCTION public.freeze_fact_run_v1(
  p_fact_run_id uuid, p_facts jsonb, p_provenance jsonb, p_policy_source_id text,
  p_canonical_facts_fingerprint text, p_effective_facts_fingerprint text,
  p_fact_reviews_snapshot jsonb DEFAULT '[]'::jsonb, p_fact_count integer DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_run public.fact_extraction_runs; v_id uuid;
BEGIN
  SELECT * INTO v_run FROM public.fact_extraction_runs WHERE id = p_fact_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'FACT_RUN_NOT_FOUND'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.policy_source_registry WHERE document_id = p_policy_source_id) THEN RAISE EXCEPTION 'POLICY_SOURCE_NOT_REGISTERED'; END IF;
  INSERT INTO public.fact_run_frozen_snapshots(audit_id, fact_run_id, facts, provenance, fact_reviews_snapshot, extractor_version, policy_source_id, canonical_facts_fingerprint, effective_facts_fingerprint, fact_count, integrity_hash, frozen_by)
  VALUES (v_run.audit_id, v_run.id, p_facts, p_provenance, COALESCE(p_fact_reviews_snapshot,'[]'::jsonb), v_run.extractor_version, p_policy_source_id, p_canonical_facts_fingerprint, p_effective_facts_fingerprint, p_fact_count, encode(digest(p_facts::text || p_provenance::text, 'sha256'), 'hex'), auth.uid())
  ON CONFLICT (fact_run_id) DO UPDATE SET facts = EXCLUDED.facts
  RETURNING id INTO v_id;
  UPDATE public.fact_extraction_runs SET state='FROZEN', frozen_at=now() WHERE id=p_fact_run_id;
  RETURN v_id;
END $$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_manual_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fact_extraction_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fact_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_source_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fact_run_frozen_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_evidence_selection ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dictamen_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_self_select ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid() OR public.current_app_role() = 'OWNER');
CREATE POLICY profiles_self_insert ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid() OR public.current_app_role() = 'OWNER');

CREATE POLICY audits_visible ON public.audits FOR SELECT TO authenticated USING (created_by = auth.uid() OR public.current_app_role() = 'OWNER');
CREATE POLICY audits_insert ON public.audits FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid() OR public.current_app_role() = 'OWNER');
CREATE POLICY audits_update ON public.audits FOR UPDATE TO authenticated USING (created_by = auth.uid() OR public.current_app_role() = 'OWNER') WITH CHECK (created_by = auth.uid() OR public.current_app_role() = 'OWNER');

CREATE POLICY policy_source_registry_select_authenticated ON public.policy_source_registry FOR SELECT TO authenticated USING (true);
CREATE POLICY policy_source_registry_owner_insert ON public.policy_source_registry FOR INSERT TO authenticated WITH CHECK (public.current_app_role() = 'OWNER');

-- Baseline V2 uses broad authenticated access for app-owned operational tables; server-side authz remains in API routes.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public TO project_admin;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO project_admin;
