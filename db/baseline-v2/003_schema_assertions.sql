-- Baseline V2 schema assertions. Must return zero rows from assertion_failures.

CREATE TEMP TABLE assertion_failures(message text);

WITH required_tables(name) AS (VALUES
  ('profiles'),('audits'),('evidences'),('audit_log'),('audit_manual_comments'),
  ('jobs'),('job_attempts'),('job_artifacts'),('fact_extraction_runs'),('facts'),('fact_reviews'),
  ('policy_source_registry'),('fact_run_frozen_snapshots'),('rules'),('evidence_requirements'),
  ('audit_evidence_selection'),('audit_runs'),('dictamen_documents'),('ai_usage'),('schema_baseline_v2_manifest')
)
INSERT INTO assertion_failures
SELECT 'missing table: ' || name FROM required_tables rt
WHERE to_regclass('public.' || rt.name) IS NULL;

WITH required_columns(table_name, column_name) AS (VALUES
  ('audits','id'),('audits','display_name'),('audits','status'),('audits','created_by'),
  ('evidences','audit_id'),('evidences','storage_key'),('evidences','status'),('evidences','document_role'),
  ('jobs','idempotency_key'),('jobs','status'),('jobs','payload'),
  ('fact_extraction_runs','state'),('facts','source_ref'),('policy_source_registry','document_id'),
  ('fact_run_frozen_snapshots','integrity_hash'),('audit_runs','run_type'),('dictamen_documents','pdf_sha256')
)
INSERT INTO assertion_failures
SELECT 'missing column: ' || table_name || '.' || column_name
FROM required_columns rc
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.columns c
  WHERE c.table_schema='public' AND c.table_name=rc.table_name AND c.column_name=rc.column_name
);

WITH required_functions(name) AS (VALUES
  ('current_app_role'),('delete_audit'),('enqueue_job'),('claim_next_job'),('record_job_artifact'),
  ('complete_job'),('schedule_job_retry'),('fail_job_permanent'),('freeze_fact_run_v1')
)
INSERT INTO assertion_failures
SELECT 'missing function: ' || name FROM required_functions rf
WHERE NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname=rf.name
);

WITH required_indexes(name) AS (VALUES
  ('audits_created_by_created_at_idx'),('evidences_audit_created_idx'),('jobs_claim_idx'),
  ('facts_run_created_idx'),('policy_source_registry_status_idx'),('audit_runs_audit_created_idx')
)
INSERT INTO assertion_failures
SELECT 'missing index: ' || name FROM required_indexes ri
WHERE NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=ri.name);

WITH rls_tables(name) AS (VALUES
  ('audits'),('evidences'),('jobs'),('fact_extraction_runs'),('policy_source_registry'),('fact_run_frozen_snapshots')
)
INSERT INTO assertion_failures
SELECT 'rls not enabled: ' || name FROM rls_tables rt
WHERE NOT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname=rt.name AND c.relrowsecurity
);

WITH required_policies(tablename, policyname) AS (VALUES
  ('audits','audits_visible'),('audits','audits_insert'),('policy_source_registry','policy_source_registry_select_authenticated'),('policy_source_registry','policy_source_registry_owner_insert')
)
INSERT INTO assertion_failures
SELECT 'missing policy: ' || tablename || '.' || policyname FROM required_policies rp
WHERE NOT EXISTS (
  SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=rp.tablename AND p.policyname=rp.policyname
);

WITH required_grants(table_name, grantee, privilege_type) AS (VALUES
  ('audits','authenticated','SELECT'),('audits','authenticated','INSERT'),
  ('policy_source_registry','authenticated','SELECT'),('policy_source_registry','authenticated','INSERT')
)
INSERT INTO assertion_failures
SELECT 'missing grant: ' || table_name || ' ' || privilege_type || ' to ' || grantee
FROM required_grants rg
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.role_table_grants g
  WHERE g.table_schema='public' AND g.table_name=rg.table_name AND g.grantee=rg.grantee AND g.privilege_type=rg.privilege_type
);

SELECT * FROM assertion_failures ORDER BY message;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM assertion_failures) THEN
    RAISE EXCEPTION 'Baseline V2 schema assertions failed';
  END IF;
END $$;
