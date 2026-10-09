-- =============================================================================
-- 20261009120000 — Nombre del estudiante para identificar expedientes.
--
-- Idempotente, forward-only y sin escrituras sobre filas existentes. La
-- matrícula sigue en `student_identifier`; `student_name` es un dato separado
-- para mostrar el expediente como matrícula + nombre en la interfaz.
-- NO aplicar hasta completar la conciliación documentada en
-- `docs/MIGRATION-RECONCILIATION.md`.
-- =============================================================================

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS student_name text;

COMMENT ON COLUMN public.cases.student_name IS
  'Nombre del estudiante capturado por el usuario al crear el expediente. Se muestra junto a student_identifier; no es criterio de auditoría.';

DO $verify$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'cases'
    AND column_name = 'student_name'
    AND data_type = 'text';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'case_student_name: cases.student_name debe existir como text (encontradas: %)', v_count;
  END IF;

  RAISE NOTICE 'OK — cases.student_name text verificado';
END
$verify$;
