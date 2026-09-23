import { createInsForgeServerClient } from '@/server/insforge/server';
import { isLocalDemoMode, localDemoUser } from '@/server/local-demo';

export async function getCurrentUser() {
  if (isLocalDemoMode()) return localDemoUser;
  try {
    const client = await createInsForgeServerClient();
    const { data, error } = await client.auth.getCurrentUser();
    if (error) return null;
    return data?.user ?? null;
  } catch {
    return null;
  }
}
