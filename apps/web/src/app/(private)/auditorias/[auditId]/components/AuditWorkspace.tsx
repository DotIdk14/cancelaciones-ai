'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import type { AuditLogRecord, AuditRecord, AuditResultRecord, AuditRunRecord, EvidenceRecord, JobArtifactRecord, JobRecord } from '@cancelaciones/db';
import { DeleteAuditButton } from '@/components/DeleteAuditButton';
import { formatDateTime } from '@/lib/format';

export function AuditWorkspace({
  audit,
  evidences,
  jobs,
  artifacts,
  runs,
  events,
  result,
}: {
  audit: AuditRecord;
  evidences: EvidenceRecord[];
  jobs: JobRecord[];
  artifacts: JobArtifactRecord[];
  runs: AuditRunRecord[];
  events: AuditLogRecord[];
  result: AuditResultRecord | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function postAction(action: 'PROCESS_EVIDENCES' | 'START_AUDIT') {
    startTransition(async () => {
      setMessage(null);
      const response = await fetch(`/api/audits/${audit.id}/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { message?: string } | null;
        setMessage(body?.message ?? 'No fue posible encolar la acción.');
        return;
      }
      setMessage(action === 'PROCESS_EVIDENCES' ? 'Procesamiento de evidencias encolado.' : 'Audit run encolado.');
    });
  }

  return (
    <section className="mx-auto max-w-7xl px-6 py-8 text-ink">
      <header className="flex flex-col gap-4 rounded-2xl border border-line bg-surface-1 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <Link href="/auditorias" className="text-sm text-muted hover:text-ink">← Auditorías</Link>
          <h1 className="mt-2 text-2xl font-semibold">{audit.displayName ?? audit.externalCaseId ?? audit.id}</h1>
          <p className="mt-1 text-sm text-muted">Estado: <span className="font-mono text-ink">{audit.status}</span> · Creada {formatDateTime(audit.createdAt)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button disabled={isPending} onClick={() => postAction('PROCESS_EVIDENCES')} className="rounded-lg border border-line bg-surface-2 px-4 py-2 text-sm font-semibold hover:bg-white/5 disabled:opacity-60">Procesar evidencias</button>
          <button disabled={isPending} onClick={() => postAction('START_AUDIT')} className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-background hover:bg-white disabled:opacity-60">Iniciar audit run</button>
          <button disabled={isPending} onClick={() => fetch('/api/jobs/process', { method: 'POST' }).then(() => setMessage('Worker ejecutado.'))} className="rounded-lg border border-brand/40 bg-brand/10 px-4 py-2 text-sm font-semibold text-brand disabled:opacity-60">Procesar siguiente job</button>
          <DeleteAuditButton auditId={audit.id} auditLabel={audit.displayName ?? audit.externalCaseId ?? audit.id} redirectTo="/auditorias" />
        </div>
      </header>

      {message && <p className="mt-4 rounded-lg border border-brand/30 bg-brand/10 px-4 py-3 text-sm text-brand">{message}</p>}

      {result && (
        <section className="mt-6 rounded-2xl border border-success/30 bg-success/10 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-success">Resultado terminal</p>
          <h2 className="mt-2 text-xl font-semibold">{result.classification ?? result.status}</h2>
          <p className="mt-2 text-sm leading-6 text-ink">{result.summary}</p>
          <pre className="mt-4 max-h-80 overflow-auto rounded-lg bg-background p-4 text-xs text-muted">{JSON.stringify({ assessment: result.assessment, review: result.review }, null, 2)}</pre>
        </section>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Panel title="Evidencias" count={evidences.length}>
          <div className="divide-y divide-line">
            {evidences.map((evidence) => (
              <div key={evidence.id} className="grid gap-2 py-3 text-sm md:grid-cols-[1fr_auto]">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{evidence.originalFilename ?? evidence.filename}</p>
                  <p className="mt-1 text-xs text-muted">{evidence.kind} · {evidence.contentStatus} · {evidence.sha256?.slice(0, 12) ?? 'sin hash'}</p>
                </div>
                <a href={`/api/evidences/${evidence.id}/download?download=1`} className="rounded-md border border-line px-3 py-1.5 text-xs font-semibold hover:bg-white/5">Descargar</a>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Jobs" count={jobs.length}>
          <div className="space-y-2">
            {jobs.map((job) => <div key={job.id} className="rounded-lg border border-line bg-background p-3 text-xs"><p className="font-semibold text-ink">{job.jobType} · {job.status}</p><p className="mt-1 text-muted">Intentos {job.attemptCount}/{job.maxAttempts} · {job.lastErrorMessageSanitized ?? 'sin error'}</p></div>)}
          </div>
        </Panel>

        <Panel title="Runs" count={runs.length}>
          <div className="space-y-2">
            {runs.map((run) => <div key={run.id} className="rounded-lg border border-line bg-background p-3 text-xs"><p className="font-semibold">Run #{run.runNumber} · {run.status}</p><p className="mt-1 text-muted">Analyst: {run.analystModel ?? '—'} · Reviewer: {run.reviewerModel ?? '—'}</p></div>)}
          </div>
        </Panel>

        <Panel title="Artefactos y eventos" count={artifacts.length + events.length}>
          <div className="space-y-2 text-xs">
            {artifacts.slice(0, 10).map((artifact) => <div key={artifact.id} className="rounded-lg border border-line bg-background p-3"><p className="font-semibold">{artifact.artifactType}</p><p className="mt-1 text-muted">{artifact.evidenceId ?? artifact.jobId}</p></div>)}
            {events.slice(0, 5).map((event) => <div key={event.id} className="rounded-lg border border-line bg-background p-3"><p className="font-semibold">{event.eventType}</p><p className="mt-1 text-muted">{formatDateTime(event.occurredAt)}</p></div>)}
          </div>
        </Panel>
      </div>
    </section>
  );
}

function Panel({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-line bg-surface-1 p-5"><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">{title}</h2><span className="rounded-md bg-surface-3 px-2 py-1 text-xs text-muted">{count}</span></div>{children}</section>;
}
