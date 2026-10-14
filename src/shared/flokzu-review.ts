/** Enrutamiento administrativo. No interpreta el procedimiento ni emite dictámenes. */
export const FLOKZU_CLASSIFICATIONS = ['ACTIVE', 'REJECTED', 'FINALIZED', 'OTHER_STAGE', 'VERIFY'] as const;
export type FlokzuClassification = typeof FLOKZU_CLASSIFICATIONS[number];
export type FlokzuReviewState = 'OPEN' | 'CLOSED' | 'REACTIVATED' | 'PENDING';
export const FLOKZU_CLASSIFICATION_LABELS: Record<FlokzuClassification, string> = {
  ACTIVE: 'Auditoría activa', REJECTED: 'Rechazado', FINALIZED: 'Finalizado', OTHER_STAGE: 'Otra etapa', VERIFY: 'Requiere verificación',
};
export const FLOKZU_REVIEW_LABELS: Record<FlokzuReviewState, string> = {
  OPEN: 'Sin decisión manual', CLOSED: 'Cierre confirmado', REACTIVATED: 'Reactivado manualmente', PENDING: 'Mantener pendiente',
};
export interface AdministrativeData {
  operations: { currentTask: string | null; statusReported: string | null; finalizedReported: string | null };
  procedure: { motive: string | null; description: string | null };
  administrativeComments?: Array<{ label: string; value: string }>;
}
const normalize = (s: string | null): string => (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
export function classifyFlokzu(data: AdministrativeData): { classification: FlokzuClassification; reason: string; discrepancy: boolean } {
  const state = normalize(data.operations.statusReported);
  const task = normalize(data.operations.currentTask);
  const final = normalize(data.operations.finalizedReported);
  const rejected = /^(rechazad[ao]|rechazo)$/.test(state);
  const closed = /^(finalizad[ao]|cerrad[ao]|completad[ao]|terminad[ao])$/.test(state);
  const pending = /^(revision|en revision|pendiente|en proceso|en curso|activ[ao])$/.test(state);
  const finalYes = /^(si|true|1|finalizad[ao])$/.test(final) || /^\d{4}-\d{2}-\d{2}(?:[t ].*)?$/.test(final) || /^\d{2}\/\d{2}\/\d{4}$/.test(final);
  const finalNo = /^(no|false|0)$/.test(final);
  const bo = task === '[backoffice] [revision bo] [cv]';
  const narrative = normalize([data.procedure.motive, data.procedure.description, ...(data.administrativeComments ?? []).map(c => c.value)].filter(Boolean).join(' '));
  const conflictingNarrative = pending && /(?:solicitud|ticket|caso)\s+(?:rechazad[ao]|finalizad[ao]|cerrad[ao])/.test(narrative);
  if ((pending && finalYes) || (closed && finalNo) || conflictingNarrative || (final !== '' && !finalYes && !finalNo)) {
    return { classification: 'VERIFY', reason: 'Hay información contradictoria o no reconocida entre Estado, Tarea actual, Finalizado y el contexto administrativo.', discrepancy: true };
  }
  if (rejected) return { classification: 'REJECTED', reason: 'Excluido de auditoría activa porque Flokzu reporta la solicitud como RECHAZADA.', discrepancy: bo };
  if (closed || finalYes) return { classification: 'FINALIZED', reason: 'Excluido de auditoría activa porque Estado o Finalizado confirma un cierre.', discrepancy: bo };
  if (!task || (!pending && state !== '')) return { classification: 'VERIFY', reason: 'Falta una etapa reconocible o el Estado reportado no permite confirmar el destino operativo.', discrepancy: false };
  // La etapa BO explícita es suficiente si el export no trae Estado; Finalizado nunca la contradice aquí.
  if (bo) return { classification: 'ACTIVE', reason: 'Tarea actual en revisión BO de CaVe, sin señal de rechazo o cierre.', discrepancy: false };
  return { classification: 'OTHER_STAGE', reason: 'Excluido de auditoría activa porque la Tarea actual corresponde a otra etapa.', discrepancy: false };
}
export function resolveFlokzuEligibility(classification: FlokzuClassification, local: FlokzuReviewState): boolean {
  return local === 'REACTIVATED' || (local === 'OPEN' && classification === 'ACTIVE');
}
export interface FlokzuTicket {
  id: string; externalCaseId: string; studentIdentifier: string | null; studentName: string | null;
  classification: FlokzuClassification; reviewState: FlokzuReviewState; eligible: boolean;
  discrepancy: boolean; reason: string; revision: number; assignedTo: string | null; updatedAt: string;
  campus: string | null; policy: string | null; requestDate: string | null;
}
export interface FlokzuEvent {
  id: string; action: string; actor: string | null; createdAt: string; reason: string | null;
  before: Record<string, unknown> | null; after: Record<string, unknown>; batchId: string | null;
}
export interface FlokzuDecision {
  caseId: string; revision: number; action: 'CLOSE' | 'REACTIVATE' | 'REASSIGN' | 'PENDING' | 'DISCREPANCY';
  reason?: string; observation?: string; assignedTo?: string | null; confirmed?: boolean;
}
