-- Importación diaria de Flokzu: origen externo, asignación y batches durables.
-- No toca las tablas de auditoría, evidencias ni revisión humana.

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS external_source text,
  ADD COLUMN IF NOT EXISTS external_case_id text,
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS flokzu_data jsonb;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cases'::regclass
      AND conname = 'cases_external_identity_pair_check'
  ) THEN
    ALTER TABLE public.cases
      ADD CONSTRAINT cases_external_identity_pair_check
      CHECK ((external_source IS NULL) = (external_case_id IS NULL));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cases'::regclass
      AND conname = 'cases_external_source_check'
  ) THEN
    ALTER TABLE public.cases
      ADD CONSTRAINT cases_external_source_check
      CHECK (external_source IS NULL OR external_source = 'FLOKZU');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cases'::regclass
      AND conname = 'cases_external_case_id_check'
  ) THEN
    ALTER TABLE public.cases
      ADD CONSTRAINT cases_external_case_id_check
      CHECK (external_case_id IS NULL OR external_case_id ~ '^CaVe-[0-9]{1,16}$');
  END IF;
END
$migration$;

CREATE UNIQUE INDEX IF NOT EXISTS cases_external_identity_idx
  ON public.cases (external_source, external_case_id);
CREATE INDEX IF NOT EXISTS cases_assigned_to_status_created_at_idx
  ON public.cases (assigned_to, status, created_at DESC)
  WHERE assigned_to IS NOT NULL;

COMMENT ON COLUMN public.cases.external_source IS
  'Sistema origen del expediente. Solo FLOKZU se admite para sincronización externa.';
COMMENT ON COLUMN public.cases.external_case_id IS
  'Identificador estable del expediente en su sistema origen; matrícula no es una clave única.';
COMMENT ON COLUMN public.cases.assigned_to IS
  'Responsable de trabajo asignado. Es distinto de created_by, que conserva al autor de creación.';
COMMENT ON COLUMN public.cases.flokzu_data IS
  'Última proyección de campos administrativos sincronizados desde Flokzu; no forma parte del dictamen de IA.';

CREATE TABLE IF NOT EXISTS public.case_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  imported_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PREVIEWED' CHECK (status IN ('PREVIEWED','COMPLETED','EXPIRED')),
  total_rows integer NOT NULL CHECK (total_rows >= 0),
  valid_rows integer NOT NULL CHECK (valid_rows >= 0),
  new_rows integer NOT NULL CHECK (new_rows >= 0),
  changed_rows integer NOT NULL CHECK (changed_rows >= 0),
  unchanged_rows integer NOT NULL CHECK (unchanged_rows >= 0),
  error_rows integer NOT NULL CHECK (error_rows >= 0),
  issues jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(issues) = 'array'),
  staged_rows jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(staged_rows) = 'array'),
  preview_assignments jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(preview_assignments) = 'array'),
  result_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  CONSTRAINT case_import_batches_completion_check
    CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS case_import_batches_imported_by_created_at_idx
  ON public.case_import_batches (imported_by, created_at DESC);

ALTER TABLE public.case_import_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.case_import_batches FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.case_import_batches TO project_admin;

COMMENT ON TABLE public.case_import_batches IS
  'Historial y staging de importaciones Flokzu. staged_rows se vacía al confirmar; solo project_admin accede.';

