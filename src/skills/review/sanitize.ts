// =============================================================================
// Sanitización de contenido no confiable antes de empotrarlo en prompts.
//
// La implementación vive en `src/skills/sanitize.ts` (compartida por el skill
// de auditoría y el de revisión). Este módulo se mantiene como punto de entrada
// para no romper las importaciones existentes.
// =============================================================================

export { sanitizeTagDelimiters } from '../sanitize.js';