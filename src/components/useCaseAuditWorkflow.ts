import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { getAudit, getCase, startAudit, toErrorState } from '../lib/api';
import type { AuditDetail, CaseDetailResponse, ErrorState } from '../lib/api';
import { errorCategoryMessage } from '../lib/labels';

const TRANSCRIPTION_POLL_MS = 3000;
const AUDIT_POLL_MS = 4000;
const MAX_WAIT_RETRIES = 60;
const MAX_RUNNING_POLLS = 90;

export const AUTH_ERROR_MESSAGE = 'El servidor requiere autenticación. La interfaz está en modo demo: los datos no se cargarán hasta que configure una sesión válida.';

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

  useEffect(() => {
    setAuditPhase('idle');
    setAuditError(null);
    setPendingEvidence([]);
    waitRetriesRef.current = 0;
    runningPollsRef.current = 0;
    bootstrappedRef.current = false;
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
    if (data.audit?.status === 'RUNNING') {
      runningPollsRef.current = 0;
      setAuditPhase('running');
    }
  }, []);

  const runAudit = useCallback(async (): Promise<void> => {
    setAuditPhase('starting');
    setAuditError(null);
    setPendingEvidence([]);
    waitRetriesRef.current = 0;
    try {
      const response = await startAudit(caseId);
      if (response.kind === 'pending') {
        setPendingEvidence(response.pendingEvidence);
        setAuditPhase('waiting');
        return;
      }
      applyAudit(response.audit);
    } catch (error) {
      setAuditPhase('idle');
      setAuditError(userFacingError(error));
    }
  }, [caseId, applyAudit]);

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
    const data = await getCase(caseId);
    setDetail(data);
    if (data.audit !== null && data.audit.status !== 'RUNNING') {
      applyAudit(data.audit);
      return;
    }
    const ready = data.evidences.length > 0 && data.evidences.every((item) => item.processingStatus === 'READY');
    if (ready) await runAudit();
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
    const next = await getAudit(caseId);
    if (next !== null) {
      setDetail((prev) => (prev ? { ...prev, audit: next } : prev));
      if (next.status === 'COMPLETED' || next.status === 'ERROR') applyAudit(next);
    }
  }, [caseId, applyAudit, setDetail]);

  return {
    auditPhase,
    auditError,
    pendingEvidence,
    runAudit,
    tickWaiting,
    tickRunning,
    observeLoadedCase,
    transcriptionPollMs: TRANSCRIPTION_POLL_MS,
    auditPollMs: AUDIT_POLL_MS,
  };
}
