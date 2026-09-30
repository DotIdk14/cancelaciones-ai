-- =============================================================================
-- 20260929040000_audit-dashboard-metrics.sql
--
-- OJO con el nombre: la CLI de InsForge rechaza el guion bajo en el nombre de
-- una migración (`<version>_<name>.sql` con guiones, minúsculas y dígitos), así
-- que el archivo real lleva guiones, como el anterior
-- `20260928010000_ai-native-production.sql`. Si algún día alguien renombra este
-- archivo, que renombre también esta línea.
-- =============================================================================
-- VISTA de métricas para el dashboard. NO es política ni reglas: es una
-- proyección de lectura sobre datos que YA existen.
--
-- POR QUÉ EXISTE
--   `audits.result_json` y `audits.provider_metadata` pesan decenas de KB por
--   fila. Calcular métricas trayéndolos enteros al servidor es inviable. Esta
--   vista expone SOLO escalares (resultado, confianza, faltantes, costo, tokens,
--   latencia, modelos, nº de intentos) y deja el agrupado en el servidor de la
--   aplicación.
--
-- QUÉ TOCA
--   + 1 vista (public.audit_dashboard_metrics)
--   + 1 índice sobre public.audits (created_at DESC)
--   ~ permisos de la vista
--   NO toca cases, evidence ni audits. No borra ni escribe filas.
--
-- REVERSIBLE
--   DROP VIEW public.audit_dashboard_metrics;
--   DROP INDEX public.audits_created_at_idx;
--
-- DIRECCIÓN
--   forward-only, SIN BEGIN/COMMIT, e idempotente (CREATE OR REPLACE VIEW,
--   CREATE INDEX IF NOT EXISTS, REVOKE y GRANT). Re-ejecutarlo es un no-op.
--
-- NO ES UNA SEGUNDA IMPLEMENTACIÓN DEL CRITERIO (NO_RULES_ENGINE)
--   Esta vista NO decide nada: no clasifica, no puntúa, no recalcula el
--   dictamen. Copia números que la aplicación ya escribió y ya validó con Zod
--   contra `AuditResultSchema` (src/skills/audit/schema.ts). El vocabulario de
--   resultados y de categorías de error sigue viviendo en TypeScript
--   (src/skills/audit/types.ts), y esta vista ni lo traduce ni lo amplía: si
--   mañana se añade un resultado, el dashboard lo verá como texto nuevo sin
--   tocar este archivo. La fuente de verdad del dictamen sigue siendo
--   `audits.result_json`; esto es una proyección de lectura, no una copia.
--
-- SEMÁNTICA DE LAS COLUMNAS DE COSTE Y TOKENS: NULL = NO REPORTADO
--   Todas las columnas de gasto de esta vista (`usage_*` y `attempts_*`) obeyen
--   la misma regla: NULL significa que el proveedor NO reportó ese valor, y un
--   número significa que lo reportó. Nunca se rellena el dato ausente con un 0,
--   porque un 0 en una columna de coste es una AFIRMACIÓN ("este proveedor cobró
--   exactamente nada"), y esa afirmación es falsa cuando lo que pasa es que no
--   lo sabemos. El consumidor (`COST_PER_ROW` en `src/server/dashboard.ts`)
--   resuelve el COALESCE por su cuenta, y puede distinguir "sin dato" de "gasto
--   cero" precisamente porque esta vista se lo permite. La sección 1 bis explica
--   el caso concreto que motivó la regla en las cuatro columnas de `attempts_*`.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- SECCIÓN 1 — La vista
--
-- El CTE `att` aplana `provider_metadata.openrouterAttempts` UNA vez por fila y
-- lo agrega, para que el SELECT exterior no tenga que recorrer el array por
-- columna. `jsonb_array_elements` en un LATERAL LEFT JOIN es lo que hace que
-- una auditoría sin `openrouterAttempts` (NULL, o `{}`) produzca una fila con
-- ceros en vez de desaparecer: es un LEFT JOIN, no un INNER, y por eso el
-- agrupado no pierde auditorías.
--
-- Los casteos son DEFENSIVOS y ése es el punto de este archivo: cada `->>` se
-- compara contra una expresión regular ANTES de convertirse a número, y el ELSE
-- es 0 (o NULL). `result_json` y `provider_metadata` son jsonb libre: los escribe
-- el adaptador de OpenRouter, no un CHECK del esquema, así que una fila vieja,
-- de otro proveedor o con un número en notación exponencial no puede abortar la
-- consulta de métricas. Sin ese `~ '^-?[0-9]+...'`, un solo valor raro tiraría
-- abajo TODO el dashboard, que es peor que mostrar un 0 en esa celda.
--
-- LA MISMA DEFENSA, PARA LA FORMA DEL ARRAY: los dos `jsonb_array_elements` del
-- CTE `att` (el `LEFT JOIN LATERAL` y el `ARRAY(SELECT DISTINCT ...)`) están
-- guardados con `jsonb_typeof(...) = 'array'`, y el `attempts_count` del SELECT
-- exterior protege su `jsonb_array_length` igual. `jsonb_array_elements` NO
-- acepta un objeto ni un escalar jsonb: lanza `cannot extract elements from a
-- scalar`. El `COALESCE(... , '[]'::jsonb)` solo cubre el NULL, no el caso
-- "hay clave pero su valor no es un array" (un `{}` de otra versión del
-- adaptador, un `true` de un flag, un objeto con el detalle por intento). Con la
-- guarda, esa fila cuenta 0 intentos y 0 coste en vez de tumbar el dashboard
-- entero. Es la misma política que el ELSE 0 de los casteos: antes un dato raro
-- rompe, ahora un dato raro se vuelve "no hay dato".
--
-- SECCIÓN 1 bis — POR QUÉ LAS CUATRO COLUMNAS DE `attempts_*` PUEDEN SER NULL
--
-- El `COALESCE(SUM(...), 0)` que cerraba las cuatro columnas tenía un defecto
-- que no era de robustez sino de VERDAD: producía 0 y nunca NULL, y hay dos
-- situaciones en las que ese 0 es una mentira.
--
--   1. `openrouterAttempts` ausente, vacío, o con otra forma. No se registró
--      ningún intento, así que no hay coste que sumar.
--   2. El array tiene entradas, pero NINGUNA trae el campo `cost`. El
--      proveedor no lo reportó, que es distinto de reportar 0.
--
-- Medido sobre los datos reales, `google/gemini-2.5-flash-lite` tenía 6
-- auditorías en `ERROR` sin `openrouterAttempts` en absoluto. La vista
-- devolvía `attempts_cost_usd = 0` en las 6, `COALESCE(usage_cost_usd,
-- attempts_cost_usd)` resolvía a 0, y la tabla "Costo por modelo" pintaba
-- `$0` para seis llamadas cuyo coste se desconoce. Antes de este cambio la UI
-- decía "Coste no reportado", que era lo correcto: un `$0` que afirma que el
-- proveedor cobró exactamente nada es peor que un hueco, porque es un dato
-- falso presentado como medido.
--
-- LA REGLA QUE QUEDA: NULL cuando NINGÚN intento reportó el valor, y el
-- número cuando al menos uno lo reportó. El total sigue siendo
-- `COALESCE(SUM(...), 0)` entre los intentos que sí lo reportaron, y eso es
-- correcto a propósito: un intento fallido sin `cost` aporta 0 al total porque
-- no se suma lo que no se sabe, no porque se afirme que costó nada. Es la misma
-- aritmética que ya usa `usage_cost_usd`, que siempre devolvió NULL sin dato.
--
-- `COUNT(*) FILTER (WHERE ...)` cuenta los intentos que APORTARON el valor,
-- con el MISMO predicado que el `ELSE` del `SUM`: si no hay ninguno, la
-- magnitud no existe y se devuelve NULL. `FILTER` sobre agregados es sintaxis
-- estándar de PostgreSQL desde la 9.4, así que no depende de la versión de la
-- plataforma.
--
-- EL TIPO DE LA COLUMNA NO CAMBIA: un `NULL` sin tipo no altera el resultado
-- del `CASE`, que sigue siendo el del `ELSE` (`double precision` para el
-- coste, y `numeric` para los tokens, que es lo que ya devolvía el `SUM()`
-- sobre `::bigint` sin envoltura). Por eso esto sigue siendo un
-- `CREATE OR REPLACE VIEW` y no necesita un DROP/CREATE, y por eso el
-- `DO $verify$` de la sección 2 sigue valiendo para las 24 columnas, su orden
-- y sus tipos.
--
-- `attempts_count` NO lleva esta envoltura, y es deliberado: cuántos intentos
-- hubo es siempre un hecho conocido, se sepa o no su coste. Un conteo
-- desconocido sería la ausencia de un dato que sí existe.
--
-- NOTA SOBRE `COST_PER_ROW` (src/server/dashboard.ts): su `COALESCE` sigue
-- resolviendo `(null, 0) -> 0`. Ese caso ya no lo emite esta vista, pero la
-- función lo conserva a propósito, porque no puede saber de dónde viene cada
-- columna, y un 0 de origen desconocido no debe colarse como gasto real. El
-- test que fija esa tripleta en tests/dashboard.test.ts documenta el contrato.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.audit_dashboard_metrics AS
WITH att AS (
  SELECT
    a.id AS audit_id,
    -- Las cuatro magnitudes de abajo se escriben IGUAL a propósito: comparten
    -- el mismo contrato ("NULL = nadie lo reportó") y el mismo predicado de
    -- casteo. Si divergieran entre sí, un `attempts_total_tokens` en 0 junto a
    -- un `attempts_cost_usd` en NULL sería la señal de que una se editó a medias.
    --
    -- El orden de las partes es siempre el mismo: ¿algún intento trajo el
    -- valor? Si NO, NULL (el dato no existe). Si SÍ, la suma de los que lo
    -- trajeron, con 0 de aportación para el resto. El `COALESCE(..., 0)`
    -- interior sobrevive porque el `GROUP BY a.id` siempre produce exactamente
    -- una fila por auditoría: sin él, un `SUM` sobre cero filas daría NULL
    -- dentro de la rama del ELSE y la columna seguiría siendo NULL cuando SÍ
    -- hay un valor reportado.
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
  -- `TRIM(a.model)` y no `a.model`: `audits.model` es texto libre que escribe el
  -- adaptador de OpenRouter, y un espacio accidental al final (medido en datos
  -- reales: el literal `"google/gemini-2.5-flash "`) partía el MISMO modelo en
  -- dos filas del informe de coste, una de ellas con 0 llamadas y "coste no
  -- reportado". El identificador del proveedor no lleva espacios, así que
  -- recortar es higiene de CLAVE DE AGRUPACIÓN de un informe de gasto, no una
  -- reclasificación de un dictamen: no toca el vocabulario del Skill
  -- (NO_RULES_ENGINE) ni reescribe `result`. `TRIM(text)` devuelve `text`, el
  -- mismo tipo, así que `CREATE OR REPLACE VIEW` no altera la columna ni el
  -- orden ni el nombre de ninguna de las 24.
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
  -- distinguía "un reintento contra el mismo modelo" de "una sola llamada".
  -- Este contador es el que permite reportar reintentos del proveedor, que es
  -- justo lo que el dashboard de IA & Costos tiene que enseñar. Va con la misma
  -- guarda que el resto: si `openrouterAttempts` no es un array, 0 intentos.
  -- Y NO lleva la envoltura NULL de la sección 1 bis: un número de intentos es
  -- siempre un hecho conocido, se sepa o no su coste.
  CASE WHEN jsonb_typeof(COALESCE(a.provider_metadata -> 'openrouterAttempts', '[]'::jsonb)) = 'array'
       THEN jsonb_array_length(COALESCE(a.provider_metadata -> 'openrouterAttempts', '[]'::jsonb))
       ELSE 0 END AS attempts_count
FROM public.audits a
LEFT JOIN public.cases c ON c.id = a.case_id
LEFT JOIN att ON att.audit_id = a.id;

COMMENT ON VIEW public.audit_dashboard_metrics IS
  'Proyeccion de solo lectura para el dashboard. No contiene datos sensibles ni credenciales.';


-- -----------------------------------------------------------------------------
-- SECCIÓN 1.1 — El índice, y por qué `audits`
--
-- El dashboard siempre filtra por una ventana de fechas (`created_at >= now() -
-- interval '90 days'`), y sin este índice el filtro se resuelve con un
-- seq scan sobre `audits` arrastrando los dos jsonb. Es el único índice nuevo:
-- no se indexa `result_json` ni `provider_metadata` porque son jsonb, y un
-- índice GIN sobre ellos multiplicaría el coste de escritura de cada auditoría
-- para acelerar una consulta que esta vista ya proyecta a escalares.
--
-- `created_at DESC` y no `created_at` a secas: el orden de lectura del
-- dashboard es el inverso al de inserción, y un índice ASC no sirve para un
-- ORDER BY ... DESC sin reordenar.
--
-- NO ES ÚNICO ni PARCIAL a propósito. Es un índice de lectura.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS audits_created_at_idx
  ON public.audits (created_at DESC);


-- -----------------------------------------------------------------------------
-- SECCIÓN 1.2 — Privilegios: deny por defecto, igual que las tablas del producto
--
-- UNA VISTA NO PASA POR RLS. Es la diferencia decisiva con una tabla: la RLS
-- filtra filas según QUIÉN pregunta, y una vista se evalúa con los privilegios
-- de quien la DEFINIÓ, no de quien la consulta. O sea que un GRANT de SELECT a
-- `authenticated` sobre esta vista publicaría TODO `result_json` a cualquier
-- navegador con un JWT, saltándose por completo el
-- `audits_select_for_visible_cases`. Por eso el único GRANT es a
-- `project_admin`, el rol con BYPASSRLS que ya lee `audits` desde el servidor
-- (`src/server/audit-service.ts`). El navegador nunca habla con InsForge: pasa
-- por `/api`.
--
-- El orden es el mismo de la sección 4 del baseline: REVOKE primero (punto de
-- partida que no depende de los privilegios por defecto de la plataforma), GRANT
-- después de exactamente un privilegio, y la última palabra sobre el anónimo la
-- tiene siempre el REVOKE.
-- -----------------------------------------------------------------------------
REVOKE ALL ON public.audit_dashboard_metrics FROM anon;
REVOKE ALL ON public.audit_dashboard_metrics FROM authenticated;
REVOKE ALL ON public.audit_dashboard_metrics FROM PUBLIC;
GRANT SELECT ON public.audit_dashboard_metrics TO project_admin;


-- =============================================================================
-- SECCIÓN 2 — Verificación posterior a la aplicación
--
-- No se dice "ya está" porque el runner lo dijo: se comprueba. Si algo no
-- cuadra, la migración falla AQUÍ, y no en un informe tres fases después, con
-- una excepción que dice exactamente qué no cuadra.
--
-- Los privilege checks leen `pg_class.relacl` con `aclexplode()`, NO las vistas
-- `information_schema.*_privileges`: esas filtran por el rol actualmente
-- habilitado del que consulta, y un runner que no es miembro de `anon` no vería
-- las filas y la comprobación fallaría sobre un esquema correcto. El catálogo no
-- filtra nada.
--
-- `COALESCE(relacl, acldefault('r', relowner))` es seguro PARA UNA VISTA
-- porque la sección 1.2 acaba de REVOCAR de PUBLIC: ese REVOKE materializa
-- `relacl` y lo deja explícito. Sin él, `relacl` sería NULL y el COALESCE
-- devolvería el default de tabla, que no incluye a PUBLIC — o sea, la
-- comprobación passaría sobre una vista abierta al anónimo.
-- =============================================================================
DO $verify$
DECLARE
  v_leaked text;
BEGIN
  -- 1) La vista existe, es una vista (no una tabla con el mismo nombre) y tiene
  --    EXACTAMENTE las columnas de este archivo. Se comprueba el conjunto de
  --    nombres, no sólo el número: una vista con las 24 columnas correctas más
  --    una de más sigue siendo una vista distinta, y una con 23 columnas
  --    significa que el SELECT exterior se editó a medias.
  --
  --    Se cuenta con pg_attribute y no con information_schema.columns por
  --    simetría con el resto de la comprobación: el catálogo no filtra por rol.
  IF to_regclass('public.audit_dashboard_metrics') IS NULL THEN
    RAISE EXCEPTION
      'AUDIT_DASHBOARD_METRICS_INCOMPLETE: no existe public.audit_dashboard_metrics. Esta migración debe aplicarse sobre el esquema AI-NATIVE (cases, evidence y audits ya existentes).';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'audit_dashboard_metrics'
      AND c.relkind = 'v'
  ) THEN
    RAISE EXCEPTION
      'AUDIT_DASHBOARD_METRICS_INCOMPLETE: public.audit_dashboard_metrics existe pero no es una vista (relkind <> ''v''). No la sustituyas a ciegas: revisa qué objeto hay con ese nombre.';
  END IF;

  WITH esperado(nombre) AS (
    VALUES
      ('id'), ('case_id'), ('case_status'), ('student_identifier'),
      ('audit_status'), ('model'), ('provider'), ('latency_ms'),
      ('error_category'), ('attempt_number'), ('created_at'), ('result'),
      ('confidence'), ('missing_evidence_count'), ('usage_cost_usd'),
      ('usage_total_tokens'), ('usage_prompt_tokens'),
      ('usage_completion_tokens'), ('provider_models'),
      ('attempts_cost_usd'), ('attempts_total_tokens'),
      ('attempts_prompt_tokens'), ('attempts_completion_tokens'),
      ('attempts_count')
  ), reales(col) AS (
    SELECT a.attname::text
    FROM pg_attribute a
    WHERE a.attrelid = 'public.audit_dashboard_metrics'::regclass
      AND a.attnum > 0
      AND NOT a.attisdropped
  )
  SELECT string_agg(d.motivo || ' ' || d.col, '; ' ORDER BY d.motivo, d.col)
    INTO v_leaked
  FROM (
    SELECT 'le falta la columna' AS motivo, e.nombre AS col
      FROM esperado e
     WHERE NOT EXISTS (SELECT 1 FROM reales r WHERE r.col = e.nombre)
    UNION ALL
    SELECT 'sobra la columna' AS motivo, r.col
      FROM reales r
     WHERE NOT EXISTS (SELECT 1 FROM esperado e WHERE e.nombre = r.col)
  ) AS d;
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'AUDIT_DASHBOARD_METRICS_INCOMPLETE: public.audit_dashboard_metrics no tiene la forma que este archivo describe -- %. Si la vista se editó a mano, vuelve a aplicar el CREATE OR REPLACE VIEW de la sección 1.',
      v_leaked;
  END IF;

  -- 2) Ni `anon` ni `authenticated` conservan ningún privilegio sobre la vista.
  --    Se comprueban los dos porque los dos tienen un motivo real: `anon` es el
  --    anónimo de la plataforma, y `authenticated` es peor, porque una vista no
  --    pasa por RLS y un SELECT suyo publicaría todos los dictámenes a cualquier
  --    navegador con un JWT, por encima de audits_select_for_visible_cases.
  SELECT string_agg(r.rolname || ':' || acl.privilege_type, ', ' ORDER BY r.rolname, acl.privilege_type)
    INTO v_leaked
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
  JOIN pg_roles r ON r.oid = acl.grantee
  WHERE n.nspname = 'public'
    AND c.relname = 'audit_dashboard_metrics'
    AND r.rolname IN ('anon', 'authenticated');
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'AUDIT_DASHBOARD_METRICS_INSECURE: anon o authenticated conservan privilegios sobre la vista de métricas: %. Una vista no pasa por RLS: concedérsela publicaría todos los dictámenes.',
      v_leaked;
  END IF;

  -- 3) PUBLIC tampoco. grantee = 0 es PUBLIC en la representación de ACL de
  --    Postgres; el JOIN a pg_roles lo dejaría fuera, así que se mira
  --    explícitamente. Se excluye al propietario (c.relowner), que sí debe
  --    poder leer lo que él mismo define.
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
    WHERE n.nspname = 'public'
      AND c.relname = 'audit_dashboard_metrics'
      AND acl.grantee = 0
      AND acl.grantee <> c.relowner
  ) THEN
    RAISE EXCEPTION
      'AUDIT_DASHBOARD_METRICS_INSECURE: PUBLIC conserva privilegios sobre la vista de métricas';
  END IF;

  -- 4) `project_admin` SÍ puede leerla, y sólo puede leerla. Sin este GRANT el
  --    dashboard recibe 42501 en cuanto el primer usuario lo abre, y ese fallo
  --    no tiene nada que ver con la RLS ni con la vista: por eso se comprueba
  --    aquí y no se espera a verlo en producción.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
    JOIN pg_roles r ON r.oid = acl.grantee
    WHERE n.nspname = 'public'
      AND c.relname = 'audit_dashboard_metrics'
      AND r.rolname = 'project_admin'
      AND acl.privilege_type = 'SELECT'
  ) THEN
    RAISE EXCEPTION
      'AUDIT_DASHBOARD_METRICS_INCOMPLETE: project_admin no tiene SELECT sobre public.audit_dashboard_metrics; cualquier lectura del dashboard fallaría con 42501';
  END IF;

  -- 5) El índice existe y está sobre `public.audits`. Se comprueba con
  --    pg_index y no sólo por el nombre: un índice con el nombre correcto
  --    sobre otra tabla cumpliría la comprobación por nombre y no ayudaría a
  --    ninguna de las consultas del dashboard.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indexrelid = to_regclass('public.audits_created_at_idx')
      AND i.indrelid = 'public.audits'::regclass
  ) THEN
    RAISE EXCEPTION
      'AUDIT_DASHBOARD_METRICS_INCOMPLETE: falta el índice public.audits_created_at_idx sobre public.audits';
  END IF;
END
$verify$;
