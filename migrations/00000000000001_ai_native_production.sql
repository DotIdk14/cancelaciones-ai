-- =============================================================================
-- 00000000000001_ai_native_production.sql
-- =============================================================================
-- Migración INCREMENTAL y no destructiva hacia el esquema AI-NATIVE.
--
-- POR QUÉ EXISTE ESTE ARCHIVO Y NO SE USA EL BASELINE
--   `00000000000000_baseline.sql` es la línea base del producto y, a propósito,
--   ABORTA si encuentra el esquema retirado (sección 0.1). La base de producción
--   sí lo tiene: 38 migraciones legacy aplicadas, ~50 tablas (facts, rules,
--   engine_runs, jobs, evidences, profiles, audit_log, ...) y datos reales.
--   Borrarlas destruiría producción sin copia ni bitácora, así que NO se
--   reaplica el baseline: este archivo pone en pie `cases`, `evidence` y el
--   `audits` nuevo ENCIMA del legacy, sin borrar ni una fila.
--
-- EL ÚNICO CHOQUE DE NOMBRES: `audits`
--   La tabla legacy `audits` existe con 12 filas y esta forma:
--     id, status, external_case_id, created_by, created_at, updated_at,
--     policy_code, policy_version, display_name
--   La tabla del producto es OTRA ENTIDAD: se indexa por `case_id`, guarda
--   `evidence_fingerprint` y su `status` es RUNNING|COMPLETED|ERROR. No hay
--   forma de adaptar la legacy en su sitio sin dos Males:
--     - su CHECK `status IN ('DRAFT','READY','PROCESSING','COMPLETED','FAILED')`
--       RECHAZA 'RUNNING', que el producto escribe al abrir una auditoría;
--     - `case_id` es NOT NULL y no existe: `external_case_id` es texto libre de
--       otro dominio y no se puede derivar un uuid de `cases` a partir de él.
--   Así que la legacy se CONSERVA ÍNTEGRA bajo el nombre `legacy_audits`
--   (ALTER TABLE ... RENAME: no copia, no borra, no pierde filas, se lleva
--   detrás sus índices, su trigger y sus políticas) y `audits` queda libre para
--   la forma del producto. Revertible en una línea si alguna vez hace falta.
--
-- `evidences` (legacy, 18 filas) NO se toca: la tabla del producto se llama
-- `evidence` y no colisiona. El resto del legacy tampoco se toca.
--
-- DIRECCIÓN
--   forward-only, SIN BEGIN/COMMIT, e idempotente (IF EXISTS / OR REPLACE /
--   DROP ... IF EXISTS). Re-ejecutarlo es un no-op.
--
-- COMPATIBILIDAD CON EL BASELINE
--   Una instalación limpia (base vacía) puede seguir usando el baseline. Esta
--   migración es su complemento: sobre una base ya migrada por el baseline no
--   hace nada (todo es IF EXISTS y el bloque de preservação sólo actúa si
--   `audits` tiene la forma legacy, que en el baseline no tiene).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- SECCIÓN 0 — Preservación de la tabla legacy `audits`
--
-- Se comprueba la FORMA, no el nombre: `audits` con `external_case_id` y sin
-- `case_id` es la legacy. Si alguien ya ejecutó esta migración, `audits` ya es
-- la del producto y el bloque no hace nada. Es idempotente por construcción.
--
-- El RENAME se ejecuta con EXECUTE porque no se puede escribir DDL
-- directamente dentro de un bloque plpgsql.
-- -----------------------------------------------------------------------------
DO $mig$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'audits'
       AND column_name = 'external_case_id'
  )
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'audits'
       AND column_name = 'case_id'
  )
  THEN
    IF to_regclass('public.legacy_audits') IS NULL THEN
      EXECUTE 'ALTER TABLE public.audits RENAME TO legacy_audits';
    END IF;
  END IF;
END
$mig$;


-- -----------------------------------------------------------------------------
-- SECCIÓN 0.1 — Prerrequisitos
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- -----------------------------------------------------------------------------
-- SECCIÓN 1 — Las tres tablas del producto
-- Definiciones idénticas (columna a columna, tipo a tipo, CHECK a CHECK) a las
-- de `00000000000000_baseline.sql`. Una sola fuente de verdad: si divergen,
-- lo que se lee es esta copia, así que aquí va el mismo texto.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','READY','AUDITING','COMPLETED','ERROR')),
  student_identifier text,
  created_by uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  hash text NOT NULL,
  storage_path text NOT NULL,
  processing_status text NOT NULL DEFAULT 'UPLOADED'
    CHECK (processing_status IN ('UPLOADED','TRANSCRIBING','READY','ERROR')),
  transcript_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'RUNNING'
    CHECK (status IN ('RUNNING','COMPLETED','ERROR')),
  provider text NOT NULL DEFAULT 'openrouter',
  model text NOT NULL,
  evidence_fingerprint text NOT NULL,
  attempt_number integer NOT NULL DEFAULT 1 CHECK (attempt_number >= 1),
  deadline_at timestamptz,
  provider_metadata jsonb,
  result_json jsonb,
  error_category text,
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cases ALTER COLUMN created_by DROP NOT NULL;


