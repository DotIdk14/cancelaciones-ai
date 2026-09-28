// Helpers de entorno para tests que tocan modules que leen variables.
import { resetEnvCache } from '../../src/server/env';

const REQUIRED_VARS: Record<string, string> = {
  INSFORGE_BASE_URL: 'https://test.insforge.app',
  INSFORGE_ANON_KEY: 'test-anon-key',
  INSFORGE_API_KEY: 'test-admin-key',
  OPENROUTER_API_KEY: 'test-or-key',
  OPENROUTER_MODEL: 'google/gemini-2.5-flash',
  ASSEMBLYAI_API_KEY: 'Example-Api-Key-1234567890',
};

/** Aplica variables mínimas y limpia la caché de getEnv(). */
export function setTestEnv(): void {
  for (const [key, value] of Object.entries(REQUIRED_VARS)) {
    process.env[key] = value;
  }
  resetEnvCache();
}