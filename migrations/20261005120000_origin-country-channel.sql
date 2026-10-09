-- =============================================================================
-- 20261005120000 — Origen de la cancelación: país y canal.
--
-- Idempotente, forward-only, sin BEGIN/COMMIT. NO escribe datos ni altera
-- `evidence` ni `audits`. Trae un bloque `DO $verify$` que falla si el resultado
-- no es el que este archivo describe.
--
-- Por qué existe: el dashboard ya podía filtrar por dimensión del caso, pero
-- ninguna tenía escritor salvo la proyección que introduce esta migración. La
-- auditoría ahora extrae el país de operación y el canal por el que el estudiante
-- expresó la cancelación, y ambos se proyectan a columnas de `cases` para poder
-- filtrar y graficar sin leer `result_json` fila por fila.
--
-- CONTRADICE A PROPÓSITO UN `COMMENT` ANTERIOR, y conviene explicarlo. La
-- migración `20260930120000_case-metadata-and-human-reviews.sql` marcó
-- `cases.country` como "NO se infiere ni se deriva de texto generado por la IA".
-- Aquel comentario protegía contra un riesgo real: derivar un filtro de
-- `audit.rule`, que es TEXTO LIBRE del modelo y no es una dimensión confiable.
--
-- Este caso es distinto y por eso el comentario se reemplaza: `country` y
-- `channel` NO son texto libre, son un vocabulario CERRADO (`EVIDENCE_COUNTRIES` /
-- `EVIDENCE_CHANNELS` en `src/skills/audit/types.ts`) validado por Zod con
-- `.strict()`, y un valor fuera del catálogo rechaza el dictamen entero. Es el
-- mismo criterio que ya usa `20260930120000:97-101` para `human_outcome`: la
-- validación fuerte se hace en el servidor y "la base acepta el texto; la API no".
--
-- La trazabilidad no se pierde: cada valor afirmado exige `evidenceIds` con las
-- evidencias que lo acreditan (`validateOrigin` rechaza lo contrario), y la cita
-- textual completa queda en `audits.result_json`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. La columna del canal
-- -----------------------------------------------------------------------------
--
-- `country` ya existe desde `20260930120000`; solo cambia su significado, y eso
-- se refleja en su `COMMENT`, no en un ALTER.
--
-- `text` y NULL-able, igual que las demás dimensiones del caso. NULL significa
-- "no determinable", que es un resultado válido (la evidencia puede no decir de
-- dónde es el estudiante) y NUNCA un valor inventado. Los dropdowns del dashboard
-- se construyen con `SELECT DISTINCT ... WHERE col IS NOT NULL`, así que un caso
-- sin canal no ofrece una opción ficticia.
--
-- No lleva CHECK contra el catálogo por la misma razón que `human_outcome`: el
-- vocabulario vive en el código y podría evolucionar; un CHECK ataría la base a
-- una taxonomía que no controla. La validación dura es de Zod en el servidor.

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS channel text;

COMMENT ON COLUMN public.cases.channel IS
  'Canal por el que el estudiante expreso la cancelacion (canal de ORIGEN, no el administrativo). Vocabulario cerrado validado en el servidor contra EVIDENCE_CHANNELS; NULL = no determinable. Trazabilidad en audits.result_json (origin.evidenceIds).';

COMMENT ON COLUMN public.cases.country IS
  'Pais de operacion de la cancelacion. Vocabulario cerrado validado en el servidor contra EVIDENCE_COUNTRIES; NULL = no determinable. Reemplaza el comentario anterior que prohibia derivarlo de la IA: un enum validado por Zod no es el texto libre de audit.rule. Trazabilidad en audits.result_json (origin.evidenceIds).';

