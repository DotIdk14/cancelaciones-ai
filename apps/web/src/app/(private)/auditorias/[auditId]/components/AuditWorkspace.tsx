'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { formatDateTime } from '@/lib/format';
import type { DictamenDocumentRecord, EvaluatedRule, EvidenceRow, HumanReviewRecord, MissingItem, PolicyEvaluationShape, SnapshotRecord } from './types';
import { AuditStatusBadge } from './AuditStatusBadge';
import { DictamenWorkflow } from './DictamenWorkflow';
import { HumanReviewCard } from './HumanReviewCard';
import { ManualCommentsPanel } from './ManualCommentsPanel';
import { RuleGroupList } from './RuleGroupList';

type InspectorTab = 'dictamen' | 'reglas' | 'comentarios';

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
  evaluation,
  policyVersion,
  manualComments,
  commentsSaved,
  humanReview,
  snapshot,
  documents,
  hasHumanReview,
  rules,
  missingItems,
  ruleLabels,
}: {
  audit: AuditHeader;
  status: string;
  evidences: EvidenceRow[];
  transcripts: TranscriptArtifact[];
  evaluation?: PolicyEvaluationShape | null;
  policyVersion?: string | null;
  manualComments: Parameters<typeof ManualCommentsPanel>[0]['comments'];
  commentsSaved?: boolean;
  humanReview?: HumanReviewRecord | null;
  snapshot?: SnapshotRecord | null;
  documents?: DictamenDocumentRecord[];
  hasHumanReview: boolean;
  rules: EvaluatedRule[];
  missingItems: MissingItem[];
  ruleLabels: Record<string, string>;
}) {
  const [selectedEvidenceId, setSelectedEvidenceId] = useState(evidences[0]?.id ?? '');
  const [tab, setTab] = useState<InspectorTab>('dictamen');
  const selectedEvidence = evidences.find((evidence) => evidence.id === selectedEvidenceId) ?? evidences[0] ?? null;
  const selectedTranscript = useMemo(() => {
    return transcripts.find((artifact) => artifact.evidenceId === selectedEvidence?.id) ?? transcripts[0] ?? null;
  }, [selectedEvidence?.id, transcripts]);
  const utterances = selectedTranscript?.result.utterances as Array<{ speaker?: string; text?: string; start?: number }> | undefined;
  const resolution = normalizeResolution(evaluation?.suggestedOutcome, evaluation?.decisionStatus ?? evaluation?.outcomeStatus);
  const finalDoc = documents?.find((doc) => doc.kind === 'FINAL');
  const draftDoc = documents?.find((doc) => doc.kind === 'DRAFT');
  const downloadDoc = finalDoc ?? draftDoc;

  return (
    <section className="h-screen overflow-hidden bg-background p-2 text-ink">
      <div className="grid h-full grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-line bg-[#0f1319]">
        <header className="grid grid-cols-[72px_minmax(260px,1fr)_minmax(300px,1.15fr)_220px] gap-2 border-b border-line bg-surface-1 p-2">
          <Link href="/auditorias" className="inline-flex items-center justify-center rounded-md border border-line bg-surface-2 text-xs font-semibold text-ink hover:bg-white/5">⌂ HOME</Link>
          <div className="rounded-md border border-line bg-surface-2 px-3 py-2">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted">Nombre: <span className="font-sans font-semibold normal-case text-ink">{audit.displayName ?? 'Expediente de auditoría'}</span></p>
            <p className="mt-1 font-mono text-[10px] text-muted">Matrícula: — <span className="mx-2">•</span> Fecha de inicio: {formatDateTime(audit.createdAt)}</p>
          </div>
          <div className="rounded-md border border-line bg-surface-2 px-3 py-2">
            <div className="flex items-center justify-between gap-2"><p className="font-mono text-[10px] uppercase tracking-wider text-muted">Número de caso: <span className="font-sans font-semibold text-brand">{audit.externalCaseId ?? audit.id.slice(0, 13)}</span></p><AuditStatusBadge status={status} /></div>
            <p className="mt-1 font-mono text-[10px] text-muted">Ticket: {formatDateTime(audit.createdAt)} <span className="mx-2">•</span> Política: {policyVersion ?? '—'}</p>
          </div>
          <a href={downloadDoc ? `/api/audits/${audit.id}/dictamen/${downloadDoc.id}/download` : '#dictamen'} className="inline-flex items-center justify-center rounded-md bg-[#5b8cff] px-3 py-2 text-center text-xs font-semibold text-white hover:bg-[#6d99ff]">⇩ Resolución / Descarga del dictamen</a>
        </header>

        <div className="grid grid-cols-[220px_minmax(420px,1fr)_360px] border-b border-line bg-surface-1 text-[11px] text-muted">
          <div className="flex items-center justify-between border-r border-line px-3 py-2"><span className="font-semibold text-ink">Evidencias</span><span>{evidences.length}</span></div>
          <div className="flex items-center gap-5 px-4 py-2"><span>−</span><span>100%</span><span>＋</span><span>‹</span><span>Pág 3 de 7</span><span>›</span><span className="rounded border border-brand/25 bg-brand/10 px-2 py-1 text-brand">Marcador de regla (1)</span></div>
          <div className="flex items-center gap-1 border-l border-line px-3 py-2">
            {(['dictamen', 'reglas', 'comentarios'] as InspectorTab[]).map((item) => <button key={item} onClick={() => setTab(item)} className={`rounded-md px-3 py-1.5 text-xs capitalize ${tab === item ? 'border border-line bg-surface-2 text-ink' : 'text-muted hover:text-ink'}`}>{item}</button>)}
          </div>
        </div>

        <div className="grid min-h-0 grid-cols-[220px_minmax(420px,1fr)_360px]">
          <aside className="flex min-h-0 flex-col border-r border-line bg-surface-1">
            <div className="flex items-center justify-between px-3 py-3 text-xs"><span className="font-semibold text-ink">Archivos</span><Link href={`/auditorias/${audit.id}`} className="text-brand">+ Agregar</Link></div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
              {evidences.map((evidence) => <button key={evidence.id} onClick={() => setSelectedEvidenceId(evidence.id)} className={`flex w-full gap-2 rounded-md p-2 text-left transition ${selectedEvidence?.id === evidence.id ? 'bg-surface-3' : 'hover:bg-surface-2'}`}>
                <span className={`mt-1 grid h-6 w-7 shrink-0 place-items-center rounded text-[10px] font-semibold ${kindColor(evidence.detectedMimeType)}`}>{fileKind(evidence.detectedMimeType)}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-ink">{evidence.originalFilename}</span><span className="mt-1 block text-[10px] text-muted">{formatSize(evidence.sizeBytes)}</span></span>
                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-success" />
              </button>)}
            </div>
            {selectedEvidence && fileKind(selectedEvidence.detectedMimeType) === 'AUD' && <div className="border-t border-line p-3 text-[11px]">
              <p className="font-semibold text-ink">🔊 Reproductor de Audio</p><p className="mt-2 truncate text-muted">{selectedEvidence.originalFilename}</p><div className="mt-3 h-1 rounded bg-surface-3"><div className="h-full w-2/3 rounded bg-brand" /></div><div className="mt-3 flex gap-2"><button>◌</button><button>▶</button><span className="rounded bg-surface-3 px-2 py-1">1.0x</span><span className="ml-auto rounded border border-brand/20 bg-brand/10 px-2 py-1 text-brand">Regla 5.2</span></div>
            </div>}
            <div className="border-t border-line px-3 py-2 text-[10px] text-muted"><span className="text-success">●</span> Almacenamiento seguro <span className="float-right">SHA-256</span></div>
          </aside>

          <main className="min-h-0 overflow-hidden bg-[#0d1117] p-5">
            <EvidenceViewer evidence={selectedEvidence} utterances={utterances} transcriptId={selectedTranscript?.id} />
          </main>

          <aside className="min-h-0 overflow-y-auto border-l border-line bg-surface-1 p-4">
            {tab === 'dictamen' && <DictamenInspector auditId={audit.id} resolution={resolution} evaluation={evaluation} humanReview={humanReview} snapshot={snapshot} documents={documents} hasHumanReview={hasHumanReview} />}
            {tab === 'reglas' && <RulesInspector rules={rules} missingItems={missingItems} ruleLabels={ruleLabels} onSelectEvidence={(id) => setSelectedEvidenceId(id)} />}
            {tab === 'comentarios' && <ManualCommentsPanel auditId={audit.id} comments={manualComments} saved={commentsSaved} />}
          </aside>
        </div>
      </div>
    </section>
  );
}

