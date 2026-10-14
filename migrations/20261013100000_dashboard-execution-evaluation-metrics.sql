-- Métricas de ejecuciones y evaluación final. ADITIVA; no aplicar sin conciliación.
-- No actualiza casos, dictámenes ni resoluciones humanas. No usa tablas legacy.
ALTER TABLE public.case_comparisons ADD COLUMN IF NOT EXISTS provider_metadata jsonb;

CREATE TABLE IF NOT EXISTS public.comparison_execution_history (
  comparison_id uuid NOT NULL REFERENCES public.case_comparisons(id) ON DELETE RESTRICT,
  attempt_count integer NOT NULL,
  snapshot jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comparison_id, attempt_count)
);
ALTER TABLE public.comparison_execution_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.comparison_execution_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.comparison_execution_history TO project_admin;

-- El archivo y el rearme son una sola escritura transaccional. No se duplican
-- la ejecución archivada y la vigente: el archivo solo se crea al incrementar.
CREATE OR REPLACE FUNCTION public.archive_comparison_execution() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $body$
BEGIN
  IF NEW.attempt_count > OLD.attempt_count THEN
    INSERT INTO public.comparison_execution_history(comparison_id, attempt_count, snapshot)
    VALUES (OLD.id, OLD.attempt_count, CASE WHEN OLD.status='RUNNING' THEN jsonb_set(to_jsonb(OLD),'{status}','"ERROR"'::jsonb) ELSE to_jsonb(OLD) END);
  END IF;
  RETURN NEW;
END
$body$;
REVOKE ALL ON FUNCTION public.archive_comparison_execution() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS archive_comparison_execution ON public.case_comparisons;
CREATE TRIGGER archive_comparison_execution BEFORE UPDATE ON public.case_comparisons
FOR EACH ROW EXECUTE FUNCTION public.archive_comparison_execution();

CREATE OR REPLACE VIEW public.comparison_execution_rows AS
SELECT cc.id::text || ':' || cc.attempt_count::text AS execution_id,
  cc.id, cc.case_review_id, cc.audit_id, cc.status, cc.result_json,
  cc.provider, cc.model, cc.latency_ms, cc.error_category, cc.attempt_count,
  cc.created_at, cc.provider_metadata
FROM public.case_comparisons cc
UNION ALL
SELECT h.comparison_id::text || ':' || h.attempt_count::text,
  h.comparison_id, (h.snapshot->>'case_review_id')::uuid, (h.snapshot->>'audit_id')::uuid,
  h.snapshot->>'status', h.snapshot->'result_json', h.snapshot->>'provider', h.snapshot->>'model',
  (h.snapshot->>'latency_ms')::bigint, h.snapshot->>'error_category', h.attempt_count,
  (h.snapshot->>'created_at')::timestamptz, h.snapshot->'provider_metadata'
FROM public.comparison_execution_history h;

