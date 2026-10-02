-- =============================================================================
-- 20260930120000 — Proyección de métricas: dimensiones del caso y revisión
-- humana.
--
-- Idempotente, forward-only, sin BEGIN/COMMIT. NO escribe datos ni altera
-- `evidence` ni `audits`. Trae un bloque `DO $verify$` que falla si el resultado
-- no es el que este archivo describe.
--
-- Por qué existe: el dashboard tenía KPIs de resultado del dictamen (concedidas /
-- requiere dictaminación / evidencia insuficiente) pero no las métricas que pidió
-- el equipo: coste, ejecución técnica, coincidencia con la revisión humana, ni
-- filtros por dimensión del caso.
--
-- POLICY_IS_IMMUTABLE: esto NO toca `result`. El dictamen de la IA se queda como
-- es. `case_reviews` guarda el dictamen humano APARTE y la coincidencia se
-- CALCULA; `result_json` nunca se sobrescribe.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Dimensiones del caso
-- -----------------------------------------------------------------------------
--
-- LAS SEIS SON `text` Y NULL-ABLE, A PROPÓSITO. Antes de crearlas se revisó el
-- schema real de InsForge y el resultado fue que NO EXISTE ninguna de esas
-- dimensiones como dato estructurado:
--
--   - `cases` solo tenía `id, status, student_identifier, created_by,
--     created_at, updated_at`.
--   - `tickets` (el CRM legacy) tiene 0 filas y su contenido vive en jsonb
--     libre: no hay catálogo del que derivar valores.
--   - `profiles` tiene una fila con `role = 'AUDITOR'`: es el USUARIO QUE OPERA
--     EL SISTEMA, no el responsable del caso. No es la misma dimensión.
--
-- Por eso se crean vacías en lugar de inventar los datos. NULL significa "no lo
-- sabemos", que es distinto de un valor falso. Los dropdowns del dashboard se
-- construyen con `SELECT DISTINCT ... WHERE col IS NOT NULL`, así que una
-- dimensión sin datos NO ofrece opciones en vez de ofrecer valores ficticios.
--
-- `text` y no FK a un catálogo: cuando llegue el catálogo externo del CRM (IDs
-- reales) la ampliación será `country_id uuid REFERENCES ...`. Guardar hoy una
-- etiqueta duplicaría el dato y obligaría a migrarlo después (LEGACY_IS_NOT_POLICY:
-- no se anticipa un catálogo que no existe).
--
-- Estos datos pertenecen al CASO, no a cada ejecución: por eso van en `cases` y
-- no en `audits`. Una segunda auditoría del mismo caso lee las mismas dimensiones
-- sin duplicarlas.
--
-- `guideline` (Lineamiento) NO es `audit.rule`: ese es texto libre que genera el
-- modelo y no es una dimensión confiable. Derivar el filtro de ahí sería
-- exactamente lo que hay que evitar.

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS country    text,
  ADD COLUMN IF NOT EXISTS campus     text,
  ADD COLUMN IF NOT EXISTS modality   text,
  ADD COLUMN IF NOT EXISTS project    text,
  ADD COLUMN IF NOT EXISTS responsible text,
  ADD COLUMN IF NOT EXISTS guideline  text;

COMMENT ON COLUMN public.cases.country IS
  'Dimension del caso (pais). NULL hasta que exista el catalogo real. NO se infiere ni se deriva de texto generado por la IA.';
COMMENT ON COLUMN public.cases.campus IS
  'Dimension del caso (campus). NULL hasta que exista el catalogo real.';
COMMENT ON COLUMN public.cases.modality IS
  'Dimension del caso (modalidad). NULL hasta que exista el catalogo real.';
COMMENT ON COLUMN public.cases.project IS
  'Dimension del caso (proyecto). NULL hasta que exista el catalogo real.';
COMMENT ON COLUMN public.cases.responsible IS
  'Dimension del caso (responsable). NO es profiles.role, que identifica al usuario que opera el sistema.';
COMMENT ON COLUMN public.cases.guideline IS
  'Lineamiento del caso. NO es audit.rule: ese es texto libre generado por el modelo y no es una dimension confiable.';

