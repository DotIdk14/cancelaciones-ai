DROP POLICY IF EXISTS tickets_select_own ON public.tickets;

DROP POLICY IF EXISTS tickets_insert_own ON public.tickets;

DROP POLICY IF EXISTS tickets_update_own ON public.tickets;

DROP POLICY IF EXISTS tickets_delete_own ON public.tickets;

ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_created_by_fkey;

ALTER TABLE public.evidences DROP CONSTRAINT IF EXISTS evidences_created_by_fkey;

ALTER TABLE public.decision_runs DROP CONSTRAINT IF EXISTS decision_runs_created_by_fkey;

ALTER TABLE public.dictamen_versions DROP CONSTRAINT IF EXISTS dictamen_versions_approved_by_fkey;

ALTER TABLE public.dictamen_versions DROP CONSTRAINT IF EXISTS dictamen_versions_created_by_fkey;

ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS audit_events_actor_fkey;

ALTER TABLE public.tickets
  ALTER COLUMN created_by TYPE TEXT;

ALTER TABLE public.evidences
  ALTER COLUMN created_by TYPE TEXT;

ALTER TABLE public.decision_runs
  ALTER COLUMN created_by TYPE TEXT;

ALTER TABLE public.dictamen_versions
  ALTER COLUMN approved_by TYPE TEXT,
  ALTER COLUMN created_by TYPE TEXT;

ALTER TABLE public.audit_events
  ALTER COLUMN actor TYPE TEXT;

CREATE POLICY "tickets_select_own" ON public.tickets
  FOR SELECT TO authenticated USING ((created_by::text = auth.uid()::text));

CREATE POLICY "tickets_insert_own" ON public.tickets
  FOR INSERT TO authenticated WITH CHECK ((created_by::text = auth.uid()::text));

CREATE POLICY "tickets_update_own" ON public.tickets
  FOR UPDATE TO authenticated USING ((created_by::text = auth.uid()::text)) WITH CHECK ((created_by::text = auth.uid()::text));

CREATE POLICY "tickets_delete_own" ON public.tickets
  FOR DELETE TO authenticated USING ((created_by::text = auth.uid()::text));

CREATE OR REPLACE FUNCTION public.is_admin_or_owner(ticket_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = ticket_id
      AND (t.created_by::text = auth.uid()::text OR t.created_by IS NULL)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin_or_owner_by_evidence(evidence_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.evidences e
    JOIN public.tickets t ON t.id = e.ticket_id
    WHERE e.id = evidence_id
      AND (t.created_by::text = auth.uid()::text OR t.created_by IS NULL)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin_or_owner_by_run(decision_run_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.decision_runs r
    JOIN public.tickets t ON t.id = r.ticket_id
    WHERE r.id = decision_run_id
      AND (t.created_by::text = auth.uid()::text OR t.created_by IS NULL)
  );
$$;
