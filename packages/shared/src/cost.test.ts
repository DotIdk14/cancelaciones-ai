import { describe, expect, it } from 'vitest';
import { estimateCostUsd, MODEL_PRICING_USD_PER_MTOK } from './cost';

describe('estimateCostUsd', () => {
  it('estima un coste positivo y mayor para la salida que para la entrada', () => {
    const coste = estimateCostUsd('google/gemini-2.5-flash', 1_000_000, 1_000_000);

    expect(coste).not.toBeNull();
    expect(coste as number).toBeGreaterThan(0);
    const precios = MODEL_PRICING_USD_PER_MTOK['google/gemini-2.5-flash'];
    expect(coste).toBeCloseTo(precios.input + precios.output, 6);
  });

  it('devuelve null para un modelo sin precios conocidos', () => {
    expect(estimateCostUsd('modelo-inventado/xyz', 1_000, 1_000)).toBeNull();
  });

  it('devuelve cero cuando no hay conteo de tokens para un modelo con precio', () => {
    expect(estimateCostUsd('openai/gpt-4.1-mini', null, null)).toBe(0);
    expect(estimateCostUsd('openai/gpt-4.1-mini', null, 1_000_000)).toBe(MODEL_PRICING_USD_PER_MTOK['openai/gpt-4.1-mini'].output);
  });

  it('cubre los modelos que usa el agente y redondea a 6 decimales', () => {
    for (const modelo of Object.keys(MODEL_PRICING_USD_PER_MTOK)) {
      expect(estimateCostUsd(modelo, 1_234, 5_678), modelo).not.toBeNull();
    }
    const coste = estimateCostUsd('anthropic/claude-sonnet-4.5', 1, 1) as number;
    expect(coste).toBe(0.000018);
  });
});
