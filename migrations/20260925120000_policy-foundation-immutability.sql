-- =============================================================================
-- 20260925120000_policy-foundation-immutability.sql
-- Fundamentos de política: fact runs irreversibles, snapshots inmutables,
-- envelopes de evaluación y persistencia append-only de AI_DECISION_V1.
--
-- ESTADO DE ESTE ARCHIVO: ESCRITO Y VERSIONADO, DELIBERADAMENTE NO APLICADO.
-- El único backend InsForge configurado en este repositorio es el proyecto
-- remoto base/producción (`appkey 4pw4jdzv`, ver .insforge/project.json). La
-- rama DEV `4pw4jdzv-cif` no tiene credenciales en ninguna parte del repositorio.
-- Aplicar esta migración contra `4pw4jdzv` modificaría producción, por lo que
-- NADIE debe ejecutarla hasta que exista un backend DEV configurado y el
-- propietario lo autorice. Este archivo es el único entregable de la tarea.
--
-- DIRECCIÓN: forward-only. No hay BEGIN/COMMIT: el runner de migraciones ya
-- envuelve cada archivo en su propia transacción y un wrapper explícito
-- rompería los `CREATE INDEX CONCURRENTLY` de otras migraciones y la
-- atomicidad por archivo. Re-ejecutar el archivo es seguro: todas las
-- operaciones son idempotentes (IF NOT EXISTS / IF EXISTS / ON CONFLICT /
-- CREATE OR REPLACE).
--
-- INVARIANTES QUE ESTA MIGRACIÓN DEFIENDE (AGENTS.md):
--   - POLICY_IS_IMMUTABLE            -> guard_fact_run_transition + guard_frozen_fact_run_row
--   - PRESERVE_MACHINE_DECISION      -> guard_append_only_row + guard_completed_engine_run_row
--   - TRACE_EVERY_DECISION           -> policy_source_registry + provenance en snapshots
--   - UNKNOWN_IS_NOT_FALSE           -> las fuentes no verificadas son PENDING_VERIFICATION
--   - DO_NOT_DUPLICATE_IMPLEMENTATIONS-> una sola ruta de escritura por capacidad
--
-- MECANISMOS DE IMPOSIBILIDAD USADOS (y qué garantiza cada uno):
--   (A) ACL      -> REVOKE: el rol de cliente ni siquiera puede intentar la
--                   escritura; es la primera barrera y la más barata.
--   (B) RLS      -> políticas por dueño de auditoría / rol OWNER: aunque un rol
--                   tuviera el privilegio, no vería ni escribiría datos ajenos.
--   (C) TRIGGER  -> RAISE EXCEPTION: última barrera. Se ejecuta incluso para el
--                   propietario de la tabla (DDL/admin), por eso es la que
--                   realmente vuelve irreversible un FROZEN o un COMPLETED.
--   (D) RPC      -> SECURITY DEFINER: concentrate la escritura en funciones que
--                   revalidan estado y autorización en cada llamada.
-- =============================================================================


-- =============================================================================
-- SECCIÓN 1 — public.policy_source_registry
-- Registro de fuentes normativas con trazabilidad de verificación.
--
-- TIPO DE OBJETO   : tabla de catálogo global (NO pertenece a una auditoría).
-- APPEND-ONLY      : sí, trigger (C) sobre UPDATE y DELETE. Una fuente verificada
--                    no se promueve EDITANDO la fila pendiente: se INSERTA una
--                    versión nueva (nuevo `policy_version` y nuevo `document_id`),
--                    de modo que la fila PENDING queda como historia y la
--                    verificación es un hecho append-only, no una sobrescritura.
--                    Por eso no hay política de UPDATE: sería código muerto.
-- RLS              : SELECT para todo `authenticated`. Se aparta del patrón
--                    "dueño de la auditoría" que sí usan las demás tablas nuevas
--                    porque esta tabla no tiene `audit_id`: es metadata global de
--                    política y TODOS los auditores autenticados deben poder leer
--                    la fuente con la que se evaluó su caso. La escritura queda
--                    reservada al rol OWNER.
-- SHA-256          : CHECK `^[a-f0-9]{64}$`; un hash mal formado no es evidencia.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.policy_source_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_code text NOT NULL CHECK (btrim(policy_code) <> ''),
  policy_version text NOT NULL CHECK (btrim(policy_version) <> ''),
  document_id text NOT NULL CHECK (btrim(document_id) <> ''),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('CANONICAL', 'LEGACY', 'PENDING_VERIFICATION', 'SUPERSEDED')),
  effective_from date,
  effective_to date,
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT policy_source_registry_version_identity UNIQUE (policy_code, policy_version),
  CONSTRAINT policy_source_registry_document_identity UNIQUE (document_id),
  CONSTRAINT policy_source_registry_effective_range_check
    CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
  -- Una fuente declarada CANONICAL tiene que haber sido verificada por alguien.
  -- Refuerza UNKNOWN_IS_NOT_FALSE: no se puede marcar como canónica sin huella
  -- de verificación. Las fuentes PENDING/LEGACY/SUPERSEDED no la exigen.
  CONSTRAINT policy_source_registry_canonical_verified_check
    CHECK (status <> 'CANONICAL' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS policy_source_registry_status_idx
  ON public.policy_source_registry (status);

-- Seed ÚNICO y deliberadamente NO canónico.
--
-- POR QUÉ NO ES CANONICAL: el hash `71faf646…c7d2` es el de la copia LOCAL que
-- vive en este repositorio, no el del documento oficial firmado por el
-- propietario. Registrarlo como CANONICAL afirmaría una verificación que nadie
-- ha hecho (violaría ONLY_OWNER_PROVIDED_POLICY_SOURCES y UNKNOWN_IS_NOT_FALSE).
-- Se siembra como PENDING_VERIFICATION para que exista un `document_id` que las
-- funciones de congelado puedan referenciar, y para que la verificación oficial
-- sea una decisión humana explícita y posterior.
--
-- `ON CONFLICT DO NOTHING` sin objetivo cubre AMBOS uniques (version y document)
-- y garantiza que re-ejecutar la migración no toca ni degrade la fila existente.
INSERT INTO public.policy_source_registry (
  policy_code, policy_version, document_id, sha256, status, effective_from,
  effective_to, verified_by, verified_at, notes
)
VALUES (
  'GDM_GAM_PRD_MLG_003',
  'UNVERIFIED_LOCAL',
  'gdm-gam-prd-mlg-003-local-unverified',
  '71faf64634805b1b4820132cdfcc1304d740ff00d1e9573dd850222c9496c7d2',
  'PENDING_VERIFICATION',
  NULL,
  NULL,
  NULL,
  NULL,
  'Copia local del repositorio; el hash corresponde al archivo local y no al documento oficial firmado. NO es fuente canonica: la verificacion contra el original es una accion pendiente del propietario.'
)
ON CONFLICT DO NOTHING;

ALTER TABLE public.policy_source_registry ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.policy_source_registry FROM anon;
GRANT SELECT ON public.policy_source_registry TO authenticated;

DROP POLICY IF EXISTS policy_source_registry_select_authenticated ON public.policy_source_registry;
CREATE POLICY policy_source_registry_select_authenticated ON public.policy_source_registry
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS policy_source_registry_owner_insert ON public.policy_source_registry;
CREATE POLICY policy_source_registry_owner_insert ON public.policy_source_registry
FOR INSERT TO authenticated
WITH CHECK (public.current_app_role() = 'OWNER');

-- No hay política de INSERT/DELETE para authenticated: el registro es de sólo
-- lectura para el rol de cliente y sólo el rol OWNER puede añadir una versión.
-- (El DELETE no existe en ninguna política: además está cerrado por trigger.)

-- (C) TRIGGER: ni el propietario de la tabla puede reescribir el registro de una
-- fuente. Sin este trigger, un DDL/admin podría cambiar el sha256 o promover a
-- CANONICAL y la trazabilidad de la política quedaría sin valor.
CREATE OR REPLACE FUNCTION public.guard_policy_source_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'POLICY_SOURCE_APPEND_ONLY: %', OLD.document_id;
  -- INALCANZABLE: el RAISE de arriba siempre aborta la sentencia. El RETURN
  -- está sólo para que plpgsql no pueda alcanzar el final de la función si algún
  -- día se cambiara el RAISE por un aviso; sin él, ese día el trigger fallaría
  -- con "control reached end of trigger procedure". En DELETE, NEW es NULL y
  -- `RETURN NEW` cancelaría la operación, que es justo lo que quiere un trigger
  -- append-only.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS policy_source_registry_append_only ON public.policy_source_registry;
CREATE TRIGGER policy_source_registry_append_only
BEFORE UPDATE OR DELETE ON public.policy_source_registry
FOR EACH ROW EXECUTE FUNCTION public.guard_policy_source_append_only();


-- =============================================================================
-- SECCIÓN 2 — Columnas de derivación en public.fact_extraction_runs
--
-- REALIDAD VERIFICADA (no supuesto del plan):
--   - `created_by` YA EXISTE desde migrations/20260923220000_phase-5-fact-model-shadow.sql:10
--     (`created_by uuid REFERENCES auth.users(id)`). El plan pedía "añadirlo";
--     NO se vuelve a añadir: un segundo `created_by` sería ambiguo. SÍ se le
--     añade el índice que le falta para las consultas de propiedad.
--   - `state` ya tiene CHECK IN ('DRAFT','PROCESSING','FAILED','FROZEN')
--     (migrations/20260923220000_phase-5-fact-model-shadow.sql:8).
--   - `policy_code_hash` y `artifact_set_fingerprint_hash` son NOT NULL y los
--     calcula el trigger `fact_runs_long_hashes_on_write`
--     (migrations/20260924170450_fact-runs-artifact-fingerprint-hash-index.sql:23).
--     El índice único de idempotencia es
--     `fact_extraction_runs_idempotency_hash_idx (audit_id, policy_code_hash,
--     policy_version, extractor_version, artifact_set_fingerprint_hash)`.
-- =============================================================================
ALTER TABLE public.fact_extraction_runs
  ADD COLUMN IF NOT EXISTS parent_fact_run_id uuid REFERENCES public.fact_extraction_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS derivation_reason text,
  ADD COLUMN IF NOT EXISTS effective_facts_fingerprint text;

-- Índice de las correcciones: "dame los runs derivados de este run padre".
CREATE INDEX IF NOT EXISTS fact_extraction_runs_parent_idx
  ON public.fact_extraction_runs (parent_fact_run_id)
  WHERE parent_fact_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS fact_extraction_runs_created_by_idx
  ON public.fact_extraction_runs (created_by);

-- Un run derivado DEBE justificar por qué existe. Sin esta regla, una
-- "corrección" podría aparecer sin motivo y la cadena de custodia se rompe.
-- Las filas preexistentes tienen parent NULL, así que el CHECK es seguro.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fact_extraction_runs_derivation_check'
  ) THEN
    ALTER TABLE public.fact_extraction_runs
      ADD CONSTRAINT fact_extraction_runs_derivation_check
      CHECK (
        parent_fact_run_id IS NULL
        OR (derivation_reason IS NOT NULL AND btrim(derivation_reason) <> '')
      );
  END IF;
