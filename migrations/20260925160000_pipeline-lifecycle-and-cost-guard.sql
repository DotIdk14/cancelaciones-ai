-- ============================================================================
-- Pipeline lifecycle + guard de coste  (FORWARD-ONLY, no edita migraciones aplicadas)
-- ============================================================================
--
-- ORIGEN: incidente del 2026-09-25, auditoría 4956e983.
--
-- CAUSA RAÍZ MEDIDA
--   freezeFactRunWithSnapshot tenía DOS caminos:
--     - RPC   (freeze_fact_run_v1), que EXIGE state = 'PROCESSING'
--     - local, que recorría DRAFT -> PROCESSING -> FROZEN
--   La transición a PROCESSING estaba SÓLO en el camino local, después del
--   intento por RPC. En cuanto la migración 20260925120000 hizo disponible el
--   RPC, todos los freezes pasaron por el camino que NO mueve el estado, y el
--   RPC respondió FACT_RUN_NOT_PROCESSING: DRAFT.
--
--   Es decir: aplicar Foundation habilitó el camino bueno y dejó vivo el malo.
--   No es un defecto del trigger ni del RPC: es que nadie hacía la transición.
--
-- LO QUE HACE ESTA MIGRACIÓN
--   1. UNA transición autoritativa, atómica e idempotente: la declara el
--      servidor, no un UPDATE disperso desde un handler.
--   2. Un ledger durable de operaciones pagadas, para que un reintento no
--      vuelva a facturar. Exactly-once en DB, no en el código.
--   3. Endurece la ACL de ai_usage y provider_operations.
--
-- LO QUE NO HACE
--   - No toca el motor normativo, ni reglas, ni umbrales, ni outcomes.
--   - No edita ninguna migración ya aplicada.
--   - No inventa precios: si el proveedor no los da, el coste queda NULL.
--     NULL significa DESCONOCIDO y 0 significa GRATIS. No son lo mismo, y
--     confundirlos es como se hides un gasto.
-- ============================================================================


