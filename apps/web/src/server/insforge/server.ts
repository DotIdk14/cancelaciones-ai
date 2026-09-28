import { cookies } from 'next/headers';
import { createAdminClient } from '@insforge/sdk';
import { createServerClient } from '@insforge/sdk/ssr';
import { getInsForgeEnv } from '@/server/config/env';

export async function createInsForgeServerClient() {
  const env = getInsForgeEnv();
  return createServerClient({
    baseUrl: env.NEXT_PUBLIC_INSFORGE_URL,
    anonKey: env.NEXT_PUBLIC_INSFORGE_ANON_KEY,
    cookies: await cookies(),
  });
}

export function createInsForgeAdminClient() {
  const env = getInsForgeEnv();
  if (!env.INSFORGE_API_KEY) return null;
  return createAdminClient({
    baseUrl: env.NEXT_PUBLIC_INSFORGE_URL,
    apiKey: env.INSFORGE_API_KEY,
  });
}
