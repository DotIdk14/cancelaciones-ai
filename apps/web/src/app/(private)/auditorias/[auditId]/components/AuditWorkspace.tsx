'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { formatDateTime } from '@/lib/format';
import type { DictamenDocumentRecord, EvidenceRow } from './types';
import { AuditStatusBadge } from './AuditStatusBadge';
import { ManualCommentsPanel } from './ManualCommentsPanel';
import { AuditWorkflow } from '../AuditWorkflow';
import { DeleteAuditButton } from '@/components/DeleteAuditButton';
import { AUDIT_ENGINE_NOT_IMPLEMENTED } from '@/server/audit-engine/boundary';

type InspectorTab = 'carga' | 'motor' | 'comentarios';

type TranscriptArtifact = {
  id: string;
  evidenceId: string | null;
  result: Record<string, unknown>;
};

type AuditHeader = {
  id: string;
  displayName: string | null;
  externalCaseId: string | null;
  createdAt: string;
};

export function AuditWorkspace({
  audit,
  status,
  evidences,
  transcripts,
  factRunId,
  extractorVersion,
  manualComments,
  commentsSaved,
  documents,
}: {
  audit: AuditHeader;
  status: string;
  evidences: EvidenceRow[];
  transcripts: TranscriptArtifact[];
  factRunId?: string | null;
  extractorVersion?: string | null;
  manualComments: Parameters<typeof ManualCommentsPanel>[0]['comments'];
  commentsSaved?: boolean;
  documents?: DictamenDocumentRecord[];
}) {
  const [selectedEvidenceId, setSelectedEvidenceId] = useState(evidences[0]?.id ?? '');
  const [tab, setTab] = useState<InspectorTab>('motor');
  const selectedEvidence = evidences.find((evidence) => evidence.id === selectedEvidenceId) ?? evidences[0] ?? null;
  const selectedTranscript = useMemo(() => {
    return transcripts.find((artifact) => artifact.evidenceId === selectedEvidence?.id) ?? transcripts[0] ?? null;
  }, [selectedEvidence?.id, transcripts]);
  const utterances = selectedTranscript?.result.utterances as Array<{ speaker?: string; text?: string; start?: number }> | undefined;
  const downloadDoc = documents?.find((doc) => doc.kind === 'FINAL') ?? documents?.find((doc) => doc.kind === 'DRAFT');

  return (
    <section className="h-screen overflow-hidden bg-background p-2 text-ink">
      <div className="grid h-full grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-line bg-[#0f1319]">
        <header className="grid grid-cols-[72px_minmax(260px,1fr)_minmax(300px,1.15fr)_minmax(240px,300px)] gap-2 border-b border-line bg-surface-1 p-2">
          <Link href="/auditorias" className="inline-flex items-center justify-center rounded-md border border-line bg-surface-2 text-xs font-semibold text-ink hover:bg-white/5">⌂ HOME</Link>
          <div className="rounded-md border border-line bg-surface-2 px-3 py-2">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted">Nombre: <span className="font-sans font-semibold normal-case text-ink">{audit.displayName ?? 'Expediente de auditoría'}</span></p>
            <p className="mt-1 font-mono text-[10px] text-muted">Matrícula: — <span className="mx-2">•</span> Fecha de inicio: {formatDateTime(audit.createdAt)}</p>
          </div>
          <div className="rounded-md border border-line bg-surface-2 px-3 py-2">
            <div className="flex items-center justify-between gap-2"><p className="font-mono text-[10px] uppercase tracking-wider text-muted">Número de caso: <span className="font-sans font-semibold text-brand">{audit.externalCaseId ?? audit.id.slice(0, 13)}</span></p><AuditStatusBadge status={status} /></div>
            <p className="mt-1 font-mono text-[10px] text-muted">Ticket: {formatDateTime(audit.createdAt)} <span className="mx-2">•</span> Extracción: {extractorVersion ?? '—'}</p>
          </div>
          <div className="flex items-center gap-2">
            {downloadDoc ? (
              <a href={`/api/audits/${audit.id}/dictamen/${downloadDoc.id}/download`} className="inline-flex min-w-0 flex-1 items-center justify-center rounded-md bg-[#5b8cff] px-3 py-2 text-center text-xs font-semibold text-white hover:bg-[#6d99ff]">⇩ Descargar documento</a>
            ) : (
              <span className="inline-flex min-w-0 flex-1 cursor-not-allowed items-center justify-center rounded-md border border-line bg-surface-2 px-3 py-2 text-center text-xs font-semibold text-muted" title="No existe ningún dictamen: el motor de auditoría no está implementado">⇩ Sin documento</span>
            )}
            <DeleteAuditButton auditId={audit.id} auditLabel={audit.displayName ?? undefined} redirectTo="/auditorias" compact />
          </div>
        </header>

        <div className="grid grid-cols-[220px_minmax(420px,1fr)_360px] border-b border-line bg-surface-1 text-[11px] text-muted">
          <div className="flex items-center justify-between border-r border-line px-3 py-2"><span className="font-semibold text-ink">Evidencias</span><span>{evidences.length}</span></div>
          <div className="flex items-center gap-3 px-4 py-2"><span className="rounded border border-warning/25 bg-warning/10 px-2 py-1 text-warning">{AUDIT_ENGINE_NOT_IMPLEMENTED}</span></div>
          <div className="flex items-center gap-1 border-l border-line px-3 py-2">
            {(['motor', 'carga', 'comentarios'] as InspectorTab[]).map((item) => <button key={item} onClick={() => setTab(item)} className={`rounded-md px-3 py-1.5 text-xs capitalize ${tab === item ? 'border border-line bg-surface-2 text-ink' : 'text-muted hover:text-ink'}`}>{item}</button>)}
          </div>
        </div>

        <div className="grid min-h-0 grid-cols-[220px_minmax(420px,1fr)_360px]">
          <aside className="flex min-h-0 flex-col border-r border-line bg-surface-1">
            <div className="flex items-center justify-between px-3 py-3 text-xs"><span className="font-semibold text-ink">Archivos</span><button type="button" onClick={() => setTab('carga')} className="text-brand">+ Agregar</button></div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
              {evidences.map((evidence) => <button key={evidence.id} onClick={() => setSelectedEvidenceId(evidence.id)} className={`flex w-full gap-2 rounded-md p-2 text-left transition ${selectedEvidence?.id === evidence.id ? 'bg-surface-3' : 'hover:bg-surface-2'}`}>
                <span className={`mt-1 grid h-6 w-7 shrink-0 place-items-center rounded text-[10px] font-semibold ${kindColor(evidence.detectedMimeType)}`}>{fileKind(evidence.detectedMimeType)}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-ink">{evidence.originalFilename}</span><span className="mt-1 block text-[10px] text-muted">{formatSize(evidence.sizeBytes)}</span></span>
                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-success" />
              </button>)}
            </div>
            <div className="border-t border-line px-3 py-2 text-[10px] text-muted"><span className="text-success">●</span> Almacenamiento seguro <span className="float-right">SHA-256</span></div>
          </aside>

          <main className="min-h-0 overflow-hidden bg-[#0d1117] p-5">
            <EvidenceViewer evidence={selectedEvidence} utterances={utterances} transcriptId={selectedTranscript?.id} />
          </main>

          <aside className="min-h-0 overflow-y-auto border-l border-line bg-surface-1 p-4">
            {tab === 'motor' && <AuditEngineInspector factRunId={factRunId ?? null} />}
            {tab === 'carga' && <UploadInspector auditId={audit.id} factRunId={factRunId ?? undefined} />}
            {tab === 'comentarios' && <ManualCommentsPanel auditId={audit.id} comments={manualComments} saved={commentsSaved} />}
          </aside>
        </div>
      </div>
    </section>
  );
}

