// =============================================================================
// Listado de casos. Los filtros se aplican a datos que ya entrega la API; la
// página no inventa categorías de auditoría ni altera las resoluciones.
// =============================================================================

import type { KeyboardEvent, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, CircleCheck, FileText, Files, FlaskConical, Search, Trash2, TriangleAlert, Undo2, X } from 'lucide-react';
import { deleteCaseAudit, deleteCaseDraft, listCasePage, setCaseTestFlag, toErrorState } from '../lib/api';
import type { CaseSummary } from '../lib/api';
import { formatDateTime, shortId } from '../lib/format';
import { isLocalDashboardPreview } from '../lib/local-dashboard-preview';
import { getLocalPreviewCases } from '../lib/local-ui-preview';
import {
  CASE_STATUS_LABELS,
  CASE_STATUS_TONE,
  RESOLUTION_SOURCE_DESCRIPTIONS,
  RESOLUTION_SOURCE_LABELS,
  caseKindLabel,
  caseKindTone,
  resolutionLabel,
  resolutionTone,
} from '../lib/labels';
import type { CaseStatus } from '../skills/audit/types';
import { Badge, Button, EmptyState, ErrorCard, Spinner } from './ui';

const AUTH_ERROR_MESSAGE = 'El servidor requiere autenticación. La interfaz está en modo demo: los datos no se cargarán hasta que configure una sesión válida.';

const STATUS_FILTERS: ReadonlyArray<{ value: CaseStatus | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'Todos' },
  { value: 'READY', label: 'Listos para auditar' },
  { value: 'AUDITING', label: 'En curso' },
  { value: 'COMPLETED', label: 'Completados' },
  { value: 'DRAFT', label: 'Borradores' },
  { value: 'ERROR', label: 'Errores' },
];

function StatusTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`case-status-tab ${active ? 'case-status-tab-active' : ''}`}
    >
      {label}<span className="case-status-count">{count}</span>
    </button>
  );
}

function selectOnKeyboard(event: KeyboardEvent<HTMLTableRowElement>, select: () => void): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    select();
  }
}

