-- ============================================================================
-- CONTRATO DE TELEMETRIA DE COSTE  (FORWARD-ONLY, no edita migraciones aplicadas)
-- ============================================================================
--
-- ORIGEN: cierre de telemetria de coste, 2026-09-25, tras el informe de
--         6bdbbae y la verificacion contra la base real de produccion.
--
-- LO QUE SE MIDIO EN PRODUCCION ANTES DE ESTA MIGRACION
--   public.ai_usage -> 0 filas
--   columnas reales (information_schema, no el fichero de migracion):
--     unit_price_usd      is_nullable = NO
--     estimated_cost_usd  is_nullable = NO
--     cost_source         NO EXISTE
--
--   Es decir: los tres defectos no son hipotesis del informe, son el estado
--   real medido de la tabla.
--
-- DEFECTO A -- LA FUENTE DEL COSTE NO SE PERSISTE
--   record_ai_usage_v1 recibe p_cost_source, lo valida contra
--   PROVIDER_REPORTED | CALCULATED | ESTIMATED | UNKNOWN ... y lo descarta.
--   El INSERT no incluye la columna porque la columna no existe. El requisito
--   "registrar de donde sale el numero" no se cumplia de forma duradera: se
--   validaba un parametro para luego perderlo.
--
-- DEFECTO B -- UN COSTE DESCONOCIDO ES IMPOSIBLE DE REGISTRAR
--   estimated_cost_usd y unit_price_usd son NOT NULL. El diseno del sistema
--   establece, en cambio, que
--       NULL = coste desconocido
--       0    = coste conocido e igual a cero
--   y buildAuditCostSummary cuenta unknownCostEvents con
--   `estimated_cost_usd IS NULL`, una condicion que con NOT NULL NUNCA puede
--   darse. El cubo de "coste desconocido" era codigo muerto: el guard de coste
--   no podia expresar incertidumbre, que es justo la propiedad que se le pidio.
--
-- DEFECTO C -- HALLAZGO NUEVO, MISMA CLASE, MEDIDO AL VERIFICAR A Y B
--   cost-ledger.ts envia SIEMPRE p_unit_price_usd = null. Contra una columna
--   NOT NULL eso es un 23502 en TODAS las llamadas, no solo en las de coste
--   desconocido. Por eso ai_usage esta vacia: la ruta de escritura de coste
--   nunca funciono de extremo a extremo contra la base real, con independencia
--   de si la llamada era de coste conocido o desconocido.
--   El informe anterior dio por buena esa ruta; se verificó contra la base real
--   y no se reproduce. Se corrige aqui por ser el mismo defecto.
--
-- LO QUE HACE ESTA MIGRACION
--   1. Anade cost_source durable, con CHECK de los 4 valores del contrato real
--      del codigo (no se inventan nombres nuevos).
--   2. Anade provider_request_id, que el RPC ya recibia y tambien descartaba.
--   3. Permite NULL en estimated_cost_usd, unit_price_usd, input_units y
--      output_units: lo desconocido se guarda como desconocido, no como 0.
--   4. Encarna en el esquema la regla "UNKNOWN nunca es 0" y "PROVIDER_REPORTED
--      siempre trae numero", para que la mentira sea imposible por construccion
--      y no por disciplina del que escribe.
--   5. Rehace record_ai_usage_v1 para que persista de verdad lo que valida, y
--      para que los campos obligatorios fallen con un error legible en vez de
--      con un 23502 opaco.
--
-- LO QUE NO HACE
--   - No toca el motor normativo, ni reglas, ni umbrales, ni outcomes, ni
--     Golden Master.
--   - No edita ninguna migracion ya aplicada.
--   - No inventa precios. Si no se sabe lo que costo, NULL y 'UNKNOWN'.
--     Poner 0 seria afirmar que la llamada fue gratis, que es una afirmacion
--     distinta y falsa.
--
-- NOTA SOBRE EL RELLENO DE cost_source
--   En el momento de aplicar, ai_usage tiene 0 filas, asi que el backfill no
--   mueve nada. Se escribe igualmente y de forma honesta, porque esta migracion
--   tiene que ser correcta aunque se aplique sobre datos: las filas anteriores
--   guardan un numero del que NO se guardo la procedencia, y la etiqueta
--   honesta para "hay un numero pero no se de donde salio" es 'UNKNOWN'.
--   'UNKNOWN' con un coste no nulo es un estado coherente: significa
--   procedencia desconocida, no cifra inexistente. Lo que queda prohibido es
--   'UNKNOWN' con 0, y eso lo hace cumplir un CHECK mas abajo.
-- ============================================================================


