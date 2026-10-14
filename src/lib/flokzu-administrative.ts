/** Preparación de afirmaciones administrativas. Nunca acredita hechos ni dictamina. */
export interface FlokzuObservation {
  field: string;
  area: 'BACK_OFFICE' | 'HELPDESK' | 'ADMINISTRATIVE';
  original: string;
  text: string;
  externalCaseId: string;
  exportedAt: string | null;
  version: string;
}

export function normalizeAdministrativeText(value: string): string {
  return value.replace(/_x000D_/gi, '\n').replace(/<br\s*\/?\s*>|<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
    .replace(/\r\n?/g, '\n').replace(/[\t \u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function usefulAdministrativeText(value: string): boolean {
  return !/^(?:|99|sin dato|sin datos|n\/a|no aplica|pendiente|seguimiento|se da seguimiento)[.! ]*$/i.test(value);
}

const topics: Array<[string, RegExp]> = [
  ['Modalidad reportada', /\bmodalidad\b/i],
  ['Calificaciones reportadas', /\bcalificaci[oó]n(?:es)?\b/i],
  ['Actividad académica reportada', /\bactividad acad[eé]mica\b/i],
  ['Acceso al aula reportado', /\b(?:acceso al aula|ingres[oó] al aula|no ingres[oó] al aula)\b/i],
  ['Contacto reportado (corroborar realización)', /\b(?:contacto|contact[oó]|llamada|llam[oó])\b/i],
  ['Solicitud de baja reportada', /\b(?:solicit[oó]|solicita|solicitud de) (?:la )?baja\b/i],
  ['Intención de continuar reportada', /\b(?:continuar|contin[uú]a)\b/i],
  ['Cambio de ciclo reportado', /\bcambio de ciclo\b/i],
  ['D35 / D53 mencionados', /\bd(?:35|53)\b/i],
  ['Posible duplicidad reportada', /\bduplicad[oa]|duplicidad\b/i],
  ['Evidencia faltante reportada', /\b(?:sin evidencia|falta(?:n)? evidencias?|no (?:adjunta|cuenta con) evidencias?)\b/i],
];

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function prepareFlokzuContext(data: unknown) {
  const root = object(data);
  const observations = Array.isArray(root.observations) ? root.observations.flatMap((raw) => {
    const entry = object(raw);
    if (!['BACK_OFFICE', 'HELPDESK', 'ADMINISTRATIVE'].includes(String(entry.area)) || typeof entry.original !== 'string') return [];
    const text = normalizeAdministrativeText(entry.original);
    if (!usefulAdministrativeText(text)) return [];
    return [{ ...entry, text } as unknown as FlokzuObservation];
  }) : [];
  const claims = observations.flatMap((source) => source.text.split(/\n|(?<=[.!?])\s+/).flatMap((fragment) =>
    topics.filter(([, pattern]) => pattern.test(fragment)).map(([topic]) => ({ topic, fragment, source, accredited: false as const }))));
  const references = [...new Set(observations.flatMap((entry) => [...entry.text.matchAll(/\bCaVe-\d+\b/gi)].map((match) => `CaVe-${match[0].split('-')[1]}`)))].sort();
  const dates = observations.flatMap((source) => [...source.text.matchAll(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/g)].map((match) => ({ reference: match[0], source })));
  // La negación y la atribución se conservan en el fragmento. No inferimos valores booleanos.
  const corroboration = [...new Set(claims.map((claim) => claim.topic))];
  const unique = new Map<string, string>();
  for (const claim of claims) {
    const key = `${claim.source.area}:${claim.source.field}:${claim.fragment.replace(/\s+/g, ' ').trim()}`;
    unique.set(key, `${claim.source.area} · ${claim.source.field}: ${claim.fragment.replace(/\s+/g, ' ').trim()}`);
  }
  const compact = [...unique.values()].filter((line) => line.startsWith('BACK_OFFICE') || line.startsWith('HELPDESK')).sort().join('\n');
  const operations = object(root.operations);
  const task = typeof operations.currentTask === 'string' ? operations.currentTask.trim().toUpperCase() : '';
  const finalized = String(operations.finalizedReported ?? '').trim().toLowerCase();
  const automaticEligible = !['sí', 'si', 'true', '1'].includes(finalized) && task === '[BACKOFFICE] [REVISION BO] [CV]';
  return { observations, claims, references, dates, corroboration, compact, automaticEligible };
}
