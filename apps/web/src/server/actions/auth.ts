'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createAuthActions } from '@insforge/sdk/ssr';

export async function signIn(formData: FormData) {
  const auth = createAuthActions({ cookies: await cookies() });
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const { data, error } = await auth.signInWithPassword({ email, password });

  if (error || !data?.user) {
    redirect('/login?error=invalid_credentials');
  }

  redirect('/auditorias');
}

export async function signOut() {
  const auth = createAuthActions({ cookies: await cookies() });
  await auth.signOut();
  redirect('/login');
}
