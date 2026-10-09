-- =============================================================================
-- 20261008120000 — Decisión del coordinador en case_reviews, separada del asesor.
--
-- Idempotente, forward-only, sin BEGIN/COMMIT. Añade CINCO columnas a
-- `public.case_reviews` y DOS restricciones CHECK. NO toca la decisión del asesor
-- (`result`) ni `audits.result_json`: la decisión del coordinador se guarda
-- APARTE y nunca sobrescribe la del asesor. Trae un bloque `DO $verify$`.
--
-- POR QUÉ EXISTE
--   La revisión humana pasa a ser secuencial: el Asesor registra una decisión y
--   una resolución propuesta (`result`); el Coordinador registra la decisión
--   final y puede MANTENER (APPROVE) o CAMBIAR (CHANGE) esa resolución. La
--   decisión del coordinador es un dato nuevo y distinto, con su propio actor,
--   su propia marca de tiempo y su propio comentario. Mezclarlo con `result`
--   sobrescribiría la decisión del asesor y perdería la traza de quién propuso
--   qué.
--
-- LA TABLA VIVA ES `public.case_reviews`
--   La columna de resolución del asesor es `result` (text NOT NULL, sin CHECK:
--   el vocabulario cerrado vive en TypeScript y se valida con Zod, ver
--   `20260930010000_human-resolution.sql`). El actor del asesor es `created_by
--   uuid REFERENCES auth.users(id) ON DELETE CASCADE`. Las columnas del
--   coordinador replican ese estilo: `coordinator_created_by uuid REFERENCES
--   auth.users(id) ON DELETE CASCADE`.
--
-- POR QUÉ UN CHECK DE CONSISTENCIA DE TABLA
--   Las cinco columnas son NULL-able porque una revisión puede no tener decisión
--   del coordinador todavía (solo la del asesor). El CHECK de tabla garantiza
--   que ese estado sea coherente y no a medias:
--     - o TODO el bloque del coordinador está vacío (sin decisión);
--     - o la decisión trae actor y hora, y la resolución sigue a la decisión:
--         APPROVE -> sin resolución de cambio (se conserva `result`);
--         CHANGE  -> resolución distinta de `result` (la del asesor).
--   Así el Coordinador no puede "aprobar con cambio", ni "cambiar sin decir a
--   qué", ni dejar una resolución de cambio idéntica a la del asesor.
-- =============================================================================

ALTER TABLE public.case_reviews
  ADD COLUMN IF NOT EXISTS coordinator_decision text;

ALTER TABLE public.case_reviews
  ADD COLUMN IF NOT EXISTS coordinator_resolution text;

ALTER TABLE public.case_reviews
  ADD COLUMN IF NOT EXISTS coordinator_created_by uuid REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.case_reviews
  ADD COLUMN IF NOT EXISTS coordinator_created_at timestamptz;

ALTER TABLE public.case_reviews
  ADD COLUMN IF NOT EXISTS coordinator_comment text;

-- Vocabulario cerrado de la decisión del coordinador. Sin CHECK, un texto
-- cualquiera colaría y el flujo no podría derivar el estado. A diferencia de
-- `result`, este vocabulario es de DOS valores fijos del flujo (APPROVE | CHANGE),
-- no una taxonomía que viva en el código.
ALTER TABLE public.case_reviews
  DROP CONSTRAINT IF EXISTS case_reviews_coordinator_decision_check;
ALTER TABLE public.case_reviews
  ADD CONSTRAINT case_reviews_coordinator_decision_check
  CHECK (coordinator_decision IS NULL OR coordinator_decision IN ('APPROVE','CHANGE'));

-- Consistencia del bloque del coordinador: o todo vacío, o decisión completa y
-- coherente con la resolución del asesor (`result`).
ALTER TABLE public.case_reviews
  DROP CONSTRAINT IF EXISTS case_reviews_coordinator_consistency_check;
ALTER TABLE public.case_reviews
  ADD CONSTRAINT case_reviews_coordinator_consistency_check
  CHECK (
    (
      coordinator_decision IS NULL
      AND coordinator_resolution IS NULL
      AND coordinator_created_by IS NULL
      AND coordinator_created_at IS NULL
      AND coordinator_comment IS NULL
    )
    OR
    (
      coordinator_decision IS NOT NULL
      AND coordinator_created_by IS NOT NULL
      AND coordinator_created_at IS NOT NULL
      AND (
        (coordinator_decision = 'APPROVE' AND coordinator_resolution IS NULL)
        OR
        (coordinator_decision = 'CHANGE'
         AND coordinator_resolution IS NOT NULL
         AND coordinator_resolution IS DISTINCT FROM result)
      )
    )
  );

