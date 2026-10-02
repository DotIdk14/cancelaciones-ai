import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEnv, resetEnvCache } from '../src/server/env';
import { setTestEnv } from './helpers/env';

/**
 * Regresión de un fallo real: `OPENROUTER_MODEL="google/gemini-2.5-flash "` (con
 * espacio final) se buscaba tal cual en el catálogo de OpenRouter, no encontraba
 * el modelo y la auditoría terminaba como error de proveedor en lugar de auditar.
 */
describe('normalización de variables de entorno', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it('recorta espacios accidentales en el modelo y en el modelo de respaldo', () => {
    setTestEnv();
    vi.stubEnv('OPENROUTER_MODEL', '  google/gemini-2.5-flash-lite  ');
    vi.stubEnv('OPENROUTER_FALLBACK_MODEL', 'google/gemini-3.1-flash-lite-preview\n');
    resetEnvCache();

    const env = getEnv();

    expect(env.OPENROUTER_MODEL).toBe('google/gemini-2.5-flash-lite');
    expect(env.OPENROUTER_FALLBACK_MODEL).toBe('google/gemini-3.1-flash-lite-preview');
  });

  it('no confunde un modelo de respaldo que solo difiere en espacios', () => {
    setTestEnv();
    vi.stubEnv('OPENROUTER_FALLBACK_MODEL', 'google/gemini-2.5-flash-lite ');
    resetEnvCache();

    expect(() => getEnv()).toThrow('OPENROUTER_FALLBACK_MODEL debe ser distinto');
  });

  it('omite el respaldo vacío en lugar de tratarlo como configurado', () => {
    setTestEnv();
    vi.stubEnv('OPENROUTER_FALLBACK_MODEL', '   ');
    resetEnvCache();

    expect(getEnv().OPENROUTER_FALLBACK_MODEL).toBeNull();
  });

  it('rechaza un presupuesto por encima del tope de la aplicación', () => {
    setTestEnv();
    vi.stubEnv('AI_MAX_OUTPUT_TOKENS', '32768');
    resetEnvCache();

    expect(() => getEnv()).toThrow('AI_MAX_OUTPUT_TOKENS');
  });

  it('prefiere APP_URL explícita y cae a https://VERCEL_URL en producción', () => {
    setTestEnv();
    vi.stubEnv('APP_URL', '  https://app.example.com  ');
    resetEnvCache();

    expect(getEnv().APP_URL).toBe('https://app.example.com');

    vi.stubEnv('APP_URL', '');
    vi.stubEnv('VERCEL_URL', 'cancelaciones-ai.vercel.app');
    resetEnvCache();

    expect(getEnv().APP_URL).toBe('https://cancelaciones-ai.vercel.app');
  });
});
