import { createRefreshAuthRouter } from '@insforge/sdk/ssr';
import { getInsForgeEnv } from '@/server/config/env';

export async function POST(request: Request) {
  const env = getInsForgeEnv();
  const router = createRefreshAuthRouter({
    baseUrl: env.NEXT_PUBLIC_INSFORGE_URL,
    anonKey: env.NEXT_PUBLIC_INSFORGE_ANON_KEY,
  });
  return router.POST(request);
}
