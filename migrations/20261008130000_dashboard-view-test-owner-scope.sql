-- =============================================================================
-- 20261008130000 — Vistas de dashboard: scope de dueño y exclusión de pruebas.
--
-- Idempotente, forward-only, sin BEGIN/COMMIT. NO escribe datos: solo RECREA dos
-- vistas de lectura para AGREGAR dos columnas al FINAL de cada una. Trae un
-- bloque `DO $verify$` que falla si el resultado no es el que este archivo
-- describe.
--
-- POR QUÉ EXISTE
--   La feature de rol/prueba necesita dos cosas que la vista no podía resolver
--   en SQL:
--     1. EXCLUIR las pruebas (`is_test = false`) de las métricas operativas
--        ANTES del count/limit. Filtrar en memoria después del recorte contaba
--        las pruebas dentro del total.
--     2. ACOTAR por dueño (`created_by = <sub>`) al Asesor, también en SQL. Antes
--        el scope se aplicaba en memoria DESPUÉS del `limit(5000)`, así que con
--        más filas que el tope el Asesor veía un total subcontado y el `truncated`
--        describía filas ajenas (el TODO de `getOwnedCaseIds` en dashboard.ts).
--
--   Se añaden AMBAS columnas, y `is_test` va la ÚLTIMA (columna 34 de la vista de
--   métricas y 11 de la de comparaciones): `CREATE OR REPLACE VIEW` solo puede
--   agregar columnas al final sin renombrar las siguientes, y los consumidores
--   seleccionan por nombre, nunca por posición. Las columnas previas conservan
--   nombre, tipo y posición, y la verificación lo comprueba una a una.
--
-- REVERSIBLE
--   Se reaplica la definición inmediatamente anterior de cada vista (la de
--   `20261005120000_origin-country-channel.sql` para las métricas y la de
--   `20260930020000_human-review-dashboard-metrics.sql` para las comparaciones).
--   No se borra ni se altera ningún dato.
--
-- NO ES UNA SEGUNDA IMPLEMENTACIÓN DEL CRITERIO (NO_RULES_ENGINE)
--   Estas vistas no deciden, no clasifican y no emiten veredicto: solo sacan
--   columnas que YA existen (`cases.created_by`, `cases.is_test`) para que el
--   servidor pueda filtrar en SQL. `audits.result_json` sigue siendo la fuente de
--   verdad del dictamen de IA.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Vista de métricas: 32 columnas previas + created_by + is_test = 34
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.audit_dashboard_metrics AS
WITH att AS (
  SELECT
    a.id AS audit_id,
    CASE WHEN COUNT(*) FILTER (
            WHERE (t.d ->> 'cost') ~ '^-?[0-9]+(\.[0-9]+)?$'
          ) = 0
         THEN NULL
         ELSE COALESCE(SUM(CASE WHEN (t.d ->> 'cost') ~ '^-?[0-9]+(\.[0-9]+)?$'
                                THEN (t.d ->> 'cost')::double precision ELSE 0 END), 0)
    END AS attempts_cost_usd,
    CASE WHEN COUNT(*) FILTER (
            WHERE (t.d ->> 'totalTokens') ~ '^-?[0-9]+$'
          ) = 0
         THEN NULL
         ELSE COALESCE(SUM(CASE WHEN (t.d ->> 'totalTokens') ~ '^-?[0-9]+$'
                                THEN (t.d ->> 'totalTokens')::bigint ELSE 0 END), 0)
    END AS attempts_total_tokens,
    CASE WHEN COUNT(*) FILTER (
            WHERE (t.d ->> 'promptTokens') ~ '^-?[0-9]+$'
          ) = 0
         THEN NULL
         ELSE COALESCE(SUM(CASE WHEN (t.d ->> 'promptTokens') ~ '^-?[0-9]+$'
                                THEN (t.d ->> 'promptTokens')::bigint ELSE 0 END), 0)
    END AS attempts_prompt_tokens,
    CASE WHEN COUNT(*) FILTER (
            WHERE (t.d ->> 'completionTokens') ~ '^-?[0-9]+$'
          ) = 0
         THEN NULL
         ELSE COALESCE(SUM(CASE WHEN (t.d ->> 'completionTokens') ~ '^-?[0-9]+$'
                                THEN (t.d ->> 'completionTokens')::bigint ELSE 0 END), 0)
    END AS attempts_completion_tokens,
    ARRAY(
      SELECT DISTINCT t2.d ->> 'model'
      FROM jsonb_array_elements(
        COALESCE(a.provider_metadata -> 'openrouterAttempts', '[]'::jsonb)
      ) AS t2(d)
      WHERE jsonb_typeof(COALESCE(a.provider_metadata -> 'openrouterAttempts', '[]'::jsonb)) = 'array'
        AND t2.d ->> 'model' IS NOT NULL
    ) AS provider_models
  FROM public.audits a
  LEFT JOIN LATERAL jsonb_array_elements(
    COALESCE(a.provider_metadata -> 'openrouterAttempts', '[]'::jsonb)
  ) AS t(d)
    ON jsonb_typeof(COALESCE(a.provider_metadata -> 'openrouterAttempts', '[]'::jsonb)) = 'array'
  GROUP BY a.id
)
SELECT
  a.id,
  a.case_id,
  c.status AS case_status,
  c.student_identifier,
  a.status AS audit_status,
  TRIM(a.model) AS model,
  a.provider,
  a.latency_ms,
  a.error_category,
  a.attempt_number,
  a.created_at,
  a.result_json #>> '{audit,result}' AS result,
  CASE WHEN (a.result_json #>> '{audit,confidence}') ~ '^-?[0-9]+(\.[0-9]+)?$'
       THEN (a.result_json #>> '{audit,confidence}')::double precision END AS confidence,
  CASE WHEN jsonb_typeof(a.result_json #> '{audit,missingEvidence}') = 'array'
       THEN jsonb_array_length(a.result_json #> '{audit,missingEvidence}')
       ELSE 0 END AS missing_evidence_count,
  CASE WHEN (a.provider_metadata #>> '{usage,estimatedCostUSD}') ~ '^-?[0-9]+(\.[0-9]+)?$'
       THEN (a.provider_metadata #>> '{usage,estimatedCostUSD}')::double precision END AS usage_cost_usd,
  CASE WHEN (a.provider_metadata #>> '{usage,totalTokens}') ~ '^-?[0-9]+$'
       THEN (a.provider_metadata #>> '{usage,totalTokens}')::bigint END AS usage_total_tokens,
  CASE WHEN (a.provider_metadata #>> '{usage,promptTokens}') ~ '^-?[0-9]+$'
       THEN (a.provider_metadata #>> '{usage,promptTokens}')::bigint END AS usage_prompt_tokens,
  CASE WHEN (a.provider_metadata #>> '{usage,completionTokens}') ~ '^-?[0-9]+$'
       THEN (a.provider_metadata #>> '{usage,completionTokens}')::bigint END AS usage_completion_tokens,
  att.provider_models,
  att.attempts_cost_usd,
  att.attempts_total_tokens,
  att.attempts_prompt_tokens,
  att.attempts_completion_tokens,
  CASE WHEN jsonb_typeof(COALESCE(a.provider_metadata -> 'openrouterAttempts', '[]'::jsonb)) = 'array'
       THEN jsonb_array_length(COALESCE(a.provider_metadata -> 'openrouterAttempts', '[]'::jsonb))
       ELSE 0 END AS attempts_count,
  c.country,
  c.campus,
  c.modality,
  c.project,
  c.responsible,
  c.guideline,
  hr.human_outcome AS human_result,
  c.channel,
  -- Columna 33: dueño del caso, para que el scope del Asesor viaje en la consulta
  -- (`created_by = <sub>`) y no en un filtro en memoria DESPUÉS del limit.
  c.created_by,
  -- Columna 34, AL FINAL: marca de prueba. La exclusión de pruebas de las métricas
  -- operativas la aplica el servidor (`is_test = false`) ANTES del count/limit.
  c.is_test
FROM public.audits a
LEFT JOIN public.cases c ON c.id = a.case_id
LEFT JOIN att ON att.audit_id = a.id
LEFT JOIN public.case_human_reviews hr ON hr.audit_id = a.id;

COMMENT ON VIEW public.audit_dashboard_metrics IS
  'Proyeccion de solo lectura para el dashboard. Incluye student_identifier (dato personal), created_by e is_test para el scope del servidor. NO contiene credenciales ni jsonb crudo.';

REVOKE ALL ON public.audit_dashboard_metrics FROM anon;
REVOKE ALL ON public.audit_dashboard_metrics FROM authenticated;
REVOKE ALL ON public.audit_dashboard_metrics FROM PUBLIC;
GRANT SELECT ON public.audit_dashboard_metrics TO project_admin;

-- -----------------------------------------------------------------------------
-- 2. Vista de comparaciones: 9 columnas previas + created_by + is_test = 11
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.case_comparisons_dashboard_metrics AS
SELECT
  cc.id,
  cc.case_review_id,
  cr.case_id,
  c.status AS case_status,
  a.result_json #>> '{audit,result}' AS audit_result,
  cc.status,
  cc.created_at,
  CASE
    WHEN cc.result_json ->> 'agrees' = 'true'  THEN true
    WHEN cc.result_json ->> 'agrees' = 'false' THEN false
    ELSE NULL
  END AS agrees,
  CASE WHEN (cc.result_json #>> '{confidence}') ~ '^-?[0-9]+(\.[0-9]+)?$'
       THEN (cc.result_json #>> '{confidence}')::double precision
       ELSE NULL END AS confidence,
  -- Columna 10: dueño del CASO, para aplicar el mismo scope que en la vista de
  -- métricas. Se proyecta desde el join a `cases`, no desde `case_reviews`.
  c.created_by,
  -- Columna 11, AL FINAL: marca de prueba del caso comparado.
  c.is_test
FROM public.case_comparisons cc
LEFT JOIN public.case_reviews cr ON cr.id = cc.case_review_id
LEFT JOIN public.cases c ON c.id = cr.case_id
LEFT JOIN public.audits a ON a.id = cc.audit_id;

COMMENT ON VIEW public.case_comparisons_dashboard_metrics IS
  'Proyeccion de solo lectura de comparaciones para el dashboard. No expone el comentario humano ni la explicacion del modelo. Incluye created_by e is_test para el scope del servidor.';

REVOKE ALL ON public.case_comparisons_dashboard_metrics FROM anon;
REVOKE ALL ON public.case_comparisons_dashboard_metrics FROM authenticated;
REVOKE ALL ON public.case_comparisons_dashboard_metrics FROM PUBLIC;
GRANT SELECT ON public.case_comparisons_dashboard_metrics TO project_admin;

-- -----------------------------------------------------------------------------
-- 3. Verificación
-- -----------------------------------------------------------------------------
DO $verify$
DECLARE
  v_count int;
  v_col   text;
BEGIN
  -- 3.1 La vista de métricas existe, es una vista y expone 34 columnas.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='audit_dashboard_metrics' AND c.relkind='v'
  ) THEN
    RAISE EXCEPTION 'dashboard_view_scope: public.audit_dashboard_metrics no existe o no es una vista';
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_attribute
  WHERE attrelid='public.audit_dashboard_metrics'::regclass
    AND attnum > 0 AND NOT attisdropped;

  IF v_count <> 34 THEN
    RAISE EXCEPTION 'dashboard_view_scope: la vista de metricas deberia exponer 34 columnas y expone %', v_count;
  END IF;

  -- 3.2 Proyecta created_by e is_test (lo que habilita el scope y la exclusion).
  FOREACH v_col SLICE 1 IN ARRAY ARRAY['created_by','is_test'] LOOP
    SELECT count(*) INTO v_count
    FROM pg_attribute
    WHERE attrelid='public.audit_dashboard_metrics'::regclass AND attnum > 0
      AND NOT attisdropped AND attname=v_col;

    IF v_count <> 1 THEN
      RAISE EXCEPTION 'dashboard_view_scope: la vista de metricas no proyecta %', v_col;
    END IF;
  END LOOP;

  -- 3.3 `is_test` es la ULTIMA columna: CREATE OR REPLACE solo puede agregar al
  --     final, y un reordenamiento romperia el contrato posicional.
  IF (SELECT a.attname FROM pg_attribute a
        WHERE a.attrelid='public.audit_dashboard_metrics'::regclass
          AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum DESC LIMIT 1) <> 'is_test' THEN
    RAISE EXCEPTION 'dashboard_view_scope: is_test debe ser la ultima columna de la vista de metricas';
  END IF;

  -- 3.4 Las 7 dimensiones del caso siguen proyectadas: ninguna se perdio al recrear.
  FOREACH v_col SLICE 1 IN ARRAY ARRAY[
    'country','channel','campus','modality','project','responsible','guideline'
  ] LOOP
    SELECT count(*) INTO v_count
    FROM pg_attribute
    WHERE attrelid='public.audit_dashboard_metrics'::regclass AND attnum > 0
      AND NOT attisdropped AND attname=v_col;

    IF v_count <> 1 THEN
      RAISE EXCEPTION 'dashboard_view_scope: la vista de metricas no proyecta la dimension cases.%', v_col;
    END IF;
  END LOOP;

  -- 3.5 La vista de comparaciones existe, es una vista y expone 11 columnas.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='case_comparisons_dashboard_metrics' AND c.relkind='v'
  ) THEN
    RAISE EXCEPTION 'dashboard_view_scope: public.case_comparisons_dashboard_metrics no existe o no es una vista';
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_attribute
  WHERE attrelid='public.case_comparisons_dashboard_metrics'::regclass
    AND attnum > 0 AND NOT attisdropped;

  IF v_count <> 11 THEN
    RAISE EXCEPTION 'dashboard_view_scope: la vista de comparaciones deberia exponer 11 columnas y expone %', v_count;
  END IF;

  FOREACH v_col SLICE 1 IN ARRAY ARRAY['created_by','is_test'] LOOP
    SELECT count(*) INTO v_count
    FROM pg_attribute
    WHERE attrelid='public.case_comparisons_dashboard_metrics'::regclass AND attnum > 0
      AND NOT attisdropped AND attname=v_col;

    IF v_count <> 1 THEN
      RAISE EXCEPTION 'dashboard_view_scope: la vista de comparaciones no proyecta %', v_col;
    END IF;
  END LOOP;

  IF (SELECT a.attname FROM pg_attribute a
        WHERE a.attrelid='public.case_comparisons_dashboard_metrics'::regclass
          AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum DESC LIMIT 1) <> 'is_test' THEN
    RAISE EXCEPTION 'dashboard_view_scope: is_test debe ser la ultima columna de la vista de comparaciones';
  END IF;

  -- 3.6 Ninguna de las dos vistas es alcanzable desde el navegador.
  IF EXISTS (
    SELECT 1 FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) g
    WHERE c.oid IN (
      'public.audit_dashboard_metrics'::regclass,
      'public.case_comparisons_dashboard_metrics'::regclass
    )
      AND g.grantee IN (
        (SELECT oid FROM pg_roles WHERE rolname='anon'),
        (SELECT oid FROM pg_roles WHERE rolname='authenticated')
      )
  ) THEN
    RAISE EXCEPTION 'dashboard_view_scope: una vista de dashboard quedo accesible por anon/authenticated';
  END IF;

  -- 3.7 project_admin puede leer AMBAS vistas.
  FOREACH v_col SLICE 1 IN ARRAY ARRAY['audit_dashboard_metrics','case_comparisons_dashboard_metrics'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      CROSS JOIN LATERAL aclexplode(c.relacl) g
      WHERE c.oid = ('public.' || v_col)::regclass
        AND g.grantee='project_admin'::regrole AND g.privilege_type='SELECT'
    ) THEN
      RAISE EXCEPTION 'dashboard_view_scope: project_admin no tiene SELECT en public.%', v_col;
    END IF;
  END LOOP;

  RAISE NOTICE 'OK — vistas de 34 y 11 columnas con created_by/is_test y permisos verificados';
END
$verify$;
