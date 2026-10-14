import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import { Badge, Button, Panel, Spinner } from './ui';
import {
  assignImportedCase,
  confirmFlokzuImport,
  getFlokzuImportHistory,
  previewFlokzuImport,
  type FlokzuImportHistoryItem,
  type FlokzuImportPreview,
  type FlokzuImportedCase,
} from '../lib/api';
import { FLOKZU_CLASSIFICATION_LABELS } from '../shared/flokzu-review';
import { formatDateTime } from '../lib/format';

const XLSX_LIMIT = 4 * 1024 * 1024;

function actionLabel(action: 'NEW' | 'UPDATE' | 'UNCHANGED'): string {
  if (action === 'NEW') return 'Nuevo';
  if (action === 'UPDATE') return 'Actualizar';
  return 'Sin cambios';
}

function actionTone(action: 'NEW' | 'UPDATE' | 'UNCHANGED'): 'brand' | 'warning' | 'neutral' {
  if (action === 'NEW') return 'brand';
  if (action === 'UPDATE') return 'warning';
  return 'neutral';
}

export function FlokzuImportPage({ previewOnly = false }: { previewOnly?: boolean }): ReactNode {
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<FlokzuImportPreview | null>(null);
  const [imports, setImports] = useState<FlokzuImportHistoryItem[]>([]);
  const [cases, setCases] = useState<FlokzuImportedCase[]>([]);
  const [casesNextOffset, setCasesNextOffset] = useState<number | null>(null);
  const [loadingMoreCases, setLoadingMoreCases] = useState(false);
  const [assignees, setAssignees] = useState<Array<{ userId: string; name: string | null }>>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [assigningCase, setAssigningCase] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const refreshHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const result = await getFlokzuImportHistory();
      setImports(result.imports);
      setCases(result.cases);
      setCasesNextOffset(result.casesNextOffset);
      setAssignees(result.assignmentOptions);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo consultar el historial.');
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  const loadMoreCases = async (): Promise<void> => {
    if (casesNextOffset === null || loadingMoreCases) return;
    setLoadingMoreCases(true);
    try {
      const result = await getFlokzuImportHistory(casesNextOffset);
      setCases((current) => [...current, ...result.cases]);
      setCasesNextOffset(result.casesNextOffset);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron cargar más expedientes.');
    } finally {
      setLoadingMoreCases(false);
    }
  };

  useEffect(() => { if (!previewOnly) void refreshHistory(); }, [previewOnly, refreshHistory]);

  const selectFile = (next: File | null): void => {
    setError(null);
    setSuccess(null);
    setPreview(null);
    if (!next) return;
    if (!next.name.toLowerCase().endsWith('.xlsx')) {
      setFile(null);
      setError('Selecciona un archivo con extensión .xlsx.');
      return;
    }
    if (next.size === 0 || next.size > XLSX_LIMIT) {
      setFile(null);
      setError('El archivo debe pesar más de 0 y como máximo 4 MB.');
      return;
    }
    setFile(next);
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    selectFile(event.target.files?.[0] ?? null);
    event.target.value = '';
  };

  const onDrop = (event: DragEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    setDragging(false);
    selectFile(event.dataTransfer.files[0] ?? null);
  };

  const handlePreview = async (): Promise<void> => {
    if (!file) return;
    setUploading(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await previewFlokzuImport(file);
      setPreview(result);
      await refreshHistory();
      if (result.validRows === 0) setError('El archivo no tiene filas importables. Revisa los errores antes de continuar.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo validar el Excel.');
    } finally {
      setUploading(false);
    }
  };

  const handleConfirm = async (): Promise<void> => {
    if (!preview || preview.validRows === 0) return;
    setConfirming(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await confirmFlokzuImport(preview.batchId);
      setSuccess(`Importación completada: ${result.created ?? 0} nuevos, ${result.updated ?? 0} actualizados, ${result.unchanged ?? 0} sin cambios.`);
      setPreview(null);
      setFile(null);
      await refreshHistory();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo confirmar la importación.');
    } finally {
      setConfirming(false);
    }
  };

  const handleReassign = async (caseId: string, value: string): Promise<void> => {
    const assignedTo = value || null;
    setAssigningCase(caseId);
    setError(null);
    try {
      await assignImportedCase(caseId, assignedTo);
      const assignedName = assignees.find((item) => item.userId === assignedTo)?.name ?? null;
      setCases((current) => current.map((item) => item.id === caseId ? { ...item, assignedTo, assignedName } : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cambiar el responsable.');
      await refreshHistory();
    } finally {
      setAssigningCase(null);
    }
  };

  if (previewOnly) return <FlokzuImportLocalPreview />;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <header>
        <a className="text-sm text-brand underline underline-offset-4" href="#/revision-flokzu">Abrir Revisión Flokzu</a>
        <h1 className="mt-1 text-2xl font-semibold text-ink">Importación de tickets</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted">Sube la exportación diaria para detectar altas, cambios y tickets ya sincronizados. El Excel no inicia auditorías ni genera costos de IA.</p>
      </header>

      {error && <div role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}
      {success && <div role="status" className="rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">{success}</div>}

      <Panel title="Archivo diario" description="El libro debe ser .xlsx, tener una hoja y conservar los encabezados de Flokzu en la segunda fila.">
        <button
          type="button"
          className={`flex min-h-40 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-5 py-7 text-center transition-colors ${dragging ? 'border-brand bg-brand/10' : 'border-line bg-surface-2 hover:border-brand/60'}`}
          onClick={() => fileInput.current?.click()}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
          onDrop={onDrop}
          aria-label="Seleccionar o soltar archivo Excel de Flokzu"
          disabled={uploading || confirming}
        >
          <span className="text-base font-semibold text-ink">Arrastra aquí el Excel o selecciónalo</span>
          <span className="text-sm text-muted">.xlsx · máximo 4 MB · sin modificación de archivos originales</span>
          {file && <span className="mt-1 rounded-full bg-surface-3 px-3 py-1 text-xs text-ink">{file.name} · {(file.size / 1024).toFixed(0)} KB</span>}
        </button>
        <input ref={fileInput} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={onFileChange} />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={() => { void handlePreview(); }} disabled={!file || uploading || confirming}>
            {uploading ? <><Spinner label="Validando archivo" /> Validando…</> : 'Validar y ver vista previa'}
          </Button>
          {file && <Button variant="ghost" onClick={() => { setFile(null); setPreview(null); setError(null); }}>Quitar archivo</Button>}
          <span className="text-xs text-muted">Primero se validan estructura y campos obligatorios; solo las filas válidas pasan a la vista previa.</span>
        </div>
      </Panel>

      {preview && <Panel title="Vista previa de importación" description={`Exportación ${preview.exportedAt ?? 'sin fecha de exportación'} · ${preview.totalRows} filas detectadas · ${preview.validRows} válidas`} actions={<Badge tone="brand">CaVe como clave · Flokzu</Badge>}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Metric label="Expedientes activos" value={preview.activeRows} />
          <Metric label="Revisión administrativa" value={preview.administrativeRows} tone="brand" />
          <Metric label="Requieren actualización" value={preview.changedRows} tone="warning" />
          <Metric label="Sin cambios" value={preview.unchangedRows} />
          <Metric label="Con errores" value={preview.errorRows} tone={preview.errorRows ? 'danger' : 'neutral'} />
        </div>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <section aria-labelledby="fl-preview-assignments">
            <h3 id="fl-preview-assignments" className="text-sm font-semibold text-ink">Distribución automática prevista</h3>
            {preview.assignments.length ? <ul className="mt-2 divide-y divide-line rounded-xl border border-line">{preview.assignments.map((assignment) => <li key={assignment.userId} className="flex justify-between gap-3 px-3 py-2 text-sm"><span>{assignment.name ?? 'Asesor sin nombre de perfil'}</span><strong>{assignment.count}</strong></li>)}</ul> : <p className="mt-2 text-sm text-muted">No hay nuevos tickets en la etapa de revisión BO o no hay Asesores elegibles.</p>}
            {preview.unassignedRows > 0 && <p className="mt-2 text-sm text-warning">{preview.unassignedRows} tickets de revisión BO quedarán pendientes de asignación.</p>}
            <p className="mt-2 text-xs text-muted">Se evalúan Estado, Tarea actual, Finalizado y contexto administrativo. Las decisiones manuales vigentes se conservan.</p>
          </section>
          <section aria-labelledby="fl-preview-rows">
            <h3 id="fl-preview-rows" className="text-sm font-semibold text-ink">Filas válidas</h3>
            <div className="mt-2 max-h-64 overflow-auto rounded-xl border border-line">
              <table className="w-full text-left text-xs"><thead className="sticky top-0 bg-surface-2 text-muted"><tr><th className="px-3 py-2">CaVe</th><th className="px-3 py-2">Estudiante</th><th className="px-3 py-2">Acción</th><th className="px-3 py-2">Destino / cambios</th><th className="px-3 py-2">Responsable</th></tr></thead>
                <tbody>{preview.rows.slice(0, 100).map((row) => <tr className="border-t border-line" key={`${row.rowNumber}-${row.externalCaseId}`}><td className="whitespace-nowrap px-3 py-2 font-mono">{row.externalCaseId}</td><td className="max-w-48 truncate px-3 py-2">{row.studentName}<span className="block text-muted">{row.studentIdentifier}</span></td><td className="px-3 py-2"><Badge tone={actionTone(row.action)}>{actionLabel(row.action)}</Badge></td><td className="px-3 py-2"><span>{FLOKZU_CLASSIFICATION_LABELS[row.classification]}</span><span className="block text-muted">{row.reason}</span>{row.action === 'UPDATE' && <span className="mt-1 block text-warning">Estado: {row.previousStatus ?? '—'} → {row.nextStatus ?? '—'}<br />Tarea: {row.previousTask ?? '—'} → {row.nextTask ?? '—'}<br />Finalizado: {row.previousFinalized ?? '—'} → {row.nextFinalized ?? '—'}</span>}</td><td className="px-3 py-2">{row.assignmentName ?? (row.canAutoAssign && row.action === 'NEW' ? 'Pendiente' : '—')}</td></tr>)}</tbody>
              </table>
            </div>
            {preview.rows.length > 100 && <p className="mt-1 text-xs text-muted">Se muestran las primeras 100 de {preview.rows.length} filas válidas.</p>}
          </section>
        </div>
        {preview.issues.length > 0 && <section className="mt-5" aria-labelledby="fl-preview-errors"><h3 id="fl-preview-errors" className="text-sm font-semibold text-danger">Errores por fila</h3><ul className="mt-2 max-h-40 space-y-1 overflow-auto rounded-xl border border-danger/30 bg-danger/5 p-3 text-xs text-muted">{preview.issues.slice(0, 100).map((issue, index) => <li key={`${issue.rowNumber}-${index}`}>Fila {issue.rowNumber}{issue.externalCaseId ? ` · ${issue.externalCaseId}` : ''}: {issue.message}</li>)}</ul></section>}
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Button onClick={() => { void handleConfirm(); }} disabled={preview.validRows === 0 || confirming || uploading}>
            {confirming ? <><Spinner label="Importando expedientes" /> Importando…</> : 'Confirmar importación'}
          </Button>
          <p className="max-w-2xl text-xs text-muted">Los tickets fuera de auditoría pasan a Revisión Flokzu. Un CaVe existente se sincroniza sin duplicarlo; se conservan evidencias, dictámenes y decisiones manuales.</p>
        </div>
      </Panel>}

      <Panel title="Historial de importaciones" description="Últimas 30 cargas, con conteos y errores. Las vistas previas vencen después de 24 horas.">
        {loadingHistory ? <div className="flex min-h-20 items-center gap-3 text-sm text-muted"><Spinner label="Cargando historial" /> Cargando historial…</div> : imports.length === 0 ? <p className="text-sm text-muted">Todavía no hay importaciones.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="text-xs text-muted"><tr><th className="py-2 pr-4">Fecha</th><th className="py-2 pr-4">Estado</th><th className="py-2 pr-4">Detectados</th><th className="py-2 pr-4">Nuevos</th><th className="py-2 pr-4">Actualizados</th><th className="py-2 pr-4">Sin cambio</th><th className="py-2">Errores</th></tr></thead><tbody>{imports.map((item) => <tr key={item.id} className="border-t border-line"><td className="py-2 pr-4">{formatDateTime(item.createdAt)}</td><td className="py-2 pr-4"><Badge tone={item.status === 'COMPLETED' ? 'success' : item.status === 'EXPIRED' ? 'neutral' : 'warning'}>{item.status === 'COMPLETED' ? 'Completada' : item.status === 'EXPIRED' ? 'Vista previa vencida' : 'Vista previa'}</Badge></td><td className="py-2 pr-4">{item.totalRows}</td><td className="py-2 pr-4">{item.result?.created ?? item.newRows}</td><td className="py-2 pr-4">{item.result?.updated ?? item.changedRows}</td><td className="py-2 pr-4">{item.result?.unchanged ?? item.unchangedRows}</td><td className="py-2">{item.errorRows}</td></tr>)}</tbody></table></div>}
      </Panel>

      <Panel title="Responsables de expedientes Flokzu" description="Puedes cambiar el responsable cuando la distribución automática no corresponda. Dejar sin selección conserva el caso pendiente de asignación.">
        {cases.length === 0 ? <p className="text-sm text-muted">Aún no hay expedientes Flokzu para asignar.</p> : <><div className="max-h-[28rem] overflow-auto rounded-xl border border-line"><table className="w-full min-w-[660px] text-left text-sm"><thead className="sticky top-0 bg-surface-2 text-xs text-muted"><tr><th className="px-3 py-2">CaVe</th><th className="px-3 py-2">Estudiante</th><th className="px-3 py-2">Estado del expediente</th><th className="px-3 py-2">Responsable</th></tr></thead><tbody>{cases.map((item) => <tr key={item.id} className="border-t border-line"><td className="px-3 py-2 font-mono">{item.externalCaseId}</td><td className="px-3 py-2">{item.studentName ?? 'Sin nombre'}<span className="block text-xs text-muted">{item.studentIdentifier ?? 'Sin matrícula'}</span></td><td className="px-3 py-2"><Badge>{item.status}</Badge></td><td className="px-3 py-2"><select aria-label={`Responsable de ${item.externalCaseId}`} className="max-w-56 rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-xs text-ink" value={item.assignedTo ?? ''} disabled={assigningCase === item.id} onChange={(event) => { void handleReassign(item.id, event.target.value); }}><option value="">Pendiente de asignación</option>{assignees.map((assignee) => <option key={assignee.userId} value={assignee.userId}>{assignee.name ?? 'Asesor sin nombre de perfil'}</option>)}</select>{assigningCase === item.id && <Spinner label="Actualizando responsable" className="ml-2" />}</td></tr>)}</tbody></table></div>{casesNextOffset !== null && <div className="mt-3 flex items-center gap-3"><Button variant="ghost" disabled={loadingMoreCases} onClick={() => { void loadMoreCases(); }}>{loadingMoreCases ? <><Spinner label="Cargando expedientes" /> Cargando…</> : 'Cargar más expedientes'}</Button><span className="text-xs text-muted">{cases.length} cargados; quedan más expedientes por consultar.</span></div>}</>}
      </Panel>
    </div>
  );
}

function FlokzuImportLocalPreview(): ReactNode {
  return <div className="mx-auto flex max-w-7xl flex-col gap-5">
    <header><p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">Coordinación · Flokzu</p><h1 className="mt-1 text-2xl font-semibold text-ink">Importación de tickets</h1><p className="mt-2 max-w-3xl text-sm text-muted">Vista local con datos sintéticos. No carga archivos ni llama a la API.</p></header>
    <Panel title="Archivo diario" description="El libro debe ser .xlsx, tener una hoja y conservar los encabezados de Flokzu en la segunda fila."><div className="flex min-h-40 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-surface-2 px-5 py-7 text-center"><span className="text-base font-semibold text-ink">Arrastra aquí el Excel o selecciónalo</span><span className="text-sm text-muted">.xlsx · máximo 4 MB · sin modificación de archivos originales</span><span className="mt-1 rounded-full bg-surface-3 px-3 py-1 text-xs text-ink">test-flokzu-sintetico.xlsx · 48 KB</span></div><div className="mt-4 flex flex-wrap items-center gap-3"><Button disabled>Validar y ver vista previa</Button><span className="text-xs text-muted">Solo las filas válidas pasan a la vista previa.</span></div></Panel>
    <Panel title="Vista previa de importación" description="Exportación 12 oct 2026 · 4 filas detectadas · 3 válidas" actions={<Badge tone="brand">CaVe como clave · Flokzu</Badge>}><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Metric label="Tickets detectados" value={4} /><Metric label="Nuevos" value={2} tone="brand" /><Metric label="Requieren actualización" value={1} tone="warning" /><Metric label="Sin cambios" value={0} /><Metric label="Con errores" value={1} tone="danger" /></div><div className="mt-5 grid gap-5 lg:grid-cols-2"><section><h3 className="text-sm font-semibold text-ink">Distribución automática prevista</h3><ul className="mt-2 divide-y divide-line rounded-xl border border-line"><li className="flex justify-between px-3 py-2 text-sm"><span>Asesor A</span><strong>1</strong></li><li className="flex justify-between px-3 py-2 text-sm"><span>Asesor B</span><strong>1</strong></li></ul><p className="mt-2 text-xs text-muted">Solo revisión BO de CaVe entra al reparto.</p></section><section><h3 className="text-sm font-semibold text-ink">Filas válidas</h3><div className="mt-2 overflow-auto rounded-xl border border-line"><table className="w-full text-left text-xs"><thead className="bg-surface-2 text-muted"><tr><th className="px-3 py-2">CaVe</th><th className="px-3 py-2">Estudiante</th><th className="px-3 py-2">Acción</th><th className="px-3 py-2">Responsable</th></tr></thead><tbody><tr className="border-t border-line"><td className="px-3 py-2 font-mono">CaVe-31024</td><td className="px-3 py-2">Estudiante de muestra<span className="block text-muted">000123456</span></td><td className="px-3 py-2"><Badge tone="brand">Nuevo</Badge></td><td className="px-3 py-2">Asesor A</td></tr><tr className="border-t border-line"><td className="px-3 py-2 font-mono">CaVe-31025</td><td className="px-3 py-2">Estudiante de muestra<span className="block text-muted">000123456</span></td><td className="px-3 py-2"><Badge tone="warning">Actualizar</Badge></td><td className="px-3 py-2">—</td></tr></tbody></table></div></section></div><div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4"><Button disabled>Confirmar importación</Button><p className="text-xs text-muted">El Excel no inicia auditorías ni genera costos de IA.</p></div></Panel>
    <Panel title="Historial de importaciones" description="Últimas 30 cargas."><p className="text-sm text-muted">La vista previa local muestra el diseño sin consultar datos reales.</p></Panel>
    <Panel title="Responsables de expedientes Flokzu" description="Reasignación manual de los casos importados."><div className="rounded-xl border border-line px-3 py-4 text-sm text-muted">Los Coordinadores pueden cambiar el responsable desde la lista real de tickets Flokzu.</div></Panel>
  </div>;
}

function Metric({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'brand' | 'warning' | 'danger' }): ReactNode {
  const color = tone === 'brand' ? 'text-brand' : tone === 'warning' ? 'text-warning' : tone === 'danger' ? 'text-danger' : 'text-ink';
  return <div className="rounded-xl border border-line bg-surface-2 px-3 py-3"><div className="text-xs text-muted">{label}</div><div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</div></div>;
}
