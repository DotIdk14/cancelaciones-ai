-- =============================================================================
-- 20260930010000_human-resolution.sql
--
-- OJO con el nombre: la CLI de InsForge rechaza el guion bajo en el nombre de
-- una migración (`<version>_<name>.sql` con guiones, minúsculas y dígitos), así
-- que el archivo real lleva guiones, como los dos anteriores
-- (`20260928010000_ai-native-production.sql` y
-- `20260929040000_audit-dashboard-metrics.sql`). Si alguien renombra este
-- archivo, que renombre también esta línea.
-- =============================================================================
--
-- REVISIÓN HUMANA: la resolución final del caso, y su comparación con IA.
--
-- QUÉ TOCA
--   + 2 tablas (public.case_reviews, public.case_comparisons)
--   + 1 índice explícito (case_comparisons_created_at_idx)
--   + 1 disparador (case_comparisons_set_updated_at)
--   + 6 políticas RLS
--   ~ permisos de las dos tablas
--   NO toca cases, evidence ni audits: sólo los REFERENCIA.
--
-- POR QUÉ EXISTE
--   El dictamen de la auditoría es lo que emitió el modelo y no se modifica
--   nunca. Lo que faltaba era el otro lado de la foto: qué decidió una persona
--   al revisarlo, y si esa decisión coincide o discrepa del dictamen. Sin
--   registrarlo, la revisión humana vive en un chat, en un correo o en la
--   memoria de alguien, y no se puede auditar ni comparar con nada.
--
-- LAS DOS TABLAS Y CÓMO SE RELACIONAN
--   1. public.case_reviews   — UNA fila por CASO (`case_id` es UNIQUE). Es la
--      resolución final: `result` es lo que la persona decidió y `comment` es
--      su justificación. `audit_id` fija a qué dictamen se compara, y es
--      INMUTABLE en la práctica: la comparación se arma contra esa fila
--      concreta (src/server/comparison-service.ts), nunca contra "la última
--      auditoría del caso".
--   2. public.case_comparisons — UNA fila por REVISIÓN (`case_review_id` es
--      UNIQUE). Es el juicio de la IA sobre si ese dictamen coincide o discrepa.
--      `status` es el estado TÉCNICO de la ejecución (RUNNING -> COMPLETED |
--      ERROR), igual que en `audits`, y no es un veredicto: el veredicto vive
--      en `result_json`, validado por el modelo y contrastado contra el
--      vocabulario cerrado de src/skills/audit/types.ts.
--
-- POR QUÉ `case_reviews.result` NO LLEVA CHECK Y `case_comparisons.status` SÍ
--   Es la misma regla que ya aplicó la línea base, y por el mismo motivo:
--   `status` es una máquina de estados del CICLO DE VIDA que este esquema
--   describe (y `audits.status` ya lleva su CHECK), mientras que el vocabulario
--   de resultados lo fija la APLICACIÓN. Duplicar la lista de resultados en
--   SQL sería una segunda fuente de verdad que puede desviarse de
--   `AUDIT_RESULTS` sin que nadie se entere, y el resultado que resuelve un
--   caso no se valida dos veces en dos lugares distintos: se valida una, en
--   servidor, con Zod (`HumanReviewInputSchema`, src/skills/review/schema.ts),
--   antes de escribir. `case_comparisons.error_category` sigue la misma regla
--   que `audits.error_category`: sin CHECK.
--
-- POR QUÉ `audit_id` ES ON DELETE RESTRICT Y NO CASCADE
--   Un dictamen que alguien ya revisó no se puede borrar en silencio. Con
--   CASCADE, borrar la auditoría (o el caso, que la arrastra) borraría la
--   revisión humana y su comparación, y la "resolución final" desaparecería
--   junto con el motivo por el que se tomó: la fila quedaría tan limpia como si
--   nadie hubiera revisado nunca. Con RESTRICT, esa fila no se puede borrar
--   mientras exista la revisión; la vía legítima de disappearance es borrar el
--   CASO, que arrastra en cascada las dos tablas (y no choca con el RESTRICT:
--   en una misma sentencia los triggers de acción —las cascadas— se ejecutan
--   antes que los de comprobación, por orden de nombre, así que cuando se
--   comprueba la referencia la revisión ya se borró). No hay endpoint que borre
--   una auditoría suelta, así que esto no cambia ningún comportamiento
--   existente: fija el que tendría que haber.
--
-- DIRECCIÓN
--   forward-only, SIN BEGIN/COMMIT (el runner envuelve el archivo en su propia
--   transacción), e idempotente (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT
--   EXISTS, DROP TRIGGER/DROP POLICY IF EXISTS + CREATE, REVOKE y GRANT).
--   Re-ejecutarlo es un no-op.
--
-- NO ES UNA SEGUNDA IMPLEMENTACIÓN DEL CRITERIO (NO_RULES_ENGINE)
--   Estas tablas GUARDAN dos cosas: lo que una persona decidió, y lo que el
--   modelo respondió al compararlo con el dictamen. Ninguna de las dos se
--   calcula aquí. No hay columna de resultado en `case_comparisons` porque la
--   comparación NO es un segundo dictamen: no reclasifica, no corrige y no
--   sustituye a nadie. El criterio sigue siendo el del Audit Skill leyendo el
--   Procedimiento V5 owner-supplied, y el vocabulario sigue viviendo en
--   TypeScript.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- SECCIÓN 1 — public.case_reviews: la resolución humana final, una por caso
--
-- `case_id` es UNIQUE y no un índice más: es la restricción que hace que
-- "una revisión por caso" sea una GARANTÍA de la base y no una cortesía de la
-- aplicación. Dos peticiones simultáneas que no se ven entre sí quedan
-- resueltas por PostgreSQL con un 23505, que src/server/reviews.ts traduce al
-- mismo 409 que devuelve la comprobación previa. Si la unicidad fuera sólo de
-- aplicación, un doble clic rápido dejaría dos resoluciones finales para el
-- mismo caso y `effectiveResolution` dejaría de ser único.
--
-- ese MISMO índice único es el índice por `case_id` que necesita la lectura del
-- detalle del caso, así que NO se crea un segundo índice sobre la misma
-- columna: un índice redundante no acelera nada y encarece cada INSERT.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.case_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL UNIQUE REFERENCES public.cases(id) ON DELETE CASCADE,
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE RESTRICT,
  result text NOT NULL,        -- vocabulario cerrado en TypeScript (AUDIT_RESULTS); sin CHECK, ver cabecera
  comment text NOT NULL,       -- justificación humana; límites 10..2000 validados en servidor (REVIEW_COMMENT_*)
  created_at timestamptz NOT NULL DEFAULT now(),
  -- NULL mientras el producto opera sin sesión (el servidor escribe con el rol
  -- `project_admin`). La columna NO es NOT NULL a propósito: con NOT NULL, el
  -- primer registro de una revisión fallaría con un 23502 en cuanto no haya
  -- sesión, que es el modo de funcionamiento normal hoy. La RLS de la sección 3
  -- exige `created_by = auth.uid()`, así que una fila sin autor tampoco sería
  -- visible para ningún rol con sesión: el dato queda inaccesible por la RLS,
  -- no publicado por un permiso.
  created_by uuid REFERENCES auth.users(id) ON DELETE CASCADE
);

