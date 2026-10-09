// =============================================================================
// Listado de casos. Los filtros se aplican a datos que ya entrega la API; la
// página no inventa categorías de auditoría ni altera las resoluciones.
// =============================================================================

import type { KeyboardEvent, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CircleCheck, FileText, Files, Search, TriangleAlert } from 'lucide-react';
import { listCases, toErrorState } from '../lib/api';
import type { CaseSummary } from '../lib/api';
import { formatDateTime, shortId } from '../lib/format';
import { isLocalDashboardPreview } from '../lib/local-dashboard-preview';
import { getLocalPreviewCases, localPreviewCaseLabel } from '../lib/local-ui-preview';
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

export function CasesPanel(): ReactNode {
  const preview = isLocalDashboardPreview();
  const [cases, setCases] = useState<CaseSummary[] | null>(() => preview ? getLocalPreviewCases() : null);
  const [loading, setLoading] = useState(!preview);
  const [listError, setListError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<CaseStatus | 'ALL'>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (preview) {
      setCases(getLocalPreviewCases());
      setListError(null);
      setLoading(false);
      return;
    }
    try {
      setCases(await listCases());
      setListError(null);
    } catch (err) {
      const state = toErrorState(err);
      setListError(state.category === 'AUTH_ERROR' ? AUTH_ERROR_MESSAGE : state.message);
    } finally {
      setLoading(false);
    }
  }, [preview]);

  useEffect(() => { if (!preview) void load(); }, [load, preview]);

  const counts = useMemo(() => {
    const result: Record<CaseStatus | 'ALL', number> = {
      ALL: cases?.length ?? 0,
      READY: 0,
      AUDITING: 0,
      COMPLETED: 0,
      DRAFT: 0,
      ERROR: 0,
    };
    for (const item of cases ?? []) result[item.status] += 1;
    return result;
  }, [cases]);

  const filteredCases = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('es');
    return (cases ?? []).filter((item) => {
      if (statusFilter !== 'ALL' && item.status !== statusFilter) return false;
      if (!normalized) return true;
      const result = item.effectiveResolution === null || item.effectiveResolution === undefined
        ? ''
        : resolutionLabel(item.effectiveResolution.result);
      return [item.id, shortId(item.id), item.studentIdentifier ?? '', result]
        .some((value) => value.toLocaleLowerCase('es').includes(normalized));
    });
  }, [cases, query, statusFilter]);

  const selectedCase = filteredCases.find((item) => item.id === selectedId) ?? filteredCases[0] ?? null;

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
              onClick={() => setStatusFilter(item.value)}
            />
          ))}
        </div>
        <label className="case-search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Buscar por folio, matrícula o resolución</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
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
            <table className="case-table">
              <thead>
                <tr>
                  <th scope="col">Expediente / caso</th>
                  <th scope="col">Estudiante</th>
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
                      <td><span className="font-mono text-sm font-semibold">{preview ? localPreviewCaseLabel(item.id) : shortId(item.id)}</span><span className="case-cell-secondary">Creado {formatDateTime(item.createdAt)}</span></td>
                      <td>{item.studentIdentifier ? <><span>{item.studentIdentifier}</span><span className="case-cell-secondary">Identificador</span></> : <span className="text-muted">Sin identificar</span>}</td>
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
              <h2 className="mt-3 font-mono text-lg font-semibold">{preview ? localPreviewCaseLabel(selectedCase.id) : shortId(selectedCase.id)}</h2>
              <div className="mt-4 border-y border-line py-3">
                <p className="text-sm font-medium">{selectedCase.studentIdentifier || 'Estudiante sin identificar'}</p>
                {selectedCase.studentIdentifier && <p className="mt-1 text-xs text-muted">Identificador</p>}
              </div>
              <dl className="mt-4 flex flex-col gap-3 text-sm">
                <div className="flex justify-between gap-3"><dt className="text-muted">Evidencias</dt><dd>{selectedCase.evidenceCount}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Clasificación</dt><dd><Badge tone={caseKindTone(selectedCase.isTest)}>{caseKindLabel(selectedCase.isTest)}</Badge></dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Dictamen vigente</dt><dd className="max-w-[65%] text-right">{selectedCase.effectiveResolution ? resolutionLabel(selectedCase.effectiveResolution.result) : selectedCase.auditIsCurrent === false ? 'Dictamen IA desactualizado' : 'Sin dictamen'}</dd></div>
                {selectedCase.effectiveResolution && <div className="flex justify-between gap-3"><dt className="text-muted">Origen</dt><dd title={RESOLUTION_SOURCE_DESCRIPTIONS[selectedCase.effectiveResolution.source]}>{RESOLUTION_SOURCE_LABELS[selectedCase.effectiveResolution.source]}</dd></div>}
              </dl>
              <a className="case-open-link mt-5" href={`#/casos/${encodeURIComponent(selectedCase.id)}`}>
                Abrir expediente <ArrowRight size={16} aria-hidden="true" />
              </a>
            </aside>
          )}
        </div>
      )}
      <p className="text-xs text-muted">Mostrando {filteredCases.length} de {cases?.length ?? 0} expedientes</p>
    </div>
  );
}

function CaseOverview({ label, value, tone, Icon }: { label: string; value: number; tone: 'brand' | 'warning' | 'success' | 'neutral' | 'danger'; Icon: typeof Files }): ReactNode {
  return <div className={`case-overview-card case-overview-${tone}`}><span>{label}</span><strong>{value}</strong><i><Icon size={18} aria-hidden="true" /></i></div>;
}
