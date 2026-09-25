-- ============================================================================
-- Cierre de seguridad de Policy Foundation + backfill de snapshots legacy
--
-- Migracion de CIERRE, no de normativa. No cambia ninguna regla, ningun
-- outcome, ningun umbral y ninguna fingerprint del Golden Master.
--
-- ORIGEN DE CADA BLOQUE:
--   A) Correcciones de ACL detectadas al MEDIR la ACL real con
--      has_table_privilege() sobre la base ya migrada.
--   B) RLS ausente en dos tablas con，DML completo para `anon`.
--   C) Backfill de snapshots para Fact Runs FROZEN anteriores a la tabla.
--
-- Todo lo que se afirma aqui se comprobó contra el backend, no se infirió.
-- ============================================================================


-- =============================================================================
-- SECCIÓN A — Correcciones de ACL (defensa en profundidad)
--
-- MEDICIÓN en la base ya migrada, con has_table_privilege:
--
--   authenticated | public.policy_source_registry : sel=T ins=T upd=T del=T
--   authenticated | public.audit_runs              : sel=T ins=T upd=T del=T
--   anon          | public.audit_runs              : sel=T ins=T upd=T del=T
--
-- El diseño declarado de la migracion Foundation es:
--   - policy_source_registry: SOLO lectura para el rol de cliente; escribir una
--     version nueva es una decision del OWNER y no una ruta de la app.
--   - audit_runs: las decisiones AI_DECISION_V1 son append-only y las decisiones
--     de maquina no las escribe `anon` en ningun caso.
--
-- Por que hace FALTA y no es purismo:
--   - En policy_source_registry el INSERT lo restringe RLS a OWNER y el
--     UPDATE/DELETE los corta el trigger, asi que el riesgo efectivo hoy es 0.
--     Pero la solucion son dos mecanismos (RLS + trigger) defendiendo un
--     privilegio que no deberia existir. Si alguna vez se toca el trigger, el
--     privilegio ya esta ahi. Se cierra el privilegio, no la barrera.
--   - En audit_runs RLS ya cubre a `anon` (las 105 politicas de public son
--     TO authenticated; ninguna concede nada a anon, luego el default de RLS es
--     denegar). Se cierra tambien el privilegio para que la tabla no dependa
--     de que RLS siga activado.
--
-- NO se toca el comportamiento de `authenticated` en audit_runs: sus políticas
-- RLS no cambian, sólo se le quita a `anon` un privilegio que ya era inútil.
-- =============================================================================

REVOKE ALL ON public.policy_source_registry FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.policy_source_registry FROM anon, authenticated;
GRANT SELECT ON public.policy_source_registry TO authenticated;

REVOKE ALL ON public.audit_runs FROM anon;

-- anon conserva lectura de audits/evidencias por diseño de la app, pero jamas
-- escritura de la cola de trabajo. Se documenta en vez de revertirse, para no
-- romper un cliente que hoy funcione y que no se ha medido.
-- (El INSERT de la cola pasa por public.enqueue_job, que es SECURITY DEFINER:
--  verificado prosecdef=true, asi que no depende del privilegio de `anon`.)


-- =============================================================================
-- SECCIÓN B — RLS ausente con DML completo para `anon`
--
-- MEDICIÓN sobre los 30 granting tables de `anon` en public:
--   28 con RLS ENABLE  -> anon denegado por defecto (ninguna politica es TO anon)
--    2 con RLS DISABLE -> audit_jobs, audit_job_evidences
--
-- Con RLS desactivado el unico control que queda es el GRANT, y el GRANT es
-- INSERT, SELECT, UPDATE y DELETE para anon. Eso es superficie de escritura
-- anonyma en la cola de trabajo, que es exactamente lo contrario de lo que un
-- pipeline de trabajos necesita.
--
-- Se activa RLS con politica TO authenticated USING (true):
--   - `anon` queda denegado (no tiene politica aplicable).
--   - `authenticated` conserva EXACTAMENTE el acceso que tenia antes, porque con
--     RLS desactivado yaloxenia enteramente y USING (true) reproduce ese
--     comportamiento. No se estrecha el acceso de la app.
--   - enqueue_job es SECURITY DEFINER (verificado) asi que el INSERT de la cola
--     sigue funcionando: corre como propietario y no pasa por esta politica.
-- =============================================================================

ALTER TABLE public.audit_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_job_evidences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_jobs_select_authenticated ON public.audit_jobs;
CREATE POLICY audit_jobs_select_authenticated ON public.audit_jobs
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS audit_job_evidences_select_authenticated ON public.audit_job_evidences;
CREATE POLICY audit_job_evidences_select_authenticated ON public.audit_job_evidences
FOR SELECT TO authenticated
USING (true);

REVOKE ALL ON public.audit_jobs, public.audit_job_evidences FROM anon;