CREATE OR REPLACE FUNCTION public.commit_flokzu_import(p_batch_id uuid, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_batch public.case_import_batches%ROWTYPE;
  v_row jsonb;
  v_id text;
  v_student_identifier text;
  v_student_name text;
  v_data jsonb;
  v_existing public.cases%ROWTYPE;
  v_case_id uuid;
  v_assigned_to uuid;
  v_inserted boolean;
  v_created integer := 0;
  v_updated integer := 0;
  v_unchanged integer := 0;
  v_unassigned integer := 0;
  v_assignments jsonb := '[]'::jsonb;
  v_result jsonb;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('flokzu-import-global-lock', 0));

  SELECT * INTO v_batch
  FROM public.case_import_batches
  WHERE id = p_batch_id AND imported_by = p_actor
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Importación no encontrada';
  END IF;
  IF v_batch.status = 'COMPLETED' THEN
    RETURN v_batch.result_json;
  END IF;
  IF v_batch.status = 'EXPIRED' OR v_batch.expires_at <= pg_catalog.now() THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'La vista previa venció; vuelve a subir el archivo';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.app_memberships
    WHERE user_id = p_actor AND role = 'coordinator'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Solo un Coordinador puede confirmar una importación';
  END IF;

  FOR v_row IN SELECT value FROM pg_catalog.jsonb_array_elements(v_batch.staged_rows)
  LOOP
    v_id := v_row ->> 'externalCaseId';
    v_student_identifier := v_row ->> 'studentIdentifier';
    v_student_name := v_row ->> 'studentName';
    v_data := v_row -> 'flokzuData';
    v_assigned_to := NULL;
    v_inserted := false;
    v_case_id := NULL;

    SELECT * INTO v_existing
    FROM public.cases
    WHERE external_source = 'FLOKZU' AND external_case_id = v_id
    FOR UPDATE;

    IF NOT FOUND THEN
      IF (v_row ->> 'eligibleForAuditAssignment')::boolean THEN
        SELECT membership.user_id INTO v_assigned_to
        FROM public.app_memberships AS membership
        LEFT JOIN (
          SELECT assigned_to, count(*) AS pending_count
          FROM public.cases
          WHERE assigned_to IS NOT NULL AND status <> 'COMPLETED'
          GROUP BY assigned_to
        ) AS workload ON workload.assigned_to = membership.user_id
        WHERE membership.role = 'user'
        ORDER BY COALESCE(workload.pending_count, 0), membership.user_id
        LIMIT 1;
      END IF;

      INSERT INTO public.cases (
        status, student_identifier, student_name, created_by, assigned_to,
        external_source, external_case_id, flokzu_data, is_test
      ) VALUES (
        'DRAFT', v_student_identifier, v_student_name, p_actor, v_assigned_to,
        'FLOKZU', v_id, v_data, false
      )
      ON CONFLICT (external_source, external_case_id) DO NOTHING
      RETURNING id INTO v_case_id;
      v_inserted := FOUND;

      IF NOT v_inserted THEN
        SELECT * INTO v_existing FROM public.cases
        WHERE external_source = 'FLOKZU' AND external_case_id = v_id
        FOR UPDATE;
      END IF;
    END IF;

    IF v_inserted THEN
      v_created := v_created + 1;
      IF (v_row ->> 'eligibleForAuditAssignment')::boolean AND v_assigned_to IS NULL THEN
        v_unassigned := v_unassigned + 1;
      END IF;
      v_assignments := v_assignments || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'externalCaseId', v_id, 'caseId', v_case_id, 'assignedTo', v_assigned_to
      ));
    ELSE
      IF v_existing.student_identifier IS DISTINCT FROM v_student_identifier
        OR v_existing.student_name IS DISTINCT FROM v_student_name
        OR v_existing.flokzu_data IS DISTINCT FROM v_data THEN
        UPDATE public.cases SET
          student_identifier = v_student_identifier,
          student_name = v_student_name,
          flokzu_data = v_data,
          updated_at = pg_catalog.now()
        WHERE id = v_existing.id;
        v_updated := v_updated + 1;
      ELSE
        v_unchanged := v_unchanged + 1;
      END IF;
      v_assignments := v_assignments || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'externalCaseId', v_id, 'caseId', v_existing.id, 'assignedTo', v_existing.assigned_to
      ));
    END IF;
  END LOOP;

  v_result := pg_catalog.jsonb_build_object(
    'created', v_created,
    'updated', v_updated,
    'unchanged', v_unchanged,
    'errors', v_batch.error_rows,
    'unassigned', v_unassigned,
    'assignments', v_assignments
  );
  UPDATE public.case_import_batches SET
    status = 'COMPLETED',
    staged_rows = '[]'::jsonb,
    result_json = v_result,
    completed_at = pg_catalog.now()
  WHERE id = v_batch.id;
  RETURN v_result;
END
$function$;

CREATE OR REPLACE FUNCTION public.expire_flokzu_import_previews()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH expired AS (
    UPDATE public.case_import_batches
    SET status = 'EXPIRED', staged_rows = '[]'::jsonb
    WHERE status = 'PREVIEWED' AND expires_at <= pg_catalog.now()
    RETURNING 1
  )
  SELECT count(*)::integer FROM expired;
$function$;

REVOKE ALL ON FUNCTION public.commit_flokzu_import(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_flokzu_import(uuid, uuid) TO project_admin;
REVOKE ALL ON FUNCTION public.expire_flokzu_import_previews() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_flokzu_import_previews() TO project_admin;

DO $verify$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'cases'
    AND column_name IN ('external_source','external_case_id','assigned_to','flokzu_data');
  IF v_count <> 4 THEN RAISE EXCEPTION 'flokzu_case_import: faltan columnas en cases'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='cases_external_identity_idx' AND indexdef ILIKE '%UNIQUE%') THEN
    RAISE EXCEPTION 'flokzu_case_import: falta la clave única de identidad externa';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='case_import_batches') THEN
    RAISE EXCEPTION 'flokzu_case_import: falta case_import_batches';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='case_import_batches' AND c.relrowsecurity
  ) THEN RAISE EXCEPTION 'flokzu_case_import: staging debe tener RLS habilitada'; END IF;
  IF has_function_privilege('anon', 'public.commit_flokzu_import(uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.commit_flokzu_import(uuid,uuid)', 'EXECUTE')
    OR NOT has_function_privilege('project_admin', 'public.commit_flokzu_import(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'flokzu_case_import: permisos RPC incorrectos';
  END IF;
  IF has_function_privilege('anon', 'public.expire_flokzu_import_previews()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.expire_flokzu_import_previews()', 'EXECUTE')
    OR NOT has_function_privilege('project_admin', 'public.expire_flokzu_import_previews()', 'EXECUTE') THEN
    RAISE EXCEPTION 'flokzu_case_import: permisos RPC de expiración incorrectos';
  END IF;
  RAISE NOTICE 'OK — origen Flokzu, asignación, batches RLS y RPC con ejecución exclusiva de project_admin';
END
$verify$;
