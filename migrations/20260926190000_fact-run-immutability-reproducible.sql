-- Reproducibilidad de las invariantes de inmutabilidad del fact run.
--
-- ORIGEN DEL DRIFT (verificado por inspección, no por copia):
-- Las siguientes objetos existen en el entorno DEV y fueron creados por las
-- migraciones `20260925120000 policy-foundation-immutability` y
-- `20260925140000 policy-foundation-security-closure`, que NO están en el
-- repositorio. Se attributaron leyendo `system.custom_migrations.statements`.
-- Las migraciones `20260925160000`, `20260925161000` y `20260925200000` que se
-- sospechaban no contienen ninguno de estos objetos: son lifecycle de pipeline,
-- restauración de estado y telemetría de costo.
--
-- CONSECUENCIA: un entorno construido solo desde `migrations/` no tendría la
-- tabla de snapshots ni las guardias, por lo que un fact run FROZEN sería
-- mutable y sus facts y provenance congelados serían alterables.
--
-- Esta migración es forward-only y reconcilia el estado del repositorio con el
-- contrato de seguridad. Es idempotente: reaplicarla en un entorno que ya tiene
-- los objetos no cambia nada.
--
-- No se modifica ninguna regla, outcome ni criterio del procedimiento.

-- ---------------------------------------------------------------------------
-- 1. Columnas de derivacion ausentes en el repositorio.
--    `parent_fact_run_id` + `derivation_reason` encadenan runs; sin ellos no se
--    puede trazar de donde sale un run, y `effective_facts_fingerprint` es el
--    campo que la guardia de inmutabilidad debe proteger.
-- ---------------------------------------------------------------------------
ALTER TABLE public.fact_extraction_runs
  ADD COLUMN IF NOT EXISTS parent_fact_run_id uuid REFERENCES public.fact_extraction_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS derivation_reason text,
  ADD COLUMN IF NOT EXISTS effective_facts_fingerprint text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fact_extraction_runs_parent_not_self_check') THEN
    ALTER TABLE public.fact_extraction_runs
      ADD CONSTRAINT fact_extraction_runs_parent_not_self_check
      CHECK (parent_fact_run_id IS NULL OR parent_fact_run_id <> id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fact_extraction_runs_derivation_check') THEN
    ALTER TABLE public.fact_extraction_runs
      ADD CONSTRAINT fact_extraction_runs_derivation_check
      CHECK (parent_fact_run_id IS NULL OR (derivation_reason IS NOT NULL AND btrim(derivation_reason) <> ''));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Tabla de snapshots: la evidencia sellada. Sin ella no hay provenance
--    inmutable que preservar, y `persist_policy_evaluation_v1` la exige.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fact_run_frozen_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  fact_run_id uuid NOT NULL REFERENCES public.fact_extraction_runs(id) ON DELETE CASCADE,
  facts jsonb NOT NULL,
  provenance jsonb NOT NULL,
  fact_reviews_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  extractor_version text NOT NULL,
  policy_source_id text NOT NULL,
  canonical_facts_fingerprint text NOT NULL,
  effective_facts_fingerprint text NOT NULL,
  fact_count integer NOT NULL,
  integrity_hash text NOT NULL,
  frozen_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  frozen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fact_run_frozen_snapshots_facts_check CHECK (jsonb_typeof(facts) = 'array'),
  CONSTRAINT fact_run_frozen_snapshots_provenance_check CHECK (jsonb_typeof(provenance) = 'object'),
  CONSTRAINT fact_run_frozen_snapshots_fact_reviews_snapshot_check CHECK (jsonb_typeof(fact_reviews_snapshot) = 'array'),
  CONSTRAINT fact_run_frozen_snapshots_extractor_version_check CHECK (btrim(extractor_version) <> ''),
  CONSTRAINT fact_run_frozen_snapshots_policy_source_id_check CHECK (btrim(policy_source_id) <> ''),
  CONSTRAINT fact_run_frozen_snapshots_canonical_facts_fingerprint_check CHECK (btrim(canonical_facts_fingerprint) <> ''),
  CONSTRAINT fact_run_frozen_snapshots_effective_facts_fingerprint_check CHECK (btrim(effective_facts_fingerprint) <> ''),
  CONSTRAINT fact_run_frozen_snapshots_fact_count_check CHECK (fact_count >= 0),
  CONSTRAINT fact_run_frozen_snapshots_integrity_hash_check CHECK (integrity_hash ~ '^[a-f0-9]{64}$')
);