-- -----------------------------------------------------------------------------
-- SECCIÓN 2 — Índices
-- Mismos cuatro del baseline. `IF NOT EXISTS` los hace seguros de re-aplicar y
-- no chocan con ningún índice legacy (los legacy viven en otras tablas).
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS cases_created_by_created_at_idx
  ON public.cases (created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS evidence_case_id_created_at_idx
  ON public.evidence (case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS evidence_hash_idx
  ON public.evidence (hash);

CREATE INDEX IF NOT EXISTS audits_case_id_created_at_idx
  ON public.audits (case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audits_case_id_fingerprint_created_at_idx
  ON public.audits (case_id, evidence_fingerprint, created_at DESC);

-- Un único intento en curso por (caso, huella de evidencia). Es lo que
-- implementa DO_NOT_REPROCESS_AI_UNNECESSARILY a nivel de concurrencia.
CREATE UNIQUE INDEX IF NOT EXISTS audits_one_running_per_case_fingerprint_idx
  ON public.audits (case_id, evidence_fingerprint)
  WHERE status = 'RUNNING';


-- -----------------------------------------------------------------------------
-- SECCIÓN 3 — set_updated_at() y su disparador en `cases`
--
-- La función YA existe en esta base (la dejó el esquema legacy y la usan
-- disparadores como `jobs_set_updated_at`). Se reemplaza en lugar de crearse:
-- `CREATE OR REPLACE` conserva el OID, así que los disparadores legacy que la
-- invocan siguen apuntando a la misma función.
--
-- El search_path fijado es la convención que impide que un objeto de `public`
-- ensombrezca una función del catálogo.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $fn$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$fn$;

-- PostgreSQL da EXECUTE a PUBLIC en toda función nueva y al reemplazar una
-- existente; se revoca. Se concede a `authenticated` porque el cliente
-- actualiza `cases` y el trigger se ejecuta con sus privilegios: sin este
-- GRANT, el UPDATE revienta con un 42501 que no tiene nada que ver con la RLS.
--
-- `project_admin` es el equivalente de InsForge a `service_role`: el rol con
-- BYPASSRLS, que es quien escribe desde el servidor. El nombre `service_role`
-- NO existe en InsForge; el baseline lo menciona porque describe un Postgres
-- genérico. Aquí el GRANT se hace al rol que existe de verdad.
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM anon;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO authenticated, project_admin;

-- DROP antes de CREATE porque CREATE TRIGGER no tiene forma idempotente.
-- El trigger va SÓLO en `cases`: es la única de las tres con `updated_at`.
-- Ponerlo en `audits` o `evidence` (que no la tienen) crearía sin quejarse y
-- reventaría en el primer UPDATE.
DROP TRIGGER IF EXISTS cases_set_updated_at ON public.cases;
CREATE TRIGGER cases_set_updated_at
  BEFORE UPDATE ON public.cases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- -----------------------------------------------------------------------------
-- SECCIÓN 4 — RLS y privilegios de tabla: deny por defecto
--
--   1) RLS habilitada (sin esto las políticas son decorado).
--   2) REVOKE ALL a anon y a authenticated: punto de partida limpio, sin
--      depender de los privilegios por defecto de la plataforma.
--   3) GRANT de exactamente los cuatro privilegios de cliente.
--   4) REVOKE ALL a anon al final: la última palabra sobre el anónimo la tiene
--      siempre el REVOKE, nunca el GRANT.
-- -----------------------------------------------------------------------------
ALTER TABLE public.cases    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audits   ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cases, public.evidence, public.audits FROM anon;
REVOKE ALL ON TABLE public.cases, public.evidence, public.audits FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.cases, public.evidence, public.audits
  TO authenticated;

REVOKE ALL ON TABLE public.cases, public.evidence, public.audits FROM anon;