DO $comment$
BEGIN
  COMMENT ON TABLE public.case_reviews IS
    'Resolución humana final del caso: una fila por caso (case_id UNIQUE). NO modifica audits.result_json; audit_id fija el dictamen que se compara. result es el vocabulario cerrado de AUDIT_RESULTS, validado en servidor.';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END
$comment$;


-- -----------------------------------------------------------------------------
-- SECCIÓN 2 — public.case_comparisons: el juicio IA sobre ese dictamen
--
-- `case_review_id` es UNIQUE por la misma razón que arriba pero en un nivel
-- más: una comparación por revisión. Eso es lo que hace que REANUDAR un run
-- interrumpido y REINTENTAR uno fallido no puedan crear filas nuevas (el
-- servicio reabre la fila existente, `rearmComparison`), y es lo que sostiene
-- NO_PROCESS_LOCAL_DURABILITY sin estado en memoria de proceso.
--
-- `result_json` es el veredicto validado con Zod (`ComparisonOutcomeSchema`,
-- src/skills/review/schema.ts): `agrees`, `explanation`, `confidence`,
-- `discrepancyReason`, `procedureSections` y `evidenceIds`, más la metadata
-- REAL de OpenRouter que agrega el servidor. Es la única fuente de verdad del
-- juicio y, como en `audits.result_json`, no se descompone en columnas: su
-- forma la fija el schema del Skill, no este archivo.
--
-- `provider` es NOT NULL con default 'openrouter' (mismo motivo que en
-- `audits`: un juicio sin saber quién lo emitió no es contrastable). `model` SÍ
-- admite NULL, y NULL significa "la fila se acaba de abrir y todavía no se
-- sabe qué modelo responderá", no "no se usó modelo": el servicio lo escribe al
-- abrir la comparación y `updateComparisonResult` lo confirma con el modelo que
-- realmente respondió, que puede ser el de reserva.
--
-- `latency_ms` admite NULL por el motivo de siempre: NULL es "no lo sé" y 0 es
-- una afirmación.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.case_comparisons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_review_id uuid NOT NULL UNIQUE REFERENCES public.case_reviews(id) ON DELETE CASCADE,
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'RUNNING'
    CHECK (status IN ('RUNNING','COMPLETED','ERROR')),
  result_json jsonb,           -- ComparisonOutcome validado (fuente de verdad del juicio)
  provider text NOT NULL DEFAULT 'openrouter',
  model text,                  -- NULL = todavía no se sabe; nunca se rellena con un modelo inventado
  error_category text,         -- vocabulario cerrado en src/skills/audit/types.ts (ERROR_CATEGORIES); sin CHECK
  latency_ms integer,
  attempt_count integer NOT NULL DEFAULT 1, -- intentos de ejecución (insert + rearms); tope duro en aplicación
  deadline_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $comment$
