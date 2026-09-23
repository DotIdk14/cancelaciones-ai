'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DictamenDocumentRecord, SnapshotRecord } from './types';

// Orquestador de la fase de dictamen: snapshot -> borrador -> aprobacion -> final.
// Corre exclusivamente contra el servicio de dictamen (rutas API de Phase 7).
export function DictamenWorkflow({ auditId, snapshot, documents, hasHumanReview }: { auditId: string; snapshot?: SnapshotRecord | null; documents?: DictamenDocumentRecord[]; hasHumanReview: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  async function act(action: 'snapshot' | 'draft' | 'approve' | 'final') {
    setBusy(action);
    setMessage('');
    try {
      if (action === 'snapshot') {
        const response = await fetch(`/api/audits/${auditId}/report-snapshot`, { method: 'POST' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message ?? 'No fue posible crear el snapshot.');
        setMessage(data.created ? 'Snapshot creado y congelado.' : 'Snapshot ya existente; se reutilizó.');
      } else if (action === 'draft') {
        const response = await fetch(`/api/audits/${auditId}/dictamen/draft`, { method: 'POST' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message ?? 'No fue posible generar el borrador.');
        setMessage('Borrador generado (BORRADOR - NO ES DOCUMENTO FINAL).');
      } else if (action === 'approve') {
        const response = await fetch(`/api/audits/${auditId}/dictamen/approve`, { method: 'POST' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message ?? 'No fue posible aprobar el snapshot.');
        setMessage('Snapshot aprobado. Ahora puedes generar el documento final.');
      } else {
        const response = await fetch(`/api/audits/${auditId}/dictamen/final`, { method: 'POST' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message ?? 'No fue posible generar el documento final.');
        setMessage('Documento FINAL generado e inmutable.');
      }
      router.refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'No fue posible completar la acción.');
    } finally {
      setBusy('');
    }
  }

  const isApproved = snapshot?.status === 'FINAL';
  const draftDoc = documents?.find((doc) => doc.kind === 'DRAFT');
  const finalDoc = documents?.find((doc) => doc.kind === 'FINAL');

  return (
    <section className="rounded-lg border border-line bg-surface-1 p-6">
      <h2 className="text-lg font-semibold text-ink">Dictamen en PDF</h2>
      <p className="mt-2 text-sm text-muted">El snapshot congela la decisión, la revisión y las evidencias antes de generar el PDF sobre la plantilla oficial.</p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <button type="button" disabled={busy !== ''} onClick={() => void act('snapshot')}
          className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-muted transition hover:bg-surface-2 disabled:opacity-50">
          {busy === 'snapshot' ? 'Creando…' : '1 · Crear snapshot'}
        </button>
        <button type="button" disabled={busy !== '' || !snapshot || isApproved} onClick={() => void act('draft')}
          className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-muted transition hover:bg-surface-2 disabled:opacity-50">
          {busy === 'draft' ? 'Generando…' : '2 · Generar borrador'}
        </button>
        <button type="button" disabled={busy !== '' || !snapshot || isApproved || !hasHumanReview} onClick={() => void act('approve')}
          className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-muted transition hover:bg-surface-2 disabled:opacity-50">
          {busy === 'approve' ? 'Aprobando…' : '3 · Aprobar snapshot'}
        </button>
        <button type="button" disabled={busy !== '' || !isApproved} onClick={() => void act('final')}
          className="inline-flex items-center justify-center rounded-lg bg-ink px-3 py-2 text-sm font-semibold text-background shadow-sm transition hover:bg-white disabled:opacity-50">
          {busy === 'final' ? 'Generando…' : '4 · Generar FINAL'}
        </button>
      </div>

      {!hasHumanReview && <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">La aprobación requiere una revisión humana registrada (Aprobar o Corregir).</p>}
      {snapshot && <p className="mt-2 text-xs text-muted">Snapshot {snapshot.status} · huella {snapshot.snapshotFingerprint.slice(0, 12)}…</p>}
      {message && <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">{message}</p>}

      {(draftDoc || finalDoc) && (
        <div className="mt-5 space-y-2 border-t border-line pt-4">
          {draftDoc && (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 p-3 text-sm">
              <div className="min-w-0"><p className="font-semibold text-ink">Borrador</p><p className="truncate text-xs text-muted">SHA-256 {draftDoc.pdfSha256.slice(0, 16)}…</p></div>
              <a className="shrink-0 font-medium text-brand hover:underline" href={`/api/audits/${auditId}/dictamen/${draftDoc.id}/download`}>Ver PDF</a>
            </div>
          )}
          {finalDoc && (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-success/10 p-3 text-sm">
              <div className="min-w-0"><p className="font-semibold text-ink">Documento FINAL</p><p className="truncate text-xs text-success">SHA-256 {finalDoc.pdfSha256.slice(0, 16)}… · inmutable</p></div>
              <a className="shrink-0 font-medium text-success hover:underline" href={`/api/audits/${auditId}/dictamen/${finalDoc.id}/download`}>Ver PDF final</a>
            </div>
          )}
        </div>
      )}
    </section>
  );
}