END $$;

-- Un run no puede ser su propio padre.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fact_extraction_runs_parent_not_self_check'
  ) THEN
    ALTER TABLE public.fact_extraction_runs
      ADD CONSTRAINT fact_extraction_runs_parent_not_self_check
      CHECK (parent_fact_run_id IS NULL OR parent_fact_run_id <> id);
  END IF;
END $$;


-- =============================================================================
-- SECCIÓN 3 — Transiciones de estado de fact_extraction_runs
--
-- (C) TRIGGER `guard_fact_run_transition`. Regla EXACTA del plan:
--     DRAFT      -> PROCESSING | FAILED
--     PROCESSING -> FROZEN | FAILED
--     FROZEN     -> (ninguna salida)
--     FAILED     -> (ninguna salida)
--   Un UPDATE que no cambia `state` pasa siempre (los triggers de
--   `fact_extraction_runs_set_updated_at` y `fact_runs_long_hashes_on_write`
--   siguen funcionando igual).
--
--   IMPACTO CONOCIDO Y DELIBERADO: `createFactRepository.freezeRun`
--   (packages/db/src/index.ts:688) hace hoy `DRAFT -> FROZEN` en un solo UPDATE,
--   y lo invoca `POST /api/audits/[auditId]/fact-runs` (route.ts:43). Ese camino
--   pasará a fallar con FACT_RUN_STATE_TRANSITION_FORBIDDEN hasta que se lo
--   encadene como DRAFT -> PROCESSING -> FROZEN. Se reporta al propietario; la
--   regla del plan es explícita y no se suaviza.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.guard_fact_run_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
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
$$;

DROP TRIGGER IF EXISTS guard_fact_run_transition ON public.fact_extraction_runs;
CREATE TRIGGER guard_fact_run_transition
BEFORE UPDATE OF state ON public.fact_extraction_runs
FOR EACH ROW EXECUTE FUNCTION public.guard_fact_run_transition();

-- (C) TRIGGER `guard_frozen_fact_run_row`: un run FROZEN o FAILED no admite
-- NINGÚN otro UPDATE, ni siquiera sin cambiar `state`. Sin esto, el guard de
-- transición dejaría pasar la mutación de columnas de identidad
-- (`artifact_set_fingerprint`, `extractor_version`, `policy_version`, ...), que
-- es justamente lo que el índice de idempotencia usa para definir "el mismo run".
--
-- DELETE de fact_extraction_runs NO se bloquea aquí a propósito: el plan no lo
-- pide y `audit-pipeline.dev-e2e.test.ts:40` borra runs ya FROZEN en su
-- cleanup. El borrado por `authenticated` sí queda cerrado por ACL en la
-- sección 10. El hueco residual (el propietario de la tabla puede borrar un run
-- FROZEN y arrastrar sus facts por CASCADE) está documentado en el reporte.
CREATE OR REPLACE FUNCTION public.guard_frozen_fact_run_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.state IN ('FROZEN', 'FAILED') THEN
    RAISE EXCEPTION 'FACT_RUN_IMMUTABLE_ROW: run % en estado %', OLD.id, OLD.state;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_frozen_fact_run_row ON public.fact_extraction_runs;
CREATE TRIGGER guard_frozen_fact_run_row
BEFORE UPDATE ON public.fact_extraction_runs
FOR EACH ROW EXECUTE FUNCTION public.guard_frozen_fact_run_row();


-- =============================================================================
-- SECCIÓN 4 — public.facts: append-only por run
--
-- REALIDAD VERIFICADA: `facts` sólo tiene `GRANT SELECT, INSERT` para
-- `authenticated` (migrations/20260923220000:53), así que para ese rol no hay
-- ningún UPDATE ni DELETE que revocar. Aun así la sección 10 revoca
-- explícitamente UPDATE/DELETE a `anon` y `authenticated`: deja la intención
-- escrita y sobrevive a un GRANT accidental futuro. Lo que faltaba era la
-- barrera (C) para el propietario de la tabla.
--
-- `facts` tiene FK `ON DELETE CASCADE` hacia `fact_extraction_runs`
-- (migrations/20260923220000:18). Cuando el run padre desaparece por cascada, el
-- SELECT del estado devuelve NULL; en ese caso se permite el borrado, siguiendo
-- exactamente la convención ya establecida en
-- public.prevent_protected_rule_child_mutation (migrations/20260924220000:99).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.guard_frozen_fact_run_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_state text;
BEGIN
  SELECT state INTO v_state FROM public.fact_extraction_runs WHERE id = NEW.run_id;
  IF v_state = 'FROZEN' THEN
    RAISE EXCEPTION 'FACT_RUN_FROZEN_APPEND_ONLY: run %', NEW.run_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS facts_reject_frozen_run_insert ON public.facts;
CREATE TRIGGER facts_reject_frozen_run_insert
BEFORE INSERT ON public.facts
FOR EACH ROW EXECUTE FUNCTION public.guard_frozen_fact_run_insert();

CREATE OR REPLACE FUNCTION public.guard_frozen_fact_run_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
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
    -- El run padre ya no existe: el borrado viene del CASCADE del propio padre.
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
$$;

DROP TRIGGER IF EXISTS facts_guard_frozen_run_mutation ON public.facts;
CREATE TRIGGER facts_guard_frozen_run_mutation
BEFORE UPDATE OR DELETE ON public.facts
FOR EACH ROW EXECUTE FUNCTION public.guard_frozen_fact_run_mutation();


-- =============================================================================
-- SECCIÓN 5 — public.fact_run_frozen_snapshots
--
-- CONGELA los hechos efectivos de un run en el instante en que pasa a FROZEN.
-- UNIQUE (fact_run_id): como máximo un snapshot por run, así que "re-congelar"
-- es imposible y la segunda llamada al RPC falla en vez de duplicar evidencia.
--
-- COLUMNAS y su justificación:
--   facts                     -> hechos canónicos tal como los verá el motor
--   provenance                -> de dónde viene cada hecho (UNKNOWN != FALSE)
--   fact_reviews_snapshot     -> revisiones humanas en el instante del congelado
--   extractor_version         -> qué extractor produjo los hechos
--   policy_source_id          -> documento_id en policy_source_registry (FK lógica
--                                verificada por freeze_fact_run_v1); sin esto el
--   canonical_facts_fingerprint  motor no podría citar la fuente que aplicó
--   effective_facts_fingerprint
--   integrity_hash            -> SHA-256 sobre el snapshot canónico completo
--   fact_count                -> invariante rápida y legible
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.fact_run_frozen_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  fact_run_id uuid NOT NULL REFERENCES public.fact_extraction_runs(id) ON DELETE CASCADE,
  facts jsonb NOT NULL CHECK (jsonb_typeof(facts) = 'array'),
  provenance jsonb NOT NULL CHECK (jsonb_typeof(provenance) = 'object'),
  fact_reviews_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(fact_reviews_snapshot) = 'array'),
  extractor_version text NOT NULL CHECK (btrim(extractor_version) <> ''),
  policy_source_id text NOT NULL CHECK (btrim(policy_source_id) <> ''),
  canonical_facts_fingerprint text NOT NULL CHECK (btrim(canonical_facts_fingerprint) <> ''),
  effective_facts_fingerprint text NOT NULL CHECK (btrim(effective_facts_fingerprint) <> ''),
  fact_count integer NOT NULL CHECK (fact_count >= 0),
  integrity_hash text NOT NULL CHECK (integrity_hash ~ '^[a-f0-9]{64}$'),
  frozen_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  frozen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fact_run_frozen_snapshots_run_identity UNIQUE (fact_run_id)
);

CREATE INDEX IF NOT EXISTS fact_run_frozen_snapshots_audit_created_idx
  ON public.fact_run_frozen_snapshots (audit_id, created_at DESC);

CREATE INDEX IF NOT EXISTS fact_run_frozen_snapshots_canonical_fingerprint_idx
  ON public.fact_run_frozen_snapshots (canonical_facts_fingerprint);

-- Índices de búsqueda por hash. Se indexa `left(hash, 63)` y no el hash entero
-- para no depender del máximo de bytes por entrada de índice B-tree de la
-- versión de Postgres del backend (los SHA-256 completos son 64 bytes y rozan ese
-- límite). El prefijo de 63 bytes sigue siendo único para efectos prácticos.
CREATE INDEX IF NOT EXISTS fact_run_frozen_snapshots_integrity_hash_idx
  ON public.fact_run_frozen_snapshots (left(integrity_hash, 63));