/**
 * Inspector de la frontera del motor.
 *
 * Muestra el estado real del sistema: la ingestion de evidencia funciona, pero
 * no existe motor normativo. No hay reglas, resultados ni acciones que
 * pretendan resolver un caso.
 */
function AuditEngineInspector({ factRunId }: { factRunId: string | null }) {
  return (
    <div className="space-y-4" id="motor">
      <div className="rounded-lg border border-warning/25 bg-warning/10 p-4">
        <p className="font-mono text-[10px] uppercase tracking-wider text-warning">Estado del sistema</p>
        <p className="mt-2 text-sm font-black uppercase tracking-wide text-warning">{AUDIT_ENGINE_NOT_IMPLEMENTED}</p>
        <p className="mt-3 text-xs leading-5 text-ink">
          La carga, el procesamiento y la extracción de hechos están disponibles. La evaluación normativa
          no está implementada: este sistema no emite dictámenes, resoluciones ni decisiones de deserción.
        </p>
      </div>
      <div className="rounded-lg border border-line bg-surface-2 p-4 text-xs">
        <p className="font-semibold text-ink">Pipeline disponible</p>
        <ol className="mt-3 space-y-2 text-muted">
          <li>1. Ingesta de evidencia (archivos, hashes, procedencia)</li>
          <li>2. Procesamiento y transcripción</li>
          <li>3. Extracción de hechos observables</li>
        </ol>
        <p className="mt-4 border-t border-line pt-3 font-semibold text-warning">Detenido en este punto.</p>
        <ol className="mt-2 space-y-2 text-muted">
          <li>4. Árbol de decisión normativo — no implementado</li>
          <li>5. Resultado normativo y dictamen — no implementado</li>
        </ol>
      </div>
      {factRunId && (
        <div className="rounded-lg border border-line bg-surface-2 p-4 text-xs">
          <p className="font-semibold text-ink">Hechos extraídos</p>
          <p className="mt-2 text-muted">Run de extracción: <span className="font-mono text-[10px] text-ink">{factRunId}</span></p>
          <p className="mt-2 text-muted">Los hechos son evidencia estructurada, no una decisión. Ninguna regla normativa se ha aplicado.</p>
        </div>
      )}
    </div>
  );
}

