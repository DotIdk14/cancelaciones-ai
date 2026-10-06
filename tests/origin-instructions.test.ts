import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../src/skills/audit/instructions';
import { EVIDENCE_CHANNELS, EVIDENCE_COUNTRIES } from '../src/skills/audit/types';

describe('reglas de origen en el prompt', () => {
  it('declara el vocabulario cerrado de país y canal', () => {
    const prompt = buildSystemPrompt();
    for (const country of EVIDENCE_COUNTRIES) expect(prompt).toContain(country);
    for (const channel of EVIDENCE_CHANNELS) expect(prompt).toContain(channel);
  });

  it('prohíbe deducir el país del código postal, el dominio o la moneda', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('código postal');
    expect(prompt).toContain('dominio del correo');
    expect(prompt).toContain('moneda');
  });

  it('exige el bloque origin aunque no haya evidencia', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('origin');
    expect(prompt).toContain('evidenceIds: []');
  });

  it('distingue el canal de origen del canal administrativo', () => {
    expect(buildSystemPrompt()).toContain('canal administrativo');
  });
});