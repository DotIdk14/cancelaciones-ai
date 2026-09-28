// =============================================================================
// Clientes InsForge (server-side only). El navegador NUNCA habla con InsForge:
// todo pasa por /api con cookies httpOnly. RLS protege el acceso por dueño.
// =============================================================================

import { createAdminClient, type InsForgeClient } from '@insforge/sdk';
import { getEnv } from './env.js';

export type { InsForgeClient };

/** Cliente privilegiado usado solo por las funciones server-side. */
export function createServerClient(): InsForgeClient {
  const env = getEnv();
  return createAdminClient({
    baseUrl: env.INSFORGE_BASE_URL,
    apiKey: env.INSFORGE_API_KEY,
  });
}