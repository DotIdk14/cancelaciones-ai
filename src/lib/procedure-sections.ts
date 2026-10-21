import manifest from '../../policy/manifest.json';

// Índice de la fuente oficial del owner para la selección humana. Las citas
// de la IA no limitan los fundamentos que una persona puede elegir al corregirla.
// Solo contiene referencias; no evalúa ni aplica criterios de negocio.
export const PROCEDURE_SECTION_OPTIONS = manifest.sections
  .map(({ id, title, pages }) => ({
    value: id,
    label: `Sección ${id} — ${title}${pages.length ? ` (pág. ${pages.join(', ')})` : ''}`,
  }))
  .sort((a, b) => a.value.localeCompare(b.value, 'es', { numeric: true }));