-- -----------------------------------------------------------------------------
-- 2. Proyección de métricas extendida
-- -----------------------------------------------------------------------------
--
-- En una instalación que todavía no proyecta `channel`, se recrea la vista y la
-- columna nueva queda al final, después de `human_result`. Si `channel` ya está
-- proyectado (por ejemplo, cuando se reconcilia el ledger de una base existente
-- que también incluye columnas añadidas por migraciones posteriores), se conserva
-- la definición actual: CREATE OR REPLACE VIEW no permite quitar esas columnas.
--
-- La verificación acepta la vista de esta etapa (32 columnas) y la vista vigente
-- extendida (34 columnas); ambas deben conservar las dimensiones y permisos.
--
-- `channel` va SIN la envoltura NULL de la sección de costes: es una dimensión del
-- caso, no un agregado, y `NULL` es un valor con significado propio.

DO $create_view$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = to_regclass('public.audit_dashboard_metrics')
      AND attnum > 0
      AND NOT attisdropped
      AND attname = 'channel'
  ) THEN
    EXECUTE $view$
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
  -- `TRIM(a.model)`: `audits.model` es texto libre que escribe el adaptador, y
  -- un espacio accidental partía el MISMO modelo en dos filas del informe de
  -- coste. Es higiene de CLAVE DE AGRUPACIÓN de un gasto, no una reclasificación
  -- del dictamen.
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
  -- NÚMERO DE INTENTOS REALES de la llamada, no el `attempt_number` del run:
  -- `provider_models` decía QUÉ modelos se probaron, y con longitud 1 no se
  -- distinguía "un reintento contra el mismo modelo" de "una sola llamada". Es
  -- la señal que separa "éxito al primer intento" de "éxito tras reintento".
  -- NO lleva la envoltura NULL de la sección de costes: un número de intentos
  -- es un hecho conocido se sepa o no su coste.
  CASE WHEN jsonb_typeof(COALESCE(a.provider_metadata -> 'openrouterAttempts', '[]'::jsonb)) = 'array'
       THEN jsonb_array_length(COALESCE(a.provider_metadata -> 'openrouterAttempts', '[]'::jsonb))
       ELSE 0 END AS attempts_count,
  -- Dimensiones del caso. NULL cuando no hay dato: NUNCA un valor inventado.
  c.country,
  c.campus,
  c.modality,
  c.project,
  c.responsible,
  c.guideline,
  -- Dictamen humano del MISMO audit_id. 1:1 por el UNIQUE, así que el LEFT JOIN
  -- no multiplica filas ni puede inflar un agregado. `null` = nadie revisó,
  -- que NO es lo mismo que "discrepó".
  hr.human_outcome AS human_result,
  -- Columna 32, agregada al final: ver la nota del encabezado. Canal de ORIGEN,
  -- no el administrativo.
  c.channel
FROM public.audits a
LEFT JOIN public.cases c ON c.id = a.case_id
LEFT JOIN att ON att.audit_id = a.id
LEFT JOIN public.case_human_reviews hr ON hr.audit_id = a.id;
    $view$;
  END IF;
END
$create_view$;

COMMENT ON VIEW public.audit_dashboard_metrics IS
  'Proyeccion de solo lectura para el dashboard. Incluye student_identifier (dato personal) y el dictamen humano de case_human_reviews. NO contiene credenciales ni jsonb crudo.';

-- -----------------------------------------------------------------------------
-- 3. Permisos
-- -----------------------------------------------------------------------------
--
-- La vista sigue siendo de SOLO lectura y sigue sin ser alcanzable desde el
-- navegador: se revoca a `anon` y `authenticated` y se concede solo al rol
-- administrativo del servidor. Una vista no pasa por RLS, así que el permiso es
-- la única barrera real. Se repiten los REVOKE porque `CREATE OR REPLACE VIEW`
-- conserva la ACL anterior, y repetirlos no tiene efecto si ya estaba así.

REVOKE ALL ON public.audit_dashboard_metrics FROM anon;
REVOKE ALL ON public.audit_dashboard_metrics FROM authenticated;
REVOKE ALL ON public.audit_dashboard_metrics FROM PUBLIC;
GRANT SELECT ON public.audit_dashboard_metrics TO project_admin;

-- -----------------------------------------------------------------------------
-- 4. Verificación
-- -----------------------------------------------------------------------------
DO $verify$
DECLARE
  v_count int;
  v_col   text;
