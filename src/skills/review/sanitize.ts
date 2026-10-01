// =============================================================================
// Sanitización de contenido no confiable antes de empotrarlo en prompts.
// =============================================================================
// Neutraliza secuencias de apertura/cierre de etiquetas (`<` y `>`) para que un
// dato externo no pueda forzar el cierre de un bloque delimitado del prompt.
// El texto sigue siendo legible porque se usan corchetes angulares de ancho
// completo (`＜`, `＞`), visualmente similares pero sintácticamente inertes.
// =============================================================================

export function sanitizeTagDelimiters(text: string): string {
  return text.replace(/</g, '\uFF1C').replace(/>/g, '\uFF1E');
}
