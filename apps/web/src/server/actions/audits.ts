'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createAuditRepository } from '@cancelaciones/db';
import { createInsForgeServerClient } from '@/server/insforge/server';
import { getCurrentUser } from '@/server/auth/session';

export async function listAuditsForCurrentUser() {
  const client = await createInsForgeServerClient();
  const repo = createAuditRepository(client.database);
  return repo.listRecent();
}

export async function createAudit(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const client = await createInsForgeServerClient();
  const repo = createAuditRepository(client.database);
  await repo.create({
    createdBy: user.id,
    externalCaseId: String(formData.get('externalCaseId') ?? '').trim() || null,
  });

  revalidatePath('/auditorias');
  redirect('/auditorias');
}