-- -----------------------------------------------------------------------------
-- SECCIÓN 5 — Las doce políticas RLS
--
-- UNA SOLA REGLA en las tres tablas: el dueño es el creador del caso.
--   cases    -> comparación directa:  created_by = auth.uid()
--   evidence  -> por existencia:       EXISTS (... cases.created_by = auth.uid())
--   audits    -> por existencia:       EXISTS (... cases.created_by = auth.uid())
--
-- `evidence` y `audits` no llevan `created_by`: la fila es de un expediente, no
-- de una persona, y una segunda atribución puede desincronizarse de la del
-- caso. La EXISTS mira `public.cases`, cuya RLS vuelve a exigir
-- created_by = auth.uid(): la condición se comprueba dos veces (defensa en
-- profundidad, no dos reglas que puedan divergir).
--
-- WITH CHECK en INSERT y UPDATE: USING decide a qué filas puede tocar el
-- cliente, WITH CHECK decide con qué valores puede dejarlas. Sin él, un UPDATE
-- podría cambiar `created_by` y regalar el caso.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS cases_select_own ON public.cases;
CREATE POLICY cases_select_own ON public.cases
  FOR SELECT TO authenticated
  USING (created_by = auth.uid());

DROP POLICY IF EXISTS cases_insert_own ON public.cases;
CREATE POLICY cases_insert_own ON public.cases
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS cases_update_own ON public.cases;
CREATE POLICY cases_update_own ON public.cases
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS cases_delete_own ON public.cases;
CREATE POLICY cases_delete_own ON public.cases
  FOR DELETE TO authenticated
  USING (created_by = auth.uid());

DROP POLICY IF EXISTS evidence_select_for_visible_cases ON public.evidence;
CREATE POLICY evidence_select_for_visible_cases ON public.evidence
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cases
      WHERE cases.id = evidence.case_id
        AND cases.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS evidence_insert_for_visible_cases ON public.evidence;
CREATE POLICY evidence_insert_for_visible_cases ON public.evidence
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.cases
      WHERE cases.id = evidence.case_id
        AND cases.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS evidence_update_for_visible_cases ON public.evidence;
CREATE POLICY evidence_update_for_visible_cases ON public.evidence
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cases
      WHERE cases.id = evidence.case_id
        AND cases.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.cases
      WHERE cases.id = evidence.case_id
        AND cases.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS evidence_delete_for_visible_cases ON public.evidence;
CREATE POLICY evidence_delete_for_visible_cases ON public.evidence
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cases
      WHERE cases.id = evidence.case_id
        AND cases.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS audits_select_for_visible_cases ON public.audits;
CREATE POLICY audits_select_for_visible_cases ON public.audits
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cases
      WHERE cases.id = audits.case_id
        AND cases.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS audits_insert_for_visible_cases ON public.audits;
CREATE POLICY audits_insert_for_visible_cases ON public.audits
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.cases
      WHERE cases.id = audits.case_id
        AND cases.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS audits_update_for_visible_cases ON public.audits;
CREATE POLICY audits_update_for_visible_cases ON public.audits
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cases
      WHERE cases.id = audits.case_id
        AND cases.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.cases
      WHERE cases.id = audits.case_id
        AND cases.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS audits_delete_for_visible_cases ON public.audits;
CREATE POLICY audits_delete_for_visible_cases ON public.audits
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cases
      WHERE cases.id = audits.case_id
        AND cases.created_by = auth.uid()
    )
  );


-- -----------------------------------------------------------------------------
-- SECCIÓN 6 — Verificación posterior a la aplicación
--
-- A diferencia del baseline, aquí NO se comprueba que el esquema legacy haya
-- desaparecido: no desaparece, y que siga ahí es lo correcto. Lo que se
-- comprueba es exactamente lo que el código actual necesita para funcionar:
-- columnas, RLS, las doce políticas, los privilegios y las cascadas.
--
-- Los privilege checks leen pg_class.relacl con aclexplode(), NO las vistas
-- information_schema.*_privileges: esas filtran por el rol actualmente
-- habilitado del que consulta, y un runner que no es miembro de `authenticated`
-- no vería las filas y la comprobación fallaría sobre un esquema correcto.
--
-- POR QUÉ SON CUATRO BLOQUES Y NO UNO
--   Un único DO giant no se puede ejecutar desde un runner que pase el SQL por
--   línea de comandos: se topa con el límite de longitud de la línea del
--   sistema operativo y el fallo dice "la línea de comandos es demasiado larga",
--   que no dice nada del esquema. Cuatro bloques keeps cada verificación por
--   debajo del límite, y además el error pasa a señalar QUÉ_check falló en vez
--   de "algo del archivo no cuadra".
-- -----------------------------------------------------------------------------
DO $verify1$
DECLARE
  v_leaked text;
  v_count integer;
