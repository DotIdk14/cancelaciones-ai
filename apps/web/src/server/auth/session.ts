import { createInsForgeServerClient } from '@/server/insforge/server';

export async function getCurrentUser() {
  try {
    const client = await createInsForgeServerClient();
    const { data, error } = await client.auth.getCurrentUser();
    if (error) return null;
    return data?.user ?? null;
  } catch {
    return null;
  }
}