-- =============================================================================
-- SECCIÓN C — Backfill de snapshots de Fact Runs FROZEN anteriores a la tabla
--
-- SITUACIÓN REAL, medida en la base: hay Fact Runs en estado FROZEN creados
-- antes de que existiera fact_run_frozen_snapshots. Para esos runs no hay
-- snapshot, y NO HAY RUTA NORMAL para obtenerlo:
--
--   - freeze_fact_run_v1 exige state = 'PROCESSING'; un run ya FROZEN no puede
--     volver atras (guard_fact_run_transition no tiene salida desde FROZEN).
--   - INSERT en fact_run_frozen_snapshots esta revocado a `authenticated`, asi
--     que la app tampoco puede sellarlo por su cuenta.
--
-- Es decir: sin este backfill, esos runs quedan FROZEN para siempre sin
-- snapshot, y las correcciones humanas sobre ellos no dejan rastro sellado.
--
-- QUÉ NO HACE ESTE BACKFILL (y es la parte importante):
--   - NO reevalua politica. No llama a evaluatePolicy ni a ninguna regla.
--   - NO crea ni modifica outcomes, ni engine_runs, ni AI_BASELINE.
--   - NO toca public.facts. Ni INSERT, ni UPDATE, ni DELETE.
--   - NO toca public.fact_extraction_runs. En particular NO escribe
--     effective_facts_fingerprint: aunque se quisiera, el trigger
--     guard_frozen_fact_run_row lo prohibe, y esa prohibicion es correcta.
--   - NO descongela ni reescribe nada. El run original queda intacto.
--
-- Es append-only: sólo INSERT, con ON CONFLICT DO NOTHING, de modo que
-- reejecutarlo no duplica ni degrada la fila existente.
--
-- Los hashes se calculan AQUI, en el servidor, con el mismo `digest` que usa
-- freeze_fact_run_v1. Antes, la captura legacy se sellaba desde la aplicacion
-- con una formula distinta, y por eso los dos hashes no eran comparables. Ahora
-- los dos los calcula el servidor y son comparables.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.backfill_legacy_frozen_snapshots_v1(
  p_policy_source_id text DEFAULT 'gdm-gam-prd-mlg-003-local-unverified'
)
RETURNS TABLE (
  out_fact_run_id uuid,
  out_action text,
  out_fact_count integer,
  out_integrity_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  r record;
  v_facts jsonb;
  v_reviews jsonb;
  v_provenance jsonb;
  v_canonical text;
  v_effective text;
  v_hash text;
  v_count integer;
BEGIN
  IF p_policy_source_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.policy_source_registry WHERE document_id = p_policy_source_id
  ) THEN
    RAISE EXCEPTION 'POLICY_SOURCE_NOT_REGISTERED: %', p_policy_source_id;
  END IF;

  FOR r IN
    SELECT fer.id, fer.audit_id, fer.extractor_version, fer.created_by,
           COALESCE(fer.frozen_at, fer.created_at, now()) AS sealed_at
    FROM public.fact_extraction_runs fer
    WHERE fer.state = 'FROZEN'
      AND NOT EXISTS (
        SELECT 1 FROM public.fact_run_frozen_snapshots s WHERE s.fact_run_id = fer.id
      )
    ORDER BY fer.created_at, fer.id
  LOOP
    SELECT COALESCE(
             jsonb_agg(
               jsonb_build_object(
                 'id', f.id,
                 'factType', f.fact_type,
                 'classification', f.classification,
                 'value', f.value,
                 'sourceRef', f.source_ref,
                 'confidence', f.confidence
               )
               ORDER BY f.fact_type, f.id
             ),
             '[]'::jsonb
           )
      INTO v_facts
    FROM public.facts f
    WHERE f.run_id = r.id;

    v_count := COALESCE(jsonb_array_length(v_facts), 0);

    SELECT COALESCE(
             jsonb_agg(
               jsonb_build_object(
                 'id', fr.id,
                 'factId', fr.fact_id,
                 'decision', fr.decision,
                 'correctedValue', fr.corrected_value,
                 'reviewedBy', fr.reviewed_by,
                 'createdAt', fr.created_at
               )
               ORDER BY fr.created_at, fr.id
             ),
             '[]'::jsonb
           )
      INTO v_reviews
    FROM public.fact_reviews fr
    WHERE fr.audit_id = r.audit_id;

    v_provenance := jsonb_build_object(
      'origin', 'LEGACY_BACKFILL',
      'capturedBy', 'backfill_legacy_frozen_snapshots_v1',
      'schemaVersion', 'fact-run-frozen-snapshot-v1',
      'backfilledAt', now(),
      'reprocessed', false,
      'note', 'Capturado desde facts historicas de un Fact Run ya FROZEN, anterior a la tabla fact_run_frozen_snapshots. No reevalua politica, no crea outcome y no modifica ni el run ni los facts.'
    );

    v_canonical := encode(public.digest(v_facts::text, 'sha256'), 'hex');
    v_effective := encode(public.digest(v_facts::text || '|' || v_reviews::text, 'sha256'), 'hex');
    v_hash := encode(
      public.digest(
        r.id::text || '|' || r.audit_id::text || '|' || r.extractor_version || '|' ||
        p_policy_source_id || '|' || v_canonical || '|' || v_effective || '|' ||
        v_facts::text || '|' || v_reviews::text || '|' || v_provenance::text,
        'sha256'
      ),
      'hex'
    );

    INSERT INTO public.fact_run_frozen_snapshots (
      audit_id, fact_run_id, facts, provenance, fact_reviews_snapshot,
      extractor_version, policy_source_id,
      canonical_facts_fingerprint, effective_facts_fingerprint,
      fact_count, integrity_hash, frozen_by, frozen_at
    )
    VALUES (
      r.audit_id, r.id, v_facts, v_provenance, v_reviews,
      r.extractor_version, p_policy_source_id,
      v_canonical, v_effective, v_count, v_hash, r.created_by, r.sealed_at
    )
    ON CONFLICT (fact_run_id) DO NOTHING;

    out_fact_run_id := r.id;
    out_action := 'SNAPSHOT_CREATED';
    out_fact_count := v_count;
    out_integrity_hash := v_hash;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.backfill_legacy_frozen_snapshots_v1(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.backfill_legacy_frozen_snapshots_v1(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.backfill_legacy_frozen_snapshots_v1(text) TO authenticated;