-- =============================================================================
-- 1) Columnas durables
--
-- IF NOT EXISTS para que la migracion sea re-aplicable sin romper. Contexto
-- obvio: una migracion que solo funciona la primera vez no es una migracion,
-- es un guion.
-- =============================================================================
ALTER TABLE public.ai_usage
  ADD COLUMN IF NOT EXISTS cost_source text;

ALTER TABLE public.ai_usage
  ADD COLUMN IF NOT EXISTS provider_request_id text;

COMMENT ON COLUMN public.ai_usage.cost_source IS
  'De donde sale el coste: PROVIDER_REPORTED | CALCULATED | ESTIMATED | UNKNOWN. NULL = desconocido.';

COMMENT ON COLUMN public.ai_usage.provider_request_id IS
  'Identificador de la operacion en el proveedor (p.ej. id de respuesta de OpenRouter).';


-- =============================================================================
-- 2) Backfill honesto antes de cerrar el NOT NULL
--
-- Se hace ANTES del SET NOT NULL a proposito: en ese punto la columna es
-- nullable y este UPDATE es legal. Si se invirtiera el orden, el NOT NULL
-- fallaria con filas sin rellenar.
-- =============================================================================
UPDATE public.ai_usage
SET cost_source = 'UNKNOWN'
WHERE cost_source IS NULL;

-- Las columnas que pasaban a NULL no necesitan backfill: su valor actual es
-- 0 por defecto historico, y 0 es un dato afirma que no es lo que significa
-- NULL. Se documenta como limitacion asumida: son 0 filas hoy.


-- =============================================================================
-- 3) Las tres invariantes del ledger, en el esquema
--
-- Se numeran a proposito. Una base de coste que no puede expresar
-- incertidumbre es un ledger que obliga a mentir.
-- =============================================================================
ALTER TABLE public.ai_usage
  DROP CONSTRAINT IF EXISTS ai_usage_cost_source_check;

ALTER TABLE public.ai_usage
  ADD CONSTRAINT ai_usage_cost_source_check
  CHECK (cost_source IN ('PROVIDER_REPORTED', 'CALCULATED', 'ESTIMATED', 'UNKNOWN'));

-- NULL = desconocido, 0 = gratis. Se retira el NOT NULL para que la distincion
-- sea representable. Los CHECK >= 0 ya existentes siguen siendo validos: en SQL
-- un CHECK solo rechaza cuando la expresion es FALSE, y NULL >= 0 es NULL.
ALTER TABLE public.ai_usage
  ALTER COLUMN estimated_cost_usd DROP NOT NULL;

ALTER TABLE public.ai_usage
  ALTER COLUMN unit_price_usd DROP NOT NULL;

-- Defecto C: misma clase. Un proveedor puede no devolver unidades, y eso es
-- "no lo sé", no "cero".
ALTER TABLE public.ai_usage
  ALTER COLUMN input_units DROP NOT NULL;

ALTER TABLE public.ai_usage
  ALTER COLUMN output_units DROP NOT NULL;

-- cost_source pasa a obligatorio: sin procedencia, un numero no significa nada.
ALTER TABLE public.ai_usage
  ALTER COLUMN cost_source SET DEFAULT 'UNKNOWN';

ALTER TABLE public.ai_usage
  ALTER COLUMN cost_source SET NOT NULL;


-- =============================================================================
-- 4) Las dos mentiras que el esquema prohibe
--
-- Estas dos constraints son la parte que no es solo permitir NULL: es impedir
-- activamente la afirmacion falsa.
-- =============================================================================
ALTER TABLE public.ai_usage
  DROP CONSTRAINT IF EXISTS ai_usage_unknown_cost_not_zero_check;