-- -----------------------------------------------------------------------------
-- 2. Revisión humana
-- -----------------------------------------------------------------------------
--
-- POR QUÉ UNA TABLA NUEVA Y NO LA `human_reviews` EXISTENTE:
-- `human_reviews` ya existe en esta base, pero su FK es
-- `audit_id -> legacy_audits(id)` y `legacy_audits` tiene 12 filas. La app
-- actual audita sobre la tabla `audits`, no sobre `legacy_audits`, así que
-- `human_reviews` no puede apuntar a las auditorías que produce este producto
-- sin romper su integridad referencial. No se modifica ni se dropea: es residuo
-- de la arquitectura anterior y no se revive (LEGACY_IS_NOT_POLICY).
--
-- Se reutiliza SU convención de nombres y tipos para no inventar un segundo
-- estándar:
--   - `decision_type` con el mismo vocabulario ('APPROVE' | 'CORRECT')
--   - `human_outcome` como columna del dictamen humano
--   - `reviewed_by` / `reviewed_at` / `created_at` / `updated_at` / `updated_by`
--
-- DIFERENCIAS CON EL MODELO PEDIDO, y son a propósito:
--   - No hay `notes`: el estándar real usa `human_reason`.
--   - No hay `result`: el estándar real usa `human_outcome`.
--   - No hay `case_id`: se alcanza por `audits.case_id`. Duplicarlo daría dos
--     fuentes de verdad para "a qué caso pertenece esta revisión".
--
-- `human_outcome` NO lleva CHECK contra el vocabulario del Skill, igual que el
-- `human_reviews` original: un CHECK ataría la base a una taxonomía que vive en
-- el código (`src/skills/audit/types.ts`) y podría divergir. La validación
-- fuerte se hace en el servidor, con Zod, contra ese vocabulario cerrado. La base
-- acepta el texto; la API no.
--
-- UNA revisión por auditoría: `UNIQUE (audit_id)`. Es lo que hace el par
-- (dictamen IA, dictamen humano) comparable 1:1, y es lo que ya hace
-- `human_reviews`.

CREATE TABLE IF NOT EXISTS public.case_human_reviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id      uuid NOT NULL UNIQUE
                  REFERENCES public.audits(id) ON DELETE CASCADE,
  decision_type text NOT NULL,
  human_outcome text,
  human_reason  text,
  reviewed_by   uuid NOT NULL REFERENCES auth.users(id),
  reviewed_at   timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES auth.users(id),
  CONSTRAINT case_human_reviews_decision_type_check
    CHECK (decision_type IN ('APPROVE', 'CORRECT'))
);

COMMENT ON TABLE public.case_human_reviews IS
  'Dictamen humano sobre una auditoria concreta. NO sobrescribe el resultado de la IA: result_json permanece inmutable y la coincidencia se calcula.';

CREATE INDEX IF NOT EXISTS case_human_reviews_reviewed_at_idx
  ON public.case_human_reviews (reviewed_at DESC);

-- -----------------------------------------------------------------------------
-- 3. Proyección de métricas extendida
-- -----------------------------------------------------------------------------
--
-- Se RECREA la vista (no se modifica): `CREATE OR REPLACE VIEW` no puede cambiar
-- el orden de las columnas existentes sin romper a los consumidores, y esta
-- añade columnas nuevas. Las 24 originales conservan nombre, tipo y posición, y
-- las nuevas van al final. La verificación final lo comprueba.
--
-- Columnas nuevas:
--   - Las 6 dimensiones del caso, por el `LEFT JOIN` que ya existía.
--   - `human_outcome`, por un `LEFT JOIN` 1:1 sobre `case_human_reviews`
--     (`UNIQUE (audit_id)`), para que la coincidencia no requiera una segunda
--     consulta ni un N+1.
--
-- NO se trae `result_json` ni `provider_metadata` crudos: la vista aplana el
-- jsonb dentro del CTE y solo expone escalares, como ya hacía.

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
  hr.human_outcome AS human_result
FROM public.audits a
LEFT JOIN public.cases c ON c.id = a.case_id
LEFT JOIN att ON att.audit_id = a.id
LEFT JOIN public.case_human_reviews hr ON hr.audit_id = a.id;

COMMENT ON VIEW public.audit_dashboard_metrics IS
  'Proyeccion de solo lectura para el dashboard. Incluye student_identifier (dato personal) y el dictamen humano de case_human_reviews. NO contiene credenciales ni jsonb crudo.';

