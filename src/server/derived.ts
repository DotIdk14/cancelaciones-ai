// =============================================================================
// Derivados de extracción (módulo HOJA: no importa nada del servidor).
// =============================================================================
// La regla "qué texto derivado sigue siendo vigente" es lógica pura y
// determinista. Vive aquí, y no en `cases.ts`, por dos razones:
//
//   1. Es una decisión de dominio, no una llamada a la base de datos: se puede
//      (y debe) testear sin Infrastructure.
//   2. `cases.ts` es un módulo que los tests sustituyen por completo. Si esta
//      función viviera allí, cualquier test que cargue el store en memoria
//      dentro de su propia fábrica `vi.mock` cerraría el círculo
//      `cases (mock) -> store -> cases` y la suite se quedaría esperando una
//      promesa que nunca se resuelve.
//
// `cases.ts` reexporta todo lo de aquí, así que las importaciones existentes no
// cambian. `persistDerivedExtraction` sí persiste, y por eso sigue en `cases.ts`.
// =============================================================================

/** Forma de la evidencia que necesita este cálculo (subconjunto de `EvidenceRow`). */
export interface DerivedExtractionCarrier {
  extracted_text?: string | null;
  extraction_pipeline_version?: string | null;
}

/**
 * Texto derivado aún vigente para la versión de pipeline dada, o `null`.
 *
 * Un derivado de otra versión NO se reutiliza: cambiar la lógica de extracción
 * debe invalidar la caché entera, porque el texto guardado se extrajo con
 * reglas que ya no son las que rigen.
 */
export function derivedExtractionOf(
  evidence: DerivedExtractionCarrier,
  pipelineVersion: string,
): string | null {
  if (!evidence.extracted_text) return null;
  if (evidence.extraction_pipeline_version !== pipelineVersion) return null;
  return evidence.extracted_text;
}
