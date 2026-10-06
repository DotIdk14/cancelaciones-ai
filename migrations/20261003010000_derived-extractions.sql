-- =============================================================================
-- 20261003010000_derived_extractions.sql — Derivados de extracción persistentes.
-- =============================================================================
--
-- Objetivo: no volver a descargar/extraer PDFs ni texto plano cuando el binario
-- original y la versión del pipeline no cambiaron (DO_NOT_REPROCESS_AI_UNNECESSARILY).
--
-- Los bytes originales NUNCA se modifican: estas columnas guardan un derivado
-- reproducible a partir del binario. El pipeline_version permite invalidar el
-- caché cuando cambie la lógica de extracción.
-- =============================================================================

ALTER TABLE public.evidence
  ADD COLUMN IF NOT EXISTS extracted_text text,
  ADD COLUMN IF NOT EXISTS extraction_pipeline_version text;

DO $mig$
BEGIN
  COMMENT ON COLUMN public.evidence.extracted_text IS
    'Texto derivado de PDF/TXT para el modelo. Nunca modifica el binario original.';
  COMMENT ON COLUMN public.evidence.extraction_pipeline_version IS
    'Versión del pipeline de extracción; se usa para reusar el derivado cuando coinciden source_hash y versión.';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END
$mig$;
