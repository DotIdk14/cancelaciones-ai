-- =============================================================================
-- 20261008100000 — Rol `manager` en app_memberships.
--
-- Idempotente, forward-only, sin BEGIN/COMMIT. NO escribe ni reescribe ninguna
-- fila: sólo amplía el vocabulario cerrado de `app_memberships.role` para admitir
-- el tercer rol. Trae un bloque `DO $verify$` que falla si el CHECK no queda con
-- los tres valores.
--
-- POR QUÉ EXISTE
--   El rol Gerente (solo lectura global) lo introduce la feature de revisión
--   humana por roles. `app_memberships.role` hoy acepta `('user','coordinator')`
--   (migración `20261002000000_auth-core.sql`). El código (`src/server/auth.ts`)
--   ya modela `AppRole = 'user' | 'coordinator' | 'manager'`, así que la base
--   debe admitir el tercer valor o la fila de un Gerente no se puede aprovisionar.
--
-- POR QUÉ DROP + ADD Y NO UN SEGUNDO CHECK
--   `CREATE TABLE` dejó el CHECK inline con el nombre que PostgreSQL genera
--   (`app_memberships_role_check`). Ampliar el vocabulario exige REEMPLAZAR ese
--   CHECK: un segundo `ADD CONSTRAINT` sobre la misma columna dejaría DOS checks,
--   y el viejo (`IN ('user','coordinator')`) seguiría rechazando `manager`. El
--   `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` es la forma idempotente de
--   sustituir la restricción sin tocar la columna.
--
-- NO REWRITE / FILAS EXISTENTES VÁLIDAS
--   Ni `DROP CONSTRAINT` ni `ADD CONSTRAINT` tocan las filas. El `ADD` VALIDA las
--   filas existentes contra el nuevo vocabulario; `user` y `coordinator` siguen
--   admitidos, así que ninguna fila existente se modifica ni se rechaza. La
--   migración no reescribe `user_id` ni `role` de ninguna fila.
-- =============================================================================

ALTER TABLE public.app_memberships
  DROP CONSTRAINT IF EXISTS app_memberships_role_check;

ALTER TABLE public.app_memberships
  ADD CONSTRAINT app_memberships_role_check
  CHECK (role IN ('user','coordinator','manager'));

-- -----------------------------------------------------------------------------
-- Verificación
-- -----------------------------------------------------------------------------
DO $verify$
DECLARE
  v_count int;
BEGIN
  -- 1) La tabla existe (no se crea aquí: viene de auth-core).
  IF to_regclass('public.app_memberships') IS NULL THEN
    RAISE EXCEPTION 'membership_role_manager: falta public.app_memberships. Esta migración se aplica sobre el esquema con auth-core ya aplicado.';
  END IF;

  -- 2) Exactamente UN check sobre la tabla. Si quedara el check viejo junto al
  --    nuevo, aquí habría dos y `manager` seguiría bloqueado por el viejo.
  SELECT count(*) INTO v_count
  FROM pg_constraint
  WHERE conrelid = 'public.app_memberships'::regclass
    AND contype = 'c';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'membership_role_manager: se esperaba exactamente 1 CHECK sobre public.app_memberships y hay % (¿quedó el check viejo junto al nuevo?)', v_count;
  END IF;

  -- 3) Ese único CHECK conserva user/coordinator y añade manager.
  SELECT count(*) INTO v_count
  FROM pg_constraint
  WHERE conrelid = 'public.app_memberships'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%user%'
    AND pg_get_constraintdef(oid) LIKE '%coordinator%'
    AND pg_get_constraintdef(oid) LIKE '%manager%';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'membership_role_manager: el CHECK de role debe admitir user, coordinator y manager';
  END IF;

  RAISE NOTICE 'OK — app_memberships.role admite user, coordinator y manager';
END
$verify$;