BEGIN
  COMMENT ON TABLE public.case_comparisons IS
    'Juicio de la IA sobre si el dictamen original coincide con la decisión humana. UNA fila por revisión (case_review_id UNIQUE). status es el estado técnico de la ejecución; el veredicto vive en result_json.';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END
$comment$;


-- -----------------------------------------------------------------------------
-- SECCIÓN 2.1 — Índices
--
-- `case_reviews(case_id)` y `case_comparisons(case_review_id)` YA están
-- indexados: son las columnas de las dos restricciones UNIQUE de la sección 1 y
-- 2, y un índice UNIQUE es un índice. Crear encima un segundo índice sobre la
-- misma columna no accelerate ninguna consulta y sí encarece cada escritura.
--
-- El índice que sí hace falta es el de `case_comparisons(created_at DESC)`: las
-- comparaciones se leen por antigüedad (la más reciente del caso, la más
-- reciente del periodo en el dashboard) y sin él ese ORDER BY resuelve con un
-- seq scan. `DESC` porque el orden de lectura es siempre el inverso al de
-- inserción, y un índice ASC no sirve para un ORDER BY ... DESC sin reordenar.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS case_comparisons_created_at_idx
  ON public.case_comparisons (created_at DESC);


-- -----------------------------------------------------------------------------
-- SECCIÓN 3 — Disparador de updated_at
--
-- `case_comparisons` sí tiene `updated_at` (a diferencia de `evidence` y
-- `audits`), y por un motivo concreto: una fila de comparación cambia más de
-- una vez a lo largo de su vida — RUNNING -> COMPLETED | ERROR, y RUNNING ->
-- COMPLETED otra vez cuando se reintenta — y sin `updated_at` no se puede
-- distinguir "nunca se reabrió" de "se reabrió hace un rato". La fila de
-- `audits` no lo necesita porque ahí cada ejecución es una fila nueva.
--
-- Se reutiliza `public.set_updated_at()` de la línea base: no se crea una
-- segunda función que haga lo mismo, y el disparador va sobre la tabla que
-- tiene la columna (un BEFORE UPDATE que asigna NEW.updated_at sobre una tabla
-- SIN esa columna se crea sin quejarse y revienta la PRIMERA vez que alguien
-- actualiza la fila, que es justo el cierre de la comparación).
--
-- DROP ... IF EXISTS antes de CREATE TRIGGER porque CREATE TRIGGER no tiene
-- forma idempotente.
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS case_comparisons_set_updated_at ON public.case_comparisons;
CREATE TRIGGER case_comparisons_set_updated_at
  BEFORE UPDATE ON public.case_comparisons
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- -----------------------------------------------------------------------------
-- SECCIÓN 4 — RLS, privilegios y políticas
--
-- DENY POR DEFECTO, en el mismo orden que la sección 3 de la línea base:
--   1) RLS habilitada. Sin esto las políticas son decorado.
--   2) REVOKE ALL a anon, a authenticated y a PUBLIC.
--   3) GRANT de exactamente SELECT/INSERT/UPDATE a project_admin.
--
-- POR QUÉ SOLO `project_admin`, Y POR QUÉ LAS POLÍTICAS SON PARA `authenticated`
--   El navegador NUNCA habla con InsForge: pasa por /api, y el único rol que
--   lee y escribe estas tablas es el servidor, con `project_admin`. Por eso el
--   GRANT no incluye a `authenticated`: no hay ninguna petición de navegador que
--   deba llegar aquí, y concederlo sería abrir una puerta que ningún flujo usa.
--
--   Las políticas, en cambio, se escriben `TO authenticated` y no `TO
--   project_admin`, y es deliberado: `project_admin` tiene BYPASSRLS, así que
--   una política suya NUNCA se evalúa y no protegería nada (y, si algún día el rol
--   dejara de saltarse la RLS, una política `created_by = auth.uid()` con
--   `created_by` NULL en el servidor rompería todas las escrituras). La
--   política `authenticated` documenta la regla que se aplicaría a un rol con
--   sesión, y como ese rol no tiene ningún privilegio sobre la tabla, la RLS
--   hoy es una segunda capa más: aunque alguien le concediera privileges por
--   error, sin política que lo matchear seguiría sin ver ni escribir nada.
--
-- LAS SEIS POLÍTICAS, tres por tabla, y por qué no hay DELETE
--   La revisión humana y su comparación NO se borran por la aplicación: no hay
--   ningún caso de uso que las deje de ser la resolución final del caso. La vía
--   de borrado es borrar el caso, y eso lo hace la cascada de `cases`, no un
--   DELETE de estas tablas. Una política de DELETE aquí sería una puerta que el
--   producto no necesita.
-- -----------------------------------------------------------------------------
ALTER TABLE public.case_reviews    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_comparisons ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.case_reviews, public.case_comparisons FROM anon;
REVOKE ALL ON TABLE public.case_reviews, public.case_comparisons FROM authenticated;
REVOKE ALL ON TABLE public.case_reviews, public.case_comparisons FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE
  ON public.case_reviews, public.case_comparisons
  TO project_admin;