ALTER TABLE public.fact_run_frozen_snapshots ENABLE ROW LEVEL SECURITY;

-- (A) ACL: ni INSERT ni UPDATE ni DELETE para el rol de cliente. La única vía es
-- el RPC freeze_fact_run_v1.
REVOKE ALL ON public.fact_run_frozen_snapshots FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.fact_run_frozen_snapshots FROM authenticated;
GRANT SELECT ON public.fact_run_frozen_snapshots TO authenticated;

DROP POLICY IF EXISTS fact_run_frozen_snapshots_select_visible ON public.fact_run_frozen_snapshots;
CREATE POLICY fact_run_frozen_snapshots_select_visible ON public.fact_run_frozen_snapshots
FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.audits
    WHERE audits.id = fact_run_frozen_snapshots.audit_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
);


-- =============================================================================
-- SECCIÓN 6 — public.audit_evaluation_envelopes
--
-- Envoltura estable de la evaluación (AuditEvaluationEnvelopeV1 de
-- packages/policy-engine/src/evaluation-envelope.ts) ligada 1:1 a un engine_run.
-- UNIQUE (engine_run_id): el envelope es la proyección auditable de ESA
-- evaluación; regenerarlo con otro contenido es un cambio de decisión y exige un
-- engine_run nuevo, no sobrescribir el anterior.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.audit_evaluation_envelopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  engine_run_id uuid NOT NULL REFERENCES public.engine_runs(id) ON DELETE CASCADE,
  fact_run_id uuid REFERENCES public.fact_extraction_runs(id) ON DELETE SET NULL,
  schema_version text NOT NULL CHECK (schema_version = 'audit-evaluation-envelope-v1'),
  envelope jsonb NOT NULL CHECK (jsonb_typeof(envelope) = 'object'),
  envelope_hash text NOT NULL CHECK (envelope_hash ~ '^[a-f0-9]{64}$'),
  facts_fingerprint text NOT NULL CHECK (btrim(facts_fingerprint) <> ''),
  rules_fingerprint text NOT NULL CHECK (btrim(rules_fingerprint) <> ''),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_evaluation_envelopes_engine_run_identity UNIQUE (engine_run_id)
);

CREATE INDEX IF NOT EXISTS audit_evaluation_envelopes_audit_created_idx
  ON public.audit_evaluation_envelopes (audit_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_evaluation_envelopes_hash_idx
  ON public.audit_evaluation_envelopes (left(envelope_hash, 63));

ALTER TABLE public.audit_evaluation_envelopes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.audit_evaluation_envelopes FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.audit_evaluation_envelopes FROM authenticated;
GRANT SELECT ON public.audit_evaluation_envelopes TO authenticated;

DROP POLICY IF EXISTS audit_evaluation_envelopes_select_visible ON public.audit_evaluation_envelopes;
CREATE POLICY audit_evaluation_envelopes_select_visible ON public.audit_evaluation_envelopes
FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.audits
    WHERE audits.id = audit_evaluation_envelopes.audit_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
);


-- =============================================================================
-- SECCIÓN 7 — public.ai_decision_snapshots
--
-- Snapshot durable y append-only de la decisión de máquina AI_DECISION_V1.
--
-- !!! RESTRICCIÓN DE IDENTIDAD — OBJETO CRÍTICO DE ESTA MIGRACIÓN !!!
-- `ai_decision_snapshots_identity UNIQUE (audit_id, decision_version,
-- input_fingerprint)` es lo que hace que `appendAiDecisionV1` en
-- packages/db/src/index.ts:1403 sea correcto. Ese repositorio hace
-- check-then-act (SELECT y luego INSERT) y traduce el error 23505 del servidor a
-- AI_DECISION_V1_ALREADY_EXISTS (packages/db/src/index.ts:1389-1393). Sin este
-- UNIQUE, dos escrituras concurrentes para la misma identidad pasarían ambas el
-- SELECT y el segundo INSERT también tendría éxito, guardando dos decisiones de
-- máquina distintas para la misma entrada.
--
-- `hash` cubre TODOS los campos anteriores (packages/policy-engine/src/
-- ai-decision-snapshot.ts:23-57). Se valida como SHA-256 de 64 hex porque el
-- productor es `createHash('sha256').digest('hex')`. En cambio
-- `input_fingerprint` NO se restringe a hex: el tipo TypeScript lo declara
-- `string` y sólo el productor actual emite hex; un CHECK más estrecho
-- rechazaría un esquema de fingerprint futuro legítimo sin que exista una
-- migración que lo cambie. Se exige que no sea vacío, que es la garantía real
-- para la identidad.
--
-- `created_at` es NOT NULL SIN DEFAULT a propósito: el instante que se guarda es
-- el mismo que entra en el hash, así que no puede depender del reloj del
-- servidor.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.ai_decision_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  fact_run_id uuid NOT NULL REFERENCES public.fact_extraction_runs(id),
  decision_version text NOT NULL CHECK (decision_version IN ('AI_DECISION_V1', 'AI_DECISION_V2')),
  policy_code text NOT NULL CHECK (btrim(policy_code) <> ''),
  policy_version text NOT NULL CHECK (btrim(policy_version) <> ''),
  policy_source_id text NOT NULL CHECK (btrim(policy_source_id) <> ''),
  engine_version text NOT NULL CHECK (btrim(engine_version) <> ''),
  prompt_version text,
  extractor_version text NOT NULL CHECK (btrim(extractor_version) <> ''),
  provider text,
  model text,
  input_fingerprint text NOT NULL CHECK (btrim(input_fingerprint) <> ''),
  decision_snapshot jsonb NOT NULL CHECK (jsonb_typeof(decision_snapshot) = 'object'),
  rule_trace_snapshot jsonb NOT NULL CHECK (jsonb_typeof(rule_trace_snapshot) = 'object'),
  evidence_snapshot jsonb NOT NULL CHECK (jsonb_typeof(evidence_snapshot) = 'object'),
  created_at timestamptz NOT NULL,
  hash text NOT NULL CHECK (hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT ai_decision_snapshots_identity UNIQUE (audit_id, decision_version, input_fingerprint)
);

CREATE INDEX IF NOT EXISTS ai_decision_snapshots_audit_created_idx
  ON public.ai_decision_snapshots (audit_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_decision_snapshots_fact_run_idx
  ON public.ai_decision_snapshots (fact_run_id);

CREATE INDEX IF NOT EXISTS ai_decision_snapshots_hash_idx
  ON public.ai_decision_snapshots (left(hash, 63));

ALTER TABLE public.ai_decision_snapshots ENABLE ROW LEVEL SECURITY;

-- (A) ACL: append-only.
--   INSERT  -> SÍ, porque `createPolicyFoundationRepository.appendAiDecisionV1`
--             inserta directamente (packages/db/src/index.ts:1417) y no hay RPC
--             para esta tabla en esta tarea.
--   UPDATE  -> REVOCADO. `authenticated` ni siquiera puede intentarlo.
--   DELETE  -> REVOCADO. `authenticated` ni siquiera puede intentarlo.
-- El trigger de la sección 9 es la segunda barrera: sin él, el propietario de la
-- tabla o un GRANT accidental seguirían pudiendo reescribir la fila.
REVOKE ALL ON public.ai_decision_snapshots FROM anon;
REVOKE UPDATE, DELETE ON public.ai_decision_snapshots FROM anon, authenticated;
GRANT SELECT, INSERT ON public.ai_decision_snapshots TO authenticated;

DROP POLICY IF EXISTS ai_decision_snapshots_select_visible ON public.ai_decision_snapshots;
CREATE POLICY ai_decision_snapshots_select_visible ON public.ai_decision_snapshots
FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.audits
    WHERE audits.id = ai_decision_snapshots.audit_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
);

DROP POLICY IF EXISTS ai_decision_snapshots_insert_visible ON public.ai_decision_snapshots;
CREATE POLICY ai_decision_snapshots_insert_visible ON public.ai_decision_snapshots
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.audits
    WHERE audits.id = ai_decision_snapshots.audit_id
      AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))
);


-- =============================================================================
-- SECCIÓN 8 — FK real de engine_runs.fact_run_id
--
-- REALIDAD VERIFICADA: la COLUMNA ya existe (migrations/20260924101000_phase-6-
-- policy-engine.sql:4, `fact_run_id uuid`, sin REFERENCES) y ya tiene índice
-- (migrations/20260924102000_vertical-slice-fact-run-policy-link.sql:21). Por
-- eso NO se añade la columna: sólo la FK que le faltaba, y sólo si no existe.
-- ON DELETE SET NULL (no CASCADE): perder un fact run no debe borrar la decisión
-- de máquina ya tomada.
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'engine_runs_fact_run_id_fkey'
      AND conrelid = 'public.engine_runs'::regclass
  ) THEN
    ALTER TABLE public.engine_runs
      ADD CONSTRAINT engine_runs_fact_run_id_fkey
      FOREIGN KEY (fact_run_id) REFERENCES public.fact_extraction_runs(id) ON DELETE SET NULL;
  END IF;
END $$;


-- =============================================================================
-- SECCIÓN 9 — Barreras de inmutabilidad por disparador (append-only)
--
-- Barreras de inmutabilidad por disparador (append-only).
--
-- Las funciones que sólo abortan la sentencia (9.1 y 9.2) NO son SECURITY
-- DEFINER: no leen nada de las tablas y no necesitan escalar privilegio, que es
-- la opción de menor superficie. La que sí lee el estado del padre (9.3) es
-- SECURITY DEFINER con `search_path` fijo, siguiendo la convención de
-- public.prevent_protected_rule_child_mutation (migrations/20260924220000:92).
-- Todas fijan `search_path` de todos modos.
-- =============================================================================

