'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createAuditRepository } from '@cancelaciones/db';
import { createInsForgeServerClient } from '@/server/insforge/server';
import { getCurrentUser } from '@/server/auth/session';
import { isLocalDemoMode, LOCAL_DEMO_AUDIT_ID, localDemoAudits } from '@/server/local-demo';

export async function listAuditsForCurrentUser() {
  if (isLocalDemoMode()) return localDemoAudits;
  const client = await createInsForgeServerClient();
  const repo = createAuditRepository(client.database);
  return repo.listRecent();
}

export async function createAudit(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (isLocalDemoMode()) redirect(`/auditorias/${LOCAL_DEMO_AUDIT_ID}`);

  const cave = String(formData.get('externalCaseId') ?? '').trim();
  const classStartDate = String(formData.get('classStartDate') ?? '').trim();
  const ticketStartDate = String(formData.get('ticketStartDate') ?? '').trim();
  const evidences = formData.getAll('evidences');

  if (!cave) throw new Error('Falta capturar CaVe.');
  if (!classStartDate) throw new Error('Falta confirmar fecha de inicio de clases.');
  if (!ticketStartDate) throw new Error('Falta confirmar fecha de inicio del ticket.');
  if (evidences.length === 0) throw new Error('Agrega al menos una evidencia válida.');

  const client = await createInsForgeServerClient();
  const repo = createAuditRepository(client.database);
  const studentName = String(formData.get('studentName') ?? '').trim();
  const displayName = String(formData.get('displayName') ?? '').trim() || studentName || `Expediente ${cave}`;
  const audit = await repo.create({
    createdBy: user.id,
    displayName,
    externalCaseId: cave,
  });

  revalidatePath('/auditorias');
  redirect(`/auditorias/${audit.id}`);
}