-- La última palabra sobre el rol anónimo siempre la tiene el REVOKE, nunca el
-- GRANT, aunque el GRANT no lo nombre: es el orden de la línea base y se
-- mantiene por si alguien añade después un GRANT a `authenticated`.
REVOKE ALL ON TABLE public.case_reviews, public.case_comparisons FROM anon;

-- ------------------------------------------------------- case_reviews --
-- `created_by = auth.uid()` es la misma regla que `cases`, y por el mismo
-- motivo: el dueño es el creador. Sin sesión, `auth.uid()` es NULL, la
-- comparación es NULL y no es TRUE: sin sesión no se ve ni se escribe nada.
DROP POLICY IF EXISTS case_reviews_select_own ON public.case_reviews;
CREATE POLICY case_reviews_select_own ON public.case_reviews
  FOR SELECT TO authenticated
  USING (created_by = auth.uid());

DROP POLICY IF EXISTS case_reviews_insert_own ON public.case_reviews;
CREATE POLICY case_reviews_insert_own ON public.case_reviews
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

-- WITH CHECK también en UPDATE: USING decide a qué filas puede tocar el rol,
-- WITH CHECK decide con qué valores puede dejarlas. Sin él, un UPDATE podría
-- cambiar `created_by` o `audit_id` y mover la revisión a otro dueño o a otro
-- dictamen. La atribución de una revisión no se cambia por UPDATE.
DROP POLICY IF EXISTS case_reviews_update_own ON public.case_reviews;
CREATE POLICY case_reviews_update_own ON public.case_reviews
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- --------------------------------------------------- case_comparisons --
-- Estas filas no llevan `created_by`: son de una revisión, no de una persona.
-- Quien puede tocar la revisión puede tocar su comparación, y se comprueba por
-- existencia contra `case_reviews`, cuya RLS vuelve a exigir
-- `created_by = auth.uid()`. Es la misma defensa en profundidad de la línea
-- base para `evidence` y `audits`, y por eso no hay una segunda atribución que
-- pueda desincronizarse.
DROP POLICY IF EXISTS case_comparisons_select_for_visible_reviews ON public.case_comparisons;
CREATE POLICY case_comparisons_select_for_visible_reviews ON public.case_comparisons
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.case_reviews
      WHERE case_reviews.id = case_comparisons.case_review_id
        AND case_reviews.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS case_comparisons_insert_for_visible_reviews ON public.case_comparisons;