-- 9.1) Append-only total: no existe ningún UPDATE ni DELETE, para ningún rol.
--      Se usa en las tres tablas de snapshot. Es la barrera (C) que complementa
--      al REVOKE (A) de las secciones 5, 6 y 7.
CREATE OR REPLACE FUNCTION public.guard_append_only_row()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY_TABLE: %', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS fact_run_frozen_snapshots_append_only ON public.fact_run_frozen_snapshots;
CREATE TRIGGER fact_run_frozen_snapshots_append_only
BEFORE UPDATE OR DELETE ON public.fact_run_frozen_snapshots
FOR EACH ROW EXECUTE FUNCTION public.guard_append_only_row();

DROP TRIGGER IF EXISTS audit_evaluation_envelopes_append_only ON public.audit_evaluation_envelopes;
CREATE TRIGGER audit_evaluation_envelopes_append_only
BEFORE UPDATE OR DELETE ON public.audit_evaluation_envelopes
FOR EACH ROW EXECUTE FUNCTION public.guard_append_only_row();

DROP TRIGGER IF EXISTS ai_decision_snapshots_append_only ON public.ai_decision_snapshots;
CREATE TRIGGER ai_decision_snapshots_append_only
BEFORE UPDATE OR DELETE ON public.ai_decision_snapshots
FOR EACH ROW EXECUTE FUNCTION public.guard_append_only_row();

-- 9.2) engine_runs COMPLETED es inmutable.
--      `status` tiene CHECK IN ('COMPLETED','FAILED')
--      (migrations/20260924101000_phase-6-policy-engine.sql:10), así que la fila
--      nace terminal: se inserta y se sella en la misma operación.
CREATE OR REPLACE FUNCTION public.guard_completed_engine_run_row()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'COMPLETED' THEN
    RAISE EXCEPTION 'ENGINE_RUN_COMPLETED_APPEND_ONLY: %', OLD.id;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS engine_runs_guard_completed ON public.engine_runs;
CREATE TRIGGER engine_runs_guard_completed
BEFORE UPDATE OR DELETE ON public.engine_runs
FOR EACH ROW EXECUTE FUNCTION public.guard_completed_engine_run_row();

-- 9.3) engine_rule_results de un engine_run COMPLETED es inmutable.
--      Cubre tanto UPDATE/DELETE directo como el CASCADE que dispara el borrado
--      del engine_run padre (que, si está COMPLETED, ya abortó en 9.2).
CREATE OR REPLACE FUNCTION public.guard_completed_engine_run_child()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_engine_run_id uuid;
  v_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_engine_run_id := OLD.engine_run_id;
  ELSE
    v_engine_run_id := NEW.engine_run_id;
  END IF;

  SELECT status INTO v_status FROM public.engine_runs WHERE id = v_engine_run_id;
  IF v_status IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF v_status = 'COMPLETED' THEN
    RAISE EXCEPTION 'ENGINE_RUN_COMPLETED_APPEND_ONLY: rule results de %', v_engine_run_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS engine_rule_results_guard_completed ON public.engine_rule_results;
CREATE TRIGGER engine_rule_results_guard_completed
BEFORE UPDATE OR DELETE ON public.engine_rule_results
FOR EACH ROW EXECUTE FUNCTION public.guard_completed_engine_run_child();

-- 9.4) audit_runs: las corridas de decisión de máquina y las ya COMPLETED son
--      inmutables. `run_type` ya acepta 'AI_DECISION_V1' y 'AI_DECISION_V2'
--      (migrations/20260924120000_ai-human-comparison.sql:27).
--      IMPACTO CONOCIDO: human-decision/service.ts:140 y
--      reconciliation/service.ts:81 re-abren una corrida con runs.mark(...,
--      'PROCESSING'); si esa corrida ya estaba COMPLETED pasarán a fallar. Se
--      reporta al propietario.
CREATE OR REPLACE FUNCTION public.guard_audit_run_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF OLD.run_type IN ('AI_DECISION_V1', 'AI_DECISION_V2') OR OLD.status = 'COMPLETED' THEN
    RAISE EXCEPTION 'AUDIT_RUN_APPEND_ONLY: % (run_type=%, status=%)', OLD.id, OLD.run_type, OLD.status;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS audit_runs_guard_append_only ON public.audit_runs;
CREATE TRIGGER audit_runs_guard_append_only
BEFORE UPDATE OR DELETE ON public.audit_runs
FOR EACH ROW EXECUTE FUNCTION public.guard_audit_run_append_only();


-- =============================================================================
-- SECCIÓN 10 — (A) REVOCEs: la única ruta de escritura es el RPC
--
-- !!! IMPACTO CRÍTICO QUE DEBE LEER EL PROPIETARIO !!!
-- `engine_runs` y `engine_rule_results` tienen `GRANT SELECT, INSERT` a
-- `authenticated` desde migrations/20260924101000_phase-6-policy-engine.sql:32.
-- Revocar INSERT deja la única escritura en `persist_policy_evaluation_v1`.
--
-- ACTUALIZADO (Task 10, `5e7201f`): la integración YA está hecha. La escritura
-- de motor vive ahora en `apps/web/src/server/policy/evaluation-persistence.ts`,
-- que llama a `persist_policy_evaluation_v1` (línea ~113) y, con detección de
-- disponibilidad, degrada a los dos INSERT directos de siempre si el RPC no
-- existe. `runPolicyEngineForAudit` ya no escribe: delega íntegro en ese módulo
-- (apps/web/src/server/policy/evaluation.ts:86). Por tanto la ruta duplicada
-- (DO_NOT_DUPLICATE_IMPLEMENTATIONS) ya no es un riesgo de producción: el
-- INSERT directo queda como degradación declarada, con aviso grepeable, y no
-- como camino normal.
--
-- LO QUE SIGUE SIENDO CRÍTICO: la degradación no está verificada contra el
-- backend real. La detección de "el objeto no existe" (los códigos
-- PostgREST/Postgres de `isFoundationObjectMissing` en
-- apps/web/src/server/facts/foundation-objects.ts) se validó sólo contra fakes
-- locales, nunca contra InsForge. Con la migración sin aplicar, esa función es
-- lo único que mantiene el pipeline registrando corridas. Ver
-- docs/reports/POLICY-FOUNDATION-REMEDIATION-REPORT.md §24 (riesgo R-1).
--
-- Y CONSTA QUE QUEDA FUERA: `apps/web/src/app/api/dev/synthetic-case/route.ts`
-- sigue insertando directo en `engine_runs` (~línea 248) y sigue llamando
-- `factsRepo.freezeRun` (~línea 237), que hace un UPDATE directo revocado por la
-- línea siguiente. Son DOS roturas independientes de esa ruta dev, no una. No se
-- tocaron (fuera del alcance de la fase).
-- =============================================================================
REVOKE INSERT, UPDATE, DELETE ON public.engine_runs, public.engine_rule_results FROM anon, authenticated;
REVOKE UPDATE, DELETE ON public.facts, public.fact_extraction_runs FROM anon, authenticated;
REVOKE ALL ON public.engine_runs, public.engine_rule_results, public.facts, public.fact_extraction_runs FROM anon;

-- audit_runs CONSERVA INSERT y UPDATE a propósito, y NO se le revoca nada:
-- `createAuditRunRepository.mark` (packages/db/src/index.ts:1578) actualiza la
-- corrida en su ciclo de vida PENDING -> PROCESSING -> COMPLETED desde
-- human-decision/service.ts:140,160,261 y reconciliation/service.ts:81,115.
-- Revocar UPDATE las rompería. Lo que cierra el estado terminal es el trigger
-- 9.4, que aborta cualquier UPDATE o DELETE cuando la corrida ya está COMPLETED
-- o es una decisión de máquina. Ése es el mecanismo correcto aquí: el ciclo de
-- vida necesita UPDATE, la inmutabilidad la aporta el trigger.
GRANT SELECT ON public.engine_runs, public.engine_rule_results TO authenticated;


