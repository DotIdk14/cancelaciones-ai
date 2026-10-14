/** Referencias externas: nunca se descargan ni se convierten en evidencia adjunta. */
export function normalizeFlokzuUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  if (input.length > 8_000 || !/^https?:\/\//i.test(input) || /[\s\\]/.test(input)
    || Array.from(input).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return null;
  try {
    const url = new URL(input);
    if (!url.hostname || url.username || url.password || !['http:', 'https:'].includes(url.protocol)) return null;
    return url.href;
  } catch { return null; }
}

export function flokzuUrlsInText(text: string): string[] {
  if (/^(?:javascript|data|file|vbscript):/i.test(text.trim())) return [];
  const direct = normalizeFlokzuUrl(text);
  if (direct) return [direct];
  return [...new Set((text.match(/https?:\/\/[^\s<>"']+/gi) ?? []).map((value) =>
    normalizeFlokzuUrl(value.replace(/[.,;!?)\]]+$/, '')),
  ).filter((value): value is string => value !== null))];
}

/** Solo literales de HYPERLINK; no referencias a celdas, concatenación ni ejecución. */
export function literalFlokzuHyperlink(formula: string): { url: string | null; text: string } | null {
  const match = /^=?\s*HYPERLINK\(\s*"((?:[^"]|"")*)"\s*(?:[,;]\s*"((?:[^"]|"")*)"\s*)?\)\s*$/i.exec(formula);
  if (!match) return null;
  const target = match[1]!.replace(/""/g, '"');
  return { url: normalizeFlokzuUrl(target), text: (match[2] ?? match[1]!).replace(/""/g, '"') };
}
