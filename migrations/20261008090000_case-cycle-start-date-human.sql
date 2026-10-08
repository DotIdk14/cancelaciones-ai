-- =============================================================================
-- 20261008090000 — Fecha de inicio de ciclo aportada por una persona.
--
-- Cuatro columnas en `cases`, todas NULL-able. Idempotente, forward-only, sin
-- BEGIN/COMMIT. NO escribe datos, NO altera `evidence` ni `audits`, y NO toca
-- RLS: las políticas de `cases` siguen exactamente como estaban.
--
-- QUÉ ES ESTE DATO
--   `cycle_start_date` es la fecha de inicio de clases que una persona del
--   equipo escribió porque el dictamen NO pudo acreditarla con la evidencia del
--   expediente. Es un DATO CON PROCEDENCIA, no evidencia del caso: no proviene
--   de un documento, no se cita en `audits.result_json` y no crea criterio. El
--   criterio sigue siendo exclusivamente el procedimiento V5 del owner
--   (POLICY_IS_IMMUTABLE). `NULL` significa "nadie la ha capturado" y es un
--   estado válido.
--
-- POR QUÉ EL ALCANCE NO ES UNA POLÍTICA NUEVA
--   El acceso real es el del SERVIDOR con la clave de administración, así que una
--   política de RLS no restringe la escritura (para `project_admin` no aplican).
--   El alcance lo resuelve el endpoint con `getScopedCaseOr404` +
--   `assertCaseOwner`, igual que los comentarios por área: un caso ajeno
--   responde 404, nunca 403 (NO_RESOURCE_EXISTENCE_LEAK). Añadir una política
--   aquí sería una barrera que no protege nada y que solo complicaría el
--   `apply-migration.mjs`.
--
-- POR QUÉ GUARDAR ES UN UPSERT Y NO UN HISTÓRICO
--   Cuatro columnas y ninguna tabla nueva: guardar dos veces pisa fecha, autor,
--   nombre y hora. Es el mismo criterio que `case_area_comments`: lo que se lee
--   es el estado actual, y el `updated_at` del caso (disparador
--   `cases_set_updated_at`, del baseline) deja la marca de cuándo se tocó por
--   última vez. Guardar dos veces NO duplica nada porque la fila del caso es una
--   sola.
--
-- SOBRE EL NOMBRE ESCRITO POR LA PERSONA
--   NO existe nombre de usuario autoritativo en el sistema. La revisión humana
--   resuelve lo mismo guardando `case_reviews.reviewer_name` como texto que la
--   persona escribe (ver `20261001010000_case-reviewer-name.sql`); aquí se
--   replica ese patrón. El AUTOR REAL es `cycle_start_date_by` (uuid de
--   `auth.users`) y es lo único con sello de auditoría; `_by_name` es solo para
--   mostrar. Por eso `_by_name` es texto libre sin vocabulario cerrado, y por eso
--   NO lleva `CHECK` de longitud en la base: la validación dura es la de Zod en
--   el servidor (VALIDATE_BEFORE_EFFECT), igual que `reviewer_name`.
--
-- POR QUÉ NO HAY COLUMNA `source`
--   La única fuente es humana por definición, así que la columna sería
--   constante. Y la procedencia no la elige el cliente: `cycle_start_date_at` y
--   `cycle_start_date_by` los pone el servidor, nunca el cuerpo del `PATCH`.
--
-- LO QUE ESTA MIGRACIÓN NO HACE
--   No toca `audits.result_json` ni reinterpretra dictámenes ya emitidos
--   (PROJECTION_IS_NOT_THE_DICTAMEN). No agrega la fecha a ningún prompt: eso es
--   otra tarea.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Las cuatro columnas
-- -----------------------------------------------------------------------------
--
-- `date` y no `text`: la fecha es un hecho de calendario, no texto libre, y la
-- base la ordena y la compara bien. El servidor la valida como ISO estricto
-- (AAAA-MM-DD), real en el calendario, de año entre 2000 y 2100 y no futura: ese
-- rango es un CABO DE COHERENCIA, no una regla normativa.
--
-- `cycle_start_date_at` lleva `DEFAULT now()` para que una fila escrita por
-- cualquier vía directa tenga hora; la API la envía explícita igual, porque la
-- marca de tiempo tiene que ser del servidor y no del navegador.

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS cycle_start_date date;

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS cycle_start_date_by uuid REFERENCES auth.users(id);

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS cycle_start_date_at timestamptz DEFAULT now();

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS cycle_start_date_by_name text;

