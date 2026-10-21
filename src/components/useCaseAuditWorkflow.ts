import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { getAudit, getCase, startAudit, toErrorState } from '../lib/api';
import type { AuditDetail, CaseDetailResponse, ErrorState } from '../lib/api';
import { errorCategoryMessage } from '../lib/labels';

const TRANSCRIPTION_POLL_MS = 3000;
const AUDIT_POLL_MS = 4000;
const MAX_WAIT_RETRIES = 60;
const MAX_RUNNING_POLLS = 90;

export const AUTH_ERROR_MESSAGE = 'Tu sesión no está disponible. Vuelve a iniciar sesión para continuar.';

type AuditPhase = 'idle' | 'starting' | 'waiting' | 'running';

function userFacingError(error: unknown): ErrorState {
  const state = toErrorState(error);
  return state.category === 'AUTH_ERROR'
    ? { category: state.category, message: AUTH_ERROR_MESSAGE }
    : state;
}

interface UseCaseAuditWorkflowOptions {
  caseId: string;
  setDetail: Dispatch<SetStateAction<CaseDetailResponse | null>>;
}

export function useCaseAuditWorkflow({ caseId, setDetail }: UseCaseAuditWorkflowOptions) {
  const [auditPhase, setAuditPhase] = useState<AuditPhase>('idle');
  const [auditError, setAuditError] = useState<ErrorState | null>(null);
  const [pendingEvidence, setPendingEvidence] = useState<string[]>([]);
  const waitRetriesRef = useRef(0);
  const runningPollsRef = useRef(0);
  const bootstrappedRef = useRef(false);
  const requestInFlight = useRef(false);
  const generation = useRef(0);
  const recoverLock = useRef(false);

  useEffect(() => {
    setAuditPhase('idle');
    setAuditError(null);
    setPendingEvidence([]);
    waitRetriesRef.current = 0;
    runningPollsRef.current = 0;
    bootstrappedRef.current = false;
    requestInFlight.current = false;
    recoverLock.current = false;
    generation.current += 1;
    return () => { generation.current += 1; };
  }, [caseId]);

  const applyAudit = useCallback((next: AuditDetail): void => {
    setDetail((prev) => (prev ? { ...prev, audit: next } : prev));
    if (next.status === 'RUNNING') {
      runningPollsRef.current = 0;
      setAuditPhase('running');
      setAuditError(null);
      return;
    }
    setAuditPhase('idle');
    if (next.status === 'ERROR') {
      setAuditError({
        correlationId: next.providerMetadata?.correlationId ?? next.id,
        category: next.errorCategory ?? 'UNKNOWN',
        message: errorCategoryMessage(next.errorCategory),
      });
    } else {
      setAuditError(null);
    }
  }, [setDetail]);

  const observeLoadedCase = useCallback((data: CaseDetailResponse): void => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    if (data.audit?.status === 'ERROR') {
      setAuditError({ category: data.audit.errorCategory ?? 'UNKNOWN', message: errorCategoryMessage(data.audit.errorCategory), correlationId: data.audit.providerMetadata?.correlationId ?? data.audit.id });
    }
    if (data.audit?.status === 'RUNNING') {
      runningPollsRef.current = 0;
      setAuditPhase('running');
    }
  }, []);

  const runAudit = useCallback(async (contactConfirmation?: { auditId: string; performed: boolean }): Promise<void> => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    const revision = generation.current;
    setAuditPhase('starting');
    setAuditError(null);
    setPendingEvidence([]);
    waitRetriesRef.current = 0;
    try {
      const response = await startAudit(caseId, contactConfirmation);
      if (revision !== generation.current) return;
      if (response.kind === 'pending') {
        setPendingEvidence(response.pendingEvidence);
        setAuditPhase('waiting');
        return;
      }
      let next = response.audit;
      if (response.audit.status !== 'RUNNING') {
        const current = await getCase(caseId);
        if (revision !== generation.current) return;
        setDetail(current);
        next = current.audit ?? response.audit;
      }
      applyAudit(next);
    } catch (error) {
      if (revision !== generation.current) return;
      setAuditPhase('idle');
      setAuditError(userFacingError(error));
      // También recupera la fila ERROR durable para ofrecer la confirmación.
      try {
        const current = await getCase(caseId);
        if (revision === generation.current) setDetail(current);
      } catch { /* Conserva el error original y permite actualizar manualmente. */ }
    } finally {
      if (revision === generation.current) requestInFlight.current = false;
    }
  }, [caseId, applyAudit, setDetail]);

  const tickWaiting = useCallback(async (): Promise<void> => {
    waitRetriesRef.current += 1;
    if (waitRetriesRef.current > MAX_WAIT_RETRIES) {
      setAuditPhase('idle');
      setAuditError({
        category: 'TRANSCRIPTION_ERROR',
        message: 'La transcripción de las evidencias de audio no terminó a tiempo. Intenta auditar de nuevo en unos minutos.',
      });
      return;
    }
    const revision = generation.current;
    try {
      const data = await getCase(caseId);
      if (revision !== generation.current) return;
      setDetail(data);
      if (data.audit !== null && data.audit.status === 'COMPLETED' && data.auditIsCurrent !== false) {
        applyAudit(data.audit);
        return;
      }
      const ready = data.evidences.length > 0 && data.evidences.every((item) => item.processingStatus === 'READY');
      const failed = data.evidences.find((item) => item.processingStatus === 'ERROR');
      if (failed) {
        setAuditPhase('idle');
        setAuditError({ category: 'TRANSCRIPTION_ERROR', message: `No se pudo preparar ${failed.filename}. Consulta la evidencia antes de reintentar.` });
        return;
      }
      if (ready) await runAudit();
    } catch (error) {
      if (revision === generation.current) { setAuditPhase('idle'); setAuditError(userFacingError(error)); }
    }
  }, [caseId, applyAudit, runAudit, setDetail]);

  const tickRunning = useCallback(async (): Promise<void> => {
    runningPollsRef.current += 1;
    if (runningPollsRef.current > MAX_RUNNING_POLLS) {
      setAuditPhase('idle');
      setAuditError({
        category: 'AI_PROVIDER_ERROR',
        message: 'La auditoría está tardando demasiado. Actualiza el caso para consultar el estado real antes de reintentar.',
      });
      return;
    }
    const revision = generation.current;
    try {
      const next = await getAudit(caseId);
      if (revision !== generation.current) return;
      if (next !== null) {
        setDetail((prev) => (prev ? { ...prev, audit: next } : prev));
        if (next.status === 'COMPLETED' || next.status === 'ERROR') {
          const data = await getCase(caseId);
          if (revision !== generation.current) return;
          setDetail(data);
          applyAudit(data.audit ?? next);
        }
      }
    } catch (error) {
      if (revision === generation.current) { setAuditPhase('idle'); setAuditError(userFacingError(error)); }
    }
  }, [caseId, applyAudit, setDetail]);

  const recoverAudit = useCallback(async (): Promise<void> => {
    if (recoverLock.current) return;
    recoverLock.current = true;
    const revision = generation.current;
    try {
      const data = await getCase(caseId);
      if (revision !== generation.current) return;
      setDetail(data);
      if (data.audit?.status === 'RUNNING' || (data.audit?.status === 'COMPLETED' && data.auditIsCurrent !== false)) { applyAudit(data.audit); return; }
      await runAudit();
    } catch (error) { if (revision === generation.current) setAuditError(userFacingError(error)); }
    finally { if (revision === generation.current) recoverLock.current = false; }
  }, [caseId, setDetail, applyAudit, runAudit]);

  return {
    auditPhase,
    auditError,
    pendingEvidence,
    runAudit,
    recoverAudit,
    tickWaiting,
    tickRunning,
    observeLoadedCase,
    transcriptionPollMs: TRANSCRIPTION_POLL_MS,
    auditPollMs: AUDIT_POLL_MS,
  };
}
