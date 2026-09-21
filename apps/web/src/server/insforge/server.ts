import { cookies } from 'next/headers';
import { createServerClient } from '@insforge/sdk/ssr';
import { getServerEnv } from '@/server/config/env';

export async function createInsForgeServerClient() {
  const env = getServerEnv();
  return createServerClient({
    baseUrl: env.NEXT_PUBLIC_INSFORGE_URL,
    anonKey: env.NEXT_PUBLIC_INSFORGE_ANON_KEY,
    cookies: await cookies(),
  });
}