function EvidenceViewer({ evidence, utterances, transcriptId }: { evidence: EvidenceRow | null; utterances?: Array<{ speaker?: string; text?: string; start?: number }>; transcriptId?: string }) {
  if (!evidence) return <div className="grid h-full place-items-center text-sm text-muted">No hay evidencia seleccionada.</div>;
  const kind = fileKind(evidence.detectedMimeType);
  if (kind === 'AUD' || utterances) return <div className="mx-auto flex h-full max-w-3xl flex-col rounded-lg border border-line bg-surface-1 p-4">
    <div className="flex items-center justify-between border-b border-line pb-3"><h2 className="font-semibold text-ink">▣ Transcripción</h2><div className="flex gap-2 text-[11px]"><span className="rounded bg-surface-3 px-2 py-1">{utterances?.length ?? 0} intervenciones</span><span className="rounded bg-surface-3 px-2 py-1">Whisper Large v3</span><span className="rounded border border-line px-2 py-1">Buscar</span></div></div>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pt-4">{(utterances ?? []).map((u, i) => <div key={`${transcriptId}-${i}`} className={`max-w-[86%] rounded-lg border p-3 text-xs leading-5 ${i % 2 ? 'ml-auto border-white/70 bg-background' : 'border-line bg-surface-2'}`}><div className="mb-2 flex justify-between text-[10px] font-semibold text-muted"><span>{u.speaker ?? 'Participante'}</span><span>{typeof u.start === 'number' ? `${Math.round(u.start / 1000).toString().padStart(2, '0')}:00` : ''}</span></div><p className="text-ink">{u.text}</p></div>)}</div>
  </div>;
  if (kind === 'IMG') return <div className="grid h-full place-items-center rounded-lg border border-line bg-surface-1"><div className="text-center"><div className="mx-auto mb-4 grid h-40 w-56 place-items-center rounded-lg border border-line bg-surface-2 text-brand">IMG</div><p className="text-sm font-semibold text-ink">{evidence.originalFilename}</p><a className="mt-2 inline-block text-xs text-brand" href={`/api/evidences/${evidence.id}/download`}>Abrir descarga</a></div></div>;
  return <div className="grid h-full place-items-center rounded-lg border border-line bg-surface-1"><div className="text-center"><div className="mx-auto mb-4 grid h-44 w-36 place-items-center rounded-lg border border-line bg-surface-2 text-danger">{kind}</div><p className="text-sm font-semibold text-ink">{evidence.originalFilename}</p><a className="mt-2 inline-block text-xs text-brand" href={`/api/evidences/${evidence.id}/download`}>Abrir evidencia</a></div></div>;
}