-- Un snapshot por fact run: es la garantie de que el provenance sellado es unico.
CREATE UNIQUE INDEX IF NOT EXISTS fact_run_frozen_snapshots_run_identity
  ON public.fact_run_frozen_snapshots (fact_run_id);
CREATE INDEX IF NOT EXISTS fact_run_frozen_snapshots_canonical_fingerprint_idx
  ON public.fact_run_frozen_snapshots (canonical_facts_fingerprint);

-- ---------------------------------------------------------------------------
-- 3. Guardias. Los cuerpos son los verificados en DEV; se recrean con
--    CREATE OR REPLACE para que el repositorio sea la fuente y no el drift.
-- ---------------------------------------------------------------------------

-- Un run FROZEN o FAILED no admite ninguna UPDATE: bloquea tanto la
-- retrocesion de estado como el borrado de frozen_at, la alteracion de
-- fingerprints y de la identidad de politica.
CREATE OR REPLACE FUNCTION public.guard_frozen_fact_run_row()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.state IN ('FROZEN', 'FAILED') THEN
    RAISE EXCEPTION 'FACT_RUN_IMMUTABLE_ROW: run % en estado %', OLD.id, OLD.state;
  END IF;
  RETURN NEW;
END;
$function$;

-- Maquina de estados explicita. Sin ella, DRAFT -> FROZEN seria legal y se
-- saltaria el sellado con snapshot.
CREATE OR REPLACE FUNCTION public.guard_fact_run_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.state = OLD.state THEN
    RETURN NEW;
  END IF;

  IF OLD.state = 'DRAFT' AND NEW.state IN ('PROCESSING', 'FAILED') THEN
    RETURN NEW;
  END IF;

  IF OLD.state = 'PROCESSING' AND NEW.state IN ('FROZEN', 'FAILED') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'FACT_RUN_STATE_TRANSITION_FORBIDDEN: % -> %', OLD.state, NEW.state;
END;
$function$;

-- No se agregan facts a un run ya congelado. SECURITY DEFINER porque la
-- guardia debe leer el estado del run padre aunque RLS no lo exponga al autor.
CREATE OR REPLACE FUNCTION public.guard_frozen_fact_run_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_state text;
BEGIN
  SELECT state INTO v_state FROM public.fact_extraction_runs WHERE id = NEW.run_id;
  IF v_state = 'FROZEN' THEN
    RAISE EXCEPTION 'FACT_RUN_FROZEN_APPEND_ONLY: run %', NEW.run_id;
  END IF;
  RETURN NEW;
END;
$function$;

-- Los facts de un run FROZEN son inmutables. La excepcion para run padre
-- inexistente evita bloquear el ON DELETE CASCADE del propio padre.
CREATE OR REPLACE FUNCTION public.guard_frozen_fact_run_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_run_id uuid;
  v_state text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_run_id := OLD.run_id;
  ELSE
    v_run_id := NEW.run_id;
  END IF;

  SELECT state INTO v_state FROM public.fact_extraction_runs WHERE id = v_run_id;
  IF v_state IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF v_state IN ('FROZEN', 'FAILED') THEN
    RAISE EXCEPTION 'FACT_RUN_APPEND_ONLY: run % en estado %', v_run_id, v_state;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

