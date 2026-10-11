-- Tickets and sanitized operational errors. These tables are accessed only
-- through authenticated Vercel Functions using the server-side admin client.
CREATE TABLE IF NOT EXISTS public.app_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reporter_email text NOT NULL,
  module text NOT NULL CHECK (module IN ('Resumen','Calidad','IA y Costos','Expedientes','Nueva auditoría','Incidencias','Otro')),
  description text NOT NULL CHECK (length(description) BETWEEN 10 AND 5000),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED')),
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_ticket_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.app_tickets(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('CREATED','COMMENT','STATUS_CHANGED')),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  previous_status text CHECK (previous_status IS NULL OR previous_status IN ('OPEN','IN_PROGRESS','RESOLVED')),
  next_status text CHECK (next_status IS NULL OR next_status IN ('OPEN','IN_PROGRESS','RESOLVED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_error_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id uuid NOT NULL,
  source text NOT NULL CHECK (source IN ('FRONTEND','BACKEND','ASYNC')),
  category text NOT NULL CHECK (length(category) <= 80),
  module text NOT NULL CHECK (length(module) <= 80),
  route text NOT NULL CHECK (length(route) <= 160),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_tickets_reporter_created_idx ON public.app_tickets (reporter_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS app_tickets_status_created_idx ON public.app_tickets (status, created_at DESC);
CREATE INDEX IF NOT EXISTS app_ticket_events_ticket_created_idx ON public.app_ticket_events (ticket_id, created_at);
CREATE INDEX IF NOT EXISTS app_error_events_created_idx ON public.app_error_events (created_at DESC);
CREATE INDEX IF NOT EXISTS app_error_events_correlation_idx ON public.app_error_events (correlation_id);

ALTER TABLE public.app_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_ticket_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_error_events ENABLE ROW LEVEL SECURITY;

-- All access is mediated by server authorization (the app server uses the
-- project_admin client). Browser roles receive no direct access to private data.
REVOKE ALL ON public.app_tickets, public.app_ticket_events, public.app_error_events FROM anon, authenticated;

COMMENT ON TABLE public.app_tickets IS 'Incidencias reportadas desde la aplicación; acceso exclusivamente server-side.';
COMMENT ON TABLE public.app_ticket_events IS 'Historial append-only de seguimiento de tickets; acceso exclusivamente server-side.';
COMMENT ON TABLE public.app_error_events IS 'Errores operativos saneados, sin cuerpos, tokens, stacks ni PII.';
