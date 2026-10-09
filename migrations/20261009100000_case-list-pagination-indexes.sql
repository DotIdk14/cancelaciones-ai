-- Índices de apoyo para la paginación de casos por fecha descendente.
-- Los índices actuales cubren el alcance por propietario, pero el Coordinador y
-- el Gerente consultan globalmente. Esta migración es aditiva e idempotente.
CREATE INDEX IF NOT EXISTS cases_created_at_id_idx
  ON public.cases (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS cases_status_created_at_id_idx
  ON public.cases (status, created_at DESC, id DESC);
