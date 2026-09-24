import { createRefreshAuthRouter } from '@insforge/sdk/ssr';
import { getInsForgeEnv } from '@/server/config/env';

const env = getInsForgeEnv();

export const { POST } = createRefreshAuthRouter({
  baseUrl: env.NEXT_PUBLIC_INSFORGE_URL,
  anonKey: env.NEXT_PUBLIC_INSFORGE_ANON_KEY,
});
