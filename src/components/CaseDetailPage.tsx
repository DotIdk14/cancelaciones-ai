// =============================================================================
// Detalle de caso: evidencias, botón AUDITAR, polling y panel de resultado.
// Toda la verdad vive en el servidor; aquí solo se orquestan peticiones.
// =============================================================================

import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteEvidence, getAudit, getCase, startAudit, toErrorState } from '../lib/api';
import type { AuditDetail, CaseDetailResponse, ErrorState, Evidence } from '../lib/api';
import { formatDateTime, shortId } from '../lib/format';
import { CASE_STATUS_LABELS, CASE_STATUS_TONE, errorCategoryLabel, errorCategoryMessage } from '../lib/labels';
import { goToCases } from '../lib/useHashRoute';
import { usePolling } from '../lib/usePolling';
import { AuditResultPanel } from './AuditResultPanel';
import { EvidenceList } from './EvidenceList';
import { EvidenceUploader } from './EvidenceUploader';
import { EvidenceViewer } from './EvidenceViewer';
import { Badge, Button, ErrorCard, Panel, Spinner } from './ui';

/** Mensaje amigable cuando el servidor devuelve 401 (sesión requerida). */
const AUTH_ERROR_MESSAGE = 'El servidor requiere autenticación. La interfaz está en modo demo: los datos no se cargarán hasta que configure una sesión válida.';

const TRANSCRIPTION_POLL_MS = 3000;
const AUDIT_POLL_MS = 4000;
/** Reintentos de POST mientras la transcripción no termina (≈3 min). */
const MAX_WAIT_RETRIES = 60;
/** Consultas de estado de una auditoría en curso (≈6 min). */
const MAX_RUNNING_POLLS = 90;

type AuditPhase = 'idle' | 'starting' | 'waiting' | 'running';

export interface CaseDetailPageProps {
  caseId: string;
}

