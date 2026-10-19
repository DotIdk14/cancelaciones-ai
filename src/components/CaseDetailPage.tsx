import { CaseAssignment } from './CaseAssignment';
import { CaseContextMenu, type ContextTab } from './CaseContextMenu';
import { EvidenceReferences } from './EvidenceReferences';
import { OperationProgressDialog } from './OperationProgressDialog';
import { ReportProblemModal } from './ReportProblemModal';
// =============================================================================
// Detalle de caso: evidencias, botón AUDITAR, polling y panel de resultado.
// Toda la verdad vive en el servidor; aquí solo se orquestan peticiones.
// =============================================================================

import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpenCheck, ChevronDown, ChevronUp, Clock3, FileCheck2, FileText, Paperclip, Search } from 'lucide-react';
import { deleteEvidence, getAreaComments, getCase, toErrorState, workflowStateOf } from '../lib/api';
import type { AppRole, AreaComment, CaseDetailResponse, ErrorState, Evidence, SessionSnapshot } from '../lib/api';
import { formatDateTime, formatLatency, formatPercent, formatFactValue, textOrDash } from '../lib/format';
import {
  RESULT_LABELS,
  EVIDENCE_STATUS_LABELS,
  errorCategoryLabel,
  errorCategoryMessage,
} from '../lib/labels';
import { goToCases } from '../lib/useHashRoute';
import { usePolling } from '../lib/usePolling';
import { AuditResultPanel } from './AuditResultPanel';
import { CaseReviewPanel } from './CaseReviewPanel';
import { AUDIT_RESULTS } from '../skills/audit/types';
import type { AuditResultType } from '../skills/audit/types';
import { EvidenceList } from './EvidenceList';
import { EvidenceUploader } from './EvidenceUploader';
import { AreaQuickComments } from './AreaQuickComments';
import { AUDIT_TRIGGER_ID, CycleStartDateCapture } from './CycleStartDateCapture';
import { EvidencePane } from './EvidencePane';
import { Badge, Button, ErrorCard, Panel, Spinner } from './ui';
import { AUTH_ERROR_MESSAGE, useCaseAuditWorkflow } from './useCaseAuditWorkflow';

type CaseDetailTab = 'findings' | 'timeline' | 'verdict' | 'evidence';

/**
 * Pestañas que el buscador puede filtrar. Fuera quedan dos, y por razones
 * distintas:
 *   · 'verdict' es un bloque único, no una colección, así que "filtrarlo" lo
 *     haría aparecer incompleto sin avisar.
 *   · 'evidence' muestra un archivo binario (imagen, PDF, audio). No hay texto
 *     que el buscador pueda reducir, así que contarla entre las coincidencias
 *     daría un número que nunca refleja lo que el operador está viendo.
 */
const SEARCHABLE_TABS = ['findings', 'timeline'] as const;

const TAB_LABELS: Record<CaseDetailTab, string> = {
  findings: 'Hechos considerados',
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
  evidenceIds?: string[];
}

/**
 * Detalle técnico del fallo, tal como lo sanitiza `audit-observability.ts`.
 *
 * No es el cuerpo crudo del modelo ni el expediente: es el `detail` que el
 * emisor del error atestiguó (un id de evidencia, un código de Zod) más la ruta
 * del campo y la categoría. Es lo que faltaba para actionar un
 * `INVALID_EVIDENCE_REFERENCE`: sin el id infractor, sólo quedaba el nombre del
 * error.
 */
interface FailureAttemptDetail {
  failureCategory: string | null;
  path: string | null;
  detail: string | null;
  latencyMs: number;
}

/** Un fallo por evidencia puede citar varias rutas; el mismo error se repite. */
const MAX_LISTED_ATTEMPTS = 4;
const EMPTY_EVIDENCES: Evidence[] = [];

/**
 * Detalle técnico de la auditoría fallida.
 *
 * Sólo se pinta cuando el caso está en error Y hay diagnósticos: si `path` o
 * `detail` no vienen (respuesta vieja, fila sin metadatos), se omiten en lugar de
 * inventar un guion bajo. Los campos ausentes se toleran porque `providerMetadata`
 * es un agregado del contrato, no la fuente de verdad del dictamen.
 */
