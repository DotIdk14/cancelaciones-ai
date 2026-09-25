-- ============================================================================
-- Reparación de la forma de las capturas LEGACY_BACKFILL
--
-- CORRIGE un defecto introducido por
-- 20260925140000_policy-foundation-security-closure.sql al sellar los 9 Fact
-- Runs FROZEN que existían antes de que existiera fact_run_frozen_snapshots.
--
-- EL DEFECTO (medido contra producción):
--   El lector canónico de la aplicación,
--   apps/web/src/server/policy/frozen-fact-run.ts:107 `mapSnapshotFactsToPolicyFacts`,
--   exige que cada entrada del array `facts` tenga `id`, `type` y `value`:
--       facts[i].id    ausente -> FROZEN_SNAPSHOT_PAYLOAD_INVALID
--       facts[i].type  ausente -> FROZEN_SNAPSHOT_PAYLOAD_INVALID
--       facts[i].value ausente -> FROZEN_SNAPSHOT_PAYLOAD_INVALID
--   El backfill escribió `id`, `factType`, `classification`, `value`, `sourceRef`,
--   `confidence`. No llevaba `type`, de modo que las 9 filas selladas eran
--   ilegibles: leer cualquiera de esas 9 auditorías habría lanzado
--   FROZEN_SNAPSHOT_PAYLOAD_INVALID.
--
--   No era una decisión de diseño. `Fact`, el tipo que consume el motor, es
--   `{ id, type, value }`. `factType` es el nombre del campo en OTRO tipo
--   (`DerivedFact`, el DTO de transporte de la corrección humana). Se
--   confundieron los dos al serializar.
--
-- POR QUÉ HAY QUE TOCAR FILAS APPEND-ONLY
--   fact_run_frozen_snapshots es append-only por diseño y con razón. Pero estas 9
--   filas las escribió la migración anterior y están mal. No hay otra vía:
--   UNIQUE (fact_run_id) impide un segundo sellado, y el trigger de append-only
--   bloquea UPDATE y DELETE para todos los roles, incluido el propietario.
--
--   Se levanta el trigger, se corrigen EXCLUSIVAMENTE las filas con
--   provenance->>'origin' = 'LEGACY_BACKFILL', y se vuelve a levantarlo. No hay
--   puerta trasera: no hay GUC, ni flag, ni vía de escape en runtime. El bypass
--   vive únicamente dentro de este fichero, queda en el ledger, y el invariante
--   queda restaurado antes de que termine la sentencia. Las dos aserciones del
--   final comprueban que la reparación se aplicó y que no se tocó ninguna fila
--   ajena a este backfill.
--
-- LO QUE ESTA MIGRACIÓN NO HACE
--   - No toca public.facts, ni public.fact_extraction_runs, ni engine_runs.
--   - No crea outcomes, ni envelopes, ni decisiones.
--   - No reevalúa política ni toca ninguna regla, umbral o fingerprint.
--   - No toca la forma de la columna `facts` de ninguna fila que no sea de este
--     backfill.
--
-- DEFECTO SEPARADO, QUE ESTA MIGRACIÓN NO CORRIGE (se reporta aparte):
--   `create_derived_fact_run_v1` lee los hechos como `f->>'fact_type'`,
--   `f->>'source_ref'`, `f->>'confidence'`, mientras que la aplicación envía
--   `DerivedFact` = `{ id, factType, classification, value, sourceRef, confidence }`
--   (apps/web/src/server/facts/human-correction.ts:40, y `p_facts: derivedFacts`).
--   Ninguna de las dos grafías coincide, así que la derivación por RPC falla con
--   NOT NULL sobre facts.fact_type. Es un defecto de transporte preexistente,
--   independiente del backfill, y NO se arregla aquí: la función tiene una
--   firma de retorno de 5 columnas que `CREATE OR REPLACE` no puede cambiar, y
--   reescribir su cuerpo a ciegas sería peor que reportarlo.
-- ============================================================================

ALTER TABLE public.fact_run_frozen_snapshots DISABLE TRIGGER fact_run_frozen_snapshots_append_only;

UPDATE public.fact_run_frozen_snapshots
SET facts = (
        SELECT COALESCE(
                 jsonb_agg(
                   jsonb_build_object(
                     'id', e.value->>'id',
                     'type', COALESCE(e.value->>'type', e.value->>'factType', e.value->>'fact_type'),
                     'value', e.value->'value',
                     'source', COALESCE(e.value->'source', e.value->'sourceRef', e.value->'source_ref', '{}'::jsonb),
                     'extractionConfidence', COALESCE(e.value->>'extractionConfidence', e.value->>'confidence')
                   )
                   ORDER BY e.value->>'type', e.value->>'id'
                 ),
                 '[]'::jsonb
               )
        FROM jsonb_array_elements(COALESCE(facts, '[]'::jsonb)) AS e(value)
       ),
    provenance = provenance || jsonb_build_object('shape', 'canonical-fact-v1', 'repairedBy', '20260925150000')
WHERE provenance->>'origin' = 'LEGACY_BACKFILL';

ALTER TABLE public.fact_run_frozen_snapshots ENABLE TRIGGER fact_run_frozen_snapshots_append_only;

DO $$
DECLARE
  v_bad integer;
  v_scope integer;
BEGIN
  -- 1) Toda entrada de un snapshot de este backfill tiene id, type y value.
  SELECT count(*) INTO v_bad
  FROM public.fact_run_frozen_snapshots s,
       LATERAL jsonb_array_elements(COALESCE(s.facts, '[]'::jsonb)) AS e(value)
  WHERE s.provenance->>'origin' = 'LEGACY_BACKFILL'
    AND (e.value->>'type' IS NULL OR e.value->>'id' IS NULL OR NOT (e.value ? 'value'));
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'BACKFILL_REPAIR_INCOMPLETE: % entradas sin id/type/value', v_bad;
  END IF;

  -- 2) No se ha marcado ninguna fila ajena a este backfill.
  SELECT count(*) INTO v_scope
  FROM public.fact_run_frozen_snapshots
  WHERE provenance->>'origin' IS DISTINCT FROM 'LEGACY_BACKFILL'
    AND provenance ? 'repairedBy';
  IF v_scope > 0 THEN
    RAISE EXCEPTION 'BACKFILL_REPAIR_SCOPE_VIOLATION: % filas ajenas tocadas', v_scope;
  END IF;
END $$;
