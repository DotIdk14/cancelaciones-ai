import { describe, expect, test } from 'vitest';
import { loadPolicyManifest, readPolicySection, searchPolicy } from './policy';

describe('policy tools', () => {
  test('carga el manifest oficial', () => {
    const manifest = loadPolicyManifest();
    expect(manifest.code).toBe('GDM_GAM_PRD_MLG_003');
    expect(manifest.sections.length).toBeGreaterThan(5);
  });

  test('busca intentos contacto en secciones', () => {
    const hits = searchPolicy('intentos contacto');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.score).toBeGreaterThan(0);
  });

  test('lee la seccion 5.2', () => {
    const section = readPolicySection('5.2');
    expect(section.text.toLowerCase()).toContain('contacto');
  });
});
