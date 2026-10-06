-- =============================================================================
-- 20261003000000_paid_admissions.sql — Cuotas atómicas sin Redis.
-- =============================================================================
--
-- ORDEN DE APLICACIÓN
--   Forward-only; el runner aplica la migración en su propia transacción.
--
-- DIRECCIÓN
--   No hay rollback. Es DDL idempotente (CREATE ... IF NOT EXISTS, DROP ... IF
--   EXISTS, REVOKE, GRANT).
--
-- MODELO DE SEGURIDAD
--   - RLS habilitada.
--   - anon y authenticated NO tienen privilegios.
--   - project_admin tiene SELECT e INSERT (la fila se escribe vía la función
--     SECURITY DEFINER, no directamente por el cliente).
--   - La función es SECURITY DEFINER con search_path fijo y REVOKE a PUBLIC,
--     anon y authenticated; sólo project_admin puede ejecutarla.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tabla de admisiones pagadas/login.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.request_admissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_hash text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  operation text NOT NULL CHECK (operation IN ('paid','login')),
  context_hash text NOT NULL,
  admitted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS request_admissions_operation_admitted_at_idx
  ON public.request_admissions (operation, admitted_at);

CREATE INDEX IF NOT EXISTS request_admissions_subject_operation_admitted_at_idx
  ON public.request_admissions (subject_hash, operation, admitted_at);

ALTER TABLE public.request_admissions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.request_admissions FROM anon;
REVOKE ALL ON TABLE public.request_admissions FROM authenticated;
GRANT SELECT, INSERT ON TABLE public.request_admissions TO project_admin;

-- -----------------------------------------------------------------------------
-- 2. Función RPC: admite o rechaza una operación sujeta a cuota.
--
--    - 'paid':  6 por usuario / 60 min, 40 globales / 24 h.
--    - 'login': 5 por email / 15 min, 10 por IP / 15 min.
--
--  La serialización se hace con pg_advisory_xact_lock por operation, así el
--  conteo y la inserción son atómicas dentro de la transacción del llamador.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admit_or_reject_quota(
  p_operation text,
  p_subject_hash text,
  p_context_hash text,
  p_user_id uuid DEFAULT NULL
) RETURNS TABLE(admitted boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_user_limit integer;
  v_user_window interval;
  v_global_limit integer;
  v_global_window interval;
  v_user_count integer;
  v_global_count integer;
  v_oldest timestamptz;
  v_retry integer;
BEGIN
  -- Lock transaccional por operation. Serializa conteos e inserciones para
  -- evitar carreras que superen los límites.
  PERFORM pg_advisory_xact_lock(abs(hashtext('quota:' || COALESCE(p_operation, ''))));

  IF p_operation = 'paid' THEN
    v_user_limit := 6;
    v_user_window := interval '60 minutes';
    v_global_limit := 40;
    v_global_window := interval '24 hours';
  ELSIF p_operation = 'login' THEN
    IF p_context_hash = 'email' THEN
      v_user_limit := 5;
      v_user_window := interval '15 minutes';
      v_global_limit := NULL;
      v_global_window := NULL;
    ELSIF p_context_hash = 'ip' THEN
      v_user_limit := 10;
      v_user_window := interval '15 minutes';
      v_global_limit := NULL;
      v_global_window := NULL;
    ELSE
      RAISE EXCEPTION 'perfil de login desconocido: %', p_context_hash;
    END IF;
  ELSE
    RAISE EXCEPTION 'operación de cuota no soportada: %', p_operation;
  END IF;

  SELECT count(*) INTO v_user_count
  FROM public.request_admissions
  WHERE operation = p_operation
    AND subject_hash = p_subject_hash
    AND admitted_at > now() - v_user_window;

  IF v_global_limit IS NOT NULL THEN
    SELECT count(*) INTO v_global_count
    FROM public.request_admissions
    WHERE operation = p_operation
      AND admitted_at > now() - v_global_window;
  ELSE
    v_global_count := 0;
  END IF;

  IF v_user_count >= v_user_limit OR (v_global_limit IS NOT NULL AND v_global_count >= v_global_limit) THEN
    -- Calcula el retry_after_seconds basado en la admisión más antigua de la
    -- ventana que se agotó.
    IF v_global_limit IS NOT NULL AND v_global_count >= v_global_limit THEN
      SELECT min(admitted_at) INTO v_oldest
      FROM public.request_admissions
      WHERE operation = p_operation
        AND admitted_at > now() - v_global_window;
      v_retry := GREATEST(1, ceil(extract(epoch from (v_oldest + v_global_window - now()))))::integer;
    ELSE
      SELECT min(admitted_at) INTO v_oldest
      FROM public.request_admissions
      WHERE operation = p_operation
        AND subject_hash = p_subject_hash
        AND admitted_at > now() - v_user_window;
      v_retry := GREATEST(1, ceil(extract(epoch from (v_oldest + v_user_window - now()))))::integer;
    END IF;
    RETURN QUERY SELECT false, v_retry;
    RETURN;
  END IF;

  INSERT INTO public.request_admissions (subject_hash, user_id, operation, context_hash, admitted_at)
  VALUES (p_subject_hash, p_user_id, p_operation, p_context_hash, now());

  RETURN QUERY SELECT true, 0::integer;
  RETURN;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admit_or_reject_quota FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admit_or_reject_quota FROM anon;
REVOKE ALL ON FUNCTION public.admit_or_reject_quota FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admit_or_reject_quota TO project_admin;
