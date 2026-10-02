-- Nombre de quien registró la revisión humana. Nullable para conservar las
-- revisiones históricas creadas antes de que el formulario solicitara este dato.
ALTER TABLE public.case_reviews
  ADD COLUMN IF NOT EXISTS reviewer_name text;

COMMENT ON COLUMN public.case_reviews.reviewer_name IS
  'Nombre libre de quien registró la revisión; nullable para filas históricas. No se deriva de autenticación.';