BEGIN
  -- 4.1 `channel` existe como text NULL-able.
  SELECT count(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='cases' AND column_name='channel'
    AND is_nullable='YES' AND data_type='text';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'cases.channel debe existir como text NULL-able (encontradas: %)', v_count;
  END IF;

  -- 4.2 `country` SIGUE siendo text NULL-able: esta migración no lo endurece.
  SELECT count(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='cases' AND column_name='country'
    AND is_nullable='YES' AND data_type='text';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'cases.country debe seguir siendo text NULL-able (encontradas: %)', v_count;
  END IF;

-- 4.3 La vista existe, es una vista y conserva la forma de esta migración
--     (32 columnas) o la forma vigente posterior (34 columnas).
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='audit_dashboard_metrics' AND c.relkind='v'
  ) THEN
    RAISE EXCEPTION 'public.audit_dashboard_metrics no existe o no es una vista';
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_attribute
  WHERE attrelid='public.audit_dashboard_metrics'::regclass
    AND attnum > 0 AND NOT attisdropped;

  IF v_count NOT IN (32, 34) THEN
    RAISE EXCEPTION 'la vista deberia exponer 32 o 34 columnas y expone %', v_count;
  END IF;

  -- 4.4 La vista PROYECTA channel, que es lo que habilita el filtro. Sin esto, el
  --     cambio de código pasaría el typecheck y fallaría en runtime.
  SELECT count(*) INTO v_count
  FROM pg_attribute
  WHERE attrelid='public.audit_dashboard_metrics'::regclass AND attnum > 0
    AND NOT attisdropped AND attname='channel';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'la vista no proyecta channel';
  END IF;

  -- Si se conserva la forma posterior de 34 columnas, sus columnas de alcance y
  -- exclusión de pruebas también deben seguir disponibles.
  IF (SELECT count(*) FROM pg_attribute
      WHERE attrelid='public.audit_dashboard_metrics'::regclass
        AND attnum > 0 AND NOT attisdropped) = 34 THEN
    FOREACH v_col IN ARRAY ARRAY['created_by','is_test'] LOOP
      SELECT count(*) INTO v_count
      FROM pg_attribute
      WHERE attrelid='public.audit_dashboard_metrics'::regclass AND attnum > 0
        AND NOT attisdropped AND attname=v_col;

      IF v_count <> 1 THEN
        RAISE EXCEPTION 'la vista vigente no proyecta %', v_col;
      END IF;
    END LOOP;
  END IF;

  -- 4.5 Las 7 dimensiones del caso siguen proyectadas: ninguna se perdió al recrear.
  FOREACH v_col IN ARRAY ARRAY[
    'country','channel','campus','modality','project','responsible','guideline'
  ] LOOP
    SELECT count(*) INTO v_count
    FROM pg_attribute
    WHERE attrelid='public.audit_dashboard_metrics'::regclass AND attnum > 0
      AND NOT attisdropped AND attname=v_col;

    IF v_count <> 1 THEN
      RAISE EXCEPTION 'la vista no proyecta la dimension cases.%', v_col;
    END IF;
  END LOOP;

  -- 4.6 Permisos: la vista sigue sin ser alcanzable desde el navegador.
  IF EXISTS (
    SELECT 1 FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) g
    WHERE c.oid='public.audit_dashboard_metrics'::regclass
      AND g.grantee IN (
        (SELECT oid FROM pg_roles WHERE rolname='anon'),
        (SELECT oid FROM pg_roles WHERE rolname='authenticated')
      )
  ) THEN
    RAISE EXCEPTION 'la vista no debe ser accesible por anon/authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) g
    WHERE c.oid='public.audit_dashboard_metrics'::regclass
      AND g.grantee='project_admin'::regrole AND g.privilege_type='SELECT'
  ) THEN
    RAISE EXCEPTION 'project_admin debe tener SELECT en la vista';
  END IF;

  RAISE NOTICE 'OK — cases.channel, vista compatible y permisos verificados';
END
$verify$;
