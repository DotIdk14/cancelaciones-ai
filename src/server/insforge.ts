// =============================================================================
// Clientes InsForge (server-side only). El navegador NUNCA habla con InsForge:
// todo pasa por /api con cookies httpOnly. RLS protege el acceso por dueño.
// =============================================================================

import { createClient, type InsForgeClient } from '@insforge/sdk';
import { getEnv } from './env.js';

export type { InsForgeClient };

/** Cliente con sesión de usuario (RLS). Usado para DB y Storage del dueño. */
export function createUserClient(accessToken: string | null): InsForgeClient {
  const env = getEnv();
  const client = createClient({
    baseUrl: env.INSFORGE_BASE_URL,
    anonKey: env.INSFORGE_ANON_KEY,
    isServerMode: true,
  });
  if (accessToken) client.setAccessToken(accessToken);
  return client;
}