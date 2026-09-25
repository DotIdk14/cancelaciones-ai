import type { NextResponse } from 'next/server';
import { getCurrentUser } from '@/server/auth/session';
import { createInsForgeServerClient } from '@/server/insforge/server';
import { forbiddenResponse, unauthorizedResponse } from './http';

type AuthContext = {
  user: { id: string };
  client: Awaited<ReturnType<typeof createInsForgeServerClient>>;
};

export async function requireOwner(): Promise<AuthContext | NextResponse> {
  const user = await getCurrentUser();
  if (!user) return unauthorizedResponse();
  const client = await createInsForgeServerClient();
  const { data } = await client.database.from('profiles').select('role').eq('id', user.id).limit(1);
  if (data?.[0]?.role !== 'OWNER') return forbiddenResponse();
  return { user, client };
}

export async function requireUser(): Promise<AuthContext | NextResponse> {
  const user = await getCurrentUser();
  if (!user) return unauthorizedResponse();
  const client = await createInsForgeServerClient();
  return { user, client };
}

export type { AuthContext };