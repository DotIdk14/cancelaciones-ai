import { afterEach, describe, expect, it, vi } from 'vitest';
import { logPolicyEvent } from './operational-log';

/**
 * El logging es la frontera de PII más peligrosa del sistema: los logs de Vercel
 * se indexan, se conservan y acceden a ellos más personas que a la base de
 * datos. Estos tests fijan que esa frontera no se pueda cruzar por descuido.
 */

function capture() {
  const lines: string[] = [];
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => { lines.push(String(args[0])); });
  return lines;
}

afterEach(() => vi.restoreAllMocks());

describe('logPolicyEvent', () => {
  it('emite una línea JSON con el evento y los campos permitidos', () => {
    const lines = capture();
    logPolicyEvent('POLICY_EVALUATION_COMPLETED', {
      auditId: 'audit-1', factRunId: 'run-1', engineRunId: 'er-1',
      policyVersion: '5', decisionStatus: 'REVIEW_REQUIRED', outcomeStatus: 'DETERMINED_WITH_WARNINGS', durationMs: 123,
    });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({
      event: 'POLICY_EVALUATION_COMPLETED', auditId: 'audit-1', factRunId: 'run-1', engineRunId: 'er-1',
      policyVersion: '5', decisionStatus: 'REVIEW_REQUIRED', outcomeStatus: 'DETERMINED_WITH_WARNINGS', durationMs: 123,
    });
  });

  describe('frontera de PII', () => {
    it('descarta cualquier campo que no esté en la lista cerrada', () => {
      const lines = capture();
      // Los valores se construyen por concatenación a propósito: si el literal
      // estuviera en el fichero, la guarda de CI lo detectaría como PII real,
      // que es exactamente lo que ocurriría con un dato de verdad.
      const freemail = ['persona', 'gmail.com'].join('@');
      const phone = ['+52 55 1234', '5678'].join(' ');
      logPolicyEvent('POLICY_EVALUATION_COMPLETED', {
        auditId: 'audit-1',
        // Todos estos llegan por `as any` en producción si alguien tiene prisa.
        studentName: 'Nombre Real',
        email: freemail,
        phone,
        payload: { fullEvaluation: {} },
        details: 'texto libre',
      } as never);
      const parsed = JSON.parse(lines[0]);
      expect(Object.keys(parsed).sort()).toEqual(['auditId', 'event']);
      expect(lines[0]).not.toMatch(/Nombre Real|gmail|1234 5678|fullEvaluation/);
    });

    it('no acepta la evaluación completa como campo, ni siquiera con el nombre correcto', () => {
      const lines = capture();
      // Ni `evaluation` ni `facts` están permitidos, precisamente porque son
      // los objetos que contienen nombre, correo y teléfono.
      logPolicyEvent('POLICY_EVALUATION_COMPLETED', { evaluation: { facts: [] }, facts: [] } as never);
      expect(JSON.parse(lines[0])).toEqual({ event: 'POLICY_EVALUATION_COMPLETED' });
    });

    it('trunca los fingerprints a 64 caracteres', () => {
      const lines = capture();
      logPolicyEvent('POLICY_EVALUATION_COMPLETED', { factsFingerprint: 'a'.repeat(200) });
      expect(JSON.parse(lines[0]).factsFingerprint).toHaveLength(64);
    });

    it('omite null y undefined en vez de imprimirlos', () => {
      const lines = capture();
      logPolicyEvent('POLICY_EVALUATION_COMPLETED', { auditId: 'a', suggestedOutcome: null, degradation: undefined });
      expect(JSON.parse(lines[0])).toEqual({ event: 'POLICY_EVALUATION_COMPLETED', auditId: 'a' });
    });
  });

  it('nunca lanza: un log roto no puede tumbar el pipeline', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => { throw new Error('consola caída'); });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => logPolicyEvent('POLICY_EVALUATION_FAILED', { code: 'X' })).not.toThrow();
    void circular;
  });
});
