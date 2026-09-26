-- ============================================================================
-- Restaurar PROCESSING al CHECK de estado de fact_extraction_runs
-- ============================================================================
--
-- POR QUÉ ESTA MIGRACIÓN EXISTE
--
-- El diseño declara, en migrations/20260923220000_phase-5-fact-model-shadow.sql:8:
--
--   state text NOT NULL DEFAULT 'DRAFT'
--     CHECK (state IN ('DRAFT', 'PROCESSING', 'FAILED', 'FROZEN'))
--
-- El trigger de la migración Foundation (20260925120000:249-253) también lo
-- asume: permite DRAFT -> PROCESSING | FAILED y PROCESSING -> FROZEN | FAILED.
--
-- El esquema REAL de la base tenía:
--
--   CHECK (state IN ('DRAFT', 'FROZEN', 'FAILED'))
--
-- Es decir, PROCESSING no estaba permitido. Y no por una decisión posterior:
-- nadie en el ledger estrecha ese CHECK. La tabla se creó FUERA del registro de
-- migraciones, y `CREATE TABLE IF NOT EXISTS` de phase-5 fue un no-op
-- silencioso para una tabla que ya existía, de modo que su definición jamás
-- se comprobó contra la declarada.
--
-- MEDIDO en producción, no inferido:
--   - pg_get_constraintdef da ('DRAFT','FROZEN','FAILED')
--   - SELECT state, count(*) FROM fact_extraction_runs GROUP BY state
--     devuelve únicamente DRAFT=1 y FROZEN=9. NUNCA hubo una fila PROCESSING.
--
-- LA CADENA COMPLETA DEL INCIDENTE (auditoría 4956e983)
--
--   CHECK sin PROCESSING
--     -> PROCESSING es inalcanzable
--       -> freeze_fact_run_v1 exige state = 'PROCESSING' y falla siempre
--         -> FACT_RUN_NOT_PROCESSING: DRAFT
--           -> el handler lo clasificaba como transitorio y reintentaba
--             -> el job queda RETRY_SCHEDULED
--               -> la UI veía "activo" y repetía POST /api/jobs/process
--
--   Es decir: el bucle era el SÍNTOMA. La causa era que el estado que el
--   congelado exige no se podía alcanzar.
--
-- POR QUÉ ES SEGURO RESTAURARLO
--
--   - No hay ninguna fila en PROCESSING que pueda quedar huerfana: no existe
--     ninguna, y el CHECK nuevo la acepta sin más.
--   - No se toca el trigger guard_fact_run_transition, que ya definía las
--     transiciones legales. Este CHECK deja de contradecirlo.
--   - No se abre ninguna transición nueva: FROZEN sigue siendo terminal, porque
--     el trigger lo bloquea. El CHECK sólo deja de impedir un estado que el
--     trigger ya gobernaba.
--   - Es forward-only. No edita ninguna migración ya aplicada.
-- ============================================================================

-- 1) Se suelta el CHECK actual y se vuelve a declarar el del diseño.
--    DROP + ADD y no un ALTER más directo porque el nombre puede haber
--    cambiado; se usa IF EXISTS para que sea idempotente.
ALTER TABLE public.fact_extraction_runs
  DROP CONSTRAINT IF EXISTS fact_extraction_runs_state_check;

ALTER TABLE public.fact_extraction_runs
  ADD CONSTRAINT fact_extraction_runs_state_check
  CHECK (state IN ('DRAFT', 'PROCESSING', 'FAILED', 'FROZEN'));

-- 2) Comprobación. Si esto pasa, PROCESSING es escribible y el lifecycle
--    DRAFT -> PROCESSING -> FROZEN existe de verdad. Se hace con un UPDATE que
--    se revierte, para no dejar filas tocan.
DO $$
DECLARE
  v_target uuid;
  v_state text;
BEGIN
  SELECT id, state INTO v_target, v_state
  FROM public.fact_extraction_runs
  WHERE state = 'DRAFT'
  ORDER BY created_at
  LIMIT 1;

  IF v_target IS NULL THEN
    RAISE NOTICE 'STATE_CHECK_REPAIR: no hay Fact Run en DRAFT para verificar; el CHECK queda declarado.';
    RETURN;
  END IF;

  -- Se prueba la escritura y se revierte. No hay una forma de "comprobar" un
  -- CHECK sin escribir, y no se quiere dejar el run en PROCESSING por un test.
  BEGIN
    UPDATE public.fact_extraction_runs SET state = 'PROCESSING' WHERE id = v_target;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'STATE_CHECK_REPAIR_FAILED: no se pudo escribir PROCESSING';
    END IF;
    RAISE NOTICE 'STATE_CHECK_REPAIR: PROCESSING es escribible sobre el Fact Run % (estado previo %). Se revierte.', v_target, v_state;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'STATE_CHECK_REPAIR_FAILED: %', SQLERRM;
  END;
END $$;
