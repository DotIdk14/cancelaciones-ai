// =============================================================================
// Detalle de caso: evidencias, botón AUDITAR, polling y panel de resultado.
// Toda la verdad vive en el servidor; aquí solo se orquestan peticiones.
// =============================================================================

import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, BookOpenCheck, Clock3, FileCheck2, FileText, Paperclip, Search } from 'lucide-react';
import { deleteEvidence, getAreaComments, getAudit, getCase, startAudit, toErrorState } from '../lib/api';
import type { AreaComment, AuditDetail, CaseDetailResponse, ErrorState, Evidence } from '../lib/api';
import { formatDateTime, formatDuration, formatPercent, formatFactValue, shortId, textOrDash } from '../lib/format';
import {
  CASE_STATUS_LABELS,
  CASE_STATUS_TONE,
  EVIDENCE_STATUS_LABELS,
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
import { AreaQuickComments } from './AreaQuickComments';
import { EvidencePane } from './EvidencePane';
import { Badge, Button, ErrorCard, Panel, Spinner } from './ui';

/** Mensaje amigable cuando el servidor devuelve 401 (sesión requerida). */
const AUTH_ERROR_MESSAGE = 'El servidor requiere autenticación. La interfaz está en modo demo: los datos no se cargarán hasta que configure una sesión válida.';

const TRANSCRIPTION_POLL_MS = 3000;
const AUDIT_POLL_MS = 4000;
/** Reintentos de POST mientras la transcripción no termina (≈3 min). */
const MAX_WAIT_RETRIES = 60;
/** Consultas de estado de una auditoría en curso (≈6 min). */
const MAX_RUNNING_POLLS = 90;

type CaseDetailTab = 'transcript' | 'findings' | 'timeline' | 'verdict' | 'evidence';

/**
 * Pestañas que el buscador puede filtrar. Fuera quedan dos, y por razones
 * distintas:
 *   · 'verdict' es un bloque único, no una colección, así que "filtrarlo" lo
 *     haría aparecer incompleto sin avisar.
 *   · 'evidence' muestra un archivo binario (imagen, PDF, audio). No hay texto
 *     que el buscador pueda reducir, así que contarla entre las coincidencias
 *     daría un número que nunca refleja lo que el operador está viendo.
 */
const SEARCHABLE_TABS = ['transcript', 'findings', 'timeline'] as const;

const TAB_LABELS: Record<CaseDetailTab, string> = {
  transcript: 'Transcripción',
  findings: 'Hechos y checks',
  timeline: 'Cronología',
  verdict: 'Dictamen',
  evidence: 'Evidencia',
};

/**
 * Evento ya aplanado de la cronología. Se separa en dos grupos al renderizar:
 * la cronología del cliente (la que el modelo extrae de la evidencia) y los
 * eventos de la plataforma (creación, subidas, auditorías, resolución).
 */
interface TimelineEntry {
  id: string;
  time: string;
  title: string;
  body: string;
}

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

  /**
   * Id de la evidencia abierta en la pestaña central, no el objeto entero: si
   * un `load()` posterior trae la lista actualizada, el visor se queda apuntando
   * a la evidencia correcta aunque sus datos hayan cambiado (por ejemplo, una
   * transcripción que terminó de procesarse).
   */
  const [viewingEvidenceId, setViewingEvidenceId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<ErrorState | null>(null);
  const [activeTab, setActiveTab] = useState<CaseDetailTab>('transcript');
  const [search, setSearch] = useState('');

  const [quickComments, setQuickComments] = useState<AreaComment[] | null>(null);
  const [showNotesPrompt, setShowNotesPrompt] = useState(false);
  const [skipNotesPrompt, setSkipNotesPrompt] = useState(false);
  const [focusNotesRequest, setFocusNotesRequest] = useState(0);

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

  const loadQuickComments = useCallback(async (): Promise<void> => {
    try {
      const comments = await getAreaComments(caseId);
      setQuickComments(comments);
    } catch {
      // Si no se puede consultar, se trata como "no se puede determinar":
      // el prompt se muestra igual y el usuario decide.
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
    setViewingEvidenceId(null);
    setActiveTab('transcript');
    setSearch('');
    setQuickComments(null);
    setShowNotesPrompt(false);
    setSkipNotesPrompt(false);
    setFocusNotesRequest(0);
    waitRetriesRef.current = 0;
    runningPollsRef.current = 0;
    bootstrappedRef.current = false;
    void load();
    void loadQuickComments();
  }, [load, loadQuickComments]);

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
    setShowNotesPrompt(false);
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

  const maybeRunAudit = useCallback((): void => {
    if (showNotesPrompt) return;
    const hasQuickComments =
      quickComments !== null &&
      quickComments.some(
        (comment) =>
          (comment.area === 'BACK_OFFICE' || comment.area === 'HELPDESK') &&
          comment.comment.trim() !== '',
      );
    if (!hasQuickComments && !skipNotesPrompt) {
      setShowNotesPrompt(true);
      return;
    }
    void runAudit();
  }, [quickComments, showNotesPrompt, skipNotesPrompt, runAudit]);

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
  const review = detail?.review ?? null;
  const comparison = detail?.comparison ?? null;
  const effectiveResolution = detail?.effectiveResolution ?? null;
  const reviewAuditValue = review === null ? null : detail?.audits.find((item) => item.id === review.auditId)?.result ?? null;
  const reviewAuditResult: AuditResultType | null =
    AUDIT_RESULTS.find((result) => result === reviewAuditValue) ?? null;

  /**
   * Evidencia abierta en la pestaña central. Puede quedar en `null` aunque haya
   * un id guardado: si la evidencia se borra mientras está abierta, el visor
   * muestra el estado vacío en vez de romperse.
   */
  const viewingEvidence =
    viewingEvidenceId === null
      ? null
      : (evidences.find((item) => item.id === viewingEvidenceId) ?? null);

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
  const result = audit?.status === 'COMPLETED' ? audit.resultJson : null;
  const transcriptCount = evidences.filter((item) => item.transcript !== null).length;
  const findingCount = (result?.facts.length ?? 0) + (result?.audit.procedureChecks.length ?? 0);
  // ---------------------------------------------------------------- cronología
  // Se arman dos listas separadas porque no son lo mismo: los eventos de la
  // plataforma (se abrió el caso, se subieron archivos, corrió una auditoría) y
  // la cronología del cliente, que es la que el modelo extrae de la evidencia y
  // va desde la apertura de la matrícula hasta la cancelación de venta. Las
  // subidas dejan de ser un evento por archivo: ahora son una sola entrada.
  const systemEvents: TimelineEntry[] = [
    { id: 'case-created', time: formatDateTime(detail.case.createdAt), title: 'Expediente creado', body: `Se abrió el caso ${shortId(detail.case.id)}.` },
  ];

  const [firstEvidence] = evidences;
  if (firstEvidence !== undefined) {
    const firstUploadedAt = evidences.reduce(
      (earliest, item) => (item.createdAt < earliest ? item.createdAt : earliest),
      firstEvidence.createdAt,
    );
    systemEvents.push({
      id: 'evidences-uploaded',
      time: formatDateTime(firstUploadedAt),
      title: `Se subieron ${evidences.length} ${evidences.length === 1 ? 'evidencia' : 'evidencias'}`,
      body: evidences.map((item) => `${item.filename} · ${EVIDENCE_STATUS_LABELS[item.processingStatus]}`).join(' · '),
    });
  }

  for (const item of detail.audits) {
    systemEvents.push({
      id: `audit-${item.id}`,
      time: formatDateTime(item.createdAt),
      title: item.status === 'COMPLETED' ? 'Auditoría completada' : item.status === 'ERROR' ? 'Auditoría con error' : 'Auditoría en curso',
      body: item.result
        ? RESULT_LABELS[item.result as keyof typeof RESULT_LABELS] ?? item.result
        : item.errorCategory
          ? errorCategoryLabel(item.errorCategory)
          : `${item.provider} · ${item.model}`,
    });
  }

  if (review) {
    systemEvents.push({
      id: 'human-review',
      time: formatDateTime(review.createdAt),
      title: 'Resolución humana registrada',
      body: `${RESULT_LABELS[review.result]}${review.reviewerName ? ` · ${review.reviewerName}` : ''}`,
    });
  }

  const clientEvents: TimelineEntry[] = (result?.timeline ?? []).map((event, index) => ({
    id: `model-${index}`,
    time: textOrDash(event.date),
    title: event.event,
    body: `${event.evidenceIds.length} evidencia(s) relacionada(s)`,
  }));

  const timelineCount = systemEvents.length + clientEvents.length;

  // ----------------------------------------------------------------- búsqueda
  // Filtra sobre lo que el navegador ya tiene cargado: no pide nada al
  // servidor. Sólo la pestaña activa se filtra; las demás sólo informan cuántas
  // coincidencias tienen, para poder saltar a ellas.
  const needle = search.trim().toLowerCase();
  const hit = (text: string): boolean => needle === '' || text.toLowerCase().includes(needle);
  const searching = needle !== '';

  /** Lo buscable de un archivo de audio: su nombre y toda su transcripción. */
  const transcriptHaystack = (evidence: Evidence): string => {
    const segments = evidence.transcript?.speakers.map((segment) => `${segment.speaker} ${segment.text}`).join(' ') ?? '';
    return `${evidence.filename} ${segments} ${evidence.transcript?.transcript ?? ''}`;
  };

  const transcribedEvidences = evidences.filter((item) => item.transcript !== null);
  const visibleTranscripts = searching ? transcribedEvidences.filter((item) => hit(transcriptHaystack(item))) : transcribedEvidences;
  const visibleFacts = result === null ? [] : result.facts.filter((fact) => hit(`${fact.key} ${fact.label} ${formatFactValue(fact.value)} ${fact.evidenceText ?? ''}`));
  const visibleChecks = result === null ? [] : result.audit.procedureChecks.filter((check) => hit(`${check.procedureSection} ${check.status} ${check.criterion} ${check.reasoning}`));
  const visibleClientEvents = searching ? clientEvents.filter((event) => hit(`${event.time} ${event.title} ${event.body}`)) : clientEvents;
  const visibleSystemEvents = searching ? systemEvents.filter((event) => hit(`${event.time} ${event.title} ${event.body}`)) : systemEvents;

  const matchesFor = (tab: CaseDetailTab): number =>
    tab === 'transcript'
      ? visibleTranscripts.length
      : tab === 'findings'
        ? visibleFacts.length + visibleChecks.length
        : tab === 'timeline'
          ? visibleClientEvents.length + visibleSystemEvents.length
          : 0;

  const totalFor = (tab: CaseDetailTab): number =>
    tab === 'transcript' ? transcriptCount : tab === 'findings' ? findingCount : tab === 'timeline' ? timelineCount : 0;

  const visibleCount = matchesFor(activeTab);
  const otherMatches = SEARCHABLE_TABS.filter((tab) => tab !== activeTab && matchesFor(tab) > 0);

  const searchStatus = !searching
    ? ''
    : visibleCount === 0
      ? `Sin coincidencias para "${search.trim()}".`
      : `${visibleCount} de ${totalFor(activeTab)} coincidencias en ${TAB_LABELS[activeTab]}.`;

  let auditHint: string | null = null;
  if (evidences.length === 0) auditHint = 'Sube al menos una evidencia para poder auditar.';
  else if (hasFailedEvidence) auditHint = 'Hay evidencias con error. Elimínalas o vuelve a subirlas antes de auditar.';
  else if (hasTranscribing) auditHint = 'Las evidencias de audio se están transcribiendo. Podrás auditar cuando terminen.';
  else if (!allReady) auditHint = 'Aún hay evidencias sin procesar.';

  return (
    <div className="case-detail-page flex flex-col gap-4">
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

      <div className="case-detail-layout">
        <aside className="case-detail-evidence">
          <details className="case-detail-upload">
            <summary><span aria-hidden="true">+</span> Adjuntar evidencias</summary>
            <EvidenceUploader caseId={caseId} onUploaded={() => load()} disabled={Boolean(caseIsError)} />
          </details>
          <AreaQuickComments
            caseId={caseId}
            hasCompletedAudit={detail?.audit?.status === 'COMPLETED'}
            autoFocus={focusNotesRequest}
            initialComments={quickComments ?? undefined}
            onSaved={() => void loadQuickComments()}
          />
          <Panel
            title={`Evidencias (${evidences.length})`}
            description="Archivos originales y su estado de procesamiento."
            labelledBy="evidencias-caso"
          >
            <EvidenceList
              evidences={evidences}
              onOpen={(item) => {
                setViewingEvidenceId(item.id);
                setActiveTab('evidence');
              }}
              onDelete={(item) => setConfirmId(item.id)}
              onConfirmDelete={(item) => void handleDelete(item)}
              onCancelConfirm={() => setConfirmId(null)}
              deletingId={deletingId}
              confirmId={confirmId}
            />
          </Panel>
        </aside>

        <section className="case-detail-assessment">
          <nav className="case-detail-tabs" role="tablist" aria-label="Contenido del expediente">
            <button type="button" role="tab" aria-selected={activeTab === 'transcript'} onClick={() => setActiveTab('transcript')}>
              <AudioLines size={16} /> Transcripción <span>{searching ? `${visibleTranscripts.length}/${transcriptCount}` : transcriptCount}</span>
            </button>
            <button type="button" role="tab" aria-selected={activeTab === 'findings'} onClick={() => setActiveTab('findings')}>
              <BookOpenCheck size={16} /> Hechos y checks <span>{searching ? `${visibleFacts.length + visibleChecks.length}/${findingCount}` : findingCount}</span>
            </button>
            <button type="button" role="tab" aria-selected={activeTab === 'timeline'} onClick={() => setActiveTab('timeline')}>
              <Clock3 size={16} /> Cronología <span>{searching ? `${visibleClientEvents.length + visibleSystemEvents.length}/${timelineCount}` : timelineCount}</span>
            </button>
            <button type="button" role="tab" aria-selected={activeTab === 'verdict'} onClick={() => setActiveTab('verdict')}>
              <FileText size={16} /> Dictamen
            </button>
            {/* Solo existe mientras hay algo que ver: una pestaña de evidencia
                vacía sería un destino sin contenido detrás. */}
            {viewingEvidence !== null && (
              <button type="button" role="tab" aria-selected={activeTab === 'evidence'} onClick={() => setActiveTab('evidence')}>
                <Paperclip size={16} /> Evidencia <span>{viewingEvidence.filename}</span>
              </button>
            )}
            <div className="case-detail-search">
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                value={search}
                placeholder="Buscar en el expediente"
                aria-label="Buscar en el expediente"
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setSearch('');
                }}
              />
              {search !== '' && (
                <button type="button" className="case-detail-search-clear" onClick={() => setSearch('')}>
                  <span aria-hidden="true">×</span>
                  <span className="sr-only">Limpiar la búsqueda</span>
                </button>
              )}
            </div>
          </nav>

          {/* El estado de la búsqueda va fuera de la barra de pestañas porque
              aparece y desaparece; dentro de la barra competiría con las
              pestañas al repartir el ancho. */}
          <div className="case-detail-search-status" id="case-search-status" role="status">
            {searchStatus}
            {otherMatches.length > 0 && (
              <span className="case-detail-search-jumps">
                {' · '}También en{' '}
                {otherMatches.map((tab, index) => (
                  <span key={tab}>
                    {index > 0 && ', '}
                    <button type="button" onClick={() => setActiveTab(tab)}>{TAB_LABELS[tab]}</button>
                  </span>
                ))}
              </span>
            )}
          </div>

          <div className="case-detail-tab-content" role="tabpanel">
            {activeTab === 'transcript' && (
              <Panel title="Transcripción" description="Fragmentos extraídos del audio, con vínculo al archivo original.">
                {transcribedEvidences.length === 0 ? (
                  <div className="case-workspace-empty">
                    <AudioLines size={22} />
                    <strong>No hay transcripciones disponibles</strong>
                    <p>Cuando termine el procesamiento de un audio, su transcripción aparecerá aquí.</p>
                    {evidences.filter((item) => item.mimeType.startsWith('audio/')).length > 0 && <span>El audio todavía puede estar procesándose; revisa el estado en Evidencias.</span>}
                  </div>
                ) : visibleTranscripts.length === 0 ? (
                  <div className="case-workspace-empty">
                    <Search size={22} />
                    <strong>Ninguna transcripción coincide con la búsqueda</strong>
                    <p>Hay {transcriptCount} {transcriptCount === 1 ? 'archivo transcrito' : 'archivos transcritos'} en el expediente. La búsqueda sólo revisa el texto ya transcrito.</p>
                  </div>
                ) : visibleTranscripts.map((evidence) => (
                  <section className="case-transcript-file" key={evidence.id}>
                    <header>
                      <span><AudioLines size={16} /> {evidence.filename}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setViewingEvidenceId(evidence.id);
                          setActiveTab('evidence');
                        }}
                      >
                        Abrir evidencia
                      </button>
                    </header>
                    {evidence.transcript?.speakers.length ? evidence.transcript.speakers.map((segment, index) => (
                      <article className="case-transcript-segment" key={`${evidence.id}-${index}`}>
                        <span className="case-transcript-avatar" aria-hidden="true">{segment.speaker.slice(0, 2)}</span>
                        <div>
                          <div><strong>{segment.speaker}</strong><time>{formatDuration(segment.start)}</time></div>
                          <p>{segment.text}</p>
                        </div>
                      </article>
                    )) : (
                      <p className="case-transcript-plain">{evidence.transcript?.transcript || 'La transcripción no contiene texto.'}</p>
                    )}
                  </section>
                ))}
              </Panel>
            )}

            {activeTab === 'findings' && (
              <Panel title="Hechos y checks" description="Datos que el dictamen enlaza con evidencias y secciones del procedimiento.">
                {result === null ? <div className="case-workspace-empty"><FileCheck2 size={22} /><strong>Sin hallazgos de auditoría</strong><p>Los hechos y checks aparecerán cuando exista un dictamen completado.</p></div> : <div className="case-findings-content">
                  <section><h3>Hechos extraídos <span>{searching ? visibleFacts.length : result.facts.length}</span></h3>
                    {result.facts.length === 0 ? <p className="case-workspace-note">La auditoría no registró hechos estructurados.</p> : visibleFacts.length === 0 ? <p className="case-workspace-note">Ningún hecho coincide con la búsqueda.</p> : visibleFacts.map((fact) => (
                      <article className="case-finding-row" key={fact.key}><div><strong>{fact.label}</strong><span>{formatFactValue(fact.value)}</span></div><p>{fact.evidenceText ?? 'Sin cita textual guardada.'}</p><small>Confianza {formatPercent(fact.confidence)} · {fact.evidenceIds.length} evidencia(s)</small></article>
                    ))}
                  </section>
                  <section><h3>Checks del procedimiento <span>{searching ? visibleChecks.length : result.audit.procedureChecks.length}</span></h3>
                    {result.audit.procedureChecks.length === 0 ? <p className="case-workspace-note">La auditoría no registró checks para mostrar.</p> : visibleChecks.length === 0 ? <p className="case-workspace-note">Ningún check coincide con la búsqueda.</p> : visibleChecks.map((check, index) => (
                      <article className="case-check-row" key={`${check.procedureSection}-${index}`}><div><strong>{check.procedureSection}</strong><Badge tone={check.status === 'ACREDITADO' ? 'success' : check.status === 'NO_ACREDITADO' ? 'danger' : 'warning'}>{check.status.replaceAll('_', ' ')}</Badge></div><p>{check.criterion}</p><small>{check.reasoning}</small></article>
                    ))}
                  </section>
                </div>}
              </Panel>
            )}

            {activeTab === 'timeline' && (
              <Panel title="Cronología" description="La cronología del cliente, desde la apertura de la matrícula hasta la cancelación, y los eventos registrados por la plataforma.">
                {searching && visibleCount === 0 ? (
                  <div className="case-workspace-empty">
                    <Clock3 size={22} />
                    <strong>Ningún evento coincide con la búsqueda</strong>
                    <p>La búsqueda revisa las fechas, los títulos y las notas de los {timelineCount} eventos del expediente.</p>
                  </div>
                ) : (
                  <>
                    {/* La cronología del cliente va primero porque es la que
                        responde la pregunta del caso; los eventos de la
                        plataforma quedan debajo, como contexto de trazabilidad. */}
                    <section className="case-timeline-group">
                      <h3>Cronología del cliente <span>{visibleClientEvents.length}</span></h3>
                      {visibleClientEvents.length === 0 ? (
                        <p className="case-workspace-note">La extrae la auditoría de la evidencia: desde la apertura de la matrícula hasta la cancelación de venta. Aparece cuando hay un dictamen completado.</p>
                      ) : (
                        <ol className="case-timeline">
                          {visibleClientEvents.map((event) => (
                            <li key={event.id}><time>{event.time}</time><div><strong>{event.title}</strong><p>{event.body}</p></div></li>
                          ))}
                        </ol>
                      )}
                    </section>

                    <section className="case-timeline-group">
                      <h3>Eventos de la plataforma <span>{visibleSystemEvents.length}</span></h3>
                      {visibleSystemEvents.length === 0 ? (
                        <p className="case-workspace-note">Ningún evento de la plataforma coincide con la búsqueda.</p>
                      ) : (
                        <ol className="case-timeline">
                          {visibleSystemEvents.map((event) => (
                            <li key={event.id}>
                              <time>{event.time}</time>
                              <div>
                                <strong>{event.title}</strong>
                                {event.id === 'evidences-uploaded' ? (
                                  /* Una sola entrada para todas las subidas: los
                                     nombres de archivo quedan a un clic, porque la
                                     cronología es del caso y no un inventario. */
                                  <details className="case-timeline-files">
                                    <summary>Ver {evidences.length} {evidences.length === 1 ? 'archivo' : 'archivos'}</summary>
                                    <ul>
                                      {evidences.map((item) => (
                                        <li key={`evidence-${item.id}`}>
                                          <span title={item.filename}>{item.filename}</span>
                                          <span>{EVIDENCE_STATUS_LABELS[item.processingStatus]}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </details>
                                ) : (
                                  <p>{event.body}</p>
                                )}
                              </div>
                            </li>
                          ))}
                        </ol>
                      )}
                    </section>
                  </>
                )}
              </Panel>
            )}

            {activeTab === 'verdict' && searching && (
              <p className="case-search-note">
                La búsqueda no filtra el dictamen completo: es un bloque único y recortarlo lo dejaría incompleto sin avisar. Usa las pestañas de transcripción, hechos o cronología.
              </p>
            )}

            {activeTab === 'verdict' && (
              audit?.status === 'COMPLETED' ? <section className="case-detail-full-verdict"><h2>Dictamen original de IA</h2><AuditResultPanel audit={audit} /></section> : <Panel title="Dictamen original de IA"><div className="case-workspace-empty"><FileText size={22} /><strong>Aún no hay un dictamen completado</strong><p>Cuando la auditoría termine, el dictamen aparecerá aquí.</p></div></Panel>
            )}

            {activeTab === 'evidence' && (
              viewingEvidence === null ? (
                <div className="case-workspace-empty">
                  <Paperclip size={22} />
                  <strong>Elige una evidencia para verla aquí</strong>
                  <p>En la lista de la izquierda, pulsá "Ver" sobre un archivo para abrirlo en esta pestaña.</p>
                </div>
              ) : (
                <EvidencePane evidence={viewingEvidence} />
              )
            )}

            {activeTab === 'transcript' && auditHint !== null && <p className="case-audit-hint">{auditHint}</p>}
            {caseIsError && <p className="mt-3 text-sm text-danger">El caso está en estado de error. No se puede auditar hasta que se resuelva.</p>}
            {displayError !== null && <ErrorCard title={`Auditoría con error · ${errorCategoryLabel(displayError.category)}`} category={displayError.category} message={displayError.message} onRetry={() => void runAudit()} retrying={auditBusy} />}
          </div>
        </section>

      {/* ------------------------------------------------------ revisión
          El dictamen de arriba NO se modifica ni se oculta. La revisión humana
          va debajo, como una capa aparte: o existe (y entonces es la resolución
          final) o se ofrece el formulario para registrarla. Nunca ambas. */}
        <aside className="case-detail-review">
          <Panel title="Dictamen de IA" description="Resultado original de la auditoría.">
            {result === null ? <div className="case-verdict-pending"><span>—</span><strong>{audit?.status === 'RUNNING' ? 'Auditoría en curso' : 'Sin dictamen completado'}</strong><p>{audit?.status === 'RUNNING' ? 'El resultado aparecerá al terminar.' : 'Ejecuta la auditoría para revisar la propuesta del modelo.'}</p></div> : <div className="case-verdict-summary">
              <div><span className="case-verdict-confidence">{formatPercent(result.audit.confidence)}</span><span>Confianza declarada</span></div>
              <Badge tone={RESULT_TONE[result.audit.result]}>{RESULT_LABELS[result.audit.result]}</Badge>
              <p>{result.audit.reasoning}</p>
              <div className="case-verdict-section"><span>Sección</span><strong>{result.audit.procedureSection}</strong></div>
              <button type="button" onClick={() => setActiveTab('verdict')}>Abrir dictamen completo <span aria-hidden="true">→</span></button>
            </div>}
            <Button variant="primary" className="w-full" onClick={() => void maybeRunAudit()} disabled={!canAudit} loading={auditBusy} loadingLabel="Consultando auditoría">
              {auditPhase === 'waiting' ? 'Esperando transcripción…' : auditPhase === 'running' || auditPhase === 'starting' ? 'Auditando con IA…' : shouldShowReauditLabel ? 'Volver a auditar' : 'Auditar con IA'}
            </Button>

            {showNotesPrompt && (
              <section
                aria-label="Confirmación antes de auditar"
                aria-live="polite"
                className="mt-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm"
              >
                <p className="text-ink">
                  No hay notas de Back Office ni HelpDesk para este caso. La IA audita mejor con contexto de las áreas.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setShowNotesPrompt(false);
                      setFocusNotesRequest((n) => n + 1);
                    }}
                  >
                    Agregar notas ahora
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      setSkipNotesPrompt(true);
                      setShowNotesPrompt(false);
                      void runAudit();
                    }}
                  >
                    Auditar sin notas
                  </Button>
                </div>
              </section>
            )}

            {auditBusy && <p role="status" className="case-audit-progress"><Spinner label="Auditoría en curso" className="h-3.5 w-3.5" />{auditPhase === 'waiting' ? `Esperando transcripción de ${pendingEvidence.length} evidencia(s)…` : `Auditando… ${audit ? `${audit.provider}/${audit.model}` : ''}`}</p>}
          </Panel>
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
        </aside>
      </div>
    </div>
  );
}