function UploadInspector({ auditId, factRunId }: { auditId: string; factRunId?: string }) {
  return (
    <div className="space-y-3">
      <AuditWorkflow auditId={auditId} factRunId={factRunId} />
      <p className="rounded-lg border border-brand/20 bg-brand/10 p-3 text-xs leading-5 text-brand">
        Al seleccionar o arrastrar archivos, la carga inicia automáticamente y después se ejecutan el procesamiento
        y la extracción de hechos. La evaluación normativa está deshabilitada: no forma parte de este pipeline.
      </p>
    </div>
  );
}

function EvidenceViewer({ evidence, utterances, transcriptId }: { evidence: EvidenceRow | null; utterances?: Array<{ speaker?: string; text?: string; start?: number }>; transcriptId?: string }) {
  if (!evidence) return <div className="grid h-full place-items-center text-sm text-muted">No hay evidencia seleccionada.</div>;
  const kind = fileKind(evidence.detectedMimeType);
  if (kind === 'AUD' || utterances) return <div className="mx-auto flex h-full max-w-3xl flex-col rounded-lg border border-line bg-surface-1 p-4">
    <div className="flex items-center justify-between border-b border-line pb-3"><h2 className="font-semibold text-ink">▣ Transcripción</h2><div className="flex gap-2 text-[11px]"><span className="rounded bg-surface-3 px-2 py-1">{utterances?.length ?? 0} intervenciones</span><span className="rounded bg-surface-3 px-2 py-1">Whisper Large v3</span><span className="rounded border border-line px-2 py-1">Buscar</span></div></div>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pt-4">{(utterances ?? []).map((u, i) => <div key={`${transcriptId}-${i}`} className={`max-w-[86%] rounded-lg border p-3 text-xs leading-5 ${i % 2 ? 'ml-auto border-white/70 bg-background' : 'border-line bg-surface-2'}`}><div className="mb-2 flex justify-between text-[10px] font-semibold text-muted"><span>{u.speaker ?? 'Participante'}</span><span>{typeof u.start === 'number' ? `${Math.round(u.start / 1000).toString().padStart(2, '0')}:00` : ''}</span></div><p className="text-ink">{u.text}</p></div>)}</div>
  </div>;
  const src = `/api/evidences/${evidence.id}/download`;
  if (kind === 'IMG') return <div className="flex h-full min-h-0 flex-col rounded-lg border border-line bg-surface-1"><EvidenceToolbar evidence={evidence} src={src} />
    <div className="grid min-h-0 flex-1 place-items-center overflow-hidden bg-[#0d1117] p-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`${src}?inline=1`} alt={evidence.originalFilename} className="max-h-full max-w-full object-contain shadow-sm" />
    </div>
  </div>;
  if (kind === 'PDF' || kind === 'TXT') return <div className="flex h-full min-h-0 flex-col rounded-lg border border-line bg-surface-1"><EvidenceToolbar evidence={evidence} src={src} /><iframe src={`${src}?inline=1`} title={evidence.originalFilename} className="min-h-0 w-full flex-1" /></div>;
  return <div className="grid h-full place-items-center rounded-lg border border-line bg-surface-1"><div className="text-center"><div className="mx-auto mb-4 grid h-44 w-36 place-items-center rounded-lg border border-line bg-surface-2 text-danger">{kind}</div><p className="text-sm font-semibold text-ink">{evidence.originalFilename}</p><div className="mt-3 flex justify-center gap-2"><a className="rounded-md border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-white/5" href={`${src}?inline=1`} target="_blank" rel="noreferrer">Ver en el navegador</a><a className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white" href={`${src}?download=1`}>Descargar</a></div></div></div>;
}

function EvidenceToolbar({ evidence, src }: { evidence: EvidenceRow; src: string }) {
  return <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
    <div className="min-w-0"><p className="truncate text-sm font-semibold text-ink">{evidence.originalFilename}</p><p className="mt-0.5 text-[11px] text-muted">{evidence.detectedMimeType} · {formatSize(evidence.sizeBytes)}</p></div>
    <div className="flex shrink-0 gap-2"><a className="rounded-md border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-white/5" href={`${src}?inline=1`} target="_blank" rel="noreferrer">Abrir en pestaña</a><a className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white" href={`${src}?download=1`}>Descargar</a></div>
  </div>;
}

function fileKind(mimeType?: string | null) { const mime = mimeType?.toLowerCase() ?? ''; if (mime.includes('pdf')) return 'PDF'; if (mime.includes('image')) return 'IMG'; if (mime.includes('audio')) return 'AUD'; if (mime.includes('sheet') || mime.includes('excel')) return 'XLS'; if (mime.includes('word') || mime.includes('document')) return 'DOC'; if (mime.includes('text')) return 'TXT'; return 'FILE'; }
function kindColor(mimeType?: string | null) { const kind = fileKind(mimeType); if (kind === 'PDF') return 'bg-danger/20 text-danger'; if (kind === 'IMG') return 'bg-brand/20 text-brand'; if (kind === 'AUD') return 'bg-warning/20 text-warning'; return 'bg-surface-3 text-muted'; }
function formatSize(bytes: number) { return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`; }
