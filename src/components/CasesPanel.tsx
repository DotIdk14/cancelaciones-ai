import { CASE_BUCKETS, CASE_STAGES, caseStageOf, caseProgressLabel, matchesCaseBucket, type CaseStage, type CaseBucketCounts } from '../lib/case-workflow';
// =============================================================================
// Listado de casos. Los filtros se aplican a datos que ya entrega la API; la
// página no inventa categorías de auditoría ni altera las resoluciones.
// =============================================================================

import type { KeyboardEvent, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, FileText, FlaskConical, Search, Trash2, Undo2, X } from 'lucide-react';
import { deleteCaseAudit, deleteCaseDraft, listCasePage, setCaseTestFlag, toErrorState } from '../lib/api';
import type { CaseCreatorOption, CaseCreatorRole, CaseSummary } from '../lib/api';
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
import { EVIDENCE_CHANNELS, EVIDENCE_COUNTRIES, type CaseStatus } from '../skills/audit/types';
import { Badge, Button, EmptyState, ErrorCard, Spinner } from './ui';

const AUTH_ERROR_MESSAGE = 'El servidor requiere autenticación. La interfaz está en modo demo: los datos no se cargarán hasta que configure una sesión válida.';

function progressTone(item: CaseSummary): (typeof CASE_STATUS_TONE)[CaseStatus] {
  const stage = caseStageOf(item);
  return CASE_STATUS_TONE[stage === 'FINALIZED' ? 'COMPLETED' : stage === 'ERROR' ? 'ERROR' : stage === 'DRAFT' ? 'DRAFT' : item.status === 'AUDITING' ? 'AUDITING' : 'READY'];
}

