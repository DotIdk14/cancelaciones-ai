'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type WorkflowState = 'idle' | 'uploading' | 'processing' | 'extracting' | 'evaluating' | 'done' | 'error';
type QueueJob = { id: string; jobType: string; status: string; progress: number; attemptCount?: number; maxAttempts?: number; lastErrorCode?: string | null; lastErrorMessage?: string | null };

const activeStatuses = new Set(['QUEUED', 'RUNNING', 'RETRY_SCHEDULED']);

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { message: text.slice(0, 500) };
  }
}

async function waitVisible(ms = 900) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function AuditWorkflow({ auditId, factRunId, skipAutoResume }: { auditId: string; factRunId?: string; skipAutoResume?: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const resumedRef = useRef(false);
  const [state, setState] = useState<WorkflowState>('idle');
  const [message, setMessage] = useState('Arrastra aquí los archivos del expediente.');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);

  const refreshQueue = useCallback(async () => {
    const response = await fetch(`/api/audits/${auditId}/jobs`, { cache: 'no-store' });
    const data = await readJson(response);
    if (!response.ok) throw new Error(String(data.message ?? 'No fue posible consultar la cola.'));
    const jobs = data.jobs as QueueJob[];
    return jobs ?? [];
  }, [auditId]);

  const waitForJobs = useCallback(async () => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const jobs = await refreshQueue();
      const failed = jobs.find((job) => job.status === 'FAILED');
      if (failed) throw new Error(failed.lastErrorMessage ?? `No se pudo procesar ${failed.jobType}.`);
      const active = jobs.some((job) => activeStatuses.has(job.status));
      if (!active) return;
      const processResponse = await fetch('/api/jobs/process', { method: 'POST' });
      if (!processResponse.ok) {
        const processData = await readJson(processResponse);
        throw new Error(String(processData.message ?? 'No fue posible ejecutar el siguiente job.'));
      }
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    throw new Error('La cola no terminó dentro del tiempo esperado. Revisa el detalle de jobs.');
  }, [refreshQueue]);

  /**
   * Pipeline final compartido: extrae hechos, espera la cola, congela el fact
   * run y evalúa la política. Lo usan el flujo manual (run) y el auto-resume.
   */
  const finishPipeline = useCallback(async () => {
    const existingEvaluationResponse = await fetch(`/api/audits/${auditId}/policy`, { cache: 'no-store' });
    const existingEvaluationData = await readJson(existingEvaluationResponse);
    if (existingEvaluationResponse.ok && existingEvaluationData.engineRun) {
      setState('done');
      setMessage('Dictamen ya generado. No se volvió a ejecutar la auditoría automáticamente.');
      router.refresh();
      return;
    }

    setState('extracting');
    setMessage('Extrayendo hechos para preparar el dictamen…');
    await waitVisible();
    const factsResponse = await fetch(`/api/audits/${auditId}/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'action=EXTRACT_FACTS',
    });
    const factsData = await readJson(factsResponse);
    if (!factsResponse.ok) throw new Error(String(factsData.message ?? 'No fue posible extraer los hechos.'));
    await waitForJobs();

    const runsResponse = await fetch(`/api/audits/${auditId}/fact-runs`, { cache: 'no-store' });
    const runsData = await readJson(runsResponse);
    if (!runsResponse.ok) throw new Error(String(runsData.message ?? 'No fue posible consultar los hechos extraídos.'));
    const run = runsData.selectedRun as { id: string; state: string } | null;
    if (!run) throw new Error('No se creó el análisis de hechos.');
    if (run.state !== 'FROZEN') {
      const freezeResponse = await fetch(`/api/audits/${auditId}/fact-runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `action=FREEZE&factRunId=${encodeURIComponent(run.id)}`,
      });
      if (!freezeResponse.ok) {
        const freezeData = await readJson(freezeResponse);
        throw new Error(String(freezeData.message ?? 'No fue posible congelar los hechos.'));
      }
    }

    setState('evaluating');
    setMessage('Evaluando la política normativa…');
    await waitVisible();
    const evaluationResponse = await fetch(`/api/audits/${auditId}/policy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ policyCode: 'GDM_GAM_PRD_MLG_003', policyVersion: '5', factRunId: run.id }),
    });
    const evaluationData = await readJson(evaluationResponse);
    if (!evaluationResponse.ok) throw new Error(String(evaluationData.message ?? 'No fue posible generar el dictamen.'));
    setState('done');
    const evaluation = evaluationData.evaluation as { suggestedOutcome?: string } | undefined;
    setMessage(`Dictamen listo: ${evaluation?.suggestedOutcome ?? 'INDETERMINADO'}.`);
    router.refresh();
  }, [auditId, router, waitForJobs]);

  /**
   * Fase 3 — Auto-resume: al montar el workspace, si la cola tiene jobs
   * pendientes (QUEUED/RUNNING/RETRY_SCHEDULED) se drena con POST
   * /api/jobs/process y se continúa el pipeline hasta el dictamen. Así una
   * auditoría creada desde /nueva retoma su procesamiento automáticamente.
   */
  useEffect(() => {
    if (skipAutoResume || resumedRef.current) return;
    resumedRef.current = true;
    void (async () => {
      try {
        const jobs = await refreshQueue();
        const hasActive = jobs.some((job) => activeStatuses.has(job.status));
        if (!hasActive) return;
        setState('processing');
        setError('');
        setMessage('Retomando el procesamiento pendiente del expediente…');
        await waitVisible(1200);
        await waitForJobs();
        await finishPipeline();
      } catch (cause) {
        setState('error');
        setError(cause instanceof Error ? cause.message : 'Ocurrió un error durante el análisis.');
        setMessage('No se completó el análisis.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = useCallback(async (files: File[], rerun = false) => {
    if ((!files.length && !rerun) || state !== 'idle' && state !== 'error') return;
    setState('uploading');
    setError('');
    setMessage(`Subiendo ${files.length} archivo${files.length === 1 ? '' : 's'}…`);
    try {
      if (!rerun) {
        const form = new FormData();
        files.forEach((file) => form.append('files', file));
        const uploadResponse = await fetch(`/api/audits/${auditId}/evidences`, { method: 'POST', body: form });
        const uploadData = await readJson(uploadResponse);
        if (!uploadResponse.ok && uploadResponse.status !== 207) throw new Error(String(uploadData.message ?? 'No fue posible subir la evidencia.'));
        const failed = (uploadData.results as Array<{ status: string; message?: string }>).filter((item) => item.status === 'FAILED');
        if (failed.length === (uploadData.results as unknown[]).length) throw new Error(failed[0]?.message ?? 'No se pudo guardar ningún archivo.');
      }

      setState('processing');
      setMessage('Procesando evidencias y actualizando la cola…');
      await waitVisible();
      const processResponse = await fetch(`/api/audits/${auditId}/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `action=${rerun ? 'RERUN_EVIDENCES' : 'PROCESS_EVIDENCES'}`,
      });
      const processData = await readJson(processResponse);
      if (!processResponse.ok) throw new Error(String(processData.message ?? 'No fue posible iniciar el procesamiento.'));
      await waitForJobs();
      await finishPipeline();
    } catch (cause) {
      setState('error');
      setError(cause instanceof Error ? cause.message : 'Ocurrió un error durante el análisis.');
      setMessage('No se completó el análisis.');
    }
  }, [auditId, state, waitForJobs, finishPipeline]);

  const generateDecision = useCallback(async () => {
    if (!factRunId || (state !== 'idle' && state !== 'error' && state !== 'done')) return;
    setState('evaluating');
    setError('');
    setMessage('Generando el dictamen con los hechos ya procesados…');
    try {
      const response = await fetch(`/api/audits/${auditId}/policy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ policyCode: 'GDM_GAM_PRD_MLG_003', policyVersion: '5', factRunId }),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(String(data.message ?? 'No fue posible generar el dictamen.'));
      setState('done');
      const evaluation = data.evaluation as { suggestedOutcome?: string } | undefined;
      setMessage(`Dictamen listo: ${evaluation?.suggestedOutcome ?? 'INDETERMINADO'}.`);
      router.refresh();
    } catch (cause) {
      setState('error');
      setError(cause instanceof Error ? cause.message : 'No fue posible generar el dictamen.');
      setMessage('No se completó el dictamen.');
    }
  }, [auditId, factRunId, router, state]);

  const retryAnalysis = useCallback(async () => {
    if (state !== 'error') return;
    setState('processing');
    setError('');
    setMessage('Reintentando el analisis con las evidencias ya almacenadas…');
    try {
      const jobs = await refreshQueue();
      const hasActive = jobs.some((job) => activeStatuses.has(job.status));
      if (hasActive) {
        await waitVisible(1200);
        await waitForJobs();
      }
      await finishPipeline();
    } catch (cause) {
      setState('error');
      setError(cause instanceof Error ? cause.message : 'Ocurrió un error durante el análisis.');
      setMessage('No se completó el análisis.');
    }
  }, [finishPipeline, refreshQueue, state, waitForJobs]);

  function onInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    void run(Array.from(event.target.files ?? []));
    event.target.value = '';
  }

  return (
    <section className="rounded-3xl border border-brand/20 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">Flujo automático</p>
          <h2 className="mt-2 text-2xl font-bold text-ink">Obtén tu dictamen en un solo paso</h2>
          <p className="mt-2 text-sm text-slate-600">Sube el expediente. El sistema guarda los originales, procesa la cola, extrae hechos y evalúa la política.</p>
        </div>
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">{state === 'idle' ? 'Listo' : state === 'done' ? 'Completado' : 'Workers activos'}</span>
      </div>
      <button
        type="button"
        className={`mt-6 flex min-h-44 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed p-6 text-center transition ${dragging ? 'border-brand bg-teal-50' : 'border-slate-300 bg-slate-50 hover:border-brand hover:bg-teal-50'} disabled:cursor-wait disabled:opacity-60`}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); void run(Array.from(event.dataTransfer.files)); }}
        disabled={state !== 'idle' && state !== 'error'}
      >
        <span className="text-4xl">⇧</span>
        <span className="mt-2 font-semibold text-slate-800">Arrastra tus evidencias aquí</span>
        <span className="mt-1 text-sm text-slate-500">o haz clic para elegir varios archivos</span>
        <span className="mt-3 text-xs text-slate-400">PDF, imágenes, audio, TXT, CSV, DOCX y XLSX · máximo 50 MB por archivo</span>
      </button>
      <input ref={inputRef} className="hidden" type="file" multiple onChange={onInputChange} />
      <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700" aria-live="polite">{message}</div>
      {state !== 'idle' && state !== 'error' && state !== 'done' && <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full w-1/2 animate-pulse rounded-full bg-brand" /></div>}
      {error && <p className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {factRunId && state === 'idle' && <button type="button" onClick={() => void generateDecision()} className="mt-4 block text-sm font-semibold text-brand hover:underline">Generar dictamen con los datos actuales</button>}
      {state === 'idle' && <button type="button" onClick={() => void run([], true)} className="mt-4 block text-sm font-semibold text-brand hover:underline">Procesar evidencias ya cargadas</button>}
      {state === 'error' && <button type="button" onClick={() => void retryAnalysis()} className="mt-4 text-sm font-semibold text-brand hover:underline">Intentar de nuevo</button>}
      {state === 'done' && <button type="button" onClick={() => { setState('idle'); setError(''); setMessage('Puedes agregar evidencias; no se recalculará el dictamen hasta que lo solicites.'); }} className="mt-4 text-sm font-semibold text-brand hover:underline">Agregar evidencias</button>}
      {state === 'done' && <button type="button" onClick={() => void run([], true)} className="ml-4 mt-4 text-sm font-semibold text-brand hover:underline">Crear nueva auditoría con evidencias actuales</button>}
    </section>
    );
}