COMMENT ON COLUMN public.case_reviews.coordinator_decision IS
  'Decision final del coordinador: APPROVE (mantiene la resolucion del asesor) o CHANGE (la cambia). NULL = aun no hay decision de coordinador. Vocabulario cerrado con CHECK en la base.';
COMMENT ON COLUMN public.case_reviews.coordinator_resolution IS
  'Resolucion final solo cuando coordinator_decision = CHANGE; NULL en APPROVE (se conserva result). El vocabulario lo valida el servidor con Zod, igual que result.';
COMMENT ON COLUMN public.case_reviews.coordinator_created_by IS
  'UUID de auth.users del coordinador que registro la decision. Lo escribe el servidor desde la sesion, nunca el cliente. Mismo estilo que created_by.';
COMMENT ON COLUMN public.case_reviews.coordinator_created_at IS
  'Momento en que el coordinador registro la decision (timestamptz). Lo pone el servidor; NULL hasta que actua el coordinador.';
COMMENT ON COLUMN public.case_reviews.coordinator_comment IS
  'Comentario opcional del coordinador. Sin vocabulario cerrado ni limite en la base; la validacion dura es de Zod en el servidor.';

-- -----------------------------------------------------------------------------
-- Verificación
-- -----------------------------------------------------------------------------
DO $verify$
DECLARE
  v_count int;
BEGIN
  -- 1) Las cinco columnas existen, con su tipo y NULL-able (un coordinador puede
  --    no haber actuado todavía).
  SELECT count(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='case_reviews'
    AND (
      (column_name='coordinator_decision'     AND data_type='text'   AND is_nullable='YES')
      OR (column_name='coordinator_resolution' AND data_type='text'   AND is_nullable='YES')
      OR (column_name='coordinator_created_by' AND data_type='uuid'   AND is_nullable='YES')
      OR (column_name='coordinator_created_at' AND data_type='timestamp with time zone' AND is_nullable='YES')
      OR (column_name='coordinator_comment'    AND data_type='text'   AND is_nullable='YES')
    );
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'case_review_coordinator_decision: las 5 columnas del coordinador deben existir con su tipo y ser NULL-able (encontradas: %)', v_count;
  END IF;

  -- 2) El CHECK de vocabulario de la decisión existe y admite APPROVE y CHANGE.
  SELECT count(*) INTO v_count
  FROM pg_constraint
  WHERE conrelid = 'public.case_reviews'::regclass
    AND contype = 'c'
    AND conname = 'case_reviews_coordinator_decision_check'
    AND pg_get_constraintdef(oid) LIKE '%APPROVE%'
    AND pg_get_constraintdef(oid) LIKE '%CHANGE%';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'case_review_coordinator_decision: falta el CHECK case_reviews_coordinator_decision_check con APPROVE y CHANGE';
  END IF;

  -- 3) El CHECK de consistencia de tabla existe.
  SELECT count(*) INTO v_count
  FROM pg_constraint
  WHERE conrelid = 'public.case_reviews'::regclass
    AND contype = 'c'
    AND conname = 'case_reviews_coordinator_consistency_check';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'case_review_coordinator_decision: falta el CHECK case_reviews_coordinator_consistency_check';
  END IF;

  -- 4) El CHECK de consistencia codifica que CHANGE exige una resolución
  --    DISTINTA de la del asesor (`result`).
  SELECT count(*) INTO v_count
  FROM pg_constraint
  WHERE conrelid = 'public.case_reviews'::regclass
    AND contype = 'c'
    AND conname = 'case_reviews_coordinator_consistency_check'
    AND pg_get_constraintdef(oid) LIKE '%DISTINCT%'
    AND pg_get_constraintdef(oid) LIKE '%result%';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'case_review_coordinator_decision: el CHECK de consistencia debe exigir coordinator_resolution IS DISTINCT FROM result en CHANGE';
  END IF;

  -- 5) El actor del coordinador es una FK a auth.users (identidad real, no texto).
  SELECT count(*) INTO v_count
  FROM pg_constraint
  WHERE conrelid = 'public.case_reviews'::regclass
    AND contype = 'f'
    AND confrelid = 'auth.users'::regclass
    AND pg_get_constraintdef(oid) LIKE '%coordinator_created_by%';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'case_review_coordinator_decision: coordinator_created_by debe referenciar auth.users(id)';
  END IF;

  -- 6) La resolución del asesor (`result`) sigue intacta: text NOT NULL, sin que
  --    esta migración la haya tocado.
  SELECT count(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='case_reviews'
    AND column_name='result'
    AND data_type='text'
    AND is_nullable='NO';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'case_review_coordinator_decision: case_reviews.result debe seguir siendo text NOT NULL (la decisión del asesor no se toca)';
  END IF;

  RAISE NOTICE 'OK — case_reviews con decisión de coordinador separada de la del asesor verificada';
END
$verify$;