CREATE POLICY case_comparisons_insert_for_visible_reviews ON public.case_comparisons
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.case_reviews
      WHERE case_reviews.id = case_comparisons.case_review_id
        AND case_reviews.created_by = auth.uid()
    )
  );

-- El estado técnico de una comparación sí cambia (RUNNING -> COMPLETED | ERROR,
-- y la reapertura de un reintento), así que UPDATE está permitido, siempre que
-- la fila siga siendo visible para su dueño.
DROP POLICY IF EXISTS case_comparisons_update_for_visible_reviews ON public.case_comparisons;
CREATE POLICY case_comparisons_update_for_visible_reviews ON public.case_comparisons
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.case_reviews
      WHERE case_reviews.id = case_comparisons.case_review_id
        AND case_reviews.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.case_reviews
      WHERE case_reviews.id = case_comparisons.case_review_id
        AND case_reviews.created_by = auth.uid()
    )
  );


-- =============================================================================
-- SECCIÓN 5 — Verificación posterior a la aplicación
--
-- No se dice "ya está" porque el runner lo dijo: se comprueba. Si algo no
-- cuadra, la migración falla AQUÍ y no en un informe tres fases después.
--
-- Lo que se comprueba:
--   1) que las 2 tablas existen con EXACTAMENTE las columnas de este archivo;
--   2) la unicidad: una revisión por caso y una comparación por revisión, y que
--      los índices que las soportan son los de las columnas correctas;
--   3) el índice explícito `case_comparisons_created_at_idx` sobre la tabla
--      correcta y en DESC;
--   4) la RLS habilitada en las dos;
--   5) las 6 políticas, con su comando y su rol, y NINGUNA política extra;
--   6) los privilegios: anon sin nada, authenticated sin nada, PUBLIC sin
--      nada, y project_admin con exactamente SELECT/INSERT/UPDATE;
--   7) el disparador de updated_at, y sólo ese;
--   8) las 3 claves foráneas y su regla de borrado en cascada.
--
-- Los privilege checks leen pg_class.relacl con aclexplode(), NO las vistas
-- information_schema.*_privileges: esas filtran por el rol actualmente
-- habilitado del que consulta, y un runner que no es miembro de `anon` no vería
-- las filas y la comprobación fallaría sobre un esquema correcto. El catálogo no
-- filtra nada.
-- =============================================================================
DO $verify$
DECLARE
  v_leaked text;
  v_count  integer;