-- -----------------------------------------------------------------------------
-- 2. Qué significa cada columna (leído desde el catálogo)
-- -----------------------------------------------------------------------------

COMMENT ON COLUMN public.cases.cycle_start_date IS
  'Fecha de inicio de clases aportada por una persona (formato ISO, 4 digitos, guion, 2, guion, 2). DATO HUMANO, NO EVIDENCIA: no proviene de un documento del expediente ni se cita en audits.result_json. NULL = nadie la ha capturado. Validada con Zod en el servidor antes de escribir.';

COMMENT ON COLUMN public.cases.cycle_start_date_by IS
  'UUID de auth.users de quien capturo la fecha. Es el autor real y el unico con sello de auditoria; lo escribe el servidor desde la sesion, nunca el cuerpo del PATCH. Mismo criterio que created_by.';

COMMENT ON COLUMN public.cases.cycle_start_date_at IS
  'Momento en que se capturo la fecha (timestamptz). Lo pone el servidor al guardar; el cliente no puede elegirlo.';

COMMENT ON COLUMN public.cases.cycle_start_date_by_name IS
  'Nombre que escribio la persona que capturo la fecha (1 a 120 caracteres). Texto libre, igual que case_reviews.reviewer_name: NO es un nombre de usuario autoritativo, solo se muestra. Sin vocabulario cerrado porque no lo hay en el sistema.';

-- -----------------------------------------------------------------------------
-- 3. Verificación
-- -----------------------------------------------------------------------------
DO $verify$
DECLARE
  v_count int;
BEGIN
  -- 3.1 Las cuatro columnas existen, del tipo correcto y NULL-able.
  SELECT count(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='cases'
    AND (
      (column_name='cycle_start_date'        AND data_type='date'       AND is_nullable='YES')
      OR (column_name='cycle_start_date_by'   AND data_type='uuid'       AND is_nullable='YES')
      OR (column_name='cycle_start_date_at'   AND data_type='timestamp with time zone' AND is_nullable='YES')
      OR (column_name='cycle_start_date_by_name' AND data_type='text'     AND is_nullable='YES')
    );

  IF v_count <> 4 THEN
    RAISE EXCEPTION 'las 4 columnas de cycle_start_date deben existir con su tipo y ser NULL-able (encontradas: %)', v_count;
  END IF;

  -- 3.2 `cycle_start_date_at` trae la hora por defecto, para que una fila
  --     escrita por otra vía no quede sin marca temporal.
  SELECT count(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='cases'
    AND column_name='cycle_start_date_at' AND column_default LIKE '%now()%';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'cases.cycle_start_date_at debe tener DEFAULT now()';
  END IF;

  -- 3.3 El autor es una FK a auth.users: el autor real tiene que existir como
  --     identidad, no ser texto.
  SELECT count(*) INTO v_count
  FROM pg_constraint
  WHERE conrelid='public.cases'::regclass AND contype='f'
    AND confrelid='auth.users'::regclass
    AND pg_get_constraintdef(oid) LIKE '%cycle_start_date_by%';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'cases.cycle_start_date_by debe referenciar auth.users(id)';
  END IF;

  -- 3.4 RLS INTACTA: esta migración no la toca. Sin este control, un cambio
  --     accidental de permisos pasaría el typecheck y abriría el caso en el
  --     navegador.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c WHERE c.oid='public.cases'::regclass AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'cases debe seguir con RLS habilitada';
  END IF;

  SELECT count(*) INTO v_count FROM pg_policy WHERE polrelid='public.cases'::regclass;

  IF v_count <> 4 THEN
    RAISE EXCEPTION 'cases debe seguir con sus 4 politicas propias, sin cambios (encontradas: %)', v_count;
  END IF;

  -- 3.5 La escritura es un UPDATE sobre `cases`, y es el disparador del baseline
  --     lo que mueve `updated_at`. Sin él, capturar la fecha no dejaría rastro
  --     de cuándo se tocó el caso.
  SELECT count(*) INTO v_count
  FROM pg_trigger
  WHERE tgrelid='public.cases'::regclass AND NOT tgisinternal AND tgname='cases_set_updated_at';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'falta el disparador cases_set_updated_at: la escritura no movería updated_at';
  END IF;

  RAISE NOTICE 'OK — cycle_start_date, cycle_start_date_by, cycle_start_date_at y cycle_start_date_by_name verificados; RLS sin cambios';
END
$verify$;