function AuditFailureDetail({ attempts }: { attempts: FailureAttemptDetail[] }): ReactNode {
  const failed = attempts
    .filter((attempt) => attempt.failureCategory !== null)
    .slice(0, MAX_LISTED_ATTEMPTS);
  if (failed.length === 0) return null;

  return (
    <section aria-label="Detalle técnico del fallo" className="mt-3 rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm">
      <p className="font-semibold text-ink">Detalle técnico del fallo</p>
      <ul className="mt-2 space-y-2">
        {failed.map((attempt, index) => (
          <li key={`${attempt.failureCategory}-${index}`}>
            <p className="text-xs text-ink/70">
              Intento {index + 1} · {formatLatency(attempt.latencyMs)} · {errorCategoryLabel(attempt.failureCategory)}
            </p>
            <dl className="mt-1 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
              <dt className="font-mono text-xs text-danger/80">Categoría</dt>
              <dd className="font-mono text-xs text-ink">{attempt.failureCategory}</dd>
              {attempt.path !== null && (
                <>
                  <dt className="font-mono text-xs text-danger/80">Ruta</dt>
                  <dd className="font-mono text-xs text-ink">{attempt.path}</dd>
                </>
              )}
              {attempt.detail !== null && (
                <>
                  <dt className="font-mono text-xs text-danger/80">Detalle</dt>
                  <dd className="font-mono text-xs text-ink">{attempt.detail}</dd>
                </>
              )}
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}

export interface CaseDetailPageProps {
  caseId: string;
  /** Rol para PRESENTACIÓN. `null`/desconocido se trata como solo lectura. */
  role: AppRole | null;
  capabilities?: SessionSnapshot['capabilities'];
}

export function CaseDetailPage({ caseId, role, capabilities = { canReadAllCases: false, canReviewOwnCases: false, canFinalizeAnyCase: false, canWriteOwnedCases: false, canManageCases: false, canImportCases: false } }: CaseDetailPageProps): ReactNode {
  const loadGeneration = useRef(0);
  const loadedCaseId = useRef(caseId);
  const [progressOpen, setProgressOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [seekRequest, setSeekRequest] = useState<{ seconds: number; requestId: number } | null>(null);
  const [detail, setDetail] = useState<CaseDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ErrorState | null>(null);

  const auditWorkflow = useCaseAuditWorkflow({ caseId, setDetail });
  const { auditPhase, auditError, pendingEvidence, tickWaiting, tickRunning, observeLoadedCase } = auditWorkflow;

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
  const [activeTab, setActiveTab] = useState<CaseDetailTab>('evidence');
  const [search, setSearch] = useState('');
  const [evidenceUploaderOpen, setEvidenceUploaderOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [contextTab, setContextTab] = useState<ContextTab>('data');

  const [quickComments, setQuickComments] = useState<AreaComment[] | null>(null);
  const [showNotesPrompt, setShowNotesPrompt] = useState(false);
  const [skipNotesPrompt, setSkipNotesPrompt] = useState(false);
  const [focusNotesRequest, setFocusNotesRequest] = useState(0);

  // ---------------------------------------------------------------- carga

  const load = useCallback(async (): Promise<void> => {
    const generation = loadGeneration.current;
    try {
      const data = await getCase(caseId);
      if (generation !== loadGeneration.current || loadedCaseId.current !== caseId) return;
      setViewingEvidenceId((currentId) =>
        currentId !== null && data.evidences.some((item) => item.id === currentId)
          ? currentId
          : data.evidences[0]?.id ?? null,
      );
      setDetail(data);
      setLoadError(null);
      observeLoadedCase(data);
    } catch (err) {
      if (generation !== loadGeneration.current || loadedCaseId.current !== caseId) return;
      const state = toErrorState(err);
      // Si el servidor devuelve 401, mostrar mensaje amigable en modo demo.
      const message = state.category === 'AUTH_ERROR' ? AUTH_ERROR_MESSAGE : state.message;
      setLoadError({ category: state.category, message });
    } finally {
      if (generation === loadGeneration.current && loadedCaseId.current === caseId) setLoading(false);
    }
  }, [caseId, observeLoadedCase]);

  const loadQuickComments = useCallback(async (): Promise<void> => {
    const generation = loadGeneration.current;
    try {
      const comments = await getAreaComments(caseId);
      if (generation !== loadGeneration.current || loadedCaseId.current !== caseId) return;
      setQuickComments(comments);
    } catch {
      // Si no se puede consultar, se trata como "no se puede determinar":
      // el prompt se muestra igual y el usuario decide.
    }
  }, [caseId]);

  useEffect(() => {
    loadGeneration.current += 1;
    loadedCaseId.current = caseId;
    setSeekRequest(null);
    setProgressOpen(false);
    setReportOpen(false);
    setLoading(true);
    setDetail(null);
    setActionError(null);
    setConfirmId(null);
    setViewingEvidenceId(null);
    setActiveTab('evidence');
    setEvidenceUploaderOpen(false);
    setContextOpen(false);
    setContextTab('data');
    setSearch('');
    setQuickComments(null);
    setShowNotesPrompt(false);
    setSkipNotesPrompt(false);
    setFocusNotesRequest(0);
    void load();
    void loadQuickComments();
    return () => { loadGeneration.current += 1; };
  }, [caseId, load, loadQuickComments]);

  // --------------------------------------------------------------- auditoría
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
    setShowNotesPrompt(false);
    setProgressOpen(true);
    void auditWorkflow.recoverAudit();
  }, [quickComments, showNotesPrompt, skipNotesPrompt, auditWorkflow]);

  const evidences = detail?.evidences ?? EMPTY_EVIDENCES;
  const audit = detail?.audit ?? null;
  const review = detail?.review ?? null;
  const comparison = detail?.comparison ?? null;
  const effectiveResolution = detail?.effectiveResolution ?? null;
  const workflowState = detail?.workflowState ?? workflowStateOf(review);
  /**
   * Rol de SOLO LECTURA para la presentación: el Gerente (y un rol no resuelto)
   * no ve controles de mutación. El servidor sigue siendo la frontera real.
   */
  const readOnly = detail?.case.canWrite !== true;
  const canUploadEvidence = !readOnly && detail?.canUploadEvidence !== false;
  const canDeleteEvidence = !readOnly && detail?.canDeleteEvidence !== false;
  const canEditAuditContext = !readOnly && detail?.canEditAuditContext !== false;
  const canRunAudit = !readOnly && detail?.canRunAudit !== false;
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
  const canAudit = allReady && !auditBusy;
  const shouldShowReauditLabel = detail?.case.status === 'READY' && allReady && hasCompletedAudit;

  // Mientras hay transcripciones en curso se refresca el caso cada 3 s.
  // En fase `waiting` el poll de auditoría ya trae los mismos datos, así que
  // se evita duplicar peticiones.
  usePolling(load, hasTranscribing && auditPhase !== 'waiting' ? auditWorkflow.transcriptionPollMs : null);
  usePolling(tickWaiting, auditPhase === 'waiting' ? auditWorkflow.transcriptionPollMs : null);
  usePolling(tickRunning, auditPhase === 'running' ? auditWorkflow.auditPollMs : null);

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
  const result = audit?.status === 'COMPLETED' && detail?.auditIsCurrent !== false ? audit.resultJson : null;
  const findingCount = (result?.facts.length ?? 0) + (result?.audit.procedureChecks.length ?? 0);
  // ---------------------------------------------------------------- cronología
  // Se arman dos listas separadas porque no son lo mismo: los eventos de la
  // plataforma (se abrió el caso, se subieron archivos, corrió una auditoría) y
  // la cronología del cliente, que es la que el modelo extrae de la evidencia y
  // va desde la apertura de la matrícula hasta la cancelación de venta. Las
  // subidas dejan de ser un evento por archivo: ahora son una sola entrada.
  const systemEvents: TimelineEntry[] = [
    { id: 'case-created', time: formatDateTime(detail.case.createdAt), title: 'Expediente creado', body: `Se abrió el caso ${detail.case.studentIdentifier ?? 'sin matrícula'}${detail.case.studentName ? ` · ${detail.case.studentName}` : ''}.` },
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

  const systemDates: Record<string, string> = { 'case-created': detail.case.createdAt, 'human-review': review?.createdAt ?? '', 'evidences-uploaded': evidences.map(item => item.createdAt).sort()[0] ?? '' };
  for (const item of detail.audits) systemDates[`audit-${item.id}`] = item.createdAt;
  systemEvents.sort((a, b) => (Date.parse(systemDates[a.id] ?? '') || 0) - (Date.parse(systemDates[b.id] ?? '') || 0));
  const clientEvents: TimelineEntry[] = [...(result?.timeline ?? [])].sort((a, b) => {
    const time = (date: string | null) => date && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(date) && Number.isFinite(Date.parse(date)) ? Date.parse(date) : Infinity;
    return time(a.date) - time(b.date);
  }).map((event, index) => ({
    id: `model-${index}`,
    time: textOrDash(event.date),
    title: event.event,
    body: `${event.date ? 'Fecha registrada por IA; consultar fuente' : 'Fecha no determinada'} · ${event.evidenceIds.length ? 'Con referencia documental; verificar incertidumbres en la fuente' : 'Sin referencia documental guardada'}`,
    evidenceIds: event.evidenceIds,
  }));

  const timelineCount = systemEvents.length + clientEvents.length;

  // ----------------------------------------------------------------- búsqueda
  // Filtra sobre lo que el navegador ya tiene cargado: no pide nada al
  // servidor. Sólo la pestaña activa se filtra; las demás sólo informan cuántas
  // coincidencias tienen, para poder saltar a ellas.
  const needle = search.trim().toLowerCase();
  const hit = (text: string): boolean => needle === '' || text.toLowerCase().includes(needle);
  const searching = needle !== '';

  const visibleFacts = result === null ? [] : result.facts.filter((fact) => hit(`${fact.key} ${fact.label} ${formatFactValue(fact.value)} ${fact.evidenceText ?? ''}`));
  const visibleChecks = result === null ? [] : result.audit.procedureChecks.filter((check) => hit(`${check.procedureSection} ${check.status} ${check.criterion} ${check.reasoning}`));
  const visibleClientEvents = searching ? clientEvents.filter((event) => hit(`${event.time} ${event.title} ${event.body}`)) : clientEvents;
  const visibleSystemEvents = searching ? systemEvents.filter((event) => hit(`${event.time} ${event.title} ${event.body}`)) : systemEvents;

  const matchesFor = (tab: CaseDetailTab): number =>
    tab === 'findings'
        ? visibleFacts.length + visibleChecks.length
      : tab === 'timeline'
        ? visibleClientEvents.length + visibleSystemEvents.length
        : 0;

  const totalFor = (tab: CaseDetailTab): number =>
    tab === 'findings' ? findingCount : tab === 'timeline' ? timelineCount : 0;

  const visibleCount = matchesFor(activeTab);
  const otherMatches = SEARCHABLE_TABS.filter((tab) => tab !== activeTab && matchesFor(tab) > 0);

  const searchStatus = !searching
    ? ''
    : activeTab === 'evidence' || activeTab === 'verdict'
      ? 'La búsqueda filtra Hechos y Cronología.'
    : visibleCount === 0
      ? `Sin coincidencias para "${search.trim()}".`
      : `${visibleCount} de ${totalFor(activeTab)} coincidencias en ${TAB_LABELS[activeTab]}.`;

  let auditHint: string | null = null;
  if (evidences.length === 0) auditHint = 'Sube al menos una evidencia para poder auditar.';
  else if (hasFailedEvidence) auditHint = 'Hay evidencias con error. Elimínalas o vuelve a subirlas antes de auditar.';
  else if (hasTranscribing) auditHint = 'Las evidencias de audio se están transcribiendo. Podrás auditar cuando terminen.';
  else if (!allReady) auditHint = 'Aún hay evidencias sin procesar.';

  const notesContent = (<>
          <AreaQuickComments
            caseId={caseId}
            hasCompletedAudit={detail?.audit?.status === 'COMPLETED'}
            autoFocus={focusNotesRequest}
            initialComments={quickComments ?? undefined}
            onSaved={() => void loadQuickComments()}
            readOnly={!canEditAuditContext}
          />
          {/* La fecha de inicio es un dato humano con procedencia, no evidencia:
              vive junto a las notas de las áreas, antes del dictamen, y nunca
              se audita sola. */}
          <CycleStartDateCapture
            caseId={caseId}
            assessment={result?.temporalAnalysis ?? null}
            cycleStartDate={detail.case.cycleStartDate ?? null}
            cycleStartDateByName={detail.case.cycleStartDateByName ?? null}
            cycleStartDateAt={detail.case.cycleStartDateAt ?? null}
            readOnly={!canEditAuditContext}
            onSaved={() => void load()}
          />
  </>);
  const reviewContent = (<>
          <CaseReviewPanel
            caseId={caseId}
            audit={detail.auditIsCurrent === false && review === null ? null : audit}
            review={review}
            comparison={comparison}
            effectiveResolution={effectiveResolution}
            reviewAuditResult={reviewAuditResult}
            evidenceNames={Object.fromEntries(evidences.map((evidence) => [evidence.id, evidence.filename]))}
            workflowState={workflowState}
            role={role}
            canReviewOwnCase={capabilities.canReviewOwnCases && detail.case.canWrite}
            canFinalizeAnyCase={capabilities.canFinalizeAnyCase}
            canChangeResolution={capabilities.canFinalizeAnyCase}
            canAddComments={capabilities.canFinalizeAnyCase}
            caseCountry={detail.case.country ?? null}
            caseChannel={detail.case.channel ?? null}
            onSubmitted={() => void load()}
          />
  </>);
  const auditAction = !readOnly && (
              <Button id={AUDIT_TRIGGER_ID} variant="primary" className="shrink-0" onClick={() => { setContextOpen(false); void maybeRunAudit(); }} disabled={!canAudit || !canRunAudit} loading={auditBusy} loadingLabel="Consultando auditoría">
                {auditPhase === 'waiting' ? 'Esperando transcripción…' : auditPhase === 'running' || auditPhase === 'starting' ? 'Auditando con IA…' : caseIsError ? 'Reintentar auditoría' : shouldShowReauditLabel ? 'Volver a auditar' : 'Auditar con IA'}
              </Button>
              );
  const auditControls = (<>
            {readOnly && (
              <p role="status" className="text-xs text-muted">
                Solo lectura: no tienes permiso para ejecutar ni modificar este expediente.
              </p>
            )}

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
                      setContextOpen(true);
                      setContextTab('data');
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
                      setProgressOpen(true);
                      void auditWorkflow.recoverAudit();
                    }}
                  >
                    Auditar sin notas
                  </Button>
                </div>
              </section>
            )}

            {auditBusy && <p role="status" className="case-audit-progress"><Spinner label="Auditoría en curso" className="h-3.5 w-3.5" />{auditPhase === 'waiting' ? `Esperando transcripción de ${pendingEvidence.length} evidencia(s)…` : `Auditando… ${audit ? `${audit.provider}/${audit.model}` : ''}`}</p>}
  </>);

  return (
    <div className="case-detail-page flex flex-col gap-4">
      <header className="case-workspace-header">
        <div><button type="button" onClick={goToCases} className="case-workspace-back">← Volver a casos</button><h1>{detail.case.studentIdentifier || 'Sin matrícula'}<span>{detail.case.externalCaseId ? ` · ${detail.case.externalCaseId}` : ''}</span></h1></div>
        <div className="case-workspace-actions justify-end"><Button aria-expanded={contextOpen} aria-controls="case-context-slot" onClick={() => setContextOpen(!contextOpen)}>{contextOpen ? 'Cerrar contexto' : 'Ver datos y dictamen'}</Button><Button onClick={() => void load()} loading={loading} loadingLabel="Actualizando">Actualizar</Button>{auditAction}</div>
      </header>
      <div className="case-workspace-audit-actions">{auditControls}</div>


      {(auditBusy || auditError) && <Button variant="secondary" onClick={() => setProgressOpen(true)}>Ver progreso de auditoría</Button>}
      {progressOpen && !reportOpen && <OperationProgressDialog title="Progreso de auditoría" stages={[
        { label: 'Evidencias disponibles', status: auditPhase === 'waiting' ? 'current' : allReady ? 'done' : hasFailedEvidence ? 'error' : 'pending', detail: auditPhase === 'waiting' ? `Esperando ${pendingEvidence.length} evidencia(s)` : undefined },
        { label: 'Preparación, evaluación y validación de IA', status: auditError ? 'error' : auditBusy && auditPhase !== 'waiting' ? 'current' : audit?.status === 'COMPLETED' ? 'done' : 'pending' },
        { label: 'Dictamen vigente guardado', status: !auditBusy && !auditError && detail.auditIsCurrent !== false && audit?.status === 'COMPLETED' ? 'done' : 'pending' },
      ]} error={auditError} onClose={() => setProgressOpen(false)} onRetry={readOnly ? undefined : () => void auditWorkflow.recoverAudit()} onReport={() => setReportOpen(true)}><AuditFailureDetail attempts={audit?.providerMetadata?.openrouterAttempts ?? []} /></OperationProgressDialog>}
      {reportOpen && <ReportProblemModal initialDescription={`Problema durante la auditoría. Código: ${auditError?.category ?? audit?.errorCategory ?? 'sin código'}. Referencia: ${auditError?.correlationId ?? audit?.id ?? 'sin referencia'}.`} module="Expedientes" context={{ route: `#/casos/${caseId}`, correlationId: auditError?.correlationId }} onClose={() => setReportOpen(false)} />}
      {loadError !== null && (
        <ErrorCard message={loadError.message} category={loadError.category} onRetry={() => void load()} />
      )}
      {actionError !== null && <ErrorCard message={actionError.message} category={actionError.category} />}

      {detail.case.mergedIntoCaseId && <Panel title="Expediente consolidado"><p className="text-sm text-muted">Este registro conserva el historial de una ficha duplicada. Continúa en el <a className="text-brand underline" href={'#/casos/' + detail.case.mergedIntoCaseId}>expediente principal</a>.</p></Panel>}
      {capabilities.canImportCases && !detail.case.mergedIntoCaseId && <CaseAssignment key={caseId + ':' + detail.case.assignedTo} caseId={caseId} assignedTo={detail.case.assignedTo ?? null} finalized={(detail.reviews ?? []).some(item => item.coordinatorDecision != null) || workflowStateOf(detail.review) === 'FINALIZED'} onSaved={load} />}
      <div className={`case-workspace${contextOpen ? ' case-workspace-context-open' : ''}`}>
        <div className="case-context-slot">
          <CaseContextMenu key={caseId} detail={detail} open={contextOpen} tab={contextTab} onTabChange={setContextTab} onClose={() => setContextOpen(false)} notesContent={notesContent} reviewContent={reviewContent} canReconcile={capabilities.canFinalizeAnyCase} />
        </div>
      <div className="case-detail-layout case-detail-workspace">
        <aside className="case-detail-evidence">
          <Panel title={`Evidencias (${evidences.length})`} description="Selecciona un archivo para revisarlo en el expediente.">
            <EvidenceList
              evidences={evidences}
              activeId={viewingEvidenceId}
              onSelect={(id) => {
                setSeekRequest(null);
                setViewingEvidenceId(id);
                setActiveTab('evidence');
              }}
              onDelete={(item) => setConfirmId(item.id)}
              onConfirmDelete={(item) => void handleDelete(item)}
              onCancelConfirm={() => setConfirmId(null)}
              deletingId={deletingId}
              confirmId={confirmId}
              readOnly={!canDeleteEvidence}
            />
          </Panel>
          {canUploadEvidence ? (
            <div className="case-detail-upload">
              <button
                type="button"
                className="case-detail-upload-trigger"
                aria-expanded={evidenceUploaderOpen}
                aria-controls="evidence-uploader-panel"
                onClick={() => setEvidenceUploaderOpen((open) => !open)}
              >
                Adjuntar evidencias
                {evidenceUploaderOpen ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
              </button>
              <div id="evidence-uploader-panel" className="case-detail-upload-panel" hidden={!evidenceUploaderOpen}>
                <EvidenceUploader caseId={caseId} onUploaded={() => load()} />
              </div>
            </div>
          ) : !readOnly ? (
            <p className="case-context-note">La evidencia queda bloqueada después de la resolución del Asesor, salvo cuando su resolución indica evidencia insuficiente.</p>
          ) : null}
        </aside>

        <section className="case-detail-assessment">
          <nav className="case-detail-tabs" role="tablist" aria-label="Contenido del expediente">
            <button type="button" role="tab" aria-selected={activeTab === 'evidence'} onClick={() => setActiveTab('evidence')}>
              <Paperclip size={16} /> Evidencias <span>{evidences.length}</span>
            </button>
            <button type="button" role="tab" aria-selected={activeTab === 'findings'} onClick={() => setActiveTab('findings')}>
              <BookOpenCheck size={16} /> Hechos <span>{searching ? `${visibleFacts.length + visibleChecks.length}/${findingCount}` : findingCount}</span>
            </button>
            <button type="button" role="tab" aria-selected={activeTab === 'timeline'} onClick={() => setActiveTab('timeline')}>
              <Clock3 size={16} /> Cronología <span>{searching ? `${visibleClientEvents.length + visibleSystemEvents.length}/${timelineCount}` : timelineCount}</span>
            </button>
            <button type="button" role="tab" aria-selected={activeTab === 'verdict'} onClick={() => setActiveTab('verdict')}>
              <FileText size={16} /> Dictamen
            </button>
            <div className="case-detail-search">
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                value={search}
                placeholder="Buscar hechos o cronología"
                aria-label="Buscar hechos o cronología"
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
            {activeTab === 'findings' && (
              <Panel title="Hechos considerados" description="Hechos registrados por IA y su sustento. La confianza declarada no equivale a comprobación; los criterios muestran su relación con el procedimiento V5.">
                {result === null ? <div className="case-workspace-empty"><FileCheck2 size={22} /><strong>Sin hallazgos de auditoría</strong><p>Los hechos y checks aparecerán cuando exista un dictamen completado.</p></div> : <div className="case-findings-content">
                  <section><h3>Hechos extraídos <span>{searching ? visibleFacts.length : result.facts.length}</span></h3>
                    {result.facts.length === 0 ? <p className="case-workspace-note">La auditoría no registró hechos estructurados.</p> : visibleFacts.length === 0 ? <p className="case-workspace-note">Ningún hecho coincide con la búsqueda.</p> : visibleFacts.map((fact) => (
                      <article className="case-finding-row" key={fact.key}><div><strong>{fact.label}</strong><span>{formatFactValue(fact.value)}</span></div><p>{fact.evidenceText ?? 'Sin cita textual guardada.'}</p><EvidenceReferences text={fact.evidenceText ?? ''} evidenceIds={fact.evidenceIds} evidences={evidences} onOpen={(id, seconds) => { setViewingEvidenceId(id); setActiveTab('evidence'); setSeekRequest(seconds === null ? null : { seconds, requestId: Date.now() }); }} /><small>{fact.value === null ? 'Información no determinada' : 'Hecho registrado por IA; el assessment no clasifica comprobación o inferencia'} · Confianza {formatPercent(fact.confidence)} · {fact.evidenceIds.length} evidencia(s)</small>{result.audit.procedureChecks.filter(check => check.evidenceIds?.some(id => fact.evidenceIds.includes(id))).map((check, index) => <p key={index}>Criterio con evidencia compartida · {check.procedureSection}: {check.reasoning}</p>)}</article>
                    ))}
                  </section>
                  <section><h3>Checks del procedimiento <span>{searching ? visibleChecks.length : result.audit.procedureChecks.length}</span></h3>
                    {result.audit.procedureChecks.length === 0 ? <p className="case-workspace-note">La auditoría no registró checks para mostrar.</p> : visibleChecks.length === 0 ? <p className="case-workspace-note">Ningún check coincide con la búsqueda.</p> : visibleChecks.map((check, index) => (
                      <article className="case-check-row" key={`${check.procedureSection}-${index}`}><div><strong>{check.procedureSection}</strong><Badge tone={check.status === 'ACREDITADO' ? 'success' : check.status === 'NO_ACREDITADO' ? 'danger' : 'warning'}>{check.status.replaceAll('_', ' ')}</Badge></div><p>{check.criterion}</p><small>{check.reasoning}</small><EvidenceReferences text={check.reasoning} evidenceIds={check.evidenceIds} evidences={evidences} onOpen={(id, seconds) => { setViewingEvidenceId(id); setActiveTab('evidence'); setSeekRequest(seconds === null ? null : { seconds, requestId: Date.now() }); }} /></article>
                    ))}
                  </section>
                  <section><h3>Información faltante declarada</h3>{result.audit.missingEvidence?.length ? result.audit.missingEvidence.map((item, index) => <article className="case-check-row" key={index}><strong>{item.title}</strong><p>{item.reason}</p><small>{item.acceptedEvidence.join(' · ')}</small></article>) : <p className="case-workspace-note">Sin faltantes registrados en esta auditoría.</p>}</section>
                  <section><h3>Incertidumbres y discrepancias registradas</h3>{result.conflicts.length ? result.conflicts.map((conflict, index) => <p key={index}>{conflict.description}</p>) : <p className="case-workspace-note">Sin discrepancias registradas.</p>}</section>
                </div>}
              </Panel>
            )}

            {activeTab === 'timeline' && (
              <Panel title="Cronología" description="Eventos de evidencias y registros de plataforma separados. Ingreso de matrícula e inicio real de clases son fechas distintas. Las fechas no determinables quedan al final.">
                {result?.temporalAnalysis && <section className="case-timeline-group"><h3>Inicio académico considerado en el dictamen</h3><p className="case-workspace-note">{result.temporalAnalysis.cycleStartDate ?? 'Fecha no determinable'} · {result.temporalAnalysis.cycleStartEvidenceText ?? 'Sin cita de inicio académico guardada'}</p><EvidenceReferences text={result.temporalAnalysis.cycleStartEvidenceText ?? ''} evidenceIds={result.temporalAnalysis.cycleStartEvidenceIds} evidences={evidences} onOpen={(id, seconds) => { setViewingEvidenceId(id); setActiveTab('evidence'); setSeekRequest(seconds === null ? null : { seconds, requestId: Date.now() }); }} /></section>}
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
                            <li key={event.id}><time>{event.time}</time><div><strong>{event.title}</strong><p>{event.body}</p><EvidenceReferences text={event.title} evidenceIds={event.evidenceIds ?? []} evidences={evidences} onOpen={(id, seconds) => { setViewingEvidenceId(id); setActiveTab('evidence'); setSeekRequest(seconds === null ? null : { seconds, requestId: Date.now() }); }} /></div></li>
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
                La búsqueda no filtra el dictamen completo: es un bloque único y recortarlo lo dejaría incompleto sin avisar. Usa las pestañas de hechos o cronología.
              </p>
            )}

            {activeTab === 'verdict' && (
              audit?.status === 'COMPLETED' && detail.auditIsCurrent !== false ? <section className="case-detail-full-verdict"><h2>Dictamen original de IA</h2><AuditResultPanel audit={audit} canEditComments={canEditAuditContext} /></section> : <Panel title="Dictamen original de IA"><div className="case-workspace-empty"><FileText size={22} /><strong>No hay un dictamen vigente</strong><p>La evidencia cambió o aún no se ha evaluado. Consulta el historial para ver resultados anteriores y vuelve a auditar para obtener el vigente.</p><Button variant="secondary" onClick={() => { setContextOpen(true); setContextTab('verdict'); }}>Consultar historial de auditorías</Button></div></Panel>
            )}

            {activeTab === 'evidence' && (
              <div className="case-evidence-viewer-region">
                {viewingEvidence !== null ? (
                  <EvidencePane seekRequest={seekRequest} evidence={viewingEvidence} studentName={detail.case.studentName} />
                ) : (
                  <div className="case-workspace-empty"><Paperclip size={22} /><strong>Sin evidencias</strong><p>Adjunta una evidencia para verla aquí.</p></div>
                )}
              </div>
            )}

            {activeTab === 'evidence' && auditHint !== null && <p className="case-audit-hint">{auditHint}</p>}
            {caseIsError && (
              <p className="mt-3 text-sm text-danger">
                {hasFailedEvidence
                  ? 'Hay evidencias con error. Elimínalas y vuelve a subir los archivos originales antes de auditar.'
                  : 'La operación anterior falló. Revisa las evidencias y vuelve a auditar; el servidor controla los reintentos y la cuota.'}
              </p>
            )}
            {displayError !== null && <ErrorCard title={`Auditoría con error · ${errorCategoryLabel(displayError.category)}`} category={displayError.category} message={displayError.message} onRetry={readOnly ? undefined : () => { setProgressOpen(true); void auditWorkflow.recoverAudit(); }} retrying={auditBusy} />}
            {/* El `ErrorCard` explica el error en lenguaje llano; este panel da
                el "dónde" y el "qué": sin él, un `INVALID_EVIDENCE_REFERENCE` sólo
                decía que el modelo falló, no qué campo ni qué evidencia. */}
            {displayError !== null && (
              <AuditFailureDetail attempts={audit?.providerMetadata?.openrouterAttempts ?? []} />
            )}
          </div>
        </section>

      {/* ------------------------------------------------------ revisión
          El dictamen de arriba NO se modifica ni se oculta. La revisión humana
          va debajo, como una capa aparte: o existe (y entonces es la resolución
          final) o se ofrece el formulario para registrarla. Nunca ambas. */}

      </div>
      </div>
    </div>
  );
}


