-- Corrige paridad entre políticas RLS y privilegios SQL.
-- Contexto: las políticas ya existían para el rol `authenticated`, pero el
-- privilegio SQL correspondiente no estaba otorgado. Postgres responde
-- `permission denied for table ...` ANTES de evaluar RLS, por lo que las
-- políticas nunca se aplicaban. Evidencia: postgres.logs ->
-- "permission denied for table fact_extraction_runs" (2026-09-26T00:09:51Z).
--
-- Additive e idempotente: GRANT es idempotente por definición.
-- No se modifica ninguna política.

-- engine_runs: política INSERT existente, privilegio SELECT únicamente.
GRANT INSERT ON public.engine_runs TO authenticated;

-- engine_rule_results: política INSERT existente, privilegio SELECT únicamente.
GRANT INSERT ON public.engine_rule_results TO authenticated;

-- fact_extraction_runs: política UPDATE existente (congelamiento del run).
GRANT UPDATE ON public.fact_extraction_runs TO authenticated;

-- policy_source_registry: política INSERT existente (registro de fuentes).
GRANT INSERT ON public.policy_source_registry TO authenticated;