export function CasesPanel({ canReadAllCases = false }: { canReadAllCases?: boolean }): ReactNode {
  const preview = isLocalDashboardPreview();
  const [cases, setCases] = useState<CaseSummary[] | null>(() => preview ? getLocalPreviewCases() : null);
  const [loading, setLoading] = useState(!preview);
  const [listError, setListError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [statusCounts, setStatusCounts] = useState<Record<CaseStatus | 'ALL', number> | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<CaseStatus | 'ALL'>('ALL');
  const [creatorRole, setCreatorRole] = useState<'user' | 'coordinator' | 'ALL'>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedCaseIds, setSelectedCaseIds] = useState<Set<string>>(() => new Set());
  const [adminPending, setAdminPending] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    if (preview) {
      setCases(getLocalPreviewCases());
      setNextCursor(null);
      setListError(null);
      setLoading(false);
      return;
    }
    const currentRequest = ++requestId.current;
    setLoading(true);
    try {
      const page = await listCasePage({ status: statusFilter, creatorRole, limit: 50 });
      if (currentRequest !== requestId.current) return;
      setCases(page.cases);
      setNextCursor(page.nextCursor);
      if (page.statusCounts) setStatusCounts(page.statusCounts);
      setListError(null);
    } catch (err) {
      if (currentRequest !== requestId.current) return;
      const state = toErrorState(err);
      setListError(state.category === 'AUTH_ERROR' ? AUTH_ERROR_MESSAGE : state.message);
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [creatorRole, preview, statusFilter]);

  const loadAllForSearch = useCallback(async (): Promise<void> => {
    if (preview) return;
    const currentRequest = ++requestId.current;
    setLoading(true);
    try {
      const first = await listCasePage({ status: statusFilter, creatorRole, limit: 50 });
      const all = [...first.cases];
      let cursor = first.nextCursor;
      while (cursor) {
        const page = await listCasePage({ status: statusFilter, creatorRole, cursor, limit: 50 });
        all.push(...page.cases);
        cursor = page.nextCursor;
      }
      if (currentRequest !== requestId.current) return;
      setCases(all);
      setNextCursor(null);
      if (first.statusCounts) setStatusCounts(first.statusCounts);
      setListError(null);
    } catch (err) {
      if (currentRequest !== requestId.current) return;
      const state = toErrorState(err);
      setListError(state.category === 'AUTH_ERROR' ? AUTH_ERROR_MESSAGE : state.message);
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [creatorRole, preview, statusFilter]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (!nextCursor || preview) return;
    const currentRequest = ++requestId.current;
    setLoading(true);
    try {
      const page = await listCasePage({ status: statusFilter, creatorRole, cursor: nextCursor, limit: 50 });
      if (currentRequest !== requestId.current) return;
      setCases((current) => [...(current ?? []), ...page.cases]);
      setNextCursor(page.nextCursor);
      setListError(null);
    } catch (err) {
      if (currentRequest !== requestId.current) return;
      const state = toErrorState(err);
      setListError(state.category === 'AUTH_ERROR' ? AUTH_ERROR_MESSAGE : state.message);
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [creatorRole, nextCursor, preview, statusFilter]);

  const loadAll = useCallback(async (): Promise<void> => {
    if (preview || !nextCursor) return;
    const currentRequest = ++requestId.current;
    setLoading(true);
    try {
      const all = [...(cases ?? [])];
      let cursor: string | null = nextCursor;
      while (cursor) {
        const page = await listCasePage({ status: statusFilter, creatorRole, cursor, limit: 50 });
        all.push(...page.cases);
        cursor = page.nextCursor;
      }
      if (currentRequest !== requestId.current) return;
      setCases(all);
      setNextCursor(null);
      setListError(null);
    } catch (err) {
      if (currentRequest !== requestId.current) return;
      const state = toErrorState(err);
      setListError(state.category === 'AUTH_ERROR' ? AUTH_ERROR_MESSAGE : state.message);
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [cases, creatorRole, nextCursor, preview, statusFilter]);

  useEffect(() => { if (!preview) void load(); }, [load, preview]);

  useEffect(() => {
    if (!query.trim() || preview) return;
    const timer = window.setTimeout(() => { void loadAllForSearch(); }, 300);
    return () => window.clearTimeout(timer);
  }, [query, loadAllForSearch, preview]);

  const counts = useMemo(() => {
    const countableCases = preview && creatorRole !== 'ALL'
      ? (cases ?? []).filter((item) => item.creatorRole === creatorRole)
      : cases ?? [];
    const result: Record<CaseStatus | 'ALL', number> = {
      ALL: countableCases.length,
      READY: 0,
      AUDITING: 0,
      COMPLETED: 0,
      DRAFT: 0,
      ERROR: 0,
    };
    for (const item of countableCases) result[item.status] += 1;
    return statusCounts ?? result;
  }, [cases, creatorRole, preview, statusCounts]);

  const filteredCases = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('es');
    return (cases ?? []).filter((item) => {
      if (statusFilter !== 'ALL' && item.status !== statusFilter) return false;
      if (preview && creatorRole !== 'ALL' && item.creatorRole !== creatorRole) return false;
      if (!normalized) return true;
      const result = item.effectiveResolution === null || item.effectiveResolution === undefined
        ? ''
        : resolutionLabel(item.effectiveResolution.result);
      return [item.id, shortId(item.id), item.studentIdentifier ?? '', result]
        .some((value) => value.toLocaleLowerCase('es').includes(normalized));
    });
  }, [cases, creatorRole, preview, query, statusFilter]);

  const selectedCase = filteredCases.find((item) => item.id === selectedId) ?? filteredCases[0] ?? null;
  const selectedCases = filteredCases.filter((item) => item.canManageCases === true && selectedCaseIds.has(item.id));
  const visibleManageableCases = filteredCases.filter((item) => item.canManageCases === true);
  const showManagementSelection = !preview && (cases?.some((item) => item.canManageCases === true) ?? false);
  const allVisibleSelected = visibleManageableCases.length > 0 && visibleManageableCases.every((item) => selectedCaseIds.has(item.id));
  const allSelectedAuditsDeletable = selectedCases.length > 0 && selectedCases.every(
    (item) => item.auditId != null && item.status !== 'AUDITING' && item.auditHasHumanReview !== true,
  );

  async function runAdminAction(action: 'delete-draft'): Promise<void> {
    if (!selectedCase?.canManageCases || adminPending) return;
    if (!window.confirm('¿Borrar este borrador sin evidencias?')) return;
    setAdminPending(true);
    setAdminError(null);
    try {
      if (action === 'delete-draft') await deleteCaseDraft(selectedCase.id);
      setSelectedId(null);
      await load();
    } catch (error) {
      setAdminError(toErrorState(error).message);
    } finally {
      setAdminPending(false);
    }
  }

  async function runBulkAction(action: 'mark-test' | 'mark-real' | 'delete-audits'): Promise<void> {
    if (adminPending || selectedCases.length === 0 || selectedCases.some((item) => item.canManageCases !== true)) return;
    if (action === 'delete-audits' && !allSelectedAuditsDeletable) return;

    const targets = action === 'mark-test'
      ? selectedCases.filter((item) => item.isTest !== true)
      : action === 'mark-real'
        ? selectedCases.filter((item) => item.isTest === true)
        : selectedCases;
    if (targets.length === 0) return;

    const actionLabel = action === 'mark-test' ? 'marcar como prueba'
      : action === 'mark-real' ? 'marcar como reales'
        : 'borrar de forma permanente los dictámenes';
    const impact = action === 'mark-test'
      ? ' Se excluirán de las métricas operativas.'
      : action === 'mark-real'
        ? ' Volverán a incluirse en las métricas operativas.'
        : ' Esta acción no se puede deshacer.';
    if (!window.confirm(`¿${actionLabel} ${targets.length} ${targets.length === 1 ? 'expediente seleccionado' : 'expedientes seleccionados'}?${impact}`)) return;

    setAdminPending(true);
    setAdminError(null);
    const outcomes = await Promise.allSettled(targets.map((item) =>
      action === 'mark-test'
        ? setCaseTestFlag(item.id, true)
        : action === 'mark-real'
          ? setCaseTestFlag(item.id, false)
          : deleteCaseAudit(item.id, item.auditId!),
    ));
    const succeededIds = targets.filter((_, index) => outcomes[index]?.status === 'fulfilled').map((item) => item.id);
    const failedIndex = outcomes.findIndex((outcome) => outcome?.status === 'rejected');
    const failedOutcome = outcomes[failedIndex];
    setSelectedCaseIds((current) => {
      const next = new Set(current);
      succeededIds.forEach((id) => next.delete(id));
      return next;
    });
    await load();
    if (failedOutcome?.status === 'rejected') {
      const failure = toErrorState(failedOutcome.reason);
      const succeeded = succeededIds.length;
      setAdminError(`${succeeded} de ${targets.length} acciones completadas. ${targets[failedIndex]?.studentIdentifier || shortId(targets[failedIndex]?.id ?? '')}: ${failure.message}`);
    }
    setAdminPending(false);
  }

  return (
    <div className="case-list-page flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Expedientes y auditoría</h1>
          <p className="mt-1 text-sm text-muted">Revisa, dictamina y da seguimiento a las solicitudes de cancelación.</p>
        </div>
        <Button onClick={() => void load()} loading={loading} loadingLabel="Actualizando">Actualizar</Button>
      </header>

      {listError !== null && <ErrorCard message={listError} onRetry={() => void load()} />}

      <div className="case-overview-strip" aria-label="Resumen de casos">
        <CaseOverview label="Todos los casos" value={counts.ALL} tone="brand" Icon={Files} />
        <CaseOverview label="Listos para auditar" value={counts.READY} tone="warning" Icon={AlertTriangle} />
        <CaseOverview label="Dictaminados" value={counts.COMPLETED} tone="success" Icon={CircleCheck} />
        <CaseOverview label="Borradores" value={counts.DRAFT} tone="neutral" Icon={FileText} />
        <CaseOverview label="Anomalías / error" value={counts.ERROR} tone="danger" Icon={TriangleAlert} />
      </div>

      <div className="case-toolbar rounded-xl border border-line bg-surface-1 p-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por estado del caso">
          {STATUS_FILTERS.map((item) => (
            <StatusTab
              key={item.value}
              label={item.label}
              count={counts[item.value]}
              active={statusFilter === item.value}
              onClick={() => { setSelectedCaseIds(new Set()); setCases(null); setNextCursor(null); setStatusFilter(item.value); }}
            />
          ))}
        </div>
          {canReadAllCases && (
            <label className="case-creator-filter">
              <span>Creado por</span>
              <select
                aria-label="Filtrar por coordinadores y asesores"
                value={creatorRole}
                onChange={(event) => {
                  setSelectedCaseIds(new Set());
                  setCases(null);
                  setNextCursor(null);
                  setCreatorRole(event.target.value as 'user' | 'coordinator' | 'ALL');
                }}
              >
                <option value="ALL">Todos los perfiles</option>
                <option value="coordinator">Coordinadores</option>
                <option value="user">Asesores (agentes)</option>
              </select>
            </label>
          )}
          <label className="case-search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Buscar por folio, matrícula o resolución</span>
          <input
            type="search"
            value={query}
            onChange={(event) => { setSelectedCaseIds(new Set()); setQuery(event.target.value); }}
            placeholder="Buscar folio, matrícula o resolución…"
          />
        </label>
      </div>

      {loading && cases === null ? (
        <div className="flex min-h-56 items-center justify-center rounded-xl border border-line bg-surface-1"><Spinner label="Cargando casos" /></div>
      ) : cases !== null && cases.length === 0 ? (
        <EmptyState title="Todavía no hay casos" description="Crea un caso para empezar a cargar evidencias y auditar con IA." />
      ) : filteredCases.length === 0 ? (
        <EmptyState title="No hay casos que coincidan" description="Prueba con otro folio, matrícula o estado." />
      ) : (
        <div className="case-list-layout">
          <div className="case-table-wrap">
            {showManagementSelection && selectedCases.length > 0 && (
              <div className="case-bulk-toolbar" role="group" aria-label="Acciones para expedientes seleccionados">
                <div className="case-bulk-selection-copy">
                  <strong>{selectedCases.length} seleccionados</strong>
                  <button type="button" className="case-bulk-clear" onClick={() => setSelectedCaseIds(new Set())} disabled={adminPending}>
                    <X size={13} aria-hidden="true" /> Quitar selección
                  </button>
                </div>
                <div className="case-bulk-actions">
                  {selectedCases.some((item) => item.isTest !== true) && (
                    <button type="button" className="case-bulk-action" onClick={() => void runBulkAction('mark-test')} disabled={adminPending}>
                      <FlaskConical size={14} aria-hidden="true" /> Marcar prueba
                    </button>
                  )}
                  {selectedCases.some((item) => item.isTest === true) && (
                    <button type="button" className="case-bulk-action" onClick={() => void runBulkAction('mark-real')} disabled={adminPending}>
                      <Undo2 size={14} aria-hidden="true" /> Marcar real
                    </button>
                  )}
                  <button
                    type="button"
                    className="case-bulk-action case-bulk-action-danger"
                    onClick={() => void runBulkAction('delete-audits')}
                    disabled={adminPending || !allSelectedAuditsDeletable}
                    title={!allSelectedAuditsDeletable ? 'Selecciona únicamente casos con dictamen, sin revisión humana y que no estén auditándose.' : undefined}
                  >
                    <Trash2 size={14} aria-hidden="true" /> Borrar dictámenes
                  </button>
                </div>
                {!allSelectedAuditsDeletable && (
                  <p className="case-bulk-hint">Para borrar, todos los seleccionados deben tener un dictamen sin revisión humana ni auditoría en curso.</p>
                )}
                {adminPending && <span role="status" className="case-bulk-progress"><Spinner label="Procesando selección" className="h-3.5 w-3.5" /> Procesando selección…</span>}
                {adminError && <p role="alert" className="case-bulk-error">{adminError}</p>}
              </div>
            )}
            <table className="case-table">
              <thead>
                <tr>
                  {showManagementSelection && (
                    <th scope="col" className="case-select-cell">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        disabled={adminPending || visibleManageableCases.length === 0}
                        aria-label="Seleccionar todos los expedientes visibles"
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => {
                          setSelectedCaseIds((current) => {
                            const next = new Set(current);
                            for (const item of visibleManageableCases) {
                              if (event.target.checked) next.add(item.id);
                              else next.delete(item.id);
                            }
                            return next;
                          });
                        }}
                      />
                    </th>
                  )}
                  <th scope="col">Caso</th>
                  {canReadAllCases && <th scope="col">Perfil</th>}
                  <th scope="col">Evidencias</th>
                  <th scope="col">Dictamen vigente</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Acción</th>
                </tr>
              </thead>
              <tbody>
                {filteredCases.map((item) => {
                  const resolution = item.effectiveResolution ?? null;
                  const selected = selectedCase?.id === item.id;
                  return (
                    <tr
                      key={item.id}
                      tabIndex={0}
                      aria-selected={selected}
                      className={selected ? 'case-table-row case-table-row-selected' : 'case-table-row'}
                      onClick={() => setSelectedId(item.id)}
                      onKeyDown={(event) => selectOnKeyboard(event, () => setSelectedId(item.id))}
                    >
                      {showManagementSelection && (
                        <td className="case-select-cell">
                          {item.canManageCases === true && (
                            <input
                              type="checkbox"
                              checked={selectedCaseIds.has(item.id)}
                              disabled={adminPending}
                              aria-label={`Seleccionar expediente ${item.studentIdentifier || shortId(item.id)}`}
                              onClick={(event) => event.stopPropagation()}
                              onKeyDown={(event) => event.stopPropagation()}
                              onChange={(event) => {
                                setSelectedCaseIds((current) => {
                                  const next = new Set(current);
                                  if (event.target.checked) next.add(item.id);
                                  else next.delete(item.id);
                                  return next;
                                });
                              }}
                            />
                          )}
                        </td>
                      )}
                      <td>
                        <span className="text-sm font-semibold">{item.studentIdentifier || 'Sin matrícula'}{item.studentName ? ` · ${item.studentName}` : ''}</span>
                        <span className="case-cell-secondary">{item.studentName ? `Matrícula ${item.studentIdentifier || 'sin capturar'}` : 'Nombre pendiente'} · Creado {formatDateTime(item.createdAt)}</span>
                      </td>
                      {canReadAllCases && <td>{item.creatorRole === 'coordinator' ? 'Coordinador' : item.creatorRole === 'user' ? 'Asesor' : <span className="text-muted">Sin perfil</span>}</td>}
                      <td><span className="inline-flex items-center gap-1.5"><FileText size={15} aria-hidden="true" />{item.evidenceCount}</span></td>
                      <td>{resolution ? <><Badge tone={resolutionTone(resolution.result)}>{resolutionLabel(resolution.result)}</Badge><span className="case-cell-secondary">{RESOLUTION_SOURCE_LABELS[resolution.source]}</span></> : <span className="text-muted">Sin dictamen</span>}</td>
                      <td>
                        <div className="flex flex-col items-start gap-1">
                          <Badge tone={CASE_STATUS_TONE[item.status]}>{CASE_STATUS_LABELS[item.status]}</Badge>
                          <Badge tone={caseKindTone(item.isTest)}>{caseKindLabel(item.isTest)}</Badge>
                        </div>
                      </td>
                      <td><a className="case-row-action" href={`#/casos/${encodeURIComponent(item.id)}`} onClick={(event) => event.stopPropagation()}>Abrir <ArrowRight size={14} aria-hidden="true" /></a></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selectedCase !== null && (
            <aside className="case-preview" aria-label="Resumen del expediente seleccionado">
              <div className="flex items-start justify-between gap-3">
                <Badge tone={CASE_STATUS_TONE[selectedCase.status]}>{CASE_STATUS_LABELS[selectedCase.status]}</Badge>
                <span className="text-xs text-muted">{formatDateTime(selectedCase.updatedAt)}</span>
              </div>
              <h2 className="mt-3 text-lg font-semibold">{selectedCase.studentIdentifier || 'Sin matrícula'}{selectedCase.studentName ? ` · ${selectedCase.studentName}` : ''}</h2>
              <div className="mt-4 border-y border-line py-3">
                <p className="text-sm font-medium">{selectedCase.studentName || 'Nombre pendiente de capturar'}</p>
                {selectedCase.studentIdentifier && <p className="mt-1 text-xs text-muted">Matrícula {selectedCase.studentIdentifier}</p>}
              </div>
              <dl className="mt-4 flex flex-col gap-3 text-sm">
                <div className="flex justify-between gap-3"><dt className="text-muted">Evidencias</dt><dd>{selectedCase.evidenceCount}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Clasificación</dt><dd><Badge tone={caseKindTone(selectedCase.isTest)}>{caseKindLabel(selectedCase.isTest)}</Badge></dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Dictamen vigente</dt><dd className="max-w-[65%] text-right">{selectedCase.effectiveResolution ? resolutionLabel(selectedCase.effectiveResolution.result) : selectedCase.auditIsCurrent === false ? 'Dictamen IA desactualizado' : 'Sin dictamen'}</dd></div>
                {selectedCase.effectiveResolution && <div className="flex justify-between gap-3"><dt className="text-muted">Origen</dt><dd title={RESOLUTION_SOURCE_DESCRIPTIONS[selectedCase.effectiveResolution.source]}>{RESOLUTION_SOURCE_LABELS[selectedCase.effectiveResolution.source]}</dd></div>}
              </dl>
              {selectedCase.canManageCases && !preview && selectedCase.status === 'DRAFT' && selectedCase.evidenceCount === 0 && (
                <div className="mt-5 border-t border-line pt-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Administración</p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" disabled={adminPending} onClick={() => void runAdminAction('delete-draft')}>
                      Borrar borrador
                    </Button>
                  </div>
                  {adminError && selectedCases.length === 0 && <p role="alert" className="mt-2 text-sm text-danger">{adminError}</p>}
                </div>
              )}
              <a className="case-open-link mt-5" href={`#/casos/${encodeURIComponent(selectedCase.id)}`}>
                Abrir expediente <ArrowRight size={16} aria-hidden="true" />
              </a>
            </aside>
          )}
        </div>
      )}
      <p className="text-xs text-muted">Mostrando {filteredCases.length} de {counts[statusFilter]} expedientes</p>
      {nextCursor && !query.trim() && (
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="secondary" onClick={() => void loadMore()} loading={loading} loadingLabel="Cargando expedientes">Mostrar más</Button>
          {canReadAllCases && <Button onClick={() => void loadAll()} loading={loading} loadingLabel="Cargando todos los expedientes">Cargar todos los expedientes</Button>}
        </div>
      )}
    </div>
  );
}

function CaseOverview({ label, value, tone, Icon }: { label: string; value: number; tone: 'brand' | 'warning' | 'success' | 'neutral' | 'danger'; Icon: typeof Files }): ReactNode {
  return <div className={`case-overview-card case-overview-${tone}`}><span>{label}</span><strong>{value}</strong><i><Icon size={18} aria-hidden="true" /></i></div>;
}
