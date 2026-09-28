/** Concatena clases ignorando valores falsy (evita dependencias externas). */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