-- Tablas append-only: el snapshot sellado no se reescribe ni se borra.
CREATE OR REPLACE FUNCTION public.guard_append_only_row()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY_TABLE: %', TG_TABLE_NAME;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Triggers. DROP + CREATE en vez de IF NOT EXISTS: Postgres no tiene
--    CREATE TRIGGER IF NOT EXISTS y el trigger debe quedar siempre enlazado a la
--    version vigente de la funcion.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS guard_frozen_fact_run_row ON public.fact_extraction_runs;
CREATE TRIGGER guard_frozen_fact_run_row
BEFORE UPDATE ON public.fact_extraction_runs
FOR EACH ROW EXECUTE FUNCTION public.guard_frozen_fact_run_row();

DROP TRIGGER IF EXISTS guard_fact_run_transition ON public.fact_extraction_runs;
CREATE TRIGGER guard_fact_run_transition
BEFORE UPDATE OF state ON public.fact_extraction_runs
FOR EACH ROW EXECUTE FUNCTION public.guard_fact_run_transition();

DROP TRIGGER IF EXISTS facts_reject_frozen_run_insert ON public.facts;
CREATE TRIGGER facts_reject_frozen_run_insert
BEFORE INSERT ON public.facts
FOR EACH ROW EXECUTE FUNCTION public.guard_frozen_fact_run_insert();

DROP TRIGGER IF EXISTS facts_guard_frozen_run_mutation ON public.facts;
CREATE TRIGGER facts_guard_frozen_run_mutation
BEFORE DELETE OR UPDATE ON public.facts
FOR EACH ROW EXECUTE FUNCTION public.guard_frozen_fact_run_mutation();

DROP TRIGGER IF EXISTS fact_run_frozen_snapshots_append_only ON public.fact_run_frozen_snapshots;
CREATE TRIGGER fact_run_frozen_snapshots_append_only
BEFORE DELETE OR UPDATE ON public.fact_run_frozen_snapshots
FOR EACH ROW EXECUTE FUNCTION public.guard_append_only_row();

-- ---------------------------------------------------------------------------
-- 6. RLS y permisos de la tabla de snapshots.
--    Sin esto un entorno construido desde el repo expondría la evidencia
--    sellada sin filtro por auditoría, o la dejaría inaccesible para el
--    cliente. Solo SELECT: el snapshot se escribe unicamente por
--    `freeze_fact_run_v1` (SECURITY DEFINER) y no se modifica nunca.
-- ---------------------------------------------------------------------------
ALTER TABLE public.fact_run_frozen_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fact_run_frozen_snapshots_select_visible ON public.fact_run_frozen_snapshots;
CREATE POLICY fact_run_frozen_snapshots_select_visible
ON public.fact_run_frozen_snapshots
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.audits
    WHERE audits.id = fact_run_frozen_snapshots.audit_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
  )
);

REVOKE ALL ON public.fact_run_frozen_snapshots FROM anon;
GRANT SELECT ON public.fact_run_frozen_snapshots TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. `facts.classification`: el repositorio admite 'HUMAN_CONFIRMED' y
--    'HUMAN_CORRECTED', que DEV no tiene. La aplicacion nunca escribe esos
--    valores (la confirmacion humana vive en `fact_reviews`), asi que
--    permitirlos solo abre la puerta a que un cliente inscriba un fact
--    declarando confirmacion humana que nadie realizo. Se alinea con DEV.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'facts_classification_check'
      AND pg_get_constraintdef(oid) NOT LIKE '%DERIVED_NORMATIVE%'
  ) THEN
    ALTER TABLE public.facts DROP CONSTRAINT facts_classification_check;
    ALTER TABLE public.facts
      ADD CONSTRAINT facts_classification_check
      CHECK (classification IN ('OBSERVABLE', 'DERIVED_NORMATIVE', 'REFERENCE_ONLY'));
  END IF;
END $$;