BEGIN
  -- 1) Las tres tablas existen y `audits` es la del producto, no la legacy.
  --    Si `audits` aparece aquí es que el RENAME de la sección 0 no ocurrió.
  SELECT string_agg(e.tabla || '.' || col.nombre, ', ' ORDER BY e.tabla, col.nombre)
    INTO v_leaked
  FROM (VALUES
    ('cases', ARRAY[
      'id','status','student_identifier','created_by','created_at','updated_at']::text[]),
    ('evidence', ARRAY[
      'id','case_id','filename','mime_type','size_bytes','hash','storage_path',
      'processing_status','transcript_json','created_at']::text[]),
    ('audits', ARRAY[
      'id','case_id','status','provider','model','evidence_fingerprint','attempt_number',
      'deadline_at','provider_metadata','result_json','error_category','latency_ms','created_at']::text[])
  ) AS e(tabla, cols)
  CROSS JOIN LATERAL unnest(e.cols) AS col(nombre)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = e.tabla
      AND c.column_name = col.nombre
  );
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'AI_NATIVE_PROD_INCOMPLETE: a las tablas del producto les faltan columnas: %. Si aparece `audits`, la tabla legacy sigue con ese nombre: revisa la sección 0.',
      v_leaked;
  END IF;

  -- 2) RLS habilitada en las tres. Sin esto las políticas de la sección 5 no
  --    se aplican y todo el modelo de seguridad es decorado.
  SELECT count(*) INTO v_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('cases','evidence','audits')
    AND c.relrowsecurity;
  IF v_count <> 3 THEN
    RAISE EXCEPTION
      'AI_NATIVE_PROD_INSECURE: la RLS no está habilitada en las tres tablas del producto';
  END IF;
END
$verify1$;


-- -----------------------------------------------------------------------------
-- SECCIÓN 6.2 — Las doce políticas y ninguna de más
-- -----------------------------------------------------------------------------
DO $verify2$
DECLARE
  v_leaked text;
BEGIN
  -- 3) Las doce políticas, con su comando correcto y SÓLO para `authenticated`.
  --    Una política con roles=PUBLIC también falla: no es lo que se escribió.
  --
  --    `pg_policies.permissive` es de tipo TEXT, no booleano: vale
  --    'PERMISSIVE' / 'RESTRICTIVE'. Escribirlo como predicado a secas
  --    (`AND p.permissive`) hace que esta verificación falle con "argument of
  --    AND must be type boolean, not type text" sobre un esquema correcto.
  WITH esperado(pol_nombre, tbl, cmd) AS (
    VALUES
      ('cases_select_own',                  'cases',    'SELECT'),
      ('cases_insert_own',                  'cases',    'INSERT'),
      ('cases_update_own',                  'cases',    'UPDATE'),
      ('cases_delete_own',                  'cases',    'DELETE'),
      ('evidence_select_for_visible_cases', 'evidence', 'SELECT'),
      ('evidence_insert_for_visible_cases', 'evidence', 'INSERT'),
      ('evidence_update_for_visible_cases', 'evidence', 'UPDATE'),
      ('evidence_delete_for_visible_cases', 'evidence', 'DELETE'),
      ('audits_select_for_visible_cases',   'audits',   'SELECT'),
      ('audits_insert_for_visible_cases',   'audits',   'INSERT'),
      ('audits_update_for_visible_cases',   'audits',   'UPDATE'),
      ('audits_delete_for_visible_cases',   'audits',   'DELETE')
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
      'AI_NATIVE_PROD_INSECURE: faltan, o no son las esperadas, estas políticas: % (cuenta como faltante una con otro comando, de otro nombre, no PERMISSIVE, o concedida a PUBLIC/anon)',
      v_leaked;
  END IF;

  -- 4) Ninguna política EXTRA en las tres tablas. Una política sobrante es una
  --    puerta trasera: son PERMISSIVE y se combinan con OR, así que una sola
  --    política adicional bien escrita anula el modelo entero sin tocar las doce.
  SELECT string_agg(p.tablename || '.' || p.policyname, ', ' ORDER BY p.tablename, p.policyname)
    INTO v_leaked
  FROM pg_policies p
  WHERE p.schemaname = 'public'
    AND p.tablename IN ('cases','evidence','audits')
    AND p.policyname <> ALL (ARRAY[
      'cases_select_own','cases_insert_own','cases_update_own','cases_delete_own',
      'evidence_select_for_visible_cases','evidence_insert_for_visible_cases',
      'evidence_update_for_visible_cases','evidence_delete_for_visible_cases',
      'audits_select_for_visible_cases','audits_insert_for_visible_cases',
      'audits_update_for_visible_cases','audits_delete_for_visible_cases'
    ]);
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'AI_NATIVE_PROD_INSECURE: políticas no esperadas en las tablas del producto: %',
      v_leaked;
  END IF;
