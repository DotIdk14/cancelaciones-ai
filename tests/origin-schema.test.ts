import { describe, expect, it } from 'vitest';
import { parseAuditResult } from '../src/skills/audit/schema';
import { validAuditResult } from './fixtures/audit-result';

/** Copia profunda sin tipos: el schema es lo que valida, no TypeScript. */
function asRecord(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

/** Devuelve el mensaje del error, o '' si no lanzó. */
function parseInvalid(value: unknown): string {
  try {
    parseAuditResult(value);
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe('origin en el contrato del assessment', () => {
  it('acepta el dictamen de referencia y conserva el país y el canal', () => {
    const parsed = parseAuditResult(validAuditResult);

    expect(parsed.origin.country).toBe('MX');
    expect(parsed.origin.channel).toBe('WHATSAPP');
    expect(parsed.origin.evidenceIds).toEqual(['ev-1']);
  });

  it('rechaza un assessment sin origin: el bloque es obligatorio', () => {
    const sinOrigin = asRecord(validAuditResult);
    delete sinOrigin.origin;

    const error = parseInvalid(sinOrigin);

    expect(error).toMatch(/^INVALID_AI_RESPONSE:/);
    expect(error).toContain('origin');
  });

  it('rechaza un país fuera del vocabulario cerrado', () => {
    const error = parseInvalid({
      ...asRecord(validAuditResult),
      origin: { country: 'ZZ', channel: null, evidenceIds: ['ev-1'], evidenceText: 'texto' },
    });

    expect(error).toContain('origin.country');
  });

  it('rechaza un canal fuera del vocabulario cerrado', () => {
    const error = parseInvalid({
      ...asRecord(validAuditResult),
      origin: { country: null, channel: 'SMS', evidenceIds: ['ev-1'], evidenceText: 'texto' },
    });

    expect(error).toContain('origin.channel');
  });

  it('rechaza un valor afirmado sin evidencia que lo acredite', () => {
    const error = parseInvalid({
      ...asRecord(validAuditResult),
      origin: { country: 'MX', channel: null, evidenceIds: [], evidenceText: null },
    });

    expect(error).toMatch(/^INVALID_AI_RESPONSE:/);
    expect(error).toContain('origin.evidenceIds');
  });

  it('acepta origin con ambos valores indeterminables y sin evidencia', () => {
    const parsed = parseAuditResult({
      ...asRecord(validAuditResult),
      origin: { country: null, channel: null, evidenceIds: [], evidenceText: null },
    });

    expect(parsed.origin.country).toBeNull();
    expect(parsed.origin.channel).toBeNull();
  });
});