export function CaseDetailPage({ caseId }: CaseDetailPageProps): ReactNode {
  const [detail, setDetail] = useState<CaseDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ErrorState | null>(null);

  const [auditPhase, setAuditPhase] = useState<AuditPhase>('idle');
  const [auditError, setAuditError] = useState<ErrorState | null>(null);
  const [pendingEvidence, setPendingEvidence] = useState<string[]>([]);

  const [viewing, setViewing] = useState<Evidence | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<ErrorState | null>(null);

  const waitRetriesRef = useRef(0);
  const runningPollsRef = useRef(0);
  /** Evita retomar el poll en refrescos posteriores del caso. */
  const bootstrappedRef = useRef(false);

  // ---------------------------------------------------------------- carga

  const load = useCallback(async (): Promise<void> => {
    try {
      const data = await getCase(caseId);
      setDetail(data);
      setLoadError(null);
      // Si al abrir el caso ya hay una auditoría en curso, se retoma el poll.
      if (!bootstrappedRef.current) {
        bootstrappedRef.current = true;
        if (data.audit !== null && data.audit.status === 'RUNNING') {
          runningPollsRef.current = 0;
          setAuditPhase('running');
        }
      }
    } catch (err) {
      const state = toErrorState(err);
      // Si el servidor devuelve 401, mostrar mensaje amigable en modo demo.
      const message = state.category === 'AUTH_ERROR' ? AUTH_ERROR_MESSAGE : state.message;
      setLoadError({ category: state.category, message });
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    setLoading(true);
    setDetail(null);
    setAuditPhase('idle');
    setAuditError(null);
    setPendingEvidence([]);
    setActionError(null);
    setConfirmId(null);
    setViewing(null);
    waitRetriesRef.current = 0;
    runningPollsRef.current = 0;
    bootstrappedRef.current = false;
    void load();
  }, [load]);

  // --------------------------------------------------------------- auditoría

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
    } catch (err) {
      setAuditPhase('idle');
      const state = toErrorState(err);
      const message = state.category === 'AUTH_ERROR' ? AUTH_ERROR_MESSAGE : state.message;
      setAuditError({ category: state.category, message });
    }
  }, [caseId, applyAudit]);

  // Poll mientras la auditoría espera transcripción: refresca el caso (evidencias
  // + audit en la misma respuesta) y reintenta el POST cuando todo está READY.
  const tickWaiting = useCallback(async (): Promise<void> => {
    waitRetriesRef.current += 1;
    if (waitRetriesRef.current > MAX_WAIT_RETRIES) {
      setAuditPhase('idle');
      setAuditError({
        category: 'TRANSCRIPTION_ERROR',
        message:
          'La transcripción de las evidencias de audio no terminó a tiempo. Intenta auditar de nuevo en unos minutos.',
      });
      return;
    }
    const data = await getCase(caseId);
    setDetail(data);
    if (data.audit !== null && data.audit.status !== 'RUNNING') {
      applyAudit(data.audit);
      return;
    }
    const ready =
      data.evidences.length > 0 && data.evidences.every((item) => item.processingStatus === 'READY');
    if (ready) await runAudit();
  }, [caseId, applyAudit, runAudit]);

  // Poll de una auditoría en curso. El servidor marca ERROR a los 4 minutos.
  const tickRunning = useCallback(async (): Promise<void> => {
    runningPollsRef.current += 1;
    if (runningPollsRef.current > MAX_RUNNING_POLLS) {
      setAuditPhase('idle');
      setAuditError({
        category: 'AI_PROVIDER_ERROR',
        message:
          'La auditoría está tardando demasiado. Actualiza el caso para consultar el estado real antes de reintentar.',
      });
      return;
    }
    const next = await getAudit(caseId);
    if (next !== null) {
      setDetail((prev) => (prev ? { ...prev, audit: next } : prev));
      if (next.status === 'COMPLETED' || next.status === 'ERROR') applyAudit(next);
    }
  }, [caseId, applyAudit]);

  const evidences = detail?.evidences ?? [];
  const audit = detail?.audit ?? null;

  const hasTranscribing = evidences.some((item) => item.processingStatus === 'TRANSCRIBING');
  const allReady = evidences.length > 0 && evidences.every((item) => item.processingStatus === 'READY');
  const hasFailedEvidence = evidences.some((item) => item.processingStatus === 'ERROR');
  const caseIsError = detail?.case.status === 'ERROR';
  const hasCompletedAudit = audit?.status === 'COMPLETED';
  const auditBusy = auditPhase !== 'idle';
  const canAudit = allReady && !caseIsError && !auditBusy;
  const shouldShowReauditLabel = detail?.case.status === 'READY' && allReady && hasCompletedAudit;

  // Mientras hay transcripciones en curso se refresca el caso cada 3 s.
  // En fase `waiting` el poll de auditoría ya trae los mismos datos, así que
  // se evita duplicar peticiones.
  usePolling(load, hasTranscribing && auditPhase !== 'waiting' ? TRANSCRIPTION_POLL_MS : null);
  usePolling(tickWaiting, auditPhase === 'waiting' ? TRANSCRIPTION_POLL_MS : null);
  usePolling(tickRunning, auditPhase === 'running' ? AUDIT_POLL_MS : null);

  // --------------------------------------------------------------- acciones

  async function handleDelete(evidence: Evidence): Promise<void> {
    setDeletingId(evidence.id);
    setActionError(null);
    try {
      await deleteEvidence(caseId, evidence.id);
      setConfirmId(null);
      await load();
    } catch (err) {
      const state = toErrorState(err);
      const message = state.category === 'AUTH_ERROR' ? AUTH_ERROR_MESSAGE : state.message;
      setActionError({ category: state.category, message });
    } finally {
      setDeletingId(null);
    }
  }

  // ---------------------------------------------------------------- render

  if (loading && detail === null) {
    return (
      <div className="flex justify-center py-16">
        <Spinner label="Cargando caso" className="h-6 w-6" />
      </div>
    );
  }

  if (detail === null) {
    return (
      <div className="flex flex-col gap-4">
        <Button onClick={goToCases} variant="ghost">
          ← Volver a casos
        </Button>
        <ErrorCard
          title="No se pudo cargar el caso"
          message={loadError?.message ?? 'El caso no está disponible.'}
          onRetry={() => void load()}
        />
      </div>
    );
  }

  const serverError: ErrorState | null =
    audit !== null && audit.status === 'ERROR'
      ? { category: audit.errorCategory ?? 'UNKNOWN', message: errorCategoryMessage(audit.errorCategory) }
      : null;
  // Mientras hay un flujo de auditoría activo manda el error local (POST fallido);
  // si no, se muestra el error que dejó registrado el servidor.
  const displayError = auditError ?? (auditBusy ? null : serverError);

  let auditHint: string | null = null;
  if (evidences.length === 0) auditHint = 'Sube al menos una evidencia para poder auditar.';
  else if (hasFailedEvidence) auditHint = 'Hay evidencias con error. Elimínalas o vuelve a subirlas antes de auditar.';
  else if (hasTranscribing) auditHint = 'Las evidencias de audio se están transcribiendo. Podrás auditar cuando terminen.';
  else if (!allReady) auditHint = 'Aún hay evidencias sin procesar.';

  return (
    <div className="flex flex-col gap-5">
      {/* ------------------------------------------------------ cabecera */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={goToCases}
            className="rounded-lg px-2 py-1 text-sm font-medium text-muted transition-colors hover:bg-surface-3 hover:text-ink"
          >
            ← Volver a casos
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-lg font-semibold text-ink">
              Caso <span className="font-mono">{shortId(detail.case.id)}</span>
            </h1>
            <Badge tone={CASE_STATUS_TONE[detail.case.status]}>
              {CASE_STATUS_LABELS[detail.case.status]}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted">
            {detail.case.studentIdentifier !== null && detail.case.studentIdentifier !== ''
              ? `Matrícula ${detail.case.studentIdentifier} · `
              : ''}
            Creado {formatDateTime(detail.case.createdAt)} · Actualizado {formatDateTime(detail.case.updatedAt)}
          </p>
        </div>
        <Button onClick={() => void load()} loading={loading} loadingLabel="Actualizando">
          Actualizar
        </Button>
      </div>

      {loadError !== null && (
        <ErrorCard message={loadError.message} category={loadError.category} onRetry={() => void load()} />
      )}
      {actionError !== null && <ErrorCard message={actionError.message} category={actionError.category} />}

      {/* ------------------------------------------------------ auditoría */}
      <Panel
        title="Auditoría con IA"
        description="El dictamen lo emite el modelo consultando el procedimiento vigente y las evidencias del caso."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            onClick={() => void runAudit()}
            disabled={!canAudit}
            loading={auditBusy}
            loadingLabel="Consultando auditoría"
          >
            {auditPhase === 'waiting'
              ? 'Esperando transcripción…'
              : auditPhase === 'running'
                ? 'Auditando con IA…'
                : shouldShowReauditLabel
                  ? 'Volver a auditar con la nueva evidencia'
                  : 'Auditar con IA'}
          </Button>

          {auditPhase === 'starting' && (
            <span role="status" className="flex items-center gap-2 text-sm text-muted">
              <Spinner label="Enviando solicitud de auditoría" className="h-3.5 w-3.5" />
              Enviando solicitud…
            </span>
          )}
          {auditPhase === 'waiting' && (
            <span role="status" className="flex items-center gap-2 text-sm text-warning">
              <Spinner label="Esperando transcripción" className="h-3.5 w-3.5" />
              Esperando transcripción de {pendingEvidence.length} evidencia
              {pendingEvidence.length === 1 ? '' : 's'}…
            </span>
          )}
          {auditPhase === 'running' && (
            <span role="status" className="flex items-center gap-2 text-sm text-brand">
              <Spinner label="Auditando con IA" className="h-3.5 w-3.5" />
              Auditando con IA… {audit !== null ? `${audit.provider}/${audit.model}` : ''}
            </span>
          )}
        </div>

        {auditHint !== null && <p className="mt-3 text-sm text-muted">{auditHint}</p>}
        {caseIsError && (
          <p className="mt-3 text-sm text-danger">
            El caso está en estado de error. No se puede auditar hasta que se resuelva.
          </p>
        )}

        {displayError !== null && (
          <div className="mt-4">
            <ErrorCard
              title={`Auditoría con error · ${errorCategoryLabel(displayError.category)}`}
              category={displayError.category}
              message={displayError.message}
              onRetry={() => void runAudit()}
              retrying={auditBusy}
            />
            <p className="mt-2 text-xs text-muted">
              No se muestra ningún dictamen mientras la auditoría no termine correctamente.
            </p>
          </div>
        )}
      </Panel>

      {/* ------------------------------------------------------ resultado */}
      {audit !== null && audit.status === 'COMPLETED' && (
        <section aria-labelledby="resultado-auditoria" className="flex flex-col gap-3">
          <h2 id="resultado-auditoria" className="text-base font-semibold text-ink">
            Resultado de la auditoría
          </h2>
          <AuditResultPanel audit={audit} evidences={evidences} />
        </section>
      )}

      {/* ------------------------------------------------------ evidencias */}
      <EvidenceUploader caseId={caseId} onUploaded={() => load()} disabled={Boolean(caseIsError)} />

      <Panel
        title={`Evidencias (${evidences.length})`}
        description="Las transcripciones de audio se actualizan automáticamente mientras se procesan."
        labelledBy="evidencias-caso"
      >
        <EvidenceList
          evidences={evidences}
          onPreview={setViewing}
          onDelete={(item) => setConfirmId(item.id)}
          onConfirmDelete={(item) => void handleDelete(item)}
          onCancelConfirm={() => setConfirmId(null)}
          deletingId={deletingId}
          confirmId={confirmId}
        />
      </Panel>

      {viewing !== null && <EvidenceViewer evidence={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
