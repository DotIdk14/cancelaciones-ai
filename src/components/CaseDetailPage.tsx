// =============================================================================
// Detalle de caso: evidencias, bot├│n AUDITAR, polling y panel de resultado.
// Toda la verdad vive en el servidor; aqu├¡ solo se orquestan peticiones.
// =============================================================================

import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteEvidence, getAudit, getCase, startAudit, toErrorState } from '../lib/api';
import type { AuditDetail, CaseDetailResponse, ErrorState, Evidence } from '../lib/api';
import { formatDateTime, shortId } from '../lib/format';
import {
  CASE_STATUS_LABELS,
  CASE_STATUS_TONE,
  RESULT_LABELS,
  RESULT_TONE,
  errorCategoryLabel,
  errorCategoryMessage,
} from '../lib/labels';
import { goToCases } from '../lib/useHashRoute';
import { usePolling } from '../lib/usePolling';
import { AuditResultPanel } from './AuditResultPanel';
import { CaseReviewPanel, CaseReviewRecord } from './CaseReviewPanel';
import { AUDIT_RESULTS } from '../skills/audit/types';
import type { AuditResultType } from '../skills/audit/types';
import { EvidenceList } from './EvidenceList';
import { EvidenceUploader } from './EvidenceUploader';
import { EvidenceViewer } from './EvidenceViewer';
import { Badge, Button, ErrorCard, Panel, Spinner } from './ui';

/** Mensaje amigable cuando el servidor devuelve 401 (sesi├│n requerida). */
const AUTH_ERROR_MESSAGE = 'El servidor requiere autenticaci├│n. La interfaz est├í en modo demo: los datos no se cargar├ín hasta que configure una sesi├│n v├ílida.';

