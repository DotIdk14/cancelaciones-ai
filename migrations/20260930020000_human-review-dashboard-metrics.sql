-- =============================================================================
-- 20260930020000_human-review-dashboard-metrics.sql
--
-- OJO con el nombre: la CLI de InsForge rechaza el guion bajo en el nombre de
-- una migración (`<version>_<name>.sql` con guiones, minúsculas y dígitos), así
-- que el archivo real lleva guiones, como los dos anteriores
-- (`20260928010000_ai-native-production.sql` y
-- `20260929040000_audit-dashboard-metrics.sql`).
-- =============================================================================
-- DEPENDE DE: `migrations/20260930010000_human-resolution.sql` (el subagente
-- paralelo de la revisión humana), que crea las tablas `case_reviews` y
-- `case_comparisons`.
--
-- POR QUÉ ESTA MIGRACIÓN VA SEPARADA y no se añade a la de las tablas: esta sólo
-- PROYECTA filas que ya existen, y su vida útil es distinta de la de las tablas.
-- Si mañana se corrige el esquema de `case_reviews` y hay que volver a aplicar
-- su migración, esta vista se queda esperando a que las columnas cambien,
-- sin que el trabajo de la otra mitad del módulo se mezcla con el de esta. Las
-- dos se aplican en orden, y esta va después: por eso la sección 2 falla AQUÍ y
-- con un mensaje exacto si falta alguna tabla, en vez de emitir una vista vacía
-- que el dashboard no podría distinguir de "no hay revisiones".
--
-- VISTA de métricas de la revisión humana. NO es política ni reglas: es una
-- proyección de lectura sobre datos que YA existen.
--
-- QUÉ TOCA
--   + 1 vista (public.case_comparisons_dashboard_metrics)
--   + 1 índice sobre public.case_comparisons (created_at DESC)
--   ~ permisos de la vista
--   NO toca cases, evidence, audits, case_reviews ni case_comparisons. No borra
--   ni escribe filas.
--
-- REVERSIBLE
--   DROP VIEW public.case_comparisons_dashboard_metrics;
--   DROP INDEX public.case_comparisons_created_at_idx;
--
-- DIRECCIÓN
--   forward-only, SIN BEGIN/COMMIT, e idempotente (CREATE OR REPLACE VIEW,
--   CREATE INDEX IF NOT EXISTS, REVOKE y GRANT). Re-ejecutarlo es un no-op.
--
-- NO ES UNA SEGUNDA IMPLEMENTACIÓN DEL CRITERIO (NO_RULES_ENGINE)
--   Esta vista NO decide, NO clasifica y NO vuelve a emitir un veredicto.
--   `agrees` y `confidence` son valores que el MODELO escribió y que ya pasaron
--   por `ComparisonResultSchema` (src/skills/review/schema.ts). La vista sólo
--   los SACA del jsonb para poder contarlos; no los interpreta, no los corrige y
--   no los recalcula. La fuente de verdad del veredicto de la comparación sigue
--   siendo `case_comparisons.result_json`, y la resolución final del caso sigue
--   siendo la de la persona: `agrees` dice si el modelo discrepó, nunca
--   reemplaza la decisión.
--   Lo mismo con `audit_result`: se proyecta desde `audits.result_json` para que
--   el filtro `result` de la barra del dashboard aplique también a las
--   comparaciones, y no porque esta vista tenga algo que decir sobre el criterio.
--
-- SEMÁNTICA DE LAS COLUMNAS: NULL = NO HAY DATO, NUNCA CERO
--   `agrees` y `confidence` valen NULL cuando la comparación no terminó
--   (`status` RUNNING) o terminó en fallo (`status` ERROR, donde
--   `updateComparisonError` deja `result_json` en NULL), y también cuando el
--   jsonb no trae un valor legible. NULL significa "no se ha medido".
--
--   Esto NO es un detalle cosmético: es el contrato que hace que
--   `aggregateHumanReview` (src/server/dashboard.ts) pueda devolver
--   `agreementRate: null` en vez de `0`. Un 0 ahí afirmaría "hubo cero
--   coincidencias", y eso es FALSO cuando lo que pasa es que nadie comparó. Es
--   la misma regla que ya separa NULL de 0 en las columnas de coste de
--   `public.audit_dashboard_metrics`, y por eso aquí se repite en vez de
--   heredarse: si esta vista devolviera un 0, el agregador no tendría forma
--   real de distinguir "el modelo discrepó en todas" de "no se comparó nada".
--
--   Y `status`, `created_at`, `case_status` y `audit_result` NUNCA se rellenan
--   con un valor inventado para tapar un hueco. Un `case_status` o un
--   `audit_result` NULL sale de un LEFT JOIN que no encontró la fila, y eso se
--   propaga tal cual: es dato ausente.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- SECCIÓN 1 — La vista
--
-- `result_json` de una comparación es jsonb libre, escrito por el adaptador de
-- OpenRouter a partir de lo que devolvió el modelo: no lo gobierna un CHECK del
-- esquema. Por eso los casteos son DEFENSIVOS, exactamente como los de
-- `audit_dashboard_metrics`: se compara contra una expresión regular ANTES de
-- convertirse a número, y el ELSE es NULL.
--
-- Un solo valor raro (una confianza en notación exponencial, un `agrees` que
-- llegue como `"sí"`) no puede abortar la consulta de métricas. Sin esa guarda,
-- un dato raro tiraría abajo el bloque entero de calidad del dashboard, que es
-- PEOR que devolver "sin dato" en una celda.
--
-- `jsonb_typeof(...) = 'object'` no hace falta, y es deliberado: en PostgreSQL
-- `->>` sobre un NULL, sobre un escalar o sobre un array devuelve NULL (no
-- lanza), así que un `result_json` con otra forma produce `agrees` y `confidence`
-- en NULL sin que haya que guardarlo. Se comprueba con la comparación contra
-- 'true' / 'false' y con la expresión regular, no con el tipo del contenedor.
--
-- `TRIM` NO hace falta aquí a diferencia de `audits.model`: aquí no se agrupa por
-- texto de proveedor, se cuenta. El `status` sale tal cual de la columna.
--
-- EL JOIN A `audits` ES POR `cc.audit_id` Y NO POR `case_id`: la comparación se
-- hace contra UNA auditoría concreta (la que dictaminó cuando se registró la
-- revisión), y un caso puede tener varias. Unir por `case_id` traería el
-- dictamen de otra auditoría y el filtro `result` mediría una cosa que nadie
-- comparó.
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
  -- `agrees` es un booleano que el modelo puede afirmar o negar. Un
  -- `false` (discrepancia) es un DATO AFIRMADO y se proyecta como `false`; un
  -- NULL es "no se sabe", y la vista lo deja en NULL para que el agregador no lo
  -- cuente como desacuerdo. La comparación es contra la CADENA exacta que emite
  -- el adaptador (`true` / `false` en jsonb), no contra un cast: un cast de
  -- texto a booleano levantaría un error en cuanto apareciera otra forma.
  CASE
    WHEN cc.result_json ->> 'agrees' = 'true'  THEN true
    WHEN cc.result_json ->> 'agrees' = 'false' THEN false
    ELSE NULL
  END AS agrees,
  -- Misma regla que la sección 1 bis de la vista de métricas: si nadie
  -- reportó el número, la magnitud NO EXISTE y se devuelve NULL. Un 0 aquí
  -- afirmaría que el modelo tuvo confianza cero, que es otra cosa.
  CASE WHEN (cc.result_json #>> '{confidence}') ~ '^-?[0-9]+(\.[0-9]+)?$'
       THEN (cc.result_json #>> '{confidence}')::double precision
       ELSE NULL END AS confidence
FROM public.case_comparisons cc
LEFT JOIN public.case_reviews cr ON cr.id = cc.case_review_id
LEFT JOIN public.cases c ON c.id = cr.case_id
LEFT JOIN public.audits a ON a.id = cc.audit_id;

COMMENT ON VIEW public.case_comparisons_dashboard_metrics IS
  'Proyeccion de solo lectura de comparaciones para el dashboard. No expone el comentario humano ni la explicacion del modelo.';


-- -----------------------------------------------------------------------------
-- SECCIÓN 1.1 — El índice
--
-- El bloque humano del dashboard filtra por una ventana de fechas
-- (`created_at >= ... AND created_at <= ...`) igual que las otras dos fuentes, y
-- sin este índice el filtro se resuelve con un seq scan sobre `case_comparisons`.
--
-- `created_at DESC` por el mismo motivo que en `audit_dashboard_metrics`: el
-- orden de lectura es el inverso al de inserción, y un índice ASC no sirve para
-- un ORDER BY ... DESC sin reordenar.
--
-- NO ES ÚNICO ni PARCIAL a propósito: es un índice de lectura. Y NO se indexa
-- `result_json` (jsonb) por la misma razón que allí: un GIN multiplicaría el
-- coste de escritura de cada comparación para acelerar una consulta que esta
-- vista ya proyecta a escalares.
--
-- DELIBERADAMENTE NO SE INDEXA `case_reviews`: esa tabla es de otro subagente y
-- su migración puede traer sus propios índices. Duplicarlos aquí dejaría dos
-- índices idénticos con dos nombres distintos, que es desgaste de escritura sin
-- ganar nada. Si el conteo de revisiones acaba midiéndose mal, se indexa en SU
-- migración, no en una proyección que sólo lee.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS case_comparisons_created_at_idx
  ON public.case_comparisons (created_at DESC);


-- -----------------------------------------------------------------------------
-- SECCIÓN 1.2 — Privilegios: deny por defecto, igual que la vista de métricas
--
-- UNA VISTA NO PASA POR RLS. Se evalúa con los privilegios de quien la DEFINIÓ,
-- no de quien la consulta, así que un GRANT de SELECT a `authenticated`
-- publicaría TODAS las comparaciones a cualquier navegador con un JWT, por
-- encima de la RLS de `case_comparisons`. Y aquí el prize sería peor que en la
-- otra vista, porque estas filas están pegadas a la decisión de una persona
-- sobre un expediente con PII: aunque la vista no exponga `comment`, sí expone
-- `case_id`, y con él se llega al expediente entero por otra vía.
--
-- Por eso el único GRANT es a `project_admin`, el rol con BYPASSRLS que ya lee
-- esas tablas desde el servidor (`src/server/dashboard.ts`). El navegador nunca
-- habla con InsForge: pasa por `/api`.
-- -----------------------------------------------------------------------------
REVOKE ALL ON public.case_comparisons_dashboard_metrics FROM anon;
REVOKE ALL ON public.case_comparisons_dashboard_metrics FROM authenticated;
REVOKE ALL ON public.case_comparisons_dashboard_metrics FROM PUBLIC;
GRANT SELECT ON public.case_comparisons_dashboard_metrics TO project_admin;


-- =============================================================================
-- SECCIÓN 2 — Verificación posterior a la aplicación
--
-- No se dice "ya está" porque el runner lo dijo: se comprueba. Y el ORDEN de las
-- comprobaciones importa: primero que existan las TABLAS de las que esta vista
-- depende, porque sin ellas el CREATE de la sección 1 ya habría fallado y este
-- bloque documenta la dependencia en vez de dejar un error de sintaxis confuso.
--
-- Mismo criterio que en la vista de métricas para los privilegios: se lee
-- `pg_class.relacl` con `aclexplode()`, NO `information_schema.*_privileges`,
-- porque esas filtran por el rol actualmente habilitado del que consulta y un
-- runner que no es miembro de `anon` no vería las filas — la comprobación
-- passaría sobre un esquema que en realidad está abierto al anónimo.
-- =============================================================================
DO $verify$
DECLARE
  v_leaked text;
BEGIN
  -- 1) Las tablas de las que depende esta vista existen. Esta es la comprobación
  --    que hace explícita la dependencia de la migración de la revisión humana.
  IF to_regclass('public.case_reviews') IS NULL
     OR to_regclass('public.case_comparisons') IS NULL THEN
    RAISE EXCEPTION
      'HUMAN_REVIEW_DASHBOARD_INCOMPLETE: falta case_reviews o case_comparisons. Esta migracion depende de 20260930010000_human-resolution.sql y debe aplicarse DESPUES de ella.';
  END IF;

  -- 2) La vista existe, es una vista (no una tabla con el mismo nombre) y tiene
  --    EXACTAMENTE las columnas que este archivo describe. Se comparan NOMBRES,
  --    no sólo el número: una vista con las 9 columnas correctas más una de más
  --    sigue siendo otra vista, y una con 8 significa que el SELECT exterior se
  --    editó a medias. El conjunto de columnas es el contrato con
  --    `ComparisonMetricRow` (src/server/dashboard.ts).
  IF to_regclass('public.case_comparisons_dashboard_metrics') IS NULL THEN
    RAISE EXCEPTION
      'HUMAN_REVIEW_DASHBOARD_INCOMPLETE: no existe public.case_comparisons_dashboard_metrics';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'case_comparisons_dashboard_metrics'
      AND c.relkind = 'v'
  ) THEN
    RAISE EXCEPTION
      'HUMAN_REVIEW_DASHBOARD_INCOMPLETE: public.case_comparisons_dashboard_metrics existe pero no es una vista (relkind <> ''v''). No la sustituyas a ciegas.';
  END IF;

  WITH esperado(nombre) AS (
    VALUES
      ('id'), ('case_review_id'), ('case_id'), ('case_status'),
      ('audit_result'), ('status'), ('created_at'), ('agrees'),
      ('confidence')
  ), reales(col) AS (
    SELECT a.attname::text
    FROM pg_attribute a
    WHERE a.attrelid = 'public.case_comparisons_dashboard_metrics'::regclass
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
      'HUMAN_REVIEW_DASHBOARD_INCOMPLETE: la vista no tiene la forma que este archivo describe -- %. Si se editó a mano, vuelve a aplicar el CREATE OR REPLACE VIEW de la sección 1.',
      v_leaked;
  END IF;

  -- 3) Ni `anon` ni `authenticated` conservan ningún privilegio. Una vista no
  --    pasa por RLS, y estas filas están pegadas a la decisión humana sobre un
  --    expediente con PII: el riesgo de abrirla al navegador es mayor que en la
  --    vista de métricas.
  SELECT string_agg(r.rolname || ':' || acl.privilege_type, ', ' ORDER BY r.rolname, acl.privilege_type)
    INTO v_leaked
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
  JOIN pg_roles r ON r.oid = acl.grantee
  WHERE n.nspname = 'public'
    AND c.relname = 'case_comparisons_dashboard_metrics'
    AND r.rolname IN ('anon', 'authenticated');
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'HUMAN_REVIEW_DASHBOARD_INSECURE: anon o authenticated conservan privilegios sobre la vista de comparaciones: %.',
      v_leaked;
  END IF;

  -- 4) PUBLIC tampoco. grantee = 0 es PUBLIC en la representación de ACL de
  --    Postgres; el JOIN a pg_roles lo dejaría fuera, así que se mira
  --    explícitamente. Se excluye al propietario, que sí debe poder leer lo que
  --    él mismo define.
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
    WHERE n.nspname = 'public'
      AND c.relname = 'case_comparisons_dashboard_metrics'
      AND acl.grantee = 0
      AND acl.grantee <> c.relowner
  ) THEN
    RAISE EXCEPTION
      'HUMAN_REVIEW_DASHBOARD_INSECURE: PUBLIC conserva privilegios sobre la vista de comparaciones';
  END IF;

  -- 5) `project_admin` SÍ puede leerla, y sólo puede leerla. Sin este GRANT el
  --    bloque humano del dashboard recibe 42501 en cuanto se abre la vista de
  --    calidad, y el informe entero deja de servirse.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
    JOIN pg_roles r ON r.oid = acl.grantee
    WHERE n.nspname = 'public'
      AND c.relname = 'case_comparisons_dashboard_metrics'
      AND r.rolname = 'project_admin'
      AND acl.privilege_type = 'SELECT'
  ) THEN
    RAISE EXCEPTION
      'HUMAN_REVIEW_DASHBOARD_INCOMPLETE: project_admin no tiene SELECT sobre public.case_comparisons_dashboard_metrics; el bloque humano del dashboard fallaria con 42501';
  END IF;

  -- 6) El índice existe y está sobre `public.case_comparisons`. Se comprueba con
  --    pg_index y no sólo por el nombre: un índice con el nombre correcto sobre
  --    otra tabla cumpliría la comprobación por nombre y no ayudaría a ninguna
  --    consulta de esta vista.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indexrelid = to_regclass('public.case_comparisons_created_at_idx')
      AND i.indrelid = 'public.case_comparisons'::regclass
  ) THEN
    RAISE EXCEPTION
      'HUMAN_REVIEW_DASHBOARD_INCOMPLETE: falta el índice public.case_comparisons_created_at_idx sobre public.case_comparisons';
  END IF;

  -- 7) LA REGLA DEL `null`, comprobada sobre la vista y no en el código. Una
  --    comparación en curso (o fallida) tiene `result_json` sin veredicto, así
  --    que la vista DEBE devolver NULL en `agrees` y `confidence` para ella. Si
  --    algún día alguien "arregla" un dato raro poniendo un 0 o un false de
  --    reserva, esta comprobación lo detecta en la migración y no meses después
  --    en un dashboard que afirme que el modelo discrepó en todas las
  --    comparaciones en las que nunca hubo veredicto.
  IF EXISTS (
    SELECT 1
    FROM public.case_comparisons_dashboard_metrics
    WHERE status IN ('RUNNING', 'ERROR')
      AND (agrees IS NOT NULL OR confidence IS NOT NULL)
  ) THEN
    RAISE EXCEPTION
      'HUMAN_REVIEW_DASHBOARD_INSECURE: hay una comparacion RUNNING o ERROR con agrees o confidence informado. Esas filas no emitieron veredicto: un valor aqui convertiria "no se ha medido" en "el modelo discrepo", que es la mentira que esta vista existe para evitar.';
  END IF;
END
$verify$;
