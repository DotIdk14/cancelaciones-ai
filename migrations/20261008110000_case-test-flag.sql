-- =============================================================================
-- 20261008110000 — Flag de caso de prueba en cases.
--
-- Idempotente, forward-only, sin BEGIN/COMMIT. Añade una columna a `cases`;
-- NO escribe datos, NO altera `evidence` ni `audits`, y NO toca
-- `audits.result_json`. Trae un bloque `DO $verify$` que falla si la columna no
-- queda con su tipo, su NOT NULL y su default.
--
-- POR QUÉ EXISTE
--   La feature de revisión humana por roles necesita clasificar cada caso como
--   prueba o real para excluir las pruebas de las métricas operativas. La
--   exclusión se resuelve en SQL en el servidor (`.eq('is_test', false)`), NO en
--   la base: la columna sólo guarda la marca. Diseño alineado con
--   `docs/superpowers/plans/2026-10-06-case-test-flag.md`.
--
-- `NOT NULL DEFAULT false`
--   Un caso creado sin la marca es real (false). Los casos existentes reciben
--   `false` al añadir la columna con default: el `ADD COLUMN` rellena las filas
--   existentes con el default, así que ningún caso histórico se convierte en
--   prueba por accidente.
--
-- REVERSIBLE
--   Borrar la columna no destruye nada: `is_test` no participa en ningún
--   dictamen. `audits.result_json` (la fuente de verdad del dictamen de IA)
--   permanece intacta. Para revertir: `ALTER TABLE public.cases DROP COLUMN
--   is_test;`.
-- =============================================================================

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.cases.is_test IS
  'Clasificacion explicita del caso: false = real, true = prueba. DEFAULT false para que un caso creado sin el dato sea real y un caso historico nunca se convierta en prueba. La exclusion de las pruebas de las metricas operativas la aplica el servidor en SQL (predicado is_test = false); esta columna solo guarda la marca. No participa en audits.result_json.';

-- -----------------------------------------------------------------------------
-- Verificación
-- -----------------------------------------------------------------------------
DO $verify$
DECLARE
  v_count int;
BEGIN
  -- 1) La columna existe, es boolean y es NOT NULL (sin NOT NULL, un caso sin
  --    marca quedaría NULL y el filtro `.eq('is_test', false)` lo excluiría
  --    de las métricas reales por un accidente de escritura).
  SELECT count(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='cases'
    AND column_name='is_test'
    AND data_type='boolean'
    AND is_nullable='NO';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'case_test_flag: cases.is_test debe existir como boolean NOT NULL (encontradas: %)', v_count;
  END IF;

  -- 2) El default es `false`: los casos existentes y los creados sin la marca
  --    son reales.
  SELECT count(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='cases'
    AND column_name='is_test'
    AND column_default LIKE '%false%';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'case_test_flag: cases.is_test debe tener DEFAULT false';
  END IF;

  RAISE NOTICE 'OK — cases.is_test boolean NOT NULL DEFAULT false verificado';
END
$verify$;
