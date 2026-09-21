CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'AUDITOR' CHECK (role IN ('AUDITOR', 'OWNER')),
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'READY', 'PROCESSING', 'COMPLETED', 'FAILED')),
  external_case_id text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid REFERENCES public.audits(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_id uuid REFERENCES auth.users(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.policy_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_code text NOT NULL,
  title text NOT NULL,
  version text NOT NULL,
  publication_date date,
  sha256 text NOT NULL,
  source_type text NOT NULL DEFAULT 'NORMATIVE' CHECK (source_type IN ('NORMATIVE', 'TEMPLATE', 'HISTORICAL_REFERENCE')),
  added_by uuid REFERENCES auth.users(id),
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_code, version, sha256)
);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS audits_set_updated_at ON public.audits;
CREATE TRIGGER audits_set_updated_at
BEFORE UPDATE ON public.audits
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_sources ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.audits TO authenticated;
GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT SELECT ON public.policy_sources TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.policy_sources TO authenticated;

DROP POLICY IF EXISTS profiles_select_own_or_owner ON public.profiles;
CREATE POLICY profiles_select_own_or_owner ON public.profiles
FOR SELECT TO authenticated
USING (id = auth.uid() OR public.current_app_role() = 'OWNER');

DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
CREATE POLICY profiles_insert_own ON public.profiles
FOR INSERT TO authenticated
WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS profiles_update_own_or_owner ON public.profiles;
CREATE POLICY profiles_update_own_or_owner ON public.profiles
FOR UPDATE TO authenticated
USING (id = auth.uid() OR public.current_app_role() = 'OWNER')
WITH CHECK (id = auth.uid() OR public.current_app_role() = 'OWNER');

DROP POLICY IF EXISTS audits_select_own_or_owner ON public.audits;
CREATE POLICY audits_select_own_or_owner ON public.audits
FOR SELECT TO authenticated
USING (created_by = auth.uid() OR public.current_app_role() = 'OWNER');

DROP POLICY IF EXISTS audits_insert_own ON public.audits;
CREATE POLICY audits_insert_own ON public.audits
FOR INSERT TO authenticated
WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS audits_update_own_or_owner ON public.audits;
CREATE POLICY audits_update_own_or_owner ON public.audits
FOR UPDATE TO authenticated
USING (created_by = auth.uid() OR public.current_app_role() = 'OWNER')
WITH CHECK (created_by = auth.uid() OR public.current_app_role() = 'OWNER');

DROP POLICY IF EXISTS audit_log_select_for_visible_audits ON public.audit_log;
CREATE POLICY audit_log_select_for_visible_audits ON public.audit_log
FOR SELECT TO authenticated
USING (
  audit_id IS NULL OR EXISTS (
    SELECT 1 FROM public.audits
    WHERE audits.id = audit_log.audit_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
  )
);

DROP POLICY IF EXISTS audit_log_insert_self ON public.audit_log;
CREATE POLICY audit_log_insert_self ON public.audit_log
FOR INSERT TO authenticated
WITH CHECK (actor_id = auth.uid());

DROP POLICY IF EXISTS policy_sources_select_authenticated ON public.policy_sources;
CREATE POLICY policy_sources_select_authenticated ON public.policy_sources
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS policy_sources_owner_write ON public.policy_sources;
CREATE POLICY policy_sources_owner_write ON public.policy_sources
FOR INSERT TO authenticated
WITH CHECK (public.current_app_role() = 'OWNER');

DROP POLICY IF EXISTS policy_sources_owner_update ON public.policy_sources;
CREATE POLICY policy_sources_owner_update ON public.policy_sources
FOR UPDATE TO authenticated
USING (public.current_app_role() = 'OWNER')
WITH CHECK (public.current_app_role() = 'OWNER');
