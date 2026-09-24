'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createAuthActions } from '@insforge/sdk/ssr';
import { getInsForgeEnv } from '@/server/config/env';

export async function signIn(formData: FormData) {
  const env = getInsForgeEnv();
  const auth = createAuthActions({
    baseUrl: env.NEXT_PUBLIC_INSFORGE_URL,
    anonKey: env.NEXT_PUBLIC_INSFORGE_ANON_KEY,
    cookies: await cookies(),
  });
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const { data, error } = await auth.signInWithPassword({ email, password });

  if (error || !data?.user) {
    redirect('/login?error=invalid_credentials');
  }

  redirect('/auditorias');
}

export async function signOut() {
  const env = getInsForgeEnv();
  const auth = createAuthActions({
    baseUrl: env.NEXT_PUBLIC_INSFORGE_URL,
    anonKey: env.NEXT_PUBLIC_INSFORGE_ANON_KEY,
    cookies: await cookies(),
  });
  await auth.signOut();
  redirect('/login');
}
