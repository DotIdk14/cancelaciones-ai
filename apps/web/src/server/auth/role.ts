import { createInsForgeServerClient } from '@/server/insforge/server';

export async function currentUserRole(client: Awaited<ReturnType<typeof createInsForgeServerClient>>, userId: string): Promise<string | null> {
  try {
    const { data, error } = await client.database
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .limit(1);
    if (error) return null;
    return (data?.[0]?.role as string | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function requireOwnerClient(client: Awaited<ReturnType<typeof createInsForgeServerClient>>, userId: string): Promise<boolean> {
  return (await currentUserRole(client, userId)) === 'OWNER';
}