-- =============================================================================
-- 1) Transición autoritativa DRAFT -> PROCESSING
--
-- Por qué una función y no un UPDATE desde TypeScript:
--   - Es atómica: lee y escribe bajo bloqueo de fila, así que dos workers
--     simultáneos no pueden intercalar.
--   - Es idempotente: llamarla dos veces no hace daño, que es exactamente lo
--     que necesita un reintento o un refresh de navegador.
--   - Es el ÚNICO sitio donde se decide. Un UPDATE disperso puede volver a
--     aparecer en un handler y reintroducir el bug.
--
-- Semántica, según lo pedido:
--   DRAFT      -> PROCESSING   devuelve 'PROCESSING'         (hace el trabajo)
--   PROCESSING -> PROCESSING   devuelve 'ALREADY_PROCESSING' (idempotente)
--   FROZEN     -> sin cambios  devuelve 'ALREADY_FROZEN'     (no-op, no error)
--   inexistente->              lanza FACT_RUN_NOT_FOUND
--
-- FROZEN no es un error a propósito: quien llama necesita poder preguntar
-- "¿en qué estado está?" sin distinguir un error de una respuesta. Lo que
-- prohibits es REESCRIBIR un FROZEN, y eso lo sigue bloqueando
-- guard_fact_run_transition, que esta función no intenta eludir: nunca
-- escribe un estado que no sea PROCESSING.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.begin_fact_run_processing_v1(p_fact_run_id uuid)
RETURNS TABLE (out_fact_run_id uuid, out_state text, out_transition text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_run public.fact_extraction_runs;
BEGIN
  IF p_fact_run_id IS NULL THEN
    RAISE EXCEPTION 'FACT_RUN_ID_REQUIRED';
  END IF;

  -- FOR UPDATE serializa a los llamadores concurrentes durante la transición.
  SELECT * INTO v_run
  FROM public.fact_extraction_runs
  WHERE id = p_fact_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FACT_RUN_NOT_FOUND';
  END IF;

  IF v_run.state = 'FROZEN' THEN
    -- Irreversible. No se toca. No es un error: es una respuesta.
    out_fact_run_id := v_run.id;
    out_state := 'FROZEN';
    out_transition := 'ALREADY_FROZEN';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_run.state = 'PROCESSING' THEN
    out_fact_run_id := v_run.id;
    out_state := 'PROCESSING';
    out_transition := 'ALREADY_PROCESSING';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_run.state <> 'DRAFT' THEN
    -- FAILED u otro estado inesperado: no se reintenta a ciegas.
    RAISE EXCEPTION 'FACT_RUN_STATE_NOT_PROCESSABLE: %', v_run.state;
  END IF;

  UPDATE public.fact_extraction_runs
  SET state = 'PROCESSING', updated_at = now()
  WHERE id = v_run.id AND state = 'DRAFT';

  out_fact_run_id := v_run.id;
  out_state := 'PROCESSING';
  out_transition := 'PROCESSING';
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.begin_fact_run_processing_v1(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.begin_fact_run_processing_v1(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.begin_fact_run_processing_v1(uuid) TO authenticated;


-- =============================================================================
-- 2) Ledger durable de operaciones pagadas
--
-- El problema que resuelve, concreto: un reintento de job vuelve a ejecutar el
-- handler. Si el handler vuelve a llamar a AssemblyAI u OpenRouter, se paga dos
-- veces por la misma operación lógica. React state no lo evita, y el lease del
-- job tampoco: el lease garantiza un solo worker CONCURRENTE, no que un
-- reintento posterior no repita el trabajo ya pagado.
--
-- La identidad de una operación lógica pagada es su HUELLA, no su id:
--   request_fingerprint = hash estable de (auditoría, job, etapa, input)
-- Con esa huella:
--   - Si ya hay una operación SUCCEEDED, se REUTILIZA su resultado. No se paga.
--   - Si hay una SUBMITTED sin cerrar, el proceso murió después de enviar al
--     proveedor y antes de guardar el resultado. NO se puede saber si el
--     proveedor aceptó. Se devuelve PROVIDER_RESULT_UNKNOWN y se PARA, en vez
--     de repetir a ciegas. Cobrar dos veces sin saberlo es peor que parar.
--
-- El poll de estado NO es una operación pagada. Se registra con
-- operation_type = 'POLL', que no cuenta para coste.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.begin_provider_operation_v1(
  p_job_id uuid,
  p_attempt_id uuid,
  p_evidence_id uuid,
  p_provider text,
  p_operation_type text,
  p_request_fingerprint text,
  p_billable boolean DEFAULT true
)
RETURNS TABLE (
  out_provider_operation_id uuid,
  out_status text,
  out_external_operation_id text,
  out_should_execute boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_existing public.provider_operations;
BEGIN
  IF p_request_fingerprint IS NULL OR btrim(p_request_fingerprint) = '' THEN
    RAISE EXCEPTION 'REQUEST_FINGERPRINT_REQUIRED';
  END IF;

  SELECT * INTO v_existing
  FROM public.provider_operations
  WHERE request_fingerprint = p_request_fingerprint
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.status = 'SUCCEEDED' THEN
      -- Ya se pagó y ya se guardó. No se vuelve a pagar.
      out_provider_operation_id := v_existing.id;
      out_status := 'SUCCEEDED';
      out_external_operation_id := v_existing.external_operation_id;
      out_should_execute := false;
      RETURN NEXT;
      RETURN;
    END IF;
    IF v_existing.status = 'SUBMITTED' AND p_billable THEN
      -- Enviado y sin cerrar: el resultado es desconocido. Se PARA.
      out_provider_operation_id := v_existing.id;
      out_status := 'RESULT_UNKNOWN';
      out_external_operation_id := v_existing.external_operation_id;
      out_should_execute := false;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.provider_operations (
    job_id, attempt_id, evidence_id, provider, operation_type,
    request_fingerprint, status, submitted_at, created_at, updated_at
  ) VALUES (
    p_job_id, p_attempt_id, p_evidence_id, p_provider, p_operation_type,
    p_request_fingerprint, 'SUBMITTED', now(), now(), now()
  )
  RETURNING * INTO v_existing;

  out_provider_operation_id := v_existing.id;
  out_status := 'SUBMITTED';
  out_external_operation_id := NULL;
  out_should_execute := true;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_provider_operation_v1(
  p_provider_operation_id uuid,
  p_status text,
  p_external_operation_id text DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_error_message text DEFAULT NULL
)
RETURNS TABLE (out_provider_operation_id uuid, out_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_row public.provider_operations;
BEGIN
  IF p_status NOT IN ('SUCCEEDED', 'FAILED', 'RESULT_UNKNOWN') THEN
    RAISE EXCEPTION 'PROVIDER_OPERATION_STATUS_INVALID: %', p_status;
  END IF;

  UPDATE public.provider_operations
  SET status = p_status,
      external_operation_id = COALESCE(p_external_operation_id, external_operation_id),
      error_code = p_error_code,
      error_message_sanitized = left(COALESCE(p_error_message, ''), 500),
      completed_at = CASE WHEN p_status = 'SUCCEEDED' THEN now() ELSE completed_at END,
      updated_at = now()
  WHERE id = p_provider_operation_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROVIDER_OPERATION_NOT_FOUND';
  END IF;

  out_provider_operation_id := v_row.id;
  out_status := v_row.status;
  RETURN NEXT;
END;
$$;

-- Exactly-once del ledger de coste. El índice único
-- ai_usage_provider_operation_request_fingerprint_key
-- (provider, operation, request_fingerprint) ya existía; esta función lo
-- convierte en la GARANTÍA de que un reintento no duplica la fila de coste.
--
-- Coste: se escribe lo que el proveedor reporta. Si no lo reporta y no hay pricing
-- configurado, estimated_cost_usd queda NULL y cost_source = 'UNKNOWN'. Poner
-- 0 sería afirmar que la llamada fue gratis, que es una afirmación distinta y
-- falsa.
CREATE OR REPLACE FUNCTION public.record_ai_usage_v1(
  p_audit_id uuid,
  p_job_id uuid,
  p_attempt_id uuid,
  p_evidence_id uuid,
  p_provider text,
  p_operation text,
  p_request_fingerprint text,
  p_provider_operation_id uuid DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_unit_type text DEFAULT NULL,
  p_input_units numeric DEFAULT NULL,
  p_output_units numeric DEFAULT NULL,
  p_unit_price_usd numeric DEFAULT NULL,
  p_estimated_cost_usd numeric DEFAULT NULL,
  p_currency text DEFAULT 'USD',
  p_cost_source text DEFAULT 'UNKNOWN',
  p_provider_request_id text DEFAULT NULL
)
RETURNS TABLE (out_ai_usage_id uuid, out_recorded boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_cost_source NOT IN ('PROVIDER_REPORTED', 'CALCULATED', 'ESTIMATED', 'UNKNOWN') THEN
    RAISE EXCEPTION 'COST_SOURCE_INVALID: %', p_cost_source;
  END IF;

  INSERT INTO public.ai_usage (
    audit_id, job_id, attempt_id, evidence_id, provider, operation,
    request_fingerprint, provider_operation_id, model, unit_type,
    input_units, output_units, unit_price_usd, estimated_cost_usd,
    currency, recorded_at
  ) VALUES (
    p_audit_id, p_job_id, p_attempt_id, p_evidence_id, p_provider, p_operation,
    p_request_fingerprint, p_provider_operation_id, p_model, p_unit_type,
    p_input_units, p_output_units, p_unit_price_usd, p_estimated_cost_usd,
    p_currency, now()
  )
  ON CONFLICT (provider, operation, request_fingerprint) DO NOTHING
  RETURNING id INTO v_id;

  -- Reintento de la MISMA operación lógica: no se cobra dos veces, y la
  -- respuesta lo dice en vez de fingir que grabó algo.
  out_recorded := (v_id IS NOT NULL);
  out_ai_usage_id := v_id;
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.begin_provider_operation_v1(uuid, uuid, uuid, text, text, text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.begin_provider_operation_v1(uuid, uuid, uuid, text, text, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.begin_provider_operation_v1(uuid, uuid, uuid, text, text, text, boolean) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.complete_provider_operation_v1(uuid, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_provider_operation_v1(uuid, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_provider_operation_v1(uuid, text, text, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.record_ai_usage_v1(uuid, uuid, uuid, uuid, text, text, text, uuid, text, text, numeric, numeric, numeric, numeric, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_ai_usage_v1(uuid, uuid, uuid, uuid, text, text, text, uuid, text, text, numeric, numeric, numeric, numeric, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_ai_usage_v1(uuid, uuid, uuid, uuid, text, text, text, uuid, text, text, numeric, numeric, numeric, numeric, text, text, text) TO authenticated;


-- =============================================================================
-- 3) ACL de las tablas de coste
--
-- MEDIDO con has_table_privilege tras aplicar la migración Foundation:
--   anon | ai_usage            -> SELECT, INSERT, UPDATE, DELETE
--   anon | provider_operations -> SELECT, INSERT, UPDATE, DELETE
--
-- RLS está ACTIVADA en ambas y ninguna política es TO anon, así que el día de
-- hoy anon ya está effectively denegado. Pero el privilegio existe, y la
-- escritura de coste es justo el dato que un atacante querría manipular: borrar
-- filas esconde gasto y falsificarlas lo distorsiona.
--
-- Se cierra el privilegio, no se depende de que RLS siga puesto. La escritura
-- pasa por las funciones de arriba, que son SECURITY DEFINER.
-- =============================================================================
REVOKE ALL ON public.ai_usage, public.provider_operations FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.ai_usage, public.provider_operations FROM authenticated;
GRANT SELECT ON public.ai_usage, public.provider_operations TO authenticated;

-- Comprobación: si la migración hizo su trabajo, esto no debe encontrar filas.
DO $$
DECLARE
  v_leaks integer;
BEGIN
  SELECT count(*) INTO v_leaks
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN ('ai_usage', 'provider_operations')
    AND grantee = 'anon';
  IF v_leaks > 0 THEN
    RAISE EXCEPTION 'COST_TABLE_ACL_NOT_HARDENED: % privilegios residuales para anon', v_leaks;
  END IF;
END $$;
