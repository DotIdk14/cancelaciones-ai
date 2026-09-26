-- ============================================================================
-- RECONCILIACION DEL LEDGER (sin cambio de contenido normativo)
--
-- Fichero original del repositorio: migrations/20260926120000_integrity-gate-
--   engine-write-boundary.sql
-- Version original en el repositorio: 20260926120000
-- Version registrada en el ledger del backend: 20260926183000
--
-- El archivo se creo en el repositorio con la version 20260926120000, pero el
-- scaffold de la CLI (`db migrations new`) genera su propio timestamp y fue el
-- que quedo registrado y aplicado en el ledger como 20260926183000. El
-- contenido aplicado es el mismo; solo divergia el numero.
--
-- Se renombra el fichero a la version del ledger conservando la original en
-- esta cabecera, que es el mismo criterio que ya se aplico a las migraciones
-- 20260925090300, 20260925090600 y 20260925090800. No se altera ninguna
-- sentencia del cuerpo y no se crea una segunda migracion equivalente: existe
-- un unico fichero para una unica version.
--
-- Con esto `repo migration history` y `DEV migration history` coinciden en
-- version y nombre, y `db migrations up` deja de intentar reaplicar este
-- archivo. Migraciones del ledger que siguen sin existir en el repositorio,
-- documentadas y fuera del alcance de seguridad de este gate:
--   20260925120000, 20260925140000, 20260925150000, 20260925160000,
--   20260925161000, 20260925200000
-- Las invariantes de seguridad de 20260925120000 ya estan reproducidas en
-- migrations/20260926190000_fact-run-immutability-reproducible.sql
-- ============================================================================
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
