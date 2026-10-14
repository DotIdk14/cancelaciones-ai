-- Pendiente: aplicar mediante el runner oficial tras conciliar el ledger.
-- No es UNIQUE: dos tickets distintos pueden compartir matrícula.
CREATE INDEX IF NOT EXISTS cases_student_history_idx
  ON public.cases (student_identifier, created_at DESC, id DESC)
  WHERE student_identifier IS NOT NULL;
DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'cases_student_history_idx') THEN
    RAISE EXCEPTION 'Falta el índice cases_student_history_idx';
  END IF;
END
$verify$;
