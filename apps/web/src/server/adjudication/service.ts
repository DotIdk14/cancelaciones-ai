import { createAdjudicationRepository, createAuditLogRepository, createAuditRunRepository, type DatabaseClient } from '@cancelaciones/db';
import type { FinalAdjudicationType } from '@cancelaciones/domain';

export class AdjudicationServiceError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'AdjudicationServiceError';
  }
}

export const FINAL_ADJUDICATION_TYPES: FinalAdjudicationType[] = ['CONFIRM_AI', 'CONFIRM_HUMAN', 'BOTH_INCORRECT', 'INSUFFICIENT_INFORMATION', 'CUSTOM_FINAL_DECISION'];

/**
 * Registra la adjudicación final (decisión de máquina + corrección humana).
 * PRESERVE_MACHINE_DECISION: la decisión de máquina nunca se sobrescribe; la
 * adjudicación se guarda como corrida nueva (append-only) referenciando la
 * baseline/comparación parent cuando exista.
 */
export async function recordFinalAdjudication(input: {
  database: DatabaseClient;
  auditId: string;
  actorId: string;
  adjudicationType: FinalAdjudicationType;
  finalOutcome?: string | null;
  comment?: string | null;
  evidenceIds?: string[];
}): Promise<{ runId: string; adjudicationId: string }> {
  if (!FINAL_ADJUDICATION_TYPES.includes(input.adjudicationType)) {
    throw new AdjudicationServiceError(`Tipo de adjudicación inválido: ${input.adjudicationType}.`, 'INVALID_ADJUDICATION_TYPE');
  }

  const runs = createAuditRunRepository(input.database);
  const baseline = await runs.findLatestByType(input.auditId, 'AI_BASELINE');
  const run = await runs.create({
    auditId: input.auditId,
    runType: 'FINAL_ADJUDICATION',
    status: 'COMPLETED',
    parentRunId: baseline?.id ?? null,
    result: {
      adjudicationType: input.adjudicationType,
      finalOutcome: input.finalOutcome ?? null,
      comment: input.comment ?? null,
      evidenceIds: input.evidenceIds ?? [],
      machineDecisionPreserved: true,
    },
    createdBy: input.actorId,
  });

  const adjudication = await createAdjudicationRepository(input.database).create({
    auditId: input.auditId,
    runId: run.id,
    adjudicationType: input.adjudicationType,
    finalOutcome: input.finalOutcome ?? null,
    comment: input.comment ?? null,
    evidenceIds: input.evidenceIds ?? [],
    adjudicatedBy: input.actorId,
  });

  await createAuditLogRepository(input.database).record({
    auditId: input.auditId,
    eventType: 'FINAL_ADJUDICATION_RECORDED',
    actorId: input.actorId,
    metadata: { runId: run.id, adjudicationId: adjudication.id, adjudicationType: input.adjudicationType },
  });

  return { runId: run.id, adjudicationId: adjudication.id };
}