const TRANSCRIPTION_POLL_MS = 3000;
const AUDIT_POLL_MS = 4000;
/** Reintentos de POST mientras la transcripci├│n no termina (Ôëê3 min). */
const MAX_WAIT_RETRIES = 60;
/** Consultas de estado de una auditor├¡a en curso (Ôëê6 min). */
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
      // Si al abrir el caso ya hay una auditor├¡a en curso, se retoma el poll.
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

  // --------------------------------------------------------------- auditor├¡a

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

  // Poll mientras la auditor├¡a espera transcripci├│n: refresca el caso (evidencias
  // + audit en la misma respuesta) y reintenta el POST cuando todo est├í READY.
  const tickWaiting = useCallback(async (): Promise<void> => {
    waitRetriesRef.current += 1;
    if (waitRetriesRef.current > MAX_WAIT_RETRIES) {
      setAuditPhase('idle');
      setAuditError({
        category: 'TRANSCRIPTION_ERROR',
        message:
          'La transcripci├│n de las evidencias de audio no termin├│ a tiempo. Intenta auditar de nuevo en unos minutos.',
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

  // Poll de una auditor├¡a en curso. El servidor marca ERROR a los 4 minutos.
  const tickRunning = useCallback(async (): Promise<void> => {
    runningPollsRef.current += 1;
    if (runningPollsRef.current > MAX_RUNNING_POLLS) {
      setAuditPhase('idle');
      setAuditError({
        category: 'AI_PROVIDER_ERROR',
        message:
          'La auditor├¡a est├í tardando demasiado. Actualiza el caso para consultar el estado real antes de reintentar.',
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
  const review = detail?.review ?? null;
  const comparison = detail?.comparison ?? null;
  const effectiveResolution = detail?.effectiveResolution ?? null;
  const reviewAuditValue = review === null ? null : detail?.audits.find((item) => item.id === review.auditId)?.result ?? null;
  const reviewAuditResult: AuditResultType | null =
    AUDIT_RESULTS.find((result) => result === reviewAuditValue) ?? null;

  const hasTranscribing = evidences.some((item) => item.processingStatus === 'TRANSCRIBING');
  const allReady = evidences.length > 0 && evidences.every((item) => item.processingStatus === 'READY');
  const hasFailedEvidence = evidences.some((item) => item.processingStatus === 'ERROR');
  const caseIsError = detail?.case.status === 'ERROR';
  const hasCompletedAudit = audit?.status === 'COMPLETED';
  const auditBusy = auditPhase !== 'idle';
  const canAudit = allReady && !caseIsError && !auditBusy;
  const shouldShowReauditLabel = detail?.case.status === 'READY' && allReady && hasCompletedAudit;

  // Mientras hay transcripciones en curso se refresca el caso cada 3 s.
  // En fase `waiting` el poll de auditor├¡a ya trae los mismos datos, as├¡ que
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
          ÔåÉ Volver a casos
        </Button>
        <ErrorCard
          title="No se pudo cargar el caso"
          message={loadError?.message ?? 'El caso no est├í disponible.'}
          onRetry={() => void load()}
        />
      </div>
    );
  }

  const serverError: ErrorState | null =
    audit !== null && audit.status === 'ERROR'
      ? { category: audit.errorCategory ?? 'UNKNOWN', message: errorCategoryMessage(audit.errorCategory) }
      : null;
  // Mientras hay un flujo de auditor├¡a activo manda el error local (POST fallido);
  // si no, se muestra el error que dej├│ registrado el servidor.
  const displayError = auditError ?? (auditBusy ? null : serverError);

  let auditHint: string | null = null;
  if (evidences.length === 0) auditHint = 'Sube al menos una evidencia para poder auditar.';
  else if (hasFailedEvidence) auditHint = 'Hay evidencias con error. Elim├¡nalas o vuelve a subirlas antes de auditar.';
  else if (hasTranscribing) auditHint = 'Las evidencias de audio se est├ín transcribiendo. Podr├ís auditar cuando terminen.';
  else if (!allReady) auditHint = 'A├║n hay evidencias sin procesar.';

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
            ÔåÉ Volver a casos
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
              ? `Matr├¡cula ${detail.case.studentIdentifier} ┬À `
              : ''}
            Creado {formatDateTime(detail.case.createdAt)} ┬À Actualizado {formatDateTime(detail.case.updatedAt)}
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

      {/* ------------------------------------------------------ auditor├¡a */}
      <Panel
        title="Auditor├¡a con IA"
        description="El dictamen lo emite el modelo consultando el procedimiento vigente y las evidencias del caso."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            onClick={() => void runAudit()}
            disabled={!canAudit}
            loading={auditBusy}
            loadingLabel="Consultando auditor├¡a"
          >
            {auditPhase === 'waiting'
              ? 'Esperando transcripci├│nÔÇª'
              : auditPhase === 'running'
                ? 'Auditando con IAÔÇª'
                : shouldShowReauditLabel
                  ? 'Volver a auditar con la nueva evidencia'
                  : 'Auditar con IA'}
          </Button>

          {auditPhase === 'starting' && (
            <span role="status" className="flex items-center gap-2 text-sm text-muted">
              <Spinner label="Enviando solicitud de auditor├¡a" className="h-3.5 w-3.5" />
              Enviando solicitudÔÇª
            </span>
          )}
          {auditPhase === 'waiting' && (
            <span role="status" className="flex items-center gap-2 text-sm text-warning">
              <Spinner label="Esperando transcripci├│n" className="h-3.5 w-3.5" />
              Esperando transcripci├│n de {pendingEvidence.length} evidencia
              {pendingEvidence.length === 1 ? '' : 's'}ÔÇª
            </span>
          )}
          {auditPhase === 'running' && (
            <span role="status" className="flex items-center gap-2 text-sm text-brand">
              <Spinner label="Auditando con IA" className="h-3.5 w-3.5" />
              Auditando con IAÔÇª {audit !== null ? `${audit.provider}/${audit.model}` : ''}
            </span>
          )}
        </div>

        {auditHint !== null && <p className="mt-3 text-sm text-muted">{auditHint}</p>}
        {caseIsError && (
          <p className="mt-3 text-sm text-danger">
            El caso est├í en estado de error. No se puede auditar hasta que se resuelva.
          </p>
        )}

        {displayError !== null && (
          <div className="mt-4">
            <ErrorCard
              title={`Auditor├¡a con error ┬À ${errorCategoryLabel(displayError.category)}`}
              category={displayError.category}
              message={displayError.message}
              onRetry={() => void runAudit()}
              retrying={auditBusy}
            />
            <p className="mt-2 text-xs text-muted">
              No se muestra ning├║n dictamen mientras la auditor├¡a no termine correctamente.
            </p>
          </div>
        )}
      </Panel>

      {review !== null && (
        <section
          aria-labelledby="resolucion-humana-vigente"
          className="rounded-2xl border border-brand/40 bg-brand/5 p-5"
        >
          <h2 id="resolucion-humana-vigente" className="text-base font-semibold text-ink">
            Resoluci├│n humana vigente
          </h2>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Badge tone={RESULT_TONE[review.result]}>{RESULT_LABELS[review.result]}</Badge>
            <span className="text-sm text-muted">
              Esta decisi├│n humana tiene prioridad y gobierna el caso.
            </span>
          </div>
          <p className="mt-2 text-sm text-muted">
            El dictamen original de IA se conserva sin cambios y se muestra debajo para comparaci├│n.
          </p>
        </section>
      )}

      {/* ------------------------------------------------------ resultado */}
      {audit !== null && audit.status === 'COMPLETED' && (
        <section aria-labelledby="resultado-auditoria" className="flex flex-col gap-3">
          <h2 id="resultado-auditoria" className="text-base font-semibold text-ink">
            Dictamen original de IA
          </h2>
          <AuditResultPanel audit={audit} evidences={evidences} />
        </section>
      )}

      {/* ------------------------------------------------------ revisi├│n
          El dictamen de arriba NO se modifica ni se oculta. La revisi├│n humana
          va debajo, como una capa aparte: o existe (y entonces es la resoluci├│n
          final) o se ofrece el formulario para registrarla. Nunca ambas. */}
      {review !== null ? (
        <CaseReviewRecord
          caseId={caseId}
          review={review}
          comparison={comparison}
          effectiveResolution={effectiveResolution}
          reviewAuditResult={reviewAuditResult}
        />
      ) : (
        <CaseReviewPanel caseId={caseId} audit={audit} review={null} onSubmitted={() => void load()} />
      )}

      {/* ------------------------------------------------------ evidencias */}
      <EvidenceUploader caseId={caseId} onUploaded={() => load()} disabled={Boolean(caseIsError)} />

      <Panel
        title={`Evidencias (${evidences.length})`}
        description="Las transcripciones de audio se actualizan autom├íticamente mientras se procesan."
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