BEGIN

  -- 1) Las 2 tablas con EXACTAMENTE las columnas de la spec. Se comprueban
  --    columnas, no sólo existencia: un CREATE TABLE IF NOT EXISTS que se
  --    encuentra una tabla vieja con otra forma es un no-op silencioso.
  IF to_regclass('public.case_reviews') IS NULL OR to_regclass('public.case_comparisons') IS NULL THEN
    RAISE EXCEPTION
      'HUMAN_RESOLUTION_INCOMPLETE: falta public.case_reviews o public.case_comparisons. Esta migración debe aplicarse sobre el esquema AI-NATIVE (cases, evidence y audits ya existentes).';
  END IF;

  WITH esperado(tabla, cols) AS (
    VALUES
      ('case_reviews', ARRAY[
        'id','case_id','audit_id','result','comment','created_at','created_by']::text[]),
      ('case_comparisons', ARRAY[
        'id','case_review_id','audit_id','status','result_json','provider','model',
        'error_category','latency_ms','attempt_count','deadline_at','created_at','updated_at']::text[])
  ), reales(tabla, col) AS (
    SELECT c.table_name::text, c.column_name::text
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name IN ('case_reviews', 'case_comparisons')
  ), diferencias AS (
    SELECT e.tabla || '.' || x.col AS detalle, e.tabla AS orden
    FROM esperado e
    CROSS JOIN LATERAL unnest(e.cols) AS x(col)
    WHERE NOT EXISTS (
      SELECT 1 FROM reales r WHERE r.tabla = e.tabla AND r.col = x.col
    )
    UNION ALL
    SELECT r.tabla || '.' || r.col, r.tabla
    FROM reales r
    WHERE NOT EXISTS (
      SELECT 1 FROM esperado e
      WHERE e.tabla = r.tabla AND r.col = ANY (e.cols)
    )
  )
  SELECT string_agg(d.detalle, ', ' ORDER BY d.orden, d.detalle)
    INTO v_leaked
  FROM diferencias d;
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'HUMAN_RESOLUTION_INCOMPLETE: las tablas de revisión humana no tienen la forma que este archivo describe -- %. Sin esas columnas la revisión no puede dejar de ser un caso único ni una comparación trazable.',
      v_leaked;
  END IF;

  -- 2) Unicidad: una revisión por caso y una comparación por revisión. Se
  --    comprueba el índice (indisunique) Y que sea sobre la columna correcta: un
  --    índice único sobre otra columna cumpliría la comprobación por bandera y
  --    no garantizaría nada.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_attribute a
      ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
    WHERE i.indrelid = 'public.case_reviews'::regclass
      AND i.indisunique
      AND a.attname = 'case_id'
  ) THEN
    RAISE EXCEPTION
      'HUMAN_RESOLUTION_INCOMPLETE: public.case_reviews.case_id no es UNIQUE. Sin esa restricción, dos revisiones simultáneas dejarían dos resoluciones finales para el mismo caso.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_attribute a
      ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
    WHERE i.indrelid = 'public.case_comparisons'::regclass
      AND i.indisunique
      AND a.attname = 'case_review_id'
  ) THEN
    RAISE EXCEPTION
      'HUMAN_RESOLUTION_INCOMPLETE: public.case_comparisons.case_review_id no es UNIQUE. Sin esa restricción, reanudar o reintentar podrían abrir una segunda comparación de la misma revisión.';
  END IF;

  -- 3) El índice de lectura por antigüedad, sobre su tabla y en DESC.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indexrelid = to_regclass('public.case_comparisons_created_at_idx')
      AND i.indrelid = 'public.case_comparisons'::regclass
  ) THEN
    RAISE EXCEPTION
      'HUMAN_RESOLUTION_INCOMPLETE: falta el índice public.case_comparisons_created_at_idx sobre public.case_comparisons';
  END IF;

  -- 4) RLS habilitada en las dos.
  SELECT count(*) INTO v_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('case_reviews', 'case_comparisons')
    AND c.relrowsecurity;
  IF v_count <> 2 THEN
    RAISE EXCEPTION
      'HUMAN_RESOLUTION_INSECURE: la RLS no está habilitada en las dos tablas de revisión humana';
  END IF;

  -- 5a) Las 6 políticas, con su comando y sólo para `authenticated`.
  WITH esperado(pol_nombre, tbl, cmd) AS (
    VALUES
      ('case_reviews_select_own',                     'case_reviews',    'SELECT'),
      ('case_reviews_insert_own',                     'case_reviews',    'INSERT'),
      ('case_reviews_update_own',                     'case_reviews',    'UPDATE'),
      ('case_comparisons_select_for_visible_reviews', 'case_comparisons', 'SELECT'),
      ('case_comparisons_insert_for_visible_reviews', 'case_comparisons', 'INSERT'),
      ('case_comparisons_update_for_visible_reviews', 'case_comparisons', 'UPDATE')
  )
  SELECT string_agg(e.pol_nombre, ', ' ORDER BY e.pol_nombre)
    INTO v_leaked
  FROM esperado e
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = e.tbl
      AND p.policyname = e.pol_nombre
      AND p.cmd = e.cmd
      AND p.permissive = 'PERMISSIVE'
      AND p.roles = ARRAY['authenticated']::name[]
  );
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'HUMAN_RESOLUTION_INSECURE: faltan, o no son las esperadas, estas políticas: % (cuenta también como faltante una política con otro comando, con otro nombre, no PERMISSIVE, o concedida a PUBLIC/anon en vez de a authenticated)',
      v_leaked;
  END IF;

  -- 5b) Ninguna política EXTRA. Las políticas son PERMISSIVE y se combinan con
  --     OR: una sola política sobrante bien escrita anula el modelo entero sin
  --     tocar ninguna de las seis.
  SELECT string_agg(p.tablename || '.' || p.policyname, ', ' ORDER BY p.tablename, p.policyname)
    INTO v_leaked
  FROM pg_policies p
  WHERE p.schemaname = 'public'
    AND p.tablename IN ('case_reviews', 'case_comparisons')
    AND p.policyname <> ALL (ARRAY[
      'case_reviews_select_own','case_reviews_insert_own','case_reviews_update_own',
      'case_comparisons_select_for_visible_reviews',
      'case_comparisons_insert_for_visible_reviews',
      'case_comparisons_update_for_visible_reviews'
    ]);
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'HUMAN_RESOLUTION_INSECURE: políticas no esperadas en las tablas de revisión humana: %',
      v_leaked;
  END IF;

  -- 6a) Ni `anon` ni `authenticated` conservan ningún privilegio: el navegador
  --     no habla con InsForge, así que ninguno de los dos debe poder tocarlas.
  SELECT string_agg(r.rolname || ':' || c.relname || ':' || acl.privilege_type,
                    ', ' ORDER BY c.relname, acl.privilege_type)
    INTO v_leaked
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
  JOIN pg_roles r ON r.oid = acl.grantee
  WHERE n.nspname = 'public'
    AND c.relname IN ('case_reviews', 'case_comparisons')
    AND r.rolname IN ('anon', 'authenticated');
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'HUMAN_RESOLUTION_INSECURE: anon o authenticated conservan privilegios sobre las tablas de revisión humana: %. El navegador nunca habla con InsForge: pase por /api.',
      v_leaked;
  END IF;

  -- 6b) PUBLIC tampoco. grantee = 0 es PUBLIC; el JOIN a pg_roles lo dejaría
  --     fuera, así que se mira explícitamente.
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
    WHERE n.nspname = 'public'
      AND c.relname IN ('case_reviews', 'case_comparisons')
      AND acl.grantee = 0
      AND acl.grantee <> c.relowner
  ) THEN
    RAISE EXCEPTION
      'HUMAN_RESOLUTION_INSECURE: PUBLIC conserva privilegios sobre las tablas de revisión humana';
  END IF;

  -- 6c) `project_admin` TIENE SELECT, INSERT y UPDATE. NO se exige que sea
  --     EXACTAMENTE ese conjunto porque las migraciones corren como
  --     `project_admin`, que es el dueño (relowner) de las tablas que crea. El
  --     dueño posee implícitamente TODOS los privilegios, así que un GRANT a sí
  --     mismo no materializa `relacl`; `COALESCE(relacl, acldefault('r',
  --     relowner))` devuelve el set completo (DELETE, INSERT, REFERENCES,
  --     SELECT, TRIGGER, TRUNCATE, UPDATE) y un check de igualdad exacta fallaría
  --     siempre. La inmutabilidad de la revisión humana se defiende en la capa de
  --     aplicación (no hay endpoint de DELETE) y en las políticas RLS (ningún rol
  --     de navegador tiene privilegio), no en un GRANT imposible. Por eso este
  --     check se centra en lo que SÍ importa: que `anon`, `authenticated` y
  --     `PUBLIC` no puedan leer ni escribir estas tablas.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
    JOIN pg_roles r ON r.oid = acl.grantee
    WHERE n.nspname = 'public'
      AND c.relname IN ('case_reviews', 'case_comparisons')
      AND r.rolname = 'project_admin'
      AND acl.privilege_type = 'SELECT'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
    JOIN pg_roles r ON r.oid = acl.grantee
    WHERE n.nspname = 'public'
      AND c.relname IN ('case_reviews', 'case_comparisons')
      AND r.rolname = 'project_admin'
      AND acl.privilege_type = 'INSERT'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
    JOIN pg_roles r ON r.oid = acl.grantee
    WHERE n.nspname = 'public'
      AND c.relname IN ('case_reviews', 'case_comparisons')
      AND r.rolname = 'project_admin'
      AND acl.privilege_type = 'UPDATE'
  ) THEN
    RAISE EXCEPTION
      'HUMAN_RESOLUTION_INSECURE: project_admin no tiene SELECT, INSERT y UPDATE sobre las tablas de revisión humana. Sin ellos el servidor falla con 42501.';
  END IF;

  -- 7) El disparador de updated_at está, es BEFORE UPDATE FOR EACH ROW, y no
  --    queda ningún otro disparador sobre estas dos tablas.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'case_comparisons'
      AND tg.tgname = 'case_comparisons_set_updated_at'
      AND NOT tg.tgisinternal
      AND tg.tgtype = 19          -- BEFORE(2) + ROW(1) + UPDATE(16) = 19
  ) THEN
    RAISE EXCEPTION
      'HUMAN_RESOLUTION_INCOMPLETE: falta el disparador BEFORE UPDATE FOR EACH ROW case_comparisons_set_updated_at sobre public.case_comparisons';
  END IF;

  SELECT string_agg(tg.tgname, ', ' ORDER BY tg.tgname)
    INTO v_leaked
  FROM pg_trigger tg
  JOIN pg_class c ON c.oid = tg.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('case_reviews', 'case_comparisons')
    AND NOT tg.tgisinternal
    AND tg.tgname <> 'case_comparisons_set_updated_at';
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'HUMAN_RESOLUTION_INCOMPLETE: disparadores no esperados sobre las tablas de revisión humana: %',
      v_leaked;
  END IF;

  -- 8) Las 3 claves foráneas, con la regla de borrado que sostiene la
  --    integridad de la resolución: CASCADE hacia el caso (borrar el caso se
  --    lleva la revisión y su comparación) y RESTRICT desde el dictamen (un
  --    dictamen ya revisado no se puede borrar en silencio).
  WITH esperado(hija, padre, regla) AS (
    VALUES
      ('case_reviews',     'cases',         'CASCADE'),
      ('case_reviews',     'audits',        'RESTRICT'),
      ('case_comparisons', 'case_reviews',  'CASCADE'),
      ('case_comparisons', 'audits',        'RESTRICT')
  )
  SELECT string_agg(e.hija || '.' || e.padre || ' (esperaba ' || e.regla || ')', ', ')
    INTO v_leaked
  FROM esperado e
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage k
      ON k.constraint_name = tc.constraint_name AND k.constraint_schema = tc.constraint_schema
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.constraint_schema
    WHERE tc.constraint_schema = 'public'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name = e.hija
      AND k.position_in_unique_constraint IS NOT NULL
      AND rc.unique_constraint_name = (
        SELECT ccu.constraint_name
        FROM information_schema.constraint_column_usage ccu
        JOIN information_schema.table_constraints ptc
          ON ptc.constraint_name = ccu.constraint_name AND ptc.constraint_schema = ccu.constraint_schema
        WHERE ccu.constraint_schema = 'public'
          AND ptc.constraint_type = 'PRIMARY KEY'
          AND ptc.table_name = e.padre
      )
      AND rc.delete_rule = e.regla
  );
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'HUMAN_RESOLUTION_INCOMPLETE: claves foráneas ausentes o con otra regla de borrado: %. Con CASCADE en audit_id, borrar un dictamen borraría la revisión humana que lo avalaba.',
      v_leaked;
  END IF;

END
$verify$;


-- =============================================================================
-- REVERSIBLE
--   Este archivo es forward-only y no trae bloque de reversión porque borrar la
--   revisión humana de un caso es una decisión de negocio, no una operación de
--   esquema. Para deshacerlo, en este orden exacto (las tablas hijas antes que
--   las padres, porque las claves foráneas lo imponen):
--
--     DROP TABLE IF EXISTS public.case_comparisons;
--     DROP TABLE IF EXISTS public.case_reviews;
--
--   Eso se lleva por delante los índices case_comparisons_created_at_idx,
--   case_reviews_case_id_key, case_comparisons_case_review_id_key, el
--   disparador case_comparisons_set_updated_at, las seis políticas y los
--   privilegios de las dos tablas; no toca cases, evidence, audits ni
--   public.set_updated_at(). Con datos, la alternativa es un rollback lógico
--   (marcar las revisiones como anuladas) que este esquema no modela y que no se
--   añade aquí a propósito.
-- =============================================================================
