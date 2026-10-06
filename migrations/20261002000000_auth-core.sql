-- =============================================================================
-- 20261002000000_auth_core.sql — Frontera de autenticación/autorización.
-- =============================================================================
--
-- ORDEN DE CUTOVER
--   1. Aplicar esta migración.
--   2. Poblar manualmente `public.app_memberships` con los usuarios de InsForge
--      que deben tener acceso y su rol ('user' o 'coordinator').
--   3. A partir de ese momento, la aplicación exige sesión válida + membership
--      en todos los endpoints (salvo login, refresh, logout y healthcheck).
--   Antes del paso 2, los usuarios existentes podrán autenticarse pero recibirán
--   403 hasta que un owner les asigne rol.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.app_memberships (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  role text NOT NULL CHECK (role IN ('user','coordinator'))
);

ALTER TABLE public.app_memberships ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.app_memberships FROM anon;
REVOKE ALL ON TABLE public.app_memberships FROM authenticated;
GRANT SELECT ON TABLE public.app_memberships TO project_admin;

-- Índice para el listado de casos filtrado por dueño (la clave de scoping).
CREATE INDEX IF NOT EXISTS cases_created_by_id_idx ON public.cases (created_by, id);
