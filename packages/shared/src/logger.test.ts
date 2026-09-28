import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from './logger';

function capturarLineas(spies: Array<{ mock: { calls: unknown[][] } }>): Record<string, unknown>[] {
  return spies.flatMap((spy) => spy.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createLogger', () => {
  it('redacta las credenciales en cualquier nivel y a cualquier profundidad', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = createLogger('evidence', { runId: 'run_1' });

    log.info('subida completada', { apiKey: 'sk-live-12345', storageKey: 'audit_1/ev_1/a.pdf' });
    log.error('fallo al autenticar', {
      request: { headers: { authorization: 'Bearer abc' } },
      payload: { credenciales: { apiKey: 'sk-anidada-999' } },
    });

    const lineas = capturarLineas([info, error]);
    const subida = lineas.find((linea) => linea.message === 'subida completada');
    const fallo = lineas.find((linea) => linea.message === 'fallo al autenticar');

    expect(subida?.apiKey).toBe('[redacted]');
    expect(subida?.runId).toBe('run_1');
    expect(subida?.level).toBe('info');
    expect(subida?.scope).toBe('evidence');
    expect(typeof subida?.ts).toBe('string');

    const request = fallo?.request as { headers: unknown };
    expect(request.headers).toBe('[redacted]');

    const payload = fallo?.payload as { credenciales: { apiKey: string } };
    expect(payload.credenciales.apiKey).toBe('[redacted]');

    expect(JSON.stringify(lineas)).not.toContain('sk-live-12345');
    expect(JSON.stringify(lineas)).not.toContain('Bearer abc');
    expect(JSON.stringify(lineas)).not.toContain('sk-anidada-999');
  });

  it('trunca la transcripción a 300 caracteres para no volcar PII al agregador', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const log = createLogger('audio');
    const transcripcion = 'la estudiante Angela solicito la baja. '.repeat(200);

    log.info('transcripción lista', { transcript: transcripcion, text: transcripcion, body: transcripcion });

    const [linea] = capturarLineas([info]);
    for (const campo of ['transcript', 'text', 'body']) {
      const valor = linea[campo] as string;
      expect(valor.length).toBeLessThanOrEqual(300);
      expect(valor.length).toBeGreaterThan(0);
    }
  });

  it('acota a 500 caracteres cualquier otro texto y hereda los campos del child', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const log = createLogger('ai').child({ runId: 'run_9' });

    log.info('contexto largo', { policyQuote: 'q'.repeat(2000) });

    const [linea] = capturarLineas([info]);
    expect((linea.policyQuote as string).length).toBe(500);
    expect(linea.runId).toBe('run_9');
  });
});