-- -----------------------------------------------------------------------------
-- 4. Permisos
-- -----------------------------------------------------------------------------
--
-- La vista sigue siendo de SOLO lectura y sigue sin ser alcanzable desde el
-- navegador: se revoca a `anon` y `authenticated` y se concede solo al rol
-- administrativo del servidor. Una vista no pasa por RLS, así que el permiso es
-- la única barrera real.
--
-- `case_human_reviews` se LEÍ y se ESCRIBE desde el servidor (el detalle del
-- caso), nunca desde el navegador. Por eso INSERT/UPDATE van al rol
-- administrativo y no a `authenticated`.

REVOKE ALL ON public.audit_dashboard_metrics FROM anon;
REVOKE ALL ON public.audit_dashboard_metrics FROM authenticated;
REVOKE ALL ON public.audit_dashboard_metrics FROM PUBLIC;
GRANT SELECT ON public.audit_dashboard_metrics TO project_admin;

REVOKE ALL ON public.case_human_reviews FROM anon;
REVOKE ALL ON public.case_human_reviews FROM authenticated;
REVOKE ALL ON public.case_human_reviews FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON public.case_human_reviews TO project_admin;

-- -----------------------------------------------------------------------------
-- 5. Verificación
-- -----------------------------------------------------------------------------
DO $verify$
DECLARE
  v_col   text;
  v_count int;
BEGIN
  -- 5.1 Las 6 dimensiones existen y son NULL-able. Si alguna fuera NOT NULL o
  --     tuviera valor por defecto, el dashboard tendría que inventar datos para
  --     poder leerla, que es justo lo que no se quiere.
  FOREACH v_col SLICE 1 IN ARRAY ARRAY[
    'country','campus','modality','project','responsible','guideline'
  ] LOOP
    SELECT count(*) INTO v_count
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='cases' AND column_name=v_col
      AND is_nullable='YES' AND data_type='text';

    IF v_count <> 1 THEN
      RAISE EXCEPTION 'cases.% debe existir como text NULL-able (encontradas: %)', v_col, v_count;
    END IF;
  END LOOP;

  -- 5.2 La tabla de revisión humana existe y apunta a `audits`, NO a
  --     `legacy_audits`. Ese es el error que motivó la tabla nueva.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='case_human_reviews'
  ) THEN
    RAISE EXCEPTION 'falta public.case_human_reviews';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.case_human_reviews'::regclass
      AND contype='f' AND confrelid='public.audits'::regclass
  ) THEN
    RAISE EXCEPTION 'case_human_reviews.audit_id no referencia public.audits';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.case_human_reviews'::regclass
      AND confrelid='public.legacy_audits'::regclass
  ) THEN
    RAISE EXCEPTION 'case_human_reviews no debe referenciar legacy_audits';
  END IF;

  -- Una revisión por auditoría: sin esto el LEFT JOIN de la vista podría
  -- multiplicar filas y cualquier agregado contaría de más.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.case_human_reviews'::regclass AND contype='u'
      AND conkey = ARRAY[
        (SELECT attnum FROM pg_attribute
         WHERE attrelid='public.case_human_reviews'::regclass AND attname='audit_id')
      ]::smallint[]
  ) THEN
    RAISE EXCEPTION 'case_human_reviews.audit_id debe ser UNIQUE (una revision por auditoria)';
  END IF;

  -- 5.3 La vista existe, es una vista, y expone las 31 columnas.
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

  IF v_count <> 31 THEN
    RAISE EXCEPTION 'la vista deberia exponer 31 columnas y expone %', v_count;
  END IF;

  -- 5.4 Permisos: la vista no puede ser alcanzable desde el navegador.
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

  -- 5.5 La revisión humana solo se escribe desde el servidor.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) g
    WHERE c.oid='public.case_human_reviews'::regclass
      AND g.grantee='project_admin'::regrole AND g.privilege_type='INSERT'
  ) THEN
    RAISE EXCEPTION 'project_admin debe poder INSERTar en case_human_reviews';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) g
    WHERE c.oid='public.case_human_reviews'::regclass
      AND g.grantee IN (
        (SELECT oid FROM pg_roles WHERE rolname='anon'),
        (SELECT oid FROM pg_roles WHERE rolname='authenticated')
      )
  ) THEN
    RAISE EXCEPTION 'case_human_reviews no debe ser accesible por anon/authenticated';
  END IF;

  RAISE NOTICE 'OK — dimensiones, case_human_reviews y vista de 31 columnas verificadas';
END
$verify$;
