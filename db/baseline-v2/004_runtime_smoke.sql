-- Runtime smoke test for Baseline V2. Uses only deterministic technical rows.

SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

CREATE TEMP TABLE smoke_failures(message text);

DO $$
DECLARE
  v_audit uuid;
  v_evidence uuid := '00000000-0000-0000-0000-000000000101';
  v_job public.jobs;
  v_claim record;
  v_run uuid;
  v_snapshot uuid;
BEGIN
  INSERT INTO public.audits(display_name, external_case_id, created_by)
  VALUES ('Baseline V2 smoke audit', 'SYNTHETIC-D8', '00000000-0000-0000-0000-000000000001')
  RETURNING id INTO v_audit;

  INSERT INTO public.evidences(id, audit_id, nombre_archivo, original_filename, safe_filename, mime_type, detected_mime_type, size_bytes, sha256, storage_bucket, storage_key, status, estado_lectura, document_role, uploaded_by, created_by)
  VALUES (v_evidence, v_audit, 'synthetic.txt', 'synthetic.txt', 'synthetic.txt', 'text/plain', 'text/plain', 12,
          repeat('0',64), 'dictamen-evidencias', 'baseline-v2/synthetic.txt', 'STORED', 'STORED', 'EVIDENCE', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001');

  SELECT * INTO v_job FROM public.enqueue_job(v_audit, 'EVIDENCE_PROCESSING', 'PROCESS_EVIDENCE', 'baseline-v2-smoke', repeat('1',64), '{}'::jsonb, 100, 3, '00000000-0000-0000-0000-000000000001', v_evidence);

  SELECT * INTO v_claim FROM public.claim_next_job('worker-baseline-v2', 60);
  IF v_claim.job_id IS NULL THEN RAISE EXCEPTION 'claim_next_job returned no job'; END IF;

  PERFORM public.record_job_artifact(v_claim.job_id, 'TEXT_EXTRACTION', jsonb_build_object('text','synthetic'), v_evidence, v_claim.attempt_id, 'baseline-v2', 'local', NULL, NULL, NULL, repeat('2',64), '[]'::jsonb);
  PERFORM public.complete_job(v_claim.job_id, 'worker-baseline-v2', 100);

  INSERT INTO public.fact_extraction_runs(audit_id, policy_code, policy_version, extractor_version, artifact_set_fingerprint, state, created_by)
  VALUES (v_audit, 'GDM_GAM_PRD_MLG_003', 'BASELINE_V2_PLACEHOLDER', 'baseline-v2', repeat('3',64), 'DRAFT', '00000000-0000-0000-0000-000000000001')
  RETURNING id INTO v_run;

  INSERT INTO public.facts(audit_id, run_id, fact_type, classification, value, source_ref, confidence)
  VALUES (v_audit, v_run, 'SMOKE_FACT', 'OBSERVABLE', jsonb_build_object('ok', true), jsonb_build_object('evidence_id', v_evidence), NULL);

  SELECT public.freeze_fact_run_v1(v_run, '[{"fact_type":"SMOKE_FACT"}]'::jsonb, '{"source":"smoke"}'::jsonb, 'GDM_GAM_PRD_MLG_003:BASELINE_V2_PLACEHOLDER', repeat('4',64), repeat('5',64), '[]'::jsonb, 1)
  INTO v_snapshot;

  IF v_snapshot IS NULL THEN RAISE EXCEPTION 'freeze_fact_run_v1 returned null'; END IF;
END $$;

SELECT * FROM smoke_failures ORDER BY message;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM smoke_failures) THEN
    RAISE EXCEPTION 'Baseline V2 runtime smoke failed';
  END IF;
END $$;
