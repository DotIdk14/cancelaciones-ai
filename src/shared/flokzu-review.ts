/** Enrutamiento administrativo. No interpreta el procedimiento ni emite dictámenes. */
export const FLOKZU_CLASSIFICATIONS = ['ACTIVE', 'REJECTED', 'FINALIZED', 'OTHER_STAGE', 'VERIFY'] as const;
export type FlokzuClassification = typeof FLOKZU_CLASSIFICATIONS[number];
export type FlokzuReviewState = 'OPEN' | 'CLOSED' | 'REACTIVATED' | 'PENDING';
export const FLOKZU_CLASSIFICATION_LABELS: Record<FlokzuClassification, string> = {
  ACTIVE: 'Auditoría activa', REJECTED: 'Rechazado en Flokzu', FINALIZED: 'Finalizado en Flokzu', OTHER_STAGE: 'Otra etapa', VERIFY: 'Requiere verificación',
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
export function classifyFlokzu(data: AdministrativeData): { classification: FlokzuClassification; reason: string; discrepancy: boolean; nextStep: string } {
  const state = normalize(data.operations.statusReported);
  const task = normalize(data.operations.currentTask);
  const final = normalize(data.operations.finalizedReported);
  const cancelledByHelpDesk = task === 'cancelado por helpdesk' || final === 'cancelado por helpdesk';
  const rejected = /^(rechazad[ao]|rechazo)$/.test(state) || cancelledByHelpDesk;
  const closed = /^(finalizad[ao]|cerrad[ao]|completad[ao]|terminad[ao])$/.test(state);
  const pending = /^(revision|en revision|pendiente|en proceso|en curso|activ[ao])$/.test(state);
  const finalYes = /^(si|true|1|finalizad[ao]|retencion por ajuste)$/.test(final) || /^\d{4}-\d{2}-\d{2}(?:[t ].*)?$/.test(final) || /^\d{2}\/\d{2}\/\d{4}$/.test(final);
  const finalNo = /^(no|false|0)$/.test(final);
  const bo = task === '[backoffice] [revision bo] [cv]';
  const quote = (value: string | null): string => value?.trim() ? `“${value.trim()}”` : 'sin dato';
  const review = 'Comprueba estos valores en Flokzu y corrige la exportación. Si corresponde auditar, reactiva el ticket con un motivo y un Asesor.';
  const outcomeConflict = cancelledByHelpDesk && state !== '' && !/^(rechazad[ao]|rechazo)$/.test(state);
  const conflicts: string[] = [];
  if (pending && finalYes) conflicts.push(`Estado = ${quote(data.operations.statusReported)} indica trabajo pendiente, pero Finalizado = ${quote(data.operations.finalizedReported)} indica cierre.`);
  if (closed && finalNo) conflicts.push(`Estado = ${quote(data.operations.statusReported)} indica cierre, pero Finalizado = ${quote(data.operations.finalizedReported)} indica que sigue abierto.`);
  if (outcomeConflict) conflicts.push(`Estado = ${quote(data.operations.statusReported)} no coincide con Tarea actual = ${quote(data.operations.currentTask)} y Finalizado = ${quote(data.operations.finalizedReported)}, que reportan cancelación por HelpDesk.`);
  const contexts = [
    { label: 'Motivo', value: data.procedure.motive }, { label: 'Descripción', value: data.procedure.description },
    ...(data.administrativeComments ?? []),
  ];
  const conflictingContext = pending && contexts.find(c => /(?:solicitud|ticket|caso)\s+(?:rechazad[ao]|finalizad[ao]|cerrad[ao])/.test(normalize(c.value)));
  if (conflictingContext) conflicts.push(`Estado = ${quote(data.operations.statusReported)} indica trabajo pendiente, pero el campo ${quote(conflictingContext.label)} menciona un rechazo o cierre. Revisa ese comentario en el detalle.`);
  if (final !== '' && !finalYes && !finalNo && final !== 'cancelado por helpdesk') conflicts.push(`Finalizado = ${quote(data.operations.finalizedReported)} no es un valor de cierre reconocido. Se admite Sí, No, una fecha, FINALIZADO, CANCELADO POR HELPDESK o RETENCION POR AJUSTE.`);
  if (conflicts.length) {
    return { classification: 'VERIFY', reason: `No se reparte automáticamente. ${conflicts.join(' ')}`, discrepancy: true, nextStep: review };
  }
  if (rejected) return { classification: 'REJECTED', reason: `No se reparte automáticamente: Flokzu reporta Estado = ${quote(data.operations.statusReported)}, Tarea actual = ${quote(data.operations.currentTask)} y Finalizado = ${quote(data.operations.finalizedReported)}. La solicitud figura rechazada o cancelada por HelpDesk.${bo ? ' La tarea BO no coincide con ese rechazo.' : ''}`, discrepancy: bo, nextStep: 'Confirma el cierre si no requiere auditoría adicional. Si el rechazo es incorrecto, registra una discrepancia o reactiva el ticket con un motivo y un Asesor.' };
  if (closed || finalYes) return { classification: 'FINALIZED', reason: `No se reparte automáticamente: Estado = ${quote(data.operations.statusReported)} o Finalizado = ${quote(data.operations.finalizedReported)} reporta un cierre.${bo ? ' La tarea sigue en revisión BO; comprueba esa diferencia.' : ''}`, discrepancy: bo, nextStep: 'Comprueba el cierre en Flokzu y confirma su paso al histórico, o reactiva el ticket si necesita auditoría adicional.' };
  if (!task) return { classification: 'VERIFY', reason: 'No se reparte automáticamente porque falta Tarea actual. Sin esa columna no se puede confirmar que esté en revisión BO.', discrepancy: false, nextStep: 'Verifica Tarea actual en Flokzu y consulta el ticket nuevamente, o selecciona un Asesor al reactivar el ticket.' };
  const knownOtherStage = (state === 'aplica' && task === '[ser] [aplicacion] [cv]') || (state === 'dictaminar' && task === '[dictaminador] [dictaminar] [cv]');
  if (!pending && state !== '' && !knownOtherStage) return { classification: 'VERIFY', reason: `No se reparte automáticamente porque Estado = ${quote(data.operations.statusReported)} no está reconocido para Tarea actual = ${quote(data.operations.currentTask)}.`, discrepancy: false, nextStep: review };
  // La etapa BO explícita es suficiente si el export no trae Estado; Finalizado nunca la contradice aquí.
  if (bo) return { classification: 'ACTIVE', reason: `Tarea actual = ${quote(data.operations.currentTask)} corresponde a revisión BO, sin señales de rechazo o cierre.`, discrepancy: false, nextStep: 'Los nuevos tickets se reparten entre Asesores disponibles. Los existentes conservan su responsable; si siguen sin asignación, selecciona uno mediante Reasignar responsable.' };
  return { classification: 'OTHER_STAGE', reason: `No se reparte automáticamente porque Tarea actual = ${quote(data.operations.currentTask)}. El reparto automático corresponde únicamente a [BACKOFFICE] [REVISION BO] [CV].`, discrepancy: false, nextStep: 'Mantén el ticket pendiente mientras siga en esa etapa. Si debe auditarse ahora, usa Reactivar para auditoría e indica el motivo y el Asesor.' };
}
export function resolveFlokzuEligibility(classification: FlokzuClassification, local: FlokzuReviewState): boolean {
  return local === 'REACTIVATED' || (local === 'OPEN' && classification === 'ACTIVE');
}
export interface FlokzuTicket {
  id: string; externalCaseId: string; studentIdentifier: string | null; studentName: string | null;
  classification: FlokzuClassification; reviewState: FlokzuReviewState; eligible: boolean;
  discrepancy: boolean; reason: string; revision: number; assignedTo: string | null; updatedAt: string;
  campus: string | null; policy: string | null; requestDate: string | null;
  currentTask?: string | null; salesChannelReported?: string | null;
}
export interface FlokzuEvent {
  id: string; action: string; actor: string | null; createdAt: string; reason: string | null;
  before: Record<string, unknown> | null; after: Record<string, unknown>; batchId: string | null;
}
export interface FlokzuDecision {
  caseId: string; revision: number; action: 'CLOSE' | 'REACTIVATE' | 'REASSIGN' | 'PENDING' | 'DISCREPANCY';
  reason?: string; observation?: string; assignedTo?: string | null; confirmed?: boolean;
}
