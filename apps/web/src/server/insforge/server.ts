import { cookies } from 'next/headers';
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