function DictamenInspector({ auditId, resolution, evaluation, humanReview, snapshot, documents, hasHumanReview }: { auditId: string; resolution: string; evaluation?: PolicyEvaluationShape | null; humanReview?: HumanReviewRecord | null; snapshot?: SnapshotRecord | null; documents?: DictamenDocumentRecord[]; hasHumanReview: boolean }) {
  return <div id="dictamen" className="space-y-4"><div className="rounded-lg border border-line bg-surface-2 p-4"><p className="font-mono text-[10px] uppercase text-muted">Resultado motor políticas</p><div className="mt-2 rounded-md border border-warning/20 bg-warning/10 p-3 text-center text-sm font-black uppercase tracking-wide text-warning">{resolution}</div><p className="mt-3 text-xs leading-5 text-ink">{evaluation?.suggestedReason ?? 'Aún no hay resolución generada.'}</p><p className="mt-2 text-[11px] text-muted">Política aplicada: {evaluation?.policyCode ?? 'GDM_GAM_PRD_MLG_003'} V{evaluation?.policyVersion ?? '—'}</p></div><HumanReviewCard auditId={auditId} review={humanReview} machineOutcome={evaluation?.suggestedOutcome ?? null} /><DictamenWorkflow auditId={auditId} snapshot={snapshot} documents={documents} hasHumanReview={hasHumanReview} /></div>;
}

function RulesInspector({ rules, missingItems, ruleLabels, onSelectEvidence }: { rules: EvaluatedRule[]; missingItems: MissingItem[]; ruleLabels: Record<string, string>; onSelectEvidence: (id: string) => void }) {
  return <div className="space-y-4"><div className="rounded-lg border border-line bg-surface-2 p-4"><h2 className="font-semibold text-ink">Reglas evaluadas</h2><RuleGroupList rules={rules} ruleLabels={ruleLabels} /><div className="mt-4 space-y-2 text-xs">{rules.slice(0, 4).map((rule) => <button key={rule.ruleId} onClick={() => onSelectEvidence('local-ev-audio')} className="block w-full rounded border border-line bg-surface-1 p-2 text-left hover:border-brand/40"><span className="font-semibold text-ink">{ruleLabels[rule.ruleId] ?? rule.ruleId}</span><span className="float-right text-success">{rule.status}</span><span className="mt-1 block text-muted">Fuente {rule.source.documentCode} · sección {rule.source.section}</span></button>)}</div></div>{missingItems.length > 0 && <div className="rounded-lg border border-warning/20 bg-warning/10 p-3 text-xs text-warning">{missingItems.length} datos pendientes para cerrar reglas.</div>}</div>;
}

function normalizeResolution(outcome?: string | null, status?: string | null) {
  const value = `${outcome ?? status ?? 'Requiere revisión'}`.toUpperCase();
  if (value.includes('PROCEDE')) return value;
  if (value.includes('OBS')) return 'OBSERVACIÓN REQUERIDA';
  if (value.includes('REVIEW') || value.includes('REVIS')) return 'REQUIERE REVISIÓN';
  return value;
}

function fileKind(mimeType?: string | null) { const mime = mimeType?.toLowerCase() ?? ''; if (mime.includes('pdf')) return 'PDF'; if (mime.includes('image')) return 'IMG'; if (mime.includes('audio')) return 'AUD'; if (mime.includes('sheet') || mime.includes('excel')) return 'XLS'; if (mime.includes('word') || mime.includes('document')) return 'DOC'; if (mime.includes('text')) return 'TXT'; return 'FILE'; }
function kindColor(mimeType?: string | null) { const kind = fileKind(mimeType); if (kind === 'PDF') return 'bg-danger/20 text-danger'; if (kind === 'IMG') return 'bg-brand/20 text-brand'; if (kind === 'AUD') return 'bg-warning/20 text-warning'; return 'bg-surface-3 text-muted'; }
function formatSize(bytes: number) { return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`; }