ALTER TABLE public.ai_usage
  ADD CONSTRAINT ai_usage_unknown_cost_not_zero_check
  CHECK (cost_source <> 'UNKNOWN' OR estimated_cost_usd IS NULL OR estimated_cost_usd <> 0);

ALTER TABLE public.ai_usage
  DROP CONSTRAINT IF EXISTS ai_usage_provider_reported_requires_cost_check;

ALTER TABLE public.ai_usage
  ADD CONSTRAINT ai_usage_provider_reported_requires_cost_check
  CHECK (cost_source <> 'PROVIDER_REPORTED' OR estimated_cost_usd IS NOT NULL);


-- =============================================================================
-- 5) record_ai_usage_v1: persistir lo que se valida
--
-- La firma NO cambia. Cambiar la firma de un RPC que ya esta desplegado
-- rompe al cliente en produccion en lugar de arreglarla; se mantiene identica
-- y se corrige el cuerpo.
--
-- Diferencias con la version anterior, todas dentro del mismo contrato:
--   - persiste cost_source (Defecto A)
--   - persiste provider_request_id (Defecto A, mismo patron de dato perdido)
--   - no convierte NULL en 0 en ningun campo (Defecto B/C)
--   - campos obligatorios con error legible en vez de 23502 opaco
--   - coherencia de la semantica verificada en SQL, no confiada al cliente
-- =============================================================================
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
  v_cost_source text := COALESCE(NULLIF(btrim(p_cost_source), ''), 'UNKNOWN');
BEGIN
  -- --- Validacion con errores legibles -----------------------------------
  -- Se valida ANTES de escribir, y el motivo es concreto: un 23502 o un 23514
  -- sin contexto obliga a ir a mirar el catalogo para descubrir que campo
  -- fallo. Un COSTE_SOURCE_INVALID:<valor> dice que paso, en la linea.
  IF v_cost_source NOT IN ('PROVIDER_REPORTED', 'CALCULATED', 'ESTIMATED', 'UNKNOWN') THEN
    RAISE EXCEPTION 'COST_SOURCE_INVALID: %', p_cost_source;
  END IF;

  IF p_audit_id IS NULL THEN
    RAISE EXCEPTION 'AI_USAGE_AUDIT_ID_REQUIRED';
  END IF;
  IF p_provider IS NULL OR btrim(p_provider) = '' THEN
    RAISE EXCEPTION 'AI_USAGE_PROVIDER_REQUIRED';
  END IF;
  IF p_operation IS NULL OR btrim(p_operation) = '' THEN
    RAISE EXCEPTION 'AI_USAGE_OPERATION_REQUIRED';
  END IF;
  IF p_request_fingerprint IS NULL OR btrim(p_request_fingerprint) = '' THEN
    RAISE EXCEPTION 'AI_USAGE_REQUEST_FINGERPRINT_REQUIRED';
  END IF;

  -- unit_type sigue siendo NOT NULL en el esquema (es una clasificacion, no una
  -- medida) y es obligatorio que se diga de forma explicita. Se mantiene la
  -- columna NOT NULL: que no haya alternativa honesta a "no se que unidad es"
  -- es correcto, porque esa fila no seria informacion sino ruido.
  IF p_unit_type IS NULL OR btrim(p_unit_type) = '' THEN
    RAISE EXCEPTION 'AI_USAGE_UNIT_TYPE_REQUIRED';
  END IF;

  -- Coherencia de la semantica del coste, verificada aqui y no solo en el
  -- CHECK, para que el error diga QUE se violo y no "ai_usage_xxx_check".
  IF v_cost_source = 'UNKNOWN' AND p_estimated_cost_usd = 0 THEN
    -- Esta es la mentira que el ledger no puede permitirse: afirmar que se
    -- conoce un coste de cero cuando lo que se sabe es que no se sabe.
    RAISE EXCEPTION 'COST_UNKNOWN_CANNOT_BE_ZERO';
  END IF;
  IF v_cost_source = 'PROVIDER_REPORTED' AND p_estimated_cost_usd IS NULL THEN
    -- Etiquetar como reportado por el proveedor algo que no trae cifra
    -- contradice la etiqueta misma.
    RAISE EXCEPTION 'COST_PROVIDER_REPORTED_REQUIRES_AMOUNT';
  END IF;

  -- --- Escritura ----------------------------------------------------------
  -- NULL entra como NULL. No hay COALESCE(..., 0) en ningun campo de coste ni
  -- de unidades, y no debe haberlo: seria exactamente el defecto que esta
  -- migracion viene a corregir.
  INSERT INTO public.ai_usage (
    audit_id, job_id, attempt_id, evidence_id, provider, operation,
    request_fingerprint, provider_operation_id, model, unit_type,
    input_units, output_units, unit_price_usd, estimated_cost_usd,
    currency, cost_source, provider_request_id, recorded_at
  ) VALUES (
    p_audit_id, p_job_id, p_attempt_id, p_evidence_id, p_provider, p_operation,
    p_request_fingerprint, p_provider_operation_id, p_model, p_unit_type,
    p_input_units, p_output_units, p_unit_price_usd, p_estimated_cost_usd,
    p_currency, v_cost_source, p_provider_request_id, now()
  )
  ON CONFLICT (provider, operation, request_fingerprint) DO NOTHING
  RETURNING id INTO v_id;

  -- Reintento de la MISMA operacion logica: no se cobra dos veces, y la
  -- respuesta lo dice en vez de fingir que grabo algo.
  out_recorded := (v_id IS NOT NULL);
  out_ai_usage_id := v_id;
  RETURN NEXT;
