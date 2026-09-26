-- INTEGRITY GATE: frontera de escritura de la decisión de máquina.
--
-- Contexto verificado empíricamente en DEV (2026-09-26): con un JWT de
-- `authenticated` —la misma credencial que recibe el navegador— era posible
-- ejecutar INSERT en `engine_runs` y en `engine_rule_results` (HTTP 201).
-- El consumidor de Dictamen (`apps/web/src/server/dictamen/service.ts:62-71`)
-- lee `ORDER BY created_at DESC LIMIT 1`, de modo que un engine_run forjado se
-- convertía en la decisión de máquina leída por el Dictamen.
--
-- Violaba los invariantes PRESERVE_MACHINE_DECISION y TRACE_EVERY_DECISION.
--
-- Corrección: la escritura de la decisión oficial pasa exclusivamente por
-- `persist_policy_evaluation_v1`, que es SECURITY DEFINER y valida actor,
-- fact run FROZEN, fingerprints y reglas evaluadas. Se revoca al rol cliente
-- el INSERT directo en ambas tablas. La lectura no cambia: el Dictamen sigue
-- viendo su engine_run, ahora solo escribible por la frontera.
--
-- No se modifica ninguna regla, outcome ni criterio del procedimiento.
-- No altera evaluatePolicy ni el motor: solo persistencia.

-- 1) Retirar al rol cliente la capacidad de escribir la decisión de máquina.
REVOKE INSERT ON public.engine_runs FROM authenticated;
REVOKE INSERT ON public.engine_rule_results FROM authenticated;

-- 2) Las políticas RLS de INSERT quedan sin efecto práctico para el cliente.
--    Se eliminan para que el esquema no anuncie una capacidad que ya no existe
--    y para que una futura reintroducción del privilegio no reactive el
--    hueco por accidente.
DROP POLICY IF EXISTS engine_runs_insert_visible_audits ON public.engine_runs;
DROP POLICY IF EXISTS engine_rule_results_insert_visible_runs ON public.engine_rule_results;

-- 3) La frontera oficial conserva EXECUTE para el rol cliente: es la única
--    vía por la que el backend persiste una evaluación. `persist_policy_evaluation_v1`
--    es SECURITY DEFINER y ya realiza la autorización real (actor no nulo,
--    audit visible, fact run FROZEN).
GRANT EXECUTE ON FUNCTION public.persist_policy_evaluation_v1(
  uuid, uuid, text, text, text, text, text, text, jsonb, jsonb, jsonb, text, text, uuid
) TO authenticated;