CREATE OR REPLACE VIEW public.audit_activity_metrics AS
SELECT a.id AS id,
  'AUDIT'::text AS execution_kind,
  a.case_id AS case_id,
  c.status AS case_status,
  c.student_identifier,
  a.status AS audit_status,
  COALESCE(a.model,'Sin modelo registrado') AS model,
  a.provider,
  a.latency_ms,
  a.error_category,
  a.attempt_number AS attempt_number,
  a.created_at,
  a.result_json #>> '{audit,result}' AS result,
  CASE WHEN (a.result_json #>> '{audit,confidence}') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (a.result_json #>> '{audit,confidence}')::double precision END AS confidence,
  CASE WHEN jsonb_typeof(a.result_json #> '{audit,missingEvidence}')='array' THEN jsonb_array_length(a.result_json #> '{audit,missingEvidence}') END AS missing_evidence_count,
  CASE WHEN (u.usage->>'estimatedCostUSD') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (u.usage->>'estimatedCostUSD')::double precision END AS usage_cost_usd,
  CASE WHEN (u.usage->>'totalTokens') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (u.usage->>'totalTokens')::double precision END AS usage_total_tokens,
  CASE WHEN (u.usage->>'promptTokens') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (u.usage->>'promptTokens')::double precision END AS usage_prompt_tokens,
  CASE WHEN (u.usage->>'completionTokens') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (u.usage->>'completionTokens')::double precision END AS usage_completion_tokens,
  att.provider_models,
  att.attempts_cost_usd,
  att.attempts_total_tokens,
  att.attempts_prompt_tokens,
  att.attempts_completion_tokens,
  att.attempts_count,
  att.call_metrics,
  CASE WHEN a.result_json ? 'origin' THEN a.result_json->'origin'->>'country' ELSE c.country END AS country,
  CASE WHEN a.result_json ? 'origin' THEN a.result_json->'origin'->>'channel' ELSE c.channel END AS channel,
  COALESCE(c.campus,c.flokzu_data #>> '{academic,campus}') AS campus,
  c.modality,
  c.project,
  COALESCE(c.assigned_to::text,c.responsible) AS responsible,
  COALESCE(c.guideline,c.flokzu_data #>> '{procedure,policyReported}') AS guideline,
  CASE WHEN review.coordinator_decision='APPROVE' THEN review.result WHEN review.coordinator_decision='CHANGE' THEN review.coordinator_resolution END AS human_result,
  c.created_by,
  c.is_test,
  EXISTS(SELECT 1 FROM public.audits previous WHERE previous.case_id=a.case_id AND (previous.created_at,previous.id)<(a.created_at,a.id)) AS is_reaudit,
  CASE WHEN a.provider_metadata->>'usageScope'='aggregate' AND u.usage->>'estimatedCostUSD' IS NOT NULL THEN false ELSE att.attempts_count=0 OR att.cost_incomplete END AS cost_incomplete,
  CASE WHEN a.provider_metadata->>'usageScope'='aggregate' AND u.usage->>'totalTokens' IS NOT NULL THEN false ELSE att.attempts_count=0 OR att.tokens_incomplete END AS tokens_incomplete,
  COALESCE(a.provider_metadata->>'usageScope'='aggregate', false) AS usage_is_aggregate
FROM public.audits a

JOIN public.cases c ON c.id=a.case_id
LEFT JOIN public.case_reviews review ON review.audit_id=a.id AND review.case_id=a.case_id
CROSS JOIN LATERAL (SELECT a.provider_metadata->'usage' AS usage) u
CROSS JOIN LATERAL (SELECT SUM(COALESCE(CASE WHEN (d->>'cost') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (d->>'cost')::double precision END, CASE WHEN d->>'failureCategory' IS NULL THEN CASE WHEN (u.usage->>'estimatedCostUSD') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (u.usage->>'estimatedCostUSD')::double precision END END)) AS attempts_cost_usd,
  bool_or((COALESCE(CASE WHEN (d->>'cost') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (d->>'cost')::double precision END, CASE WHEN d->>'failureCategory' IS NULL THEN CASE WHEN (u.usage->>'estimatedCostUSD') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (u.usage->>'estimatedCostUSD')::double precision END END)) IS NULL) AS cost_incomplete,
  SUM(COALESCE(CASE WHEN (d->>'totalTokens') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (d->>'totalTokens')::double precision END, CASE WHEN d->>'failureCategory' IS NULL THEN CASE WHEN (u.usage->>'totalTokens') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (u.usage->>'totalTokens')::double precision END END)) AS attempts_total_tokens,
  bool_or((COALESCE(CASE WHEN (d->>'totalTokens') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (d->>'totalTokens')::double precision END, CASE WHEN d->>'failureCategory' IS NULL THEN CASE WHEN (u.usage->>'totalTokens') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (u.usage->>'totalTokens')::double precision END END)) IS NULL) AS tokens_incomplete,
  SUM(COALESCE(CASE WHEN (d->>'promptTokens') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (d->>'promptTokens')::double precision END, CASE WHEN d->>'failureCategory' IS NULL THEN CASE WHEN (u.usage->>'promptTokens') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (u.usage->>'promptTokens')::double precision END END)) AS attempts_prompt_tokens,
  SUM(COALESCE(CASE WHEN (d->>'completionTokens') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (d->>'completionTokens')::double precision END, CASE WHEN d->>'failureCategory' IS NULL THEN CASE WHEN (u.usage->>'completionTokens') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (u.usage->>'completionTokens')::double precision END END)) AS attempts_completion_tokens,
  array_agg(DISTINCT d->>'model') FILTER(WHERE d->>'model' IS NOT NULL) AS provider_models,
  count(*)::integer AS attempts_count,
  jsonb_agg(jsonb_build_object('model',d->>'model','cost',CASE WHEN a.provider_metadata->>'usageScope'='aggregate' THEN NULL ELSE CASE WHEN (d->>'cost') ~ '^[0-9]+([.][0-9]+)?$' THEN (d->>'cost')::double precision END END)) AS call_metrics
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.provider_metadata->'openrouterAttempts')='array' THEN a.provider_metadata->'openrouterAttempts' ELSE '[]'::jsonb END) d
  WHERE d->>'format' IS DISTINCT FROM 'capability') att;

CREATE OR REPLACE VIEW public.comparison_activity_metrics AS
SELECT a.execution_id AS id,
  'COMPARISON'::text AS execution_kind,
  orig.case_id AS case_id,
  c.status AS case_status,
  c.student_identifier,
  a.status AS audit_status,
  COALESCE(a.model,'Sin modelo registrado') AS model,
  a.provider,
  a.latency_ms,
  a.error_category,
  a.attempt_count AS attempt_number,
  a.created_at,
  orig.result_json #>> '{audit,result}' AS result,
  CASE WHEN (orig.result_json #>> '{audit,confidence}') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (orig.result_json #>> '{audit,confidence}')::double precision END AS confidence,
  NULL::integer AS missing_evidence_count,
  CASE WHEN (u.usage->>'estimatedCostUSD') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (u.usage->>'estimatedCostUSD')::double precision END AS usage_cost_usd,
  CASE WHEN (u.usage->>'totalTokens') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (u.usage->>'totalTokens')::double precision END AS usage_total_tokens,
  CASE WHEN (u.usage->>'promptTokens') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (u.usage->>'promptTokens')::double precision END AS usage_prompt_tokens,
  CASE WHEN (u.usage->>'completionTokens') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (u.usage->>'completionTokens')::double precision END AS usage_completion_tokens,
  att.provider_models,
  att.attempts_cost_usd,
  att.attempts_total_tokens,
  att.attempts_prompt_tokens,
  att.attempts_completion_tokens,
  att.attempts_count,
  att.call_metrics,
  CASE WHEN a.result_json ? 'origin' THEN a.result_json->'origin'->>'country' ELSE c.country END AS country,
  CASE WHEN a.result_json ? 'origin' THEN a.result_json->'origin'->>'channel' ELSE c.channel END AS channel,
  COALESCE(c.campus,c.flokzu_data #>> '{academic,campus}') AS campus,
  c.modality,
  c.project,
  COALESCE(c.assigned_to::text,c.responsible) AS responsible,
  COALESCE(c.guideline,c.flokzu_data #>> '{procedure,policyReported}') AS guideline,
  NULL::text AS human_result,
  c.created_by,
  c.is_test,
  false AS is_reaudit,
  CASE WHEN a.provider_metadata->>'usageScope'='aggregate' AND u.usage->>'estimatedCostUSD' IS NOT NULL THEN false ELSE att.attempts_count=0 OR att.cost_incomplete END AS cost_incomplete,
  CASE WHEN a.provider_metadata->>'usageScope'='aggregate' AND u.usage->>'totalTokens' IS NOT NULL THEN false ELSE att.attempts_count=0 OR att.tokens_incomplete END AS tokens_incomplete,
  COALESCE(a.provider_metadata->>'usageScope'='aggregate', false) AS usage_is_aggregate
FROM public.comparison_execution_rows a
JOIN public.audits orig ON orig.id=a.audit_id
JOIN public.cases c ON c.id=orig.case_id
CROSS JOIN LATERAL (SELECT COALESCE(a.provider_metadata->'usage',a.result_json->'usage') AS usage) u
CROSS JOIN LATERAL (SELECT SUM(COALESCE(CASE WHEN (d->>'cost') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (d->>'cost')::double precision END, CASE WHEN d->>'failureCategory' IS NULL THEN CASE WHEN (u.usage->>'estimatedCostUSD') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (u.usage->>'estimatedCostUSD')::double precision END END)) AS attempts_cost_usd,
  bool_or((COALESCE(CASE WHEN (d->>'cost') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (d->>'cost')::double precision END, CASE WHEN d->>'failureCategory' IS NULL THEN CASE WHEN (u.usage->>'estimatedCostUSD') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (u.usage->>'estimatedCostUSD')::double precision END END)) IS NULL) AS cost_incomplete,
  SUM(COALESCE(CASE WHEN (d->>'totalTokens') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (d->>'totalTokens')::double precision END, CASE WHEN d->>'failureCategory' IS NULL THEN CASE WHEN (u.usage->>'totalTokens') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (u.usage->>'totalTokens')::double precision END END)) AS attempts_total_tokens,
  bool_or((COALESCE(CASE WHEN (d->>'totalTokens') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (d->>'totalTokens')::double precision END, CASE WHEN d->>'failureCategory' IS NULL THEN CASE WHEN (u.usage->>'totalTokens') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (u.usage->>'totalTokens')::double precision END END)) IS NULL) AS tokens_incomplete,
  SUM(COALESCE(CASE WHEN (d->>'promptTokens') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (d->>'promptTokens')::double precision END, CASE WHEN d->>'failureCategory' IS NULL THEN CASE WHEN (u.usage->>'promptTokens') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (u.usage->>'promptTokens')::double precision END END)) AS attempts_prompt_tokens,
  SUM(COALESCE(CASE WHEN (d->>'completionTokens') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (d->>'completionTokens')::double precision END, CASE WHEN d->>'failureCategory' IS NULL THEN CASE WHEN (u.usage->>'completionTokens') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN (u.usage->>'completionTokens')::double precision END END)) AS attempts_completion_tokens,
  array_agg(DISTINCT d->>'model') FILTER(WHERE d->>'model' IS NOT NULL) AS provider_models,
  count(*)::integer AS attempts_count,
  jsonb_agg(jsonb_build_object('model',d->>'model','cost',CASE WHEN a.provider_metadata->>'usageScope'='aggregate' THEN NULL ELSE CASE WHEN (d->>'cost') ~ '^[0-9]+([.][0-9]+)?$' THEN (d->>'cost')::double precision END END)) AS call_metrics
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.provider_metadata->'openrouterAttempts')='array' THEN a.provider_metadata->'openrouterAttempts' ELSE '[]'::jsonb END) d
  WHERE d->>'format' IS DISTINCT FROM 'capability') att;

-- Histórico por versión: review y comparación se enlazan al audit_id exacto.
CREATE OR REPLACE VIEW public.audit_evaluation_metrics AS
SELECT a.*, c.external_case_id, cr.audit_id AS review_audit_id,
 cr.id AS case_review_id, cr.result AS advisor_result,
 (a.confidence IS NOT NULL AND a.confidence BETWEEN 0 AND 1) AS has_valid_confidence,
 COALESCE(cr.coordinator_decision IS NOT NULL AND (cr.coordinator_decision='APPROVE' OR cr.coordinator_resolution IS NOT NULL),false) AS has_final_resolution,
 CASE WHEN cr.coordinator_decision='APPROVE' THEN cr.result
      WHEN cr.coordinator_decision='CHANGE' THEN cr.coordinator_resolution END AS final_result,
 cc.id AS comparison_id, cc.status AS comparison_status,
 CASE WHEN cc.result_json->>'agrees'='true' THEN true
      WHEN cc.result_json->>'agrees'='false' THEN false END AS comparison_agrees,
 CASE WHEN (cc.result_json->>'confidence') ~ '^[0-9]+([.][0-9]+)?$'
      THEN (cc.result_json->>'confidence')::double precision END AS comparison_confidence,
 latest.status AS latest_execution_status,
 a.id=chosen.id AS is_current_version,
 CASE
 WHEN a.audit_status='ERROR' THEN 'AUDIT_ERROR'
 WHEN a.audit_status='RUNNING' THEN 'AUDIT_RUNNING'
 WHEN cr.id IS NULL THEN 'PENDING_ADVISOR'
 WHEN cr.coordinator_decision IS NULL THEN 'PENDING_COORDINATOR'
 WHEN cc.id IS NULL THEN 'PENDING_COMPARISON'
 WHEN cc.status='RUNNING' THEN 'COMPARISON_RUNNING'
 WHEN cc.status='ERROR' THEN 'COMPARISON_ERROR'
 WHEN cc.result_json->>'agrees'='true' THEN 'AGREEMENT'
 WHEN cc.result_json->>'agrees'='false' THEN 'DISAGREEMENT'
 ELSE 'INVALID_COMPARISON' END AS evaluation_state
FROM public.audit_activity_metrics a
JOIN public.cases c ON c.id=a.case_id
LEFT JOIN public.case_reviews cr ON cr.audit_id=a.id AND cr.case_id=a.case_id
LEFT JOIN public.case_comparisons cc ON cc.audit_id=a.id AND cc.case_review_id=cr.id
 AND cr.coordinator_created_at IS NOT NULL AND cc.created_at>=cr.coordinator_created_at
CROSS JOIN LATERAL (SELECT x.id FROM public.audits x WHERE x.case_id=a.case_id
 ORDER BY (x.status='COMPLETED') DESC, x.created_at DESC,x.id DESC LIMIT 1) chosen
CROSS JOIN LATERAL (SELECT x.status FROM public.audits x WHERE x.case_id=a.case_id
 ORDER BY x.created_at DESC,x.id DESC LIMIT 1) latest;

CREATE OR REPLACE VIEW public.current_audit_evaluation_metrics AS
SELECT * FROM public.audit_evaluation_metrics WHERE is_current_version;

CREATE INDEX IF NOT EXISTS audits_case_version_metrics_idx ON public.audits(case_id,created_at DESC,id DESC);
REVOKE ALL ON public.comparison_execution_rows FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.comparison_execution_rows TO project_admin;
REVOKE ALL ON public.audit_activity_metrics FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.audit_activity_metrics TO project_admin;
REVOKE ALL ON public.comparison_activity_metrics FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.comparison_activity_metrics TO project_admin;
REVOKE ALL ON public.audit_evaluation_metrics FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.audit_evaluation_metrics TO project_admin;
REVOKE ALL ON public.current_audit_evaluation_metrics FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.current_audit_evaluation_metrics TO project_admin;

DO $verify$
DECLARE v text;
BEGIN
 FOREACH v IN ARRAY ARRAY['comparison_execution_rows','audit_activity_metrics','comparison_activity_metrics','audit_evaluation_metrics','current_audit_evaluation_metrics'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=('public.'||v)::regclass AND relkind='v') THEN
   RAISE EXCEPTION 'Falta vista %',v;
  END IF;
  IF has_table_privilege('anon','public.'||v,'SELECT') OR has_table_privilege('authenticated','public.'||v,'SELECT') THEN
   RAISE EXCEPTION 'Vista accesible al navegador: %',v;
  END IF;
  IF NOT has_table_privilege('project_admin','public.'||v,'SELECT') THEN RAISE EXCEPTION 'Falta permiso admin: %',v; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.case_comparisons'::regclass AND tgname='archive_comparison_execution') THEN
  RAISE EXCEPTION 'Falta archivo transaccional de ejecuciones';
 END IF;
 IF EXISTS(SELECT case_id FROM public.current_audit_evaluation_metrics GROUP BY case_id HAVING count(*)>1) THEN
  RAISE EXCEPTION 'Universo de calidad duplicado';
 END IF;
 IF (SELECT count(*) FROM public.comparison_execution_rows) < (SELECT count(*) FROM public.case_comparisons) THEN
  RAISE EXCEPTION 'Faltan ejecuciones de comparacion';
 END IF;
END
$verify$;