function selectOnKeyboard(event: KeyboardEvent<HTMLTableRowElement>, select: () => void): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    select();
  }
}
export function CasesPanel({ canReadAllCases = false, canFinalizeAnyCase = false }: { canReadAllCases?: boolean; canFinalizeAnyCase?: boolean }): ReactNode {
  const preview = isLocalDashboardPreview();
  const [cases, setCases] = useState<CaseSummary[] | null>(() => preview ? getLocalPreviewCases() : null);
  const [loading, setLoading] = useState(!preview);
  const [listError, setListError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [serverBucketCounts, setServerBucketCounts] = useState<CaseBucketCounts | null>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<CaseStatus | 'ALL'>('ALL');
  const [bucketFilter, setBucketFilter] = useState<(typeof CASE_BUCKETS)[number]['value']>('ALL');
  const [stage, setStage] = useState<CaseStage>('PENDING_AUDIT');
  const [country, setCountry] = useState('');
  const [channel, setChannel] = useState('');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [creatorRole, setCreatorRole] = useState<CaseCreatorRole | 'ALL'>('ALL');
  const [assignedTo, setAssignedTo] = useState('ALL');
  const [responsibleOptions, setResponsibleOptions] = useState<Array<{ userId: string; name: string | null }>>(() => preview ? getLocalPreviewCases().flatMap(item => item.assignedTo ? [{userId:item.assignedTo,name:item.assignedName ?? null}] : []).filter((item,index,all)=>all.findIndex(other=>other.userId===item.userId)===index) : []);
  const [creatorId, setCreatorId] = useState<string | 'ALL'>('ALL');
  const [creatorOptions, setCreatorOptions] = useState<CaseCreatorOption[]>(() => {
    if (!preview) return [];
    const creators = new Map<string, CaseCreatorOption>();
    for (const item of getLocalPreviewCases()) {
      if (item.creatorId && item.creatorRole) {
        const names: Record<string, string> = {
          '20000000-0000-4000-8000-000000000001': 'Mariana Ruiz',
          '20000000-0000-4000-8000-000000000002': 'Diego Soto',
          '10000000-0000-4000-8000-000000000001': 'Andrea Torres',
          '10000000-0000-4000-8000-000000000002': 'Lucía Vega',
          '10000000-0000-4000-8000-000000000003': 'Carlos León',
        };
        creators.set(item.creatorId, { creatorId: item.creatorId, role: item.creatorRole, name: names[item.creatorId] ?? null });
      }
    }
    return [...creators.values()];
  });
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
      const page = await listCasePage({ status: statusFilter, creatorRole, creatorId, assignedTo, bucket: bucketFilter, stage: bucketFilter === 'IN_PROGRESS' ? stage : undefined, search: debouncedQuery, country, channel, ...(createdFrom ? { createdFrom: new Date(`${createdFrom}T00:00:00`).toISOString() } : {}), ...(createdTo ? { createdTo: new Date(`${createdTo}T23:59:59.999`).toISOString() } : {}), limit: 50 });
      if (currentRequest !== requestId.current) return;
      setCases(page.cases);
      if (page.creatorOptions) setCreatorOptions(page.creatorOptions);
      if (page.responsibleOptions) setResponsibleOptions(page.responsibleOptions);
      setNextCursor(page.nextCursor);
      if (page.bucketCounts) setServerBucketCounts(page.bucketCounts);
      setListError(null);
    } catch (err) {
      if (currentRequest !== requestId.current) return;
      const state = toErrorState(err);
      setListError(state.category === 'AUTH_ERROR' ? AUTH_ERROR_MESSAGE : state.message);
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [assignedTo, bucketFilter, channel, country, createdFrom, createdTo, creatorId, creatorRole, debouncedQuery, preview, stage, statusFilter]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (!nextCursor || preview) return;
    const currentRequest = ++requestId.current;
    setLoading(true);
    try {
      const page = await listCasePage({ status: statusFilter, creatorRole, creatorId, assignedTo, bucket: bucketFilter, stage: bucketFilter === 'IN_PROGRESS' ? stage : undefined, search: debouncedQuery, country, channel, ...(createdFrom ? { createdFrom: new Date(`${createdFrom}T00:00:00`).toISOString() } : {}), ...(createdTo ? { createdTo: new Date(`${createdTo}T23:59:59.999`).toISOString() } : {}), cursor: nextCursor, limit: 50 });
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
  }, [assignedTo, bucketFilter, channel, country, createdFrom, createdTo, creatorId, creatorRole, debouncedQuery, nextCursor, preview, stage, statusFilter]);

  const loadAll = useCallback(async (): Promise<void> => {
    if (preview || !nextCursor) return;
    const currentRequest = ++requestId.current;
    setLoading(true);
    try {
      const all = [...(cases ?? [])];
      let cursor: string | null = nextCursor;
      while (cursor) {
        const page = await listCasePage({ status: statusFilter, creatorRole, creatorId, assignedTo, bucket: bucketFilter, stage: bucketFilter === 'IN_PROGRESS' ? stage : undefined, search: debouncedQuery, country, channel, ...(createdFrom ? { createdFrom: new Date(`${createdFrom}T00:00:00`).toISOString() } : {}), ...(createdTo ? { createdTo: new Date(`${createdTo}T23:59:59.999`).toISOString() } : {}), cursor, limit: 50 });
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
  }, [assignedTo, bucketFilter, cases, channel, country, createdFrom, createdTo, creatorId, creatorRole, debouncedQuery, nextCursor, preview, stage, statusFilter]);

  const searchPending = !preview && query.trim() !== debouncedQuery;

  useEffect(() => { if (!preview) void load(); }, [load, preview]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const filteredCases = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('es');
    return (cases ?? []).filter((item) => {
      if (preview && !matchesCaseBucket(item, bucketFilter, canFinalizeAnyCase)) return false;
      if (preview && bucketFilter === 'IN_PROGRESS' && caseStageOf(item) !== stage) return false;
      if (preview && country && item.country !== country) return false;
      if (preview && channel && item.channel !== channel) return false;
      if (preview && createdFrom && item.createdAt < new Date(`${createdFrom}T00:00:00`).toISOString()) return false;
      if (preview && createdTo && item.createdAt > new Date(`${createdTo}T23:59:59.999`).toISOString()) return false;
      if (statusFilter !== 'ALL' && item.status !== statusFilter) return false;
      if (preview && creatorRole !== 'ALL' && item.creatorRole !== creatorRole) return false;
      if (preview && assignedTo !== 'ALL' && (assignedTo === 'UNASSIGNED' ? Boolean(item.assignedTo) : item.assignedTo !== assignedTo)) return false;
      if (preview && creatorId !== 'ALL' && item.creatorId !== creatorId) return false;
      if (preview && !normalized) return true;
      if (!normalized) return true;
      const result = item.effectiveResolution === null || item.effectiveResolution === undefined
        ? ''
        : resolutionLabel(item.effectiveResolution.result);
      return [item.id, shortId(item.id), item.externalCaseId ?? '', item.studentIdentifier ?? '', item.studentName ?? '', result]
        .some((value) => value.toLocaleLowerCase('es').includes(normalized));
    });
  }, [assignedTo, bucketFilter, canFinalizeAnyCase, cases, channel, country, createdFrom, createdTo, creatorId, creatorRole, preview, query, stage, statusFilter]);

  const previewBucketCounts = useMemo(() => {
    if (!preview) return null;
    const normalized = query.trim().toLocaleLowerCase('es');
    const rows = (cases ?? []).filter(item =>
      (statusFilter === 'ALL' || item.status === statusFilter)
      && (creatorRole === 'ALL' || item.creatorRole === creatorRole)
      && (creatorId === 'ALL' || item.creatorId === creatorId)
      && (assignedTo === 'ALL' || (assignedTo === 'UNASSIGNED' ? !item.assignedTo : item.assignedTo === assignedTo))
      && (!country || item.country === country)
      && (!channel || item.channel === channel)
      && (!createdFrom || item.createdAt >= new Date(`${createdFrom}T00:00:00`).toISOString())
      && (!createdTo || item.createdAt <= new Date(`${createdTo}T23:59:59.999`).toISOString())
      && (!normalized || [item.id, item.studentIdentifier ?? '', item.studentName ?? ''].some(value => value.toLocaleLowerCase('es').includes(normalized))),
    );
    const counts = Object.fromEntries([...CASE_BUCKETS, ...CASE_STAGES].map(item => [item.value, 0])) as CaseBucketCounts;
    for (const row of rows) {
      for (const bucket of CASE_BUCKETS) {
        if (matchesCaseBucket(row, bucket.value, canFinalizeAnyCase)) counts[bucket.value] += 1;
      }
      if (matchesCaseBucket(row, 'IN_PROGRESS', canFinalizeAnyCase)) counts[caseStageOf(row) as CaseStage] += 1;
    }
    return counts;
  }, [assignedTo, canFinalizeAnyCase, cases, channel, country, createdFrom, createdTo, creatorId, creatorRole, preview, query, statusFilter]);

  const visibleCreatorOptions = creatorOptions
    .filter((item) => creatorRole === 'ALL' || item.role === creatorRole)
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'es'));
  const selectedCase = filteredCases.find((item) => item.id === selectedId) ?? filteredCases[0] ?? null;
  const selectedCases = filteredCases.filter((item) => item.canManageCases === true && selectedCaseIds.has(item.id));
  const deletableAuditCases = selectedCases.filter(
    (item) => item.auditId != null && item.status !== 'AUDITING' && item.auditHasHumanReview !== true && item.workflowState !== 'FINALIZED',
  );
  const visibleManageableCases = filteredCases.filter((item) => item.canManageCases === true);
  const showManagementSelection = !preview && (cases?.some((item) => item.canManageCases === true) ?? false);
  const allVisibleSelected = visibleManageableCases.length > 0 && visibleManageableCases.every((item) => selectedCaseIds.has(item.id));

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
    if (action === 'delete-audits' && deletableAuditCases.length === 0) return;

    const targets = action === 'mark-test'
      ? selectedCases.filter((item) => item.isTest !== true)
      : action === 'mark-real'
        ? selectedCases.filter((item) => item.isTest === true)
        : deletableAuditCases;
    if (targets.length === 0) return;

    const actionLabel = action === 'mark-test' ? 'marcar como prueba'
      : action === 'mark-real' ? 'marcar como reales'
        : 'borrar de forma permanente';
    const impact = action === 'mark-test'
      ? ' Se excluirán de las métricas operativas.'
      : action === 'mark-real'
        ? ' Volverán a incluirse en las métricas operativas.'
        : ` Se retirarán de la selección vigente; las evidencias, versiones y costos se conservarán${targets.length < selectedCases.length ? `; se omitirá${selectedCases.length - targets.length === 1 ? '' : 'n'} ${selectedCases.length - targets.length} ${selectedCases.length - targets.length === 1 ? 'caso' : 'casos'} sin dictamen elegible, con revisión humana o con auditoría en curso` : ''}.`;
    const targetDescription = action === 'delete-audits'
      ? `${targets.length} ${targets.length === 1 ? 'dictamen seleccionado' : 'dictámenes seleccionados'}`
      : `${targets.length} ${targets.length === 1 ? 'expediente seleccionado' : 'expedientes seleccionados'}`;
    if (!window.confirm(`¿${actionLabel} ${targetDescription}?${impact}`)) return;

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

      <div className="case-toolbar rounded-xl border border-line bg-surface-1 p-3">
        <div className="flex w-full flex-wrap gap-1.5" role="tablist" aria-label="Pestañas de expedientes">
          {CASE_BUCKETS.map((item) => <button key={item.value} type="button" role="tab" aria-selected={bucketFilter === item.value} aria-pressed={bucketFilter === item.value} className={`case-status-tab ${bucketFilter === item.value ? 'case-status-tab-active' : ''}`} onClick={() => { setSelectedCaseIds(new Set()); setSelectedId(null); setCases(preview ? getLocalPreviewCases() : null); setNextCursor(null); setBucketFilter(item.value); setStage('PENDING_AUDIT'); setStatusFilter('ALL'); }}>{item.label}<span className="case-status-count">{previewBucketCounts?.[item.value] ?? serverBucketCounts?.[item.value] ?? '—'}</span></button>)}
        </div>
        {bucketFilter === 'IN_PROGRESS' && (
          <section className="w-full border-t border-line pt-3" aria-label="Listas de En curso">
            <h2 className="mb-2 text-sm font-medium">Listas de En curso</h2>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Etapas pendientes">
              {CASE_STAGES.filter(item => item.value !== 'PENDING_COORDINATOR' || canFinalizeAnyCase).map(item => (
                <button key={item.value} type="button" aria-pressed={stage === item.value} className={`case-status-tab ${stage === item.value ? 'case-status-tab-active' : ''}`} onClick={() => { setSelectedCaseIds(new Set()); setSelectedId(null); setNextCursor(null); setCases(preview ? getLocalPreviewCases() : null); setStage(item.value); setStatusFilter('ALL'); }}>
                  {item.label}<span className="case-status-count">{previewBucketCounts?.[item.value] ?? serverBucketCounts?.[item.value] ?? '—'}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-sm text-muted">{CASE_STAGES.find(item => item.value === stage)?.description}</p>
          </section>
        )}
        <div className="flex flex-wrap items-end gap-3 pt-3">
          <label className="case-creator-filter"><span>Estado técnico</span><select aria-label="Filtrar por estado técnico" value={statusFilter} onChange={event => { setCases(preview ? getLocalPreviewCases() : null); setNextCursor(null); setStatusFilter(event.target.value as CaseStatus | 'ALL'); }}><option value="ALL">Todos</option>{(bucketFilter === 'ERRORS' ? ['ERROR'] : bucketFilter === 'DRAFTS' ? ['DRAFT', 'READY', 'COMPLETED', 'ERROR'] : ['DRAFT', 'READY', 'AUDITING', 'COMPLETED', 'ERROR']).map(status => <option key={status} value={status}>{CASE_STATUS_LABELS[status as CaseStatus]}</option>)}</select></label>
          {canReadAllCases && (
            <label className="case-creator-filter">
              <span>Perfil del creador</span>
              <select
                aria-label="Filtrar por perfil del creador"
                value={creatorRole}
                onChange={(event) => {
                  setSelectedCaseIds(new Set());
                  if (!preview) setCases(null);
                  setNextCursor(null);
                  setCreatorId('ALL');
                  setCreatorRole(event.target.value as CaseCreatorRole | 'ALL');
                }}
              >
                <option value="ALL">Todos los perfiles</option>
                <option value="coordinator">Coordinadores</option>
                <option value="user">Asesores (agentes)</option>
                <option value="manager">Gerentes</option>
              </select>
            </label>
          )}
          {canReadAllCases && (
            <label className="case-creator-filter">
              <span>Creador</span>
              <select
                aria-label="Filtrar por creador de caso"
                value={creatorId}
                onChange={(event) => {
                  setSelectedCaseIds(new Set());
                  if (!preview) setCases(null);
                  setNextCursor(null);
                  setCreatorId(event.target.value);
                }}
              >
                <option value="ALL">Todos los creadores</option>
                {visibleCreatorOptions.map((item) => (
                  <option key={item.creatorId} value={item.creatorId}>{item.name || 'Nombre no disponible'}</option>
                ))}
              </select>
            </label>
          )}
          {canReadAllCases && <label className="case-creator-filter"><span>Responsable</span><select aria-label="Filtrar por responsable" value={assignedTo} onChange={(event) => { setSelectedCaseIds(new Set()); if (!preview) setCases(null); setNextCursor(null); setAssignedTo(event.target.value); }}><option value="ALL">Todos los responsables</option><option value="UNASSIGNED">Sin asignar</option>{[...responsibleOptions].sort((a,b)=>(a.name ?? "").localeCompare(b.name ?? "", "es")).map(item=><option key={item.userId} value={item.userId}>{item.name || "Nombre no disponible"}</option>)}</select></label>}
          <label className="case-creator-filter"><span>País</span><select aria-label="Filtrar por país" value={country} onChange={event => { setCases(preview ? getLocalPreviewCases() : null); setNextCursor(null); setCountry(event.target.value); }}><option value="">Todos</option>{EVIDENCE_COUNTRIES.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="case-creator-filter"><span>Canal de origen · evidencia</span><select aria-label="Filtrar por canal de origen según evidencia" value={channel} onChange={event => { setCases(preview ? getLocalPreviewCases() : null); setNextCursor(null); setChannel(event.target.value); }}><option value="">Todos</option>{EVIDENCE_CHANNELS.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="case-creator-filter"><span>Desde</span><input aria-label="Fecha desde" type="date" value={createdFrom} onChange={event => { setCases(preview ? getLocalPreviewCases() : null); setNextCursor(null); setCreatedFrom(event.target.value); }} /></label>
          <label className="case-creator-filter"><span>Hasta</span><input aria-label="Fecha hasta" type="date" value={createdTo} onChange={event => { setCases(preview ? getLocalPreviewCases() : null); setNextCursor(null); setCreatedTo(event.target.value); }} /></label>
          <label className="case-search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Buscar por folio, matrícula o nombre</span>
          <input
            type="search"
            value={query}
            onChange={(event) => {
              const nextQuery = event.target.value;
              setSelectedCaseIds(new Set());
              setSelectedId(null);
              setQuery(nextQuery);
              if (!preview) {
                requestId.current += 1;
                setNextCursor(null);
                if (nextQuery.trim() !== debouncedQuery) setCases(null);
                else if (cases === null) void load();
              }
            }}
            placeholder="Buscar folio, matrícula o nombre…"
          />
        </label>
        <Button variant="secondary" onClick={() => { setQuery(''); setDebouncedQuery(''); setStatusFilter('ALL'); setBucketFilter('ALL'); setStage('PENDING_AUDIT'); setCreatorRole('ALL'); setCreatorId('ALL'); setAssignedTo('ALL'); setCountry(''); setChannel(''); setCreatedFrom(''); setCreatedTo(''); setNextCursor(null); setCases(preview ? getLocalPreviewCases() : null); setSelectedCaseIds(new Set()); }}>Limpiar filtros</Button>
        </div>
      </div>

      {(searchPending || (loading && cases === null)) ? (
        <div className="flex min-h-56 items-center justify-center rounded-xl border border-line bg-surface-1"><Spinner label="Cargando casos" /></div>
      ) : cases !== null && cases.length === 0 && bucketFilter === 'ALL' && !debouncedQuery && !country && !channel && !createdFrom && !createdTo && statusFilter === 'ALL' ? (
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
                    disabled={adminPending || deletableAuditCases.length === 0}
                    title={deletableAuditCases.length === 0 ? 'Selecciona al menos un caso con dictamen sin revisión humana ni auditoría en curso.' : undefined}
                  >
                    <Trash2 size={14} aria-hidden="true" /> Borrar dictámenes
                  </button>
                </div>
                {deletableAuditCases.length < selectedCases.length && (
                  <p className="case-bulk-hint">
                    Se pueden borrar {deletableAuditCases.length} de {selectedCases.length} dictámenes seleccionados junto con sus archivos de evidencia. Los demás no tienen dictamen elegible, cuentan con revisión humana o tienen una auditoría en curso.
                  </p>
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
                  {canReadAllCases && <th scope="col">Responsable</th>}
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
                      {canReadAllCases && (
                        <td>
                          {item.assignedTo ? <span>{item.assignedName || 'Nombre no disponible'}</span> : <span className="text-muted">Sin asignar</span>}
                        </td>
                      )}
                      <td><span className="inline-flex items-center gap-1.5"><FileText size={15} aria-hidden="true" />{item.evidenceCount}</span></td>
                      <td>{resolution ? <><Badge tone={resolutionTone(resolution.result)}>{resolutionLabel(resolution.result)}</Badge><span className="case-cell-secondary">{RESOLUTION_SOURCE_LABELS[resolution.source]}</span></> : <span className="text-muted">{item.auditIsCurrent === false ? 'Pendiente de nueva auditoría' : 'Sin dictamen'}</span>}</td>
                      <td>
                        <div className="flex flex-col items-start gap-1">
                          <Badge tone={progressTone(item)}>{caseProgressLabel(item)}</Badge>
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
                <Badge tone={progressTone(selectedCase)}>{caseProgressLabel(selectedCase)}</Badge>
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
                <div className="flex justify-between gap-3"><dt className="text-muted">Dictamen vigente</dt><dd className="max-w-[65%] text-right">{selectedCase.effectiveResolution ? resolutionLabel(selectedCase.effectiveResolution.result) : selectedCase.auditIsCurrent === false ? 'Pendiente de nueva auditoría' : 'Sin dictamen'}</dd></div>
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
      <p className="text-xs text-muted">Mostrando {filteredCases.length} expedientes en esta página</p>
      {nextCursor && (
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="secondary" onClick={() => void loadMore()} loading={loading} loadingLabel={query.trim() ? 'Cargando coincidencias' : 'Cargando expedientes'}>{query.trim() ? 'Mostrar más coincidencias' : 'Mostrar más'}</Button>
          {canReadAllCases && <Button onClick={() => void loadAll()} loading={loading} loadingLabel={query.trim() ? 'Cargando todas las coincidencias' : 'Cargando todos los expedientes'}>{query.trim() ? 'Cargar todas las coincidencias' : 'Cargar todos los expedientes'}</Button>}
        </div>
      )}
    </div>
  );
}
