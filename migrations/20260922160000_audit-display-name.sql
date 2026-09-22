ALTER TABLE public.audits
  ADD COLUMN IF NOT EXISTS display_name text;
