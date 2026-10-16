-- Dimensiones de caso necesarias para las vistas actuales del dashboard.
-- Instalación limpia del esquema AI-native; no crea la tabla retirada
-- `case_human_reviews` ni ninguna estructura del motor anterior.

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS campus text,
  ADD COLUMN IF NOT EXISTS modality text,
  ADD COLUMN IF NOT EXISTS project text,
  ADD COLUMN IF NOT EXISTS responsible text,
  ADD COLUMN IF NOT EXISTS guideline text;

DO $verify$
DECLARE
  v_col text;
BEGIN
  FOREACH v_col IN ARRAY ARRAY[
    'country','campus','modality','project','responsible','guideline'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema='public'
        AND table_name='cases'
        AND column_name=v_col
        AND data_type='text'
        AND is_nullable='YES'
    ) THEN
      RAISE EXCEPTION 'cases.% debe existir como text NULL-able', v_col;
    END IF;
  END LOOP;
END
$verify$;