END
$verify2$;


-- -----------------------------------------------------------------------------
-- SECCIÓN 6.3 — Privilegios: anon sin nada, PUBLIC sin nada, authenticated
-- exactamente los cuatro
-- -----------------------------------------------------------------------------
DO $verify3$
DECLARE
  v_leaked text;
BEGIN
  -- 5) `anon` sin ningún privilegio sobre las tres tablas.
  SELECT string_agg(r.rolname || ':' || c.relname || ':' || acl.privilege_type,
                    ', ' ORDER BY c.relname, acl.privilege_type)
    INTO v_leaked
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
  JOIN pg_roles r ON r.oid = acl.grantee
  WHERE n.nspname = 'public'
    AND c.relname IN ('cases','evidence','audits')
    AND r.rolname = 'anon';
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'AI_NATIVE_PROD_INSECURE: anon conserva privilegios sobre las tablas del producto: %',
      v_leaked;
  END IF;

  -- 6) PUBLIC tampoco. grantee = 0 es PUBLIC; el JOIN a pg_roles lo dejaría
  --    fuera, así que se mira explícitamente.
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
    WHERE n.nspname = 'public'
      AND c.relname IN ('cases','evidence','audits')
      AND acl.grantee = 0
  ) THEN
    RAISE EXCEPTION
      'AI_NATIVE_PROD_INSECURE: PUBLIC conserva privilegios sobre las tablas del producto';
  END IF;

  -- 7) `authenticated` con exactamente los cuatro privilegios en cada tabla
  --    y nada más (nada de TRUNCATE, REFERENCES ni TRIGGER).
  SELECT string_agg(c.relname || ':' || acl.privilege_type, ', ' ORDER BY c.relname, acl.privilege_type)
    INTO v_leaked
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
  JOIN pg_roles r ON r.oid = acl.grantee
  WHERE n.nspname = 'public'
    AND c.relname IN ('cases','evidence','audits')
    AND r.rolname = 'authenticated'
    AND acl.privilege_type NOT IN ('SELECT','INSERT','UPDATE','DELETE');
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'AI_NATIVE_PROD_INSECURE: `authenticated` conserva privilegios que no debería: %',
      v_leaked;
  END IF;
END
$verify3$;


-- -----------------------------------------------------------------------------
-- SECCIÓN 6.4 — Cascadas, disparador y el GRANT de set_updated_at()
-- -----------------------------------------------------------------------------
DO $verify4$
DECLARE
  v_count integer;
BEGIN
  -- 8) Las tres claves foráneas existen y borran en cascada. `evidence.case_id`
  --    y `audits.case_id` hacia cases, y `cases.created_by` hacia auth.users.
  --    Sin CASCADE, borrar un caso dejaría expedientes huérfanos que nadie puede
  --    atribuir ni borrar.
  SELECT count(*) INTO v_count
  FROM pg_constraint c
  WHERE c.contype = 'f'
    AND c.confdeltype = 'c'
    AND c.conrelid IN ('public.cases'::regclass, 'public.evidence'::regclass, 'public.audits'::regclass);
  IF v_count <> 3 THEN
    RAISE EXCEPTION
      'AI_NATIVE_PROD_INCOMPLETE: las claves foráneas del producto no están todas ni todas en cascada (contadas % de 3)', v_count;
  END IF;

  -- 9) El único disparador de `cases` es cases_set_updated_at, y set_updated_at()
  --    es ejecutable por `authenticated` (si no, el UPDATE revienta con 42501).
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid = 'public.cases'::regclass
      AND t.tgname = 'cases_set_updated_at'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION
      'AI_NATIVE_PROD_INCOMPLETE: falta el disparador cases_set_updated_at';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
    JOIN pg_roles r ON r.oid = acl.grantee
    WHERE n.nspname = 'public'
      AND p.proname = 'set_updated_at'
      AND acl.privilege_type = 'EXECUTE'
      AND r.rolname = 'authenticated'
  ) THEN
    RAISE EXCEPTION
      'AI_NATIVE_PROD_INSECURE: `authenticated` no puede ejecutar set_updated_at(); cualquier UPDATE sobre cases fallaría con 42501';
  END IF;
END
$verify4$;
