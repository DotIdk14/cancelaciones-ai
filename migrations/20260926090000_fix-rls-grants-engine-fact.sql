-- Alinea los privilegios SQL del rol `authenticated` con las políticas RLS ya
-- existentes en las tablas del engine y del fact model.
--
-- Hecho real (verificado 2026-09-26): el historial del repositorio YA declaraba
-- 3 de estos 4 privilegios, pero la base de datos viva no los tenía aplicados:
--   migrations/20260924101000_phase-6-policy-engine.sql:32
--     GRANT SELECT, INSERT ON public.engine_runs, public.engine_rule_results TO authenticated;
--   migrations/20260923220000_phase-5-fact-model-shadow.sql:52
--     GRANT SELECT, INSERT, UPDATE ON public.fact_extraction_runs TO authenticated;
-- La divergencia estaba entre el historial versionado y la base de datos, no
-- entre la política y una omisión del historial. Esta migración alinea la base
-- de datos con lo que el historial ya declaraba.
--
-- El cuarto privilegio (INSERT en policy_source_registry) sí era una omisión
-- real del historial: la tabla no está creada en migrations/. Por eso su GRANT
-- es condicional.
--
-- Por qué importa: Postgres responde `permission denied for table ...` ANTES de
-- evaluar RLS, así que sin el privilegio la política nunca llega a aplicarse.
-- Evidencia: postgres.logs -> "permission denied for table fact_extraction_runs"
-- (2026-09-26T00:09:51Z).
--
-- Aditiva e idempotente: GRANT es idempotente por definición.
-- No se modifica ninguna política.

-- engine_runs: política INSERT existente. El historial ya declaraba
-- SELECT, INSERT; la BD viva solo tenía SELECT. Se re-aplica el INSERT.
GRANT INSERT ON public.engine_runs TO authenticated;

-- engine_rule_results: política INSERT existente. El historial ya declaraba
-- SELECT, INSERT; la BD viva solo tenía SELECT. Se re-aplica el INSERT.
GRANT INSERT ON public.engine_rule_results TO authenticated;

-- fact_extraction_runs: política UPDATE existente (congelamiento del run). El
-- historial ya declaraba SELECT, INSERT, UPDATE; la BD viva no tenía UPDATE.
GRANT UPDATE ON public.fact_extraction_runs TO authenticated;

-- policy_source_registry: política INSERT existente (registro de fuentes).
-- Condicional a propósito: la tabla existe en la BD viva pero NO está creada en
-- ninguna migración de migrations/, así que un entorno limpio construido desde
-- el historial fallaría con `relation "policy_source_registry" does not exist` y
-- rompería la cadena de migraciones. El guard hace que este GRANT sea un no-op
-- en vez de un error cuando la tabla aún no existe.
DO $$
BEGIN
  IF to_regclass('public.policy_source_registry') IS NOT NULL THEN
    GRANT INSERT ON public.policy_source_registry TO authenticated;
  END IF;
END $$;