-- =============================================================================
-- SECCIÓN 11 — RPC public.freeze_fact_run_v1
--
-- Única forma de pasar un fact run a FROZEN con su snapshot. Valida, en este
-- orden y en la MISMA transacción (una sola llamada a una función plpgsql es una
-- sola transacción): actor, autorización sobre la auditoría, existencia del run,
-- estado PROCESSING, hechos no vacíos, fingerprints no vacíos, fuente de política
-- registrada. Sólo después inserta el snapshot y sella el run.
--
-- SECURITY DEFINER + `SET search_path = pg_catalog, public, pg_temp` (misma
-- convención que public.delete_audit, migrations/20260924180000:38).
-- NO confía en ningún parámetro para autorizar: el `audit_id` se toma del propio
-- run, nunca del llamador.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.freeze_fact_run_v1(
  p_fact_run_id uuid,
  p_facts jsonb,
  p_provenance jsonb,
  p_policy_source_id text,
  p_canonical_facts_fingerprint text,
  p_effective_facts_fingerprint text,
  p_fact_reviews_snapshot jsonb DEFAULT '[]'::jsonb,
  p_fact_count integer DEFAULT NULL
)
RETURNS TABLE (
  out_snapshot_id uuid,
  out_fact_run_id uuid,
  out_audit_id uuid,
  out_canonical_facts_fingerprint text,
  out_effective_facts_fingerprint text,
  out_fact_count integer,
  out_frozen_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role text := COALESCE(public.current_app_role(), '');
  v_run public.fact_extraction_runs;
  v_audit public.audits;
  v_snapshot public.fact_run_frozen_snapshots;
  v_db_fact_count integer;
  v_snapshot_fact_count integer;
  v_integrity_hash text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF p_fact_run_id IS NULL THEN
    RAISE EXCEPTION 'FACT_RUN_ID_REQUIRED';
  END IF;

  SELECT * INTO v_run FROM public.fact_extraction_runs WHERE id = p_fact_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FACT_RUN_NOT_FOUND';
  END IF;

  SELECT * INTO v_audit FROM public.audits WHERE id = v_run.audit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AUDIT_NOT_FOUND';
  END IF;

  IF NOT (v_audit.created_by = v_actor OR v_role = 'OWNER') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF v_run.state <> 'PROCESSING' THEN
    RAISE EXCEPTION 'FACT_RUN_NOT_PROCESSING: %', v_run.state;
  END IF;

  IF p_facts IS NULL OR jsonb_typeof(p_facts) <> 'array' THEN
    RAISE EXCEPTION 'FACTS_PAYLOAD_INVALID';
  END IF;
  IF p_provenance IS NULL OR jsonb_typeof(p_provenance) <> 'object' THEN
    RAISE EXCEPTION 'PROVENANCE_PAYLOAD_INVALID';
  END IF;
  IF p_fact_reviews_snapshot IS NULL OR jsonb_typeof(p_fact_reviews_snapshot) <> 'array' THEN
    RAISE EXCEPTION 'FACT_REVIEWS_PAYLOAD_INVALID';
  END IF;

  -- El run no se congela vacío. Se cuentan los hechos CRUDO persistidos: es la
  -- señal de que la extracción corrió de verdad.
  SELECT count(*)::integer INTO v_db_fact_count FROM public.facts WHERE run_id = p_fact_run_id;
  IF v_db_fact_count = 0 THEN
    RAISE EXCEPTION 'FACT_RUN_EMPTY';
  END IF;

  -- Lo que se sella es `p_facts`, que puede legítimamente diferir de la tabla
  -- `facts` (incluye correcciones humanas). `fact_count` registra cuántos hechos
  -- quedan congelados de verdad, que es lo que verá el motor; y si el llamador
  -- declaró un conteo, tiene que coincidir con el payload que envía.
  v_snapshot_fact_count := jsonb_array_length(p_facts);
  IF v_snapshot_fact_count = 0 THEN
    RAISE EXCEPTION 'FROZEN_SNAPSHOT_EMPTY';
  END IF;
  IF p_fact_count IS NOT NULL AND p_fact_count <> v_snapshot_fact_count THEN
    RAISE EXCEPTION 'FACT_COUNT_MISMATCH: declarado %, enviado %', p_fact_count, v_snapshot_fact_count;
  END IF;

  IF btrim(COALESCE(p_canonical_facts_fingerprint, '')) = ''
     OR btrim(COALESCE(p_effective_facts_fingerprint, '')) = '' THEN
    RAISE EXCEPTION 'FACTS_FINGERPRINT_REQUIRED';
  END IF;

  -- ONLY_OWNER_PROVIDED_POLICY_SOURCES: no se congela con una fuente que no esté
  -- en el registro, y menos aún con una inventada por el llamador.
  IF NOT EXISTS (
    SELECT 1 FROM public.policy_source_registry WHERE document_id = p_policy_source_id
  ) THEN
    RAISE EXCEPTION 'POLICY_SOURCE_NOT_REGISTERED: %', p_policy_source_id;
  END IF;

  -- El hash de integridad se calcula AQUÍ, en el servidor, sobre el contenido
  -- canónico que se está sellando. Si el llamador mandara su propio hash, podría
  -- sellar un snapshot con un hash que no corresponde a sus bytes.
  v_integrity_hash := encode(
    digest(
      jsonb_build_object(
        'auditId', v_run.audit_id,
        'factRunId', v_run.id,
        'extractorVersion', v_run.extractor_version,
        'policySourceId', p_policy_source_id,
        'canonicalFingerprint', p_canonical_facts_fingerprint,
        'effectiveFingerprint', p_effective_facts_fingerprint,
        'facts', p_facts,
        'provenance', p_provenance,
        'factReviews', p_fact_reviews_snapshot
      )::text,
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.fact_run_frozen_snapshots (
    audit_id, fact_run_id, facts, provenance, fact_reviews_snapshot,
    extractor_version, policy_source_id, canonical_facts_fingerprint,
    effective_facts_fingerprint, fact_count, integrity_hash, frozen_by, frozen_at
  )
  VALUES (
    v_run.audit_id, v_run.id, p_facts, p_provenance, p_fact_reviews_snapshot,
    v_run.extractor_version, p_policy_source_id, p_canonical_facts_fingerprint,
    p_effective_facts_fingerprint, v_snapshot_fact_count, v_integrity_hash, v_actor, now()
  )
  RETURNING * INTO v_snapshot;

  UPDATE public.fact_extraction_runs
     SET state = 'FROZEN',
         frozen_at = v_snapshot.frozen_at,
         effective_facts_fingerprint = p_effective_facts_fingerprint
   WHERE id = v_run.id;

  RETURN QUERY
    SELECT v_snapshot.id,
           v_snapshot.fact_run_id,
           v_snapshot.audit_id,
           v_snapshot.canonical_facts_fingerprint,
           v_snapshot.effective_facts_fingerprint,
           v_snapshot.fact_count,
           v_snapshot.frozen_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.freeze_fact_run_v1(uuid, jsonb, jsonb, text, text, text, jsonb, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.freeze_fact_run_v1(uuid, jsonb, jsonb, text, text, text, jsonb, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.freeze_fact_run_v1(uuid, jsonb, jsonb, text, text, text, jsonb, integer) TO authenticated;


-- =============================================================================
-- SECCIÓN 12 — RPC public.create_derived_fact_run_v1
--
-- Corrige un caso: valida que el run padre esté FROZEN, crea un run NUEVO
-- (DRAFT -> PROCESSING -> FROZEN, recorriendo la máquina de estados legal en
-- lugar de saltar el guard), inserta los hechos corregidos, inserta SU snapshot
-- y devuelve el fingerprint del padre ANTES y DESPUÉS. El padre no se toca: ni
-- una columna. Si el padre no estuviera FROZEN, no hay snapshot del cual
-- derivar y se aborta.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.create_derived_fact_run_v1(
  p_parent_fact_run_id uuid,
  p_derivation_reason text,
  p_facts jsonb,
  p_provenance jsonb,
  p_policy_source_id text,
  p_extractor_version text,
  p_canonical_facts_fingerprint text,
  p_effective_facts_fingerprint text,
  p_fact_reviews_snapshot jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE (
  out_derived_fact_run_id uuid,
  out_derived_snapshot_id uuid,
  out_parent_fact_run_id uuid,
  out_parent_fingerprint_before text,
  out_parent_fingerprint_after text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role text := COALESCE(public.current_app_role(), '');
  v_parent public.fact_extraction_runs;
  v_parent_snapshot public.fact_run_frozen_snapshots;
  v_audit public.audits;
  v_derived public.fact_extraction_runs;
  v_derived_snapshot public.fact_run_frozen_snapshots;
  v_parent_fingerprint_before text;
  v_integrity_hash text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF p_parent_fact_run_id IS NULL THEN
    RAISE EXCEPTION 'FACT_RUN_ID_REQUIRED';
  END IF;

  IF btrim(COALESCE(p_derivation_reason, '')) = '' THEN
    RAISE EXCEPTION 'DERIVATION_REASON_REQUIRED';
  END IF;

  IF p_facts IS NULL OR jsonb_typeof(p_facts) <> 'array' THEN
    RAISE EXCEPTION 'FACTS_PAYLOAD_INVALID';
  END IF;
  IF jsonb_array_length(p_facts) = 0 THEN
    RAISE EXCEPTION 'FACT_RUN_EMPTY';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_facts) AS f WHERE COALESCE(f->>'fact_type', '') = ''
  ) THEN
    RAISE EXCEPTION 'DERIVED_FACTS_INVALID: fact_type vacio';
  END IF;
  IF p_provenance IS NULL OR jsonb_typeof(p_provenance) <> 'object' THEN
    RAISE EXCEPTION 'PROVENANCE_PAYLOAD_INVALID';
  END IF;
  IF p_fact_reviews_snapshot IS NULL OR jsonb_typeof(p_fact_reviews_snapshot) <> 'array' THEN
    RAISE EXCEPTION 'FACT_REVIEWS_PAYLOAD_INVALID';
  END IF;
  IF btrim(COALESCE(p_extractor_version, '')) = '' THEN
    RAISE EXCEPTION 'EXTRACTOR_VERSION_REQUIRED';
  END IF;
  IF btrim(COALESCE(p_canonical_facts_fingerprint, '')) = ''
     OR btrim(COALESCE(p_effective_facts_fingerprint, '')) = '' THEN
    RAISE EXCEPTION 'FACTS_FINGERPRINT_REQUIRED';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_facts) AS f
    WHERE COALESCE(NULLIF(f->>'classification', ''), 'OBSERVABLE')
          NOT IN ('OBSERVABLE', 'HUMAN_CONFIRMED', 'HUMAN_CORRECTED')
  ) THEN
    RAISE EXCEPTION 'DERIVED_FACTS_INVALID: classification desconocida';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.policy_source_registry WHERE document_id = p_policy_source_id
  ) THEN
    RAISE EXCEPTION 'POLICY_SOURCE_NOT_REGISTERED: %', p_policy_source_id;
  END IF;

  SELECT * INTO v_parent
  FROM public.fact_extraction_runs
  WHERE id = p_parent_fact_run_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FACT_RUN_NOT_FOUND';
  END IF;

  -- El padre DEBE estar congelado: es la única fuente de hechos ya sella.
  IF v_parent.state <> 'FROZEN' THEN
    RAISE EXCEPTION 'PARENT_FACT_RUN_NOT_FROZEN: %', v_parent.state;
  END IF;

  SELECT * INTO v_parent_snapshot
  FROM public.fact_run_frozen_snapshots
  WHERE fact_run_id = v_parent.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PARENT_FROZEN_SNAPSHOT_MISSING';
  END IF;

  SELECT * INTO v_audit FROM public.audits WHERE id = v_parent.audit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AUDIT_NOT_FOUND';
  END IF;

  IF NOT (v_audit.created_by = v_actor OR v_role = 'OWNER') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  -- El fingerprint del padre se lee ANTES de cualquier escritura y se devuelve
  -- DESPUÉS, para que el llamador pueda probar que no se movió.
  v_parent_fingerprint_before := v_parent.effective_facts_fingerprint;

  -- El run derivado hereda `audit_id`, `policy_code`, `policy_version` y
  -- `artifact_set_fingerprint` del padre. Como el índice único de idempotencia
  -- `fact_extraction_runs_idempotency_hash_idx` es
  -- (audit_id, policy_code_hash, policy_version, extractor_version,
  -- artifact_set_fingerprint_hash), la ÚNICA variable libre es
  -- `extractor_version`: si coincide con la del padre, el INSERT chocaría con el
  -- índice. Se valida aquí para dar un error legible en vez de un 23505 opaco.
  IF p_extractor_version = v_parent.extractor_version THEN
    RAISE EXCEPTION
      'DERIVED_RUN_IDEMPOTENCY_COLLISION: p_extractor_version debe diferir de la del padre (%)',
      v_parent.extractor_version;
  END IF;

  INSERT INTO public.fact_extraction_runs (
    audit_id, policy_code, policy_version, extractor_version,
    artifact_set_fingerprint, state, created_by, parent_fact_run_id, derivation_reason
  )
  VALUES (
    v_parent.audit_id, v_parent.policy_code, v_parent.policy_version,
    p_extractor_version, v_parent.artifact_set_fingerprint, 'DRAFT', v_actor,
    v_parent.id, p_derivation_reason
  )
  RETURNING * INTO v_derived;

  INSERT INTO public.facts (audit_id, run_id, fact_type, classification, value, source_ref, confidence)
  SELECT
    v_derived.audit_id,
    v_derived.id,
    f->>'fact_type',
    COALESCE(NULLIF(f->>'classification', ''), 'OBSERVABLE'),
    COALESCE(f->'value', 'null'::jsonb),
    COALESCE(f->'source_ref', '{}'::jsonb),
    CASE
      WHEN (f->>'confidence') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (f->>'confidence')::numeric
      ELSE NULL
    END
  FROM jsonb_array_elements(p_facts) AS f;

  UPDATE public.fact_extraction_runs SET state = 'PROCESSING' WHERE id = v_derived.id;

  v_integrity_hash := encode(
    digest(
      jsonb_build_object(
        'auditId', v_derived.audit_id,
        'factRunId', v_derived.id,
        'extractorVersion', p_extractor_version,
        'policySourceId', p_policy_source_id,
        'canonicalFingerprint', p_canonical_facts_fingerprint,
        'effectiveFingerprint', p_effective_facts_fingerprint,
        'facts', p_facts,
        'provenance', p_provenance,
        'factReviews', p_fact_reviews_snapshot
      )::text,
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.fact_run_frozen_snapshots (
    audit_id, fact_run_id, facts, provenance, fact_reviews_snapshot,
    extractor_version, policy_source_id, canonical_facts_fingerprint,
    effective_facts_fingerprint, fact_count, integrity_hash, frozen_by, frozen_at
  )
  VALUES (
    v_derived.audit_id, v_derived.id, p_facts, p_provenance, p_fact_reviews_snapshot,
    p_extractor_version, p_policy_source_id, p_canonical_facts_fingerprint,
    p_effective_facts_fingerprint, jsonb_array_length(p_facts), v_integrity_hash, v_actor, now()
  )
  RETURNING * INTO v_derived_snapshot;

  UPDATE public.fact_extraction_runs
     SET state = 'FROZEN',
         frozen_at = v_derived_snapshot.frozen_at,
         effective_facts_fingerprint = p_effective_facts_fingerprint
   WHERE id = v_derived.id;

  RETURN QUERY
    SELECT v_derived.id,
           v_derived_snapshot.id,
           v_parent.id,
           v_parent_fingerprint_before,
           (SELECT effective_facts_fingerprint FROM public.fact_extraction_runs WHERE id = v_parent.id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_derived_fact_run_v1(uuid, text, jsonb, jsonb, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_derived_fact_run_v1(uuid, text, jsonb, jsonb, text, text, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_derived_fact_run_v1(uuid, text, jsonb, jsonb, text, text, text, text, jsonb) TO authenticated;


-- =============================================================================
-- SECCIÓN 13 — RPC public.persist_policy_evaluation_v1
--
-- Persistencia ATÓMICA de una evaluación: engine_run + rule_results + envelope +
-- baseline AI_BASELINE, en una sola transacción y con las tres idempotencias
-- declaradas:
--   1) (audit_id, facts_fingerprint, policy_code_hash, policy_version,
--      rules_fingerprint, COALESCE(owner_precedence_version,'')) — índice único
--      `engine_runs_idempotency_idx` (migrations/20260924130000:27)
--   2) (engine_run_id, rule_id) — UNIQUE de engine_rule_results
--      (migrations/20260924101000:23)
--   3) engine_run_id — UNIQUE de audit_evaluation_envelopes
-- La idempotencia se resuelve con subtransacciones y captura de
-- `unique_violation` en lugar de `ON CONFLICT (...)`: el índice único de
-- engine_runs contiene una expresión (COALESCE) y un predicado parcial, y
-- PostgreSQL no puede inferirlos de forma fiable desde un `ON CONFLICT`. Así el
-- comportamiento es idéntico sin depender de la inferencia del índice.
--
-- Requisito de integridad: el fact run DEBE estar FROZEN y DEBE tener snapshot.
-- Así los hechos que alimentaron la evaluación son siempre los sellados, nunca
-- una lectura suelta de `facts`/`fact_reviews`.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.persist_policy_evaluation_v1(
  p_audit_id uuid,
  p_fact_run_id uuid,
  p_policy_code text,
  p_policy_version text,
  p_rules_fingerprint text,
  p_facts_fingerprint text,
  p_suggested_outcome text,
  p_outcome_status text,
  p_evaluation jsonb,
  p_evaluated_rules jsonb,
  p_envelope jsonb,
  p_envelope_hash text,
  p_owner_precedence_version text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS TABLE (
  out_engine_run_id uuid,
  out_created boolean,
  out_envelope_id uuid,
  out_baseline_run_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role text := COALESCE(public.current_app_role(), '');
  v_audit public.audits;
  v_fact_run public.fact_extraction_runs;
  v_frozen_snapshot public.fact_run_frozen_snapshots;
  v_engine_run_id uuid;
  v_envelope_id uuid;
  v_baseline_run_id uuid;
  v_created boolean := false;
  v_policy_code_hash text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF p_audit_id IS NULL OR p_fact_run_id IS NULL THEN
    RAISE EXCEPTION 'EVALUATION_INPUT_INVALID';
  END IF;
  IF btrim(COALESCE(p_policy_code, '')) = '' OR btrim(COALESCE(p_policy_version, '')) = '' THEN
    RAISE EXCEPTION 'POLICY_REFERENCE_REQUIRED';
  END IF;
  IF btrim(COALESCE(p_rules_fingerprint, '')) = '' OR btrim(COALESCE(p_facts_fingerprint, '')) = '' THEN
    RAISE EXCEPTION 'FINGERPRINT_REQUIRED';
  END IF;
  IF p_evaluation IS NULL OR jsonb_typeof(p_evaluation) <> 'object' THEN
    RAISE EXCEPTION 'EVALUATION_PAYLOAD_INVALID';
  END IF;
  IF p_evaluated_rules IS NULL OR jsonb_typeof(p_evaluated_rules) <> 'array' THEN
    RAISE EXCEPTION 'EVALUATED_RULES_PAYLOAD_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_evaluated_rules) AS r WHERE COALESCE(r->>'rule_id', '') = ''
  ) THEN
    RAISE EXCEPTION 'EVALUATED_RULES_INVALID: rule_id vacio';
  END IF;
  IF p_envelope IS NULL OR jsonb_typeof(p_envelope) <> 'object' THEN
    RAISE EXCEPTION 'ENVELOPE_PAYLOAD_INVALID';
  END IF;
  IF COALESCE(p_envelope->>'schemaVersion', p_envelope->>'schema_version', '') <> 'audit-evaluation-envelope-v1' THEN
    RAISE EXCEPTION 'ENVELOPE_SCHEMA_VERSION_INVALID';
  END IF;
  IF COALESCE(p_envelope_hash, '') !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'ENVELOPE_HASH_INVALID: se espera SHA-256 en hexadecimal minuscula';
  END IF;

  SELECT * INTO v_audit FROM public.audits WHERE id = p_audit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AUDIT_NOT_FOUND';
  END IF;

  -- Autorización contra la auditoría pedida, no contra un audit_id del padre.
  IF NOT (v_audit.created_by = v_actor OR v_role = 'OWNER') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT * INTO v_fact_run FROM public.fact_extraction_runs WHERE id = p_fact_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FACT_RUN_NOT_FOUND';
  END IF;

  -- El audit_id se toma del fact run: un llamador no puede colgar una evaluación
  -- de una auditoría ajena pasando un par audit/run incoherente.
  IF v_fact_run.audit_id <> p_audit_id THEN
    RAISE EXCEPTION 'FACT_RUN_AUDIT_MISMATCH';
  END IF;

  IF v_fact_run.state <> 'FROZEN' THEN
    RAISE EXCEPTION 'FACT_RUN_NOT_FROZEN: %', v_fact_run.state;
  END IF;

  SELECT * INTO v_frozen_snapshot
  FROM public.fact_run_frozen_snapshots
  WHERE fact_run_id = v_fact_run.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FROZEN_SNAPSHOT_MISSING';
  END IF;

  v_policy_code_hash := encode(digest(p_policy_code, 'sha256'), 'hex');

  -- (1) engine_run: insertar o recuperar el idempotente existente.
  BEGIN
    INSERT INTO public.engine_runs (
      audit_id, fact_run_id, policy_code, policy_code_hash, policy_version,
      rules_fingerprint, facts_fingerprint, owner_precedence_version, status,
      suggested_outcome, outcome_status, evaluation
    )
    VALUES (
      p_audit_id, p_fact_run_id, p_policy_code, v_policy_code_hash, p_policy_version,
      p_rules_fingerprint, p_facts_fingerprint, p_owner_precedence_version, 'COMPLETED',
      p_suggested_outcome, p_outcome_status, p_evaluation
    )
    RETURNING id INTO v_engine_run_id;
    v_created := true;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_engine_run_id
    FROM public.engine_runs
    WHERE audit_id = p_audit_id
      AND facts_fingerprint = p_facts_fingerprint
      AND policy_code_hash = v_policy_code_hash
      AND policy_version = p_policy_version
      AND rules_fingerprint = p_rules_fingerprint
      AND COALESCE(owner_precedence_version, '') = COALESCE(p_owner_precedence_version, '');
    v_created := false;
  END;

  IF v_engine_run_id IS NULL THEN
    RAISE EXCEPTION 'ENGINE_RUN_IDEMPOTENCY_LOOKUP_FAILED';
  END IF;

  -- (2) rule_results: nunca se reescribe uno existente (UNIQUE del plan).
  INSERT INTO public.engine_rule_results (engine_run_id, rule_id, status, result)
  SELECT v_engine_run_id, r->>'rule_id', COALESCE(r->>'status', 'UNKNOWN'), COALESCE(r->'result', '{}'::jsonb)
  FROM jsonb_array_elements(p_evaluated_rules) AS r
  ON CONFLICT (engine_run_id, rule_id) DO NOTHING;

  -- (3) envelope: 1:1 con el engine_run, inmutable una vez escrito.
  BEGIN
    INSERT INTO public.audit_evaluation_envelopes (
      audit_id, engine_run_id, fact_run_id, schema_version, envelope, envelope_hash,
      facts_fingerprint, rules_fingerprint, created_by
    )
    VALUES (
      p_audit_id, v_engine_run_id, p_fact_run_id, 'audit-evaluation-envelope-v1',
      p_envelope, p_envelope_hash, p_facts_fingerprint, p_rules_fingerprint,
      COALESCE(p_created_by, v_actor)
    )
    RETURNING id INTO v_envelope_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_envelope_id
    FROM public.audit_evaluation_envelopes
    WHERE engine_run_id = v_engine_run_id;
  END;

  IF v_envelope_id IS NULL THEN
    RAISE EXCEPTION 'ENVELOPE_IDEMPOTENCY_LOOKUP_FAILED';
  END IF;

  -- (4) baseline AI_BASELINE idempotente: índice único parcial
  -- `audit_runs_baseline_engine_unique (engine_run_id) WHERE run_type =
  -- 'AI_BASELINE' AND engine_run_id IS NOT NULL` (migrations/20260924120000:49).
  BEGIN
    INSERT INTO public.audit_runs (
      audit_id, run_type, status, engine_run_id, fact_run_id, policy_code,
      policy_version, input_fingerprint, result, created_by, completed_at
    )
    VALUES (
      p_audit_id, 'AI_BASELINE', 'COMPLETED', v_engine_run_id, p_fact_run_id,
      p_policy_code, p_policy_version, p_facts_fingerprint, p_evaluation,
      COALESCE(p_created_by, v_actor), now()
    )
    RETURNING id INTO v_baseline_run_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_baseline_run_id
    FROM public.audit_runs
    WHERE engine_run_id = v_engine_run_id
      AND run_type = 'AI_BASELINE';
  END;

  RETURN QUERY
    SELECT v_engine_run_id, v_created, v_envelope_id, v_baseline_run_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.persist_policy_evaluation_v1(uuid, uuid, text, text, text, text, text, text, jsonb, jsonb, jsonb, text, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.persist_policy_evaluation_v1(uuid, uuid, text, text, text, text, text, text, jsonb, jsonb, jsonb, text, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.persist_policy_evaluation_v1(uuid, uuid, text, text, text, text, text, text, jsonb, jsonb, jsonb, text, text, uuid) TO authenticated;


-- =============================================================================
-- SECCIÓN 14 — Sondas de verificación (sólo lectura de metadatos de ACL)
--
-- POR QUÉ EXISTEN: el E2E corre sobre @insforge/sdk, que es un cliente PostgREST.
-- PostgREST no expone SQL arbitrario: sólo `from()` y `rpc()`. No hay forma de
-- ejecutar `has_table_privilege(...)` ni una transacción multi-sentido desde el
-- test. Estas dos funciones son el puente mínimo y de sólo lectura (una) /
-- con alcance de subtransacción explícita (la otra) que hace posible verificar la
-- ACL y las barreras sin abrir un cliente de base de datos al repositorio.
--
-- SEGURIDAD:
--   - No reciben `audit_id` del llamador para autorizar: leen el estado real de
--     las tablas y sólo REPORTAN.
--   - `policy_foundation_immutability_probe` sí recibe un audit_id, y por eso
--     exige que el llamador sea el dueño de esa auditoría o tenga rol OWNER.
--     `p_actor_id` sólo se usa cuando NO hay sesión JWT (cliente admin de DEV);
--     si hay sesión, el actor efectivo es SIEMPRE `auth.uid()` y un `p_actor_id`
--     distinto se rechaza. Es decir: un rol `authenticated` no puede escalar
--     privilegios declarando otro actor.
--   - Se revoca EXECUTE a `anon`; se deja el privilegio de PUBLIC para el rol
--     administrativo que usa el E2E (el nombre de ese rol no aparece en ninguna
--     migración del repositorio, así que no se adivina).
--   - Los intentos de mutación (P1..P4) van cada uno dentro de una subtransacción
--     plpgsql (bloque `BEGIN ... EXCEPTION`) que Postgres revierte al capturarse
--     la excepción: si el disparador NO estuviera, la escritura se aplicaría de
--     verdad, y por eso el resultado no se juzga por "no saltó excepción" sino por
--     el número de filas afectadas (`GET DIAGNOSTICS ... ROW_COUNT`); 0 filas =
--     bloqueado de verdad.
--   - P5 escribe una corrección derivada completa dentro de una subtransacción y
--     la revierte con un centinela explícito
--     (`RAISE EXCEPTION 'POLICY_FOUNDATION_PROBE_ROLLBACK'`). Ese es el
--     "rollback explícito" del E2E: después del rollback se vuelve a leer el
--     estado desde la base de datos, así que la aserción no depende de que
--     plpgsql conserve los valores asignados dentro del bloque revertido.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.policy_foundation_acl_probe()
RETURNS TABLE (
  out_object_name text,
  out_role_name text,
  out_can_select boolean,
  out_can_insert boolean,
  out_can_update boolean,
  out_can_delete boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT
    target.obj::text,
    roles.rolname::text,
    pg_catalog.has_table_privilege(roles.rolname, target.obj, 'SELECT'),
    pg_catalog.has_table_privilege(roles.rolname, target.obj, 'INSERT'),
    pg_catalog.has_table_privilege(roles.rolname, target.obj, 'UPDATE'),
    pg_catalog.has_table_privilege(roles.rolname, target.obj, 'DELETE')
  FROM unnest(ARRAY[
    'public.policy_source_registry',
    'public.fact_run_frozen_snapshots',
    'public.audit_evaluation_envelopes',
    'public.ai_decision_snapshots',
    'public.fact_extraction_runs',
    'public.facts',
    'public.engine_runs',
    'public.engine_rule_results',
    'public.audit_runs'
  ]) AS target(obj)
  CROSS JOIN pg_catalog.pg_roles AS roles
  WHERE roles.rolname IN ('anon', 'authenticated')
  ORDER BY target.obj, roles.rolname;
$$;

REVOKE EXECUTE ON FUNCTION public.policy_foundation_acl_probe() FROM anon;
GRANT EXECUTE ON FUNCTION public.policy_foundation_acl_probe() TO authenticated;

CREATE OR REPLACE FUNCTION public.policy_foundation_immutability_probe(
  p_audit_id uuid,
  p_actor_id uuid,
  p_fact_run_id uuid,
  p_fact_id uuid,
  p_ai_decision_id uuid
)
RETURNS TABLE (
  out_probe_name text,
  out_probe_blocked boolean,
  out_probe_detail text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_session_actor uuid := auth.uid();
  v_actor uuid;
  v_audit public.audits;
  v_parent_snapshot public.fact_run_frozen_snapshots;
  v_parent_fingerprint_before text;
  v_parent_fingerprint_after text;
  v_derived_facts jsonb;
  v_derived_runs_before integer;
  v_derived_runs_after integer;
  v_rows integer;
  v_rolled_back boolean;
  v_error text;
BEGIN
  IF p_audit_id IS NULL OR p_fact_run_id IS NULL OR p_fact_id IS NULL OR p_ai_decision_id IS NULL THEN
    RAISE EXCEPTION 'PROBE_INPUT_INVALID';
  END IF;

  -- El actor efectivo nunca puede ser "más autorizado" que la sesión.
  IF v_session_actor IS NOT NULL AND p_actor_id IS NOT NULL AND v_session_actor <> p_actor_id THEN
    RAISE EXCEPTION 'FORBIDDEN: el actor declarado no coincide con la sesion';
  END IF;
  v_actor := COALESCE(v_session_actor, p_actor_id);
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT * INTO v_audit FROM public.audits WHERE id = p_audit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AUDIT_NOT_FOUND';
  END IF;
  IF NOT (v_audit.created_by = v_actor OR COALESCE(public.current_app_role(), '') = 'OWNER') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  -- P1: UPDATE de un hecho de un run FROZEN debe abortar.
  BEGIN
    UPDATE public.facts SET value = value WHERE id = p_fact_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    out_probe_name := 'UPDATE_FROZEN_FACT';
    out_probe_blocked := (v_rows = 0);
    out_probe_detail := format('filas afectadas: %s', v_rows);
  EXCEPTION WHEN OTHERS THEN
    out_probe_name := 'UPDATE_FROZEN_FACT';
    out_probe_blocked := true;
    out_probe_detail := SQLERRM;
  END;
  RETURN NEXT;

  -- P2: DELETE del snapshot congelado debe abortar.
  BEGIN
    DELETE FROM public.fact_run_frozen_snapshots WHERE fact_run_id = p_fact_run_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    out_probe_name := 'DELETE_FROZEN_SNAPSHOT';
    out_probe_blocked := (v_rows = 0);
    out_probe_detail := format('filas afectadas: %s', v_rows);
  EXCEPTION WHEN OTHERS THEN
    out_probe_name := 'DELETE_FROZEN_SNAPSHOT';
    out_probe_blocked := true;
    out_probe_detail := SQLERRM;
  END;
  RETURN NEXT;

  -- P3: UPDATE de un audit_run AI_DECISION_V1 COMPLETED debe abortar.
  BEGIN
    UPDATE public.audit_runs
       SET status = 'FAILED'
     WHERE id = p_ai_decision_id
       AND run_type = 'AI_DECISION_V1'
       AND status = 'COMPLETED';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    out_probe_name := 'UPDATE_COMPLETED_AI_DECISION_V1';
    out_probe_blocked := (v_rows = 0);
    out_probe_detail := format('filas afectadas: %s', v_rows);
  EXCEPTION WHEN OTHERS THEN
    out_probe_name := 'UPDATE_COMPLETED_AI_DECISION_V1';
    out_probe_blocked := true;
    out_probe_detail := SQLERRM;
  END;
  RETURN NEXT;

  -- P4: INSERT de un hecho en un run FROZEN debe abortar.
  BEGIN
    INSERT INTO public.facts (audit_id, run_id, fact_type, classification, value, source_ref)
    SELECT a.id, r.id, '__probe_illegal__', 'OBSERVABLE', 'null'::jsonb, '{}'::jsonb
    FROM public.fact_extraction_runs r
    JOIN public.audits a ON a.id = r.audit_id
    WHERE r.id = p_fact_run_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    out_probe_name := 'INSERT_FACT_INTO_FROZEN_RUN';
    out_probe_blocked := (v_rows = 0);
    out_probe_detail := format('filas afectadas: %s', v_rows);
  EXCEPTION WHEN OTHERS THEN
    out_probe_name := 'INSERT_FACT_INTO_FROZEN_RUN';
    out_probe_blocked := true;
    out_probe_detail := SQLERRM;
  END;
  RETURN NEXT;

  -- P5: una corrección derivada NO mueve el fingerprint del padre.
  -- Todo el bloque es una subtransacción: el centinela final la revierte entera,
  -- así que el run derivado que se crea para la prueba no persiste.
  SELECT * INTO v_parent_snapshot
  FROM public.fact_run_frozen_snapshots
  WHERE fact_run_id = p_fact_run_id;

  IF NOT FOUND THEN
    out_probe_name := 'DERIVED_CORRECTION_PRESERVES_PARENT_FINGERPRINT';
    out_probe_blocked := false;
    out_probe_detail := 'PARENT_FROZEN_SNAPSHOT_MISSING';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT effective_facts_fingerprint INTO v_parent_fingerprint_before
  FROM public.fact_extraction_runs
  WHERE id = p_fact_run_id;

  SELECT count(*)::integer INTO v_derived_runs_before
  FROM public.fact_extraction_runs
  WHERE parent_fact_run_id = p_fact_run_id;

  v_derived_facts := COALESCE(v_parent_snapshot.facts, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'fact_type', '__probe_correction__',
      'classification', 'HUMAN_CORRECTED',
      'value', 'true',
      'source_ref', jsonb_build_object('probe', true)
    )
  );

  v_rolled_back := false;
  v_error := '';
  BEGIN
    -- Corrección derivada escrita aquí dentro, con la misma forma que produce
    -- public.create_derived_fact_run_v1, en vez de llamar a ese RPC: los tres RPC
    -- de producción exigen `auth.uid()` (no confían en un actor declarado por el
    -- llamador) y la sonda corre con el cliente administrativo de DEV, que no
    -- tiene sesión JWT. Lo que P5 verifica es el INVARIANTE del plan — una
    -- corrección derivada no mueve el fingerprint del padre — y eso no depende
    -- de quién escribió la fila. El camino feliz del RPC se cubre aparte, con la
    -- aserción AUTH_REQUIRED del E2E.
    INSERT INTO public.fact_extraction_runs (
      audit_id, policy_code, policy_version, extractor_version,
      artifact_set_fingerprint, state, created_by, parent_fact_run_id, derivation_reason
    )
    SELECT v_audit.id, r.policy_code, r.policy_version,
           s.extractor_version || '+derived', r.artifact_set_fingerprint,
           'DRAFT', v_actor, r.id, 'probe: derivacion revertida por rollback explicito'
    FROM public.fact_extraction_runs r
    JOIN public.fact_run_frozen_snapshots s ON s.fact_run_id = r.id
    WHERE r.id = p_fact_run_id;

    INSERT INTO public.facts (audit_id, run_id, fact_type, classification, value, source_ref)
    SELECT d.audit_id, d.id, f->>'fact_type', f->>'classification', f->'value', f->'source_ref'
    FROM public.fact_extraction_runs d
    CROSS JOIN jsonb_array_elements(v_derived_facts) AS f
    WHERE d.parent_fact_run_id = p_fact_run_id;

    INSERT INTO public.fact_run_frozen_snapshots (
      audit_id, fact_run_id, facts, provenance, fact_reviews_snapshot,
      extractor_version, policy_source_id, canonical_facts_fingerprint,
      effective_facts_fingerprint, fact_count, integrity_hash, frozen_by
    )
    SELECT d.audit_id, d.id, v_derived_facts,
           jsonb_build_object('source', 'POLICY_FOUNDATION_PROBE', 'reverted', true),
           s.fact_reviews_snapshot, d.extractor_version, s.policy_source_id,
           s.canonical_facts_fingerprint, s.effective_facts_fingerprint,
           jsonb_array_length(v_derived_facts),
           encode(digest(d.id::text || v_derived_facts::text, 'sha256'), 'hex'),
           v_actor
    FROM public.fact_extraction_runs d
    JOIN public.fact_run_frozen_snapshots s ON s.fact_run_id = d.parent_fact_run_id
    WHERE d.parent_fact_run_id = p_fact_run_id;

    -- Centinela: aborta esta subtransacción y la revierte por completo.
    RAISE EXCEPTION 'POLICY_FOUNDATION_PROBE_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'POLICY_FOUNDATION_PROBE_ROLLBACK' THEN
      v_rolled_back := true;
    ELSE
      v_error := SQLERRM;
    END IF;
  END;

  -- Lecturas hechas FUERA de la subtransacción, ya revertida: no dependen de que
  -- plpgsql conserve o no los valores asignados dentro de un bloque revertido.
  SELECT effective_facts_fingerprint INTO v_parent_fingerprint_after
  FROM public.fact_extraction_runs
  WHERE id = p_fact_run_id;

  SELECT count(*)::integer INTO v_derived_runs_after
  FROM public.fact_extraction_runs
  WHERE parent_fact_run_id = p_fact_run_id;

  out_probe_name := 'DERIVED_CORRECTION_PRESERVES_PARENT_FINGERPRINT';
  out_probe_blocked := (
    v_rolled_back
    AND v_parent_fingerprint_before IS NOT DISTINCT FROM v_parent_fingerprint_after
    AND v_derived_runs_after = v_derived_runs_before
  );
  out_probe_detail := format(
    'rollback=%s runsDerivados antes=%s despues=%s fingerprint antes=%s despues=%s error=%s',
    v_rolled_back,
    v_derived_runs_before,
    v_derived_runs_after,
    COALESCE(v_parent_fingerprint_before, '(null)'),
    COALESCE(v_parent_fingerprint_after, '(null)'),
    COALESCE(NULLIF(v_error, ''), '(ninguno)')
  );
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.policy_foundation_immutability_probe(uuid, uuid, uuid, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.policy_foundation_immutability_probe(uuid, uuid, uuid, uuid, uuid) TO authenticated;


-- =============================================================================
-- FIN DE MIGRACIÓN
-- Resumen de lo que esta migración hace y de lo que deliberadamente NO hace:
--   - No modifica datos históricos ni outcomes previos.
--   - No marca ninguna fuente como CANONICAL.
--   - No aplica ninguna política: sólo almacenamiento y garantías de escritura.
--   - No está aplicada. No la ejecutes contra 4pw4jdzv (producción).
-- =============================================================================
