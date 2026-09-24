'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createAuditRepository } from '@cancelaciones/db';
import { createInsForgeServerClient } from '@/server/insforge/server';
import { getCurrentUser } from '@/server/auth/session';
import { uploadEvidenceFilesForAudit } from '@/server/evidence/upload';
import { uploadHumanDecisionDocument } from '@/server/human-decision/service';
import { enqueueEvidenceProcessingJobs } from '@/server/jobs/enqueue-evidence';
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
  const evidenceFiles = formData
    .getAll('evidences')
    .filter((value): value is File => value instanceof File && value.size > 0 && value.name.trim().length > 0);
  const humanDecisionFile = formData.get('humanDecision');

  if (!cave) throw new Error('Falta capturar CaVe.');
  if (!classStartDate) throw new Error('Falta confirmar fecha de inicio de clases.');
  if (!ticketStartDate) throw new Error('Falta confirmar fecha de inicio del ticket.');
  if (evidenceFiles.length === 0) throw new Error('Agrega al menos una evidencia válida.');

  const client = await createInsForgeServerClient();
  const repo = createAuditRepository(client.database);
  const studentName = String(formData.get('studentName') ?? '').trim();
  const displayName = String(formData.get('displayName') ?? '').trim() || studentName || `Expediente ${cave}`;
  const audit = await repo.create({
    createdBy: user.id,
    displayName,
    externalCaseId: cave,
  });

  const uploadResults = await uploadEvidenceFilesForAudit({ auditId: audit.id, actorId: user.id, files: evidenceFiles, database: client.database, storage: client.storage });
  const storedCount = uploadResults.filter((result) => result.status === 'STORED').length;

  if (humanDecisionFile instanceof File && humanDecisionFile.size > 0 && humanDecisionFile.name.trim().length > 0) {
    await uploadHumanDecisionDocument({ auditId: audit.id, actorId: user.id, file: humanDecisionFile, database: client.database, storage: client.storage });
  }

  if (storedCount === 0) throw new Error('No fue posible almacenar ninguna evidencia.');

  // Encolar el procesamiento de las evidencias almacenadas para que el
  // workspace pueda retomarlas automaticamente tras el redirect.
  await enqueueEvidenceProcessingJobs({ database: client.database, auditId: audit.id, actorId: user.id });

  revalidatePath('/auditorias');
  redirect(`/auditorias/${audit.id}`);
}