END;
$$;

-- La firma es identica a la anterior, asi que los privilegios sobreviven a
-- CREATE OR REPLACE. Se repiten de todas formas, porque la migracion que los
-- fijo (20260925160000) podria no haberse aplicado en un entorno restaurado,
-- y el coste de esta linea es cero.
REVOKE EXECUTE ON FUNCTION public.record_ai_usage_v1(uuid, uuid, uuid, uuid, text, text, text, uuid, text, text, numeric, numeric, numeric, numeric, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_ai_usage_v1(uuid, uuid, uuid, uuid, text, text, text, uuid, text, text, numeric, numeric, numeric, numeric, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_ai_usage_v1(uuid, uuid, uuid, uuid, text, text, text, uuid, text, text, numeric, numeric, numeric, numeric, text, text, text) TO authenticated;


-- =============================================================================
-- 6) Validacion post-apply DENTRO de la migracion
--
-- No se dice "ya esta" porque el runner lo dijo. Se comprueba, y si algo no
-- cuadra la migracion falla aqui y no en un informe de tres fases despues.
-- =============================================================================
DO $$
DECLARE
  v_cost_source_is_nullable text;
  v_cost_is_nullable text;
  v_unit_price_is_nullable text;
BEGIN
  SELECT is_nullable INTO v_cost_source_is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'ai_usage' AND column_name = 'cost_source';

  SELECT is_nullable INTO v_cost_is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'ai_usage' AND column_name = 'estimated_cost_usd';

  SELECT is_nullable INTO v_unit_price_is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'ai_usage' AND column_name = 'unit_price_usd';

  IF v_cost_source_is_nullable IS DISTINCT FROM 'NO' THEN
    RAISE EXCEPTION 'COST_SOURCE_NOT_DURABLE: cost_source is_nullable = %, se esperaba NO', v_cost_source_is_nullable;
  END IF;
  IF v_cost_is_nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION 'COST_STILL_NOT_NULL: estimated_cost_usd is_nullable = %, se esperaba YES', v_cost_is_nullable;
  END IF;
  IF v_unit_price_is_nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION 'UNIT_PRICE_STILL_NOT_NULL: unit_price_usd is_nullable = %, se esperaba YES', v_unit_price_is_nullable;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ai_usage'::regclass
      AND conname = 'ai_usage_cost_source_check'
  ) THEN
    RAISE EXCEPTION 'COST_SOURCE_CHECK_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ai_usage'::regclass
      AND conname = 'ai_usage_unknown_cost_not_zero_check'
  ) THEN
    RAISE EXCEPTION 'UNKNOWN_NOT_ZERO_CHECK_MISSING';
  END IF;
END $$;
