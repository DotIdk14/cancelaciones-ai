'use client';

import type { DictamenDocumentRecord, SnapshotRecord } from './types';
import { formatDateTime } from '@/lib/format';

// Tarjeta que resume el estado del dictamen: snapshot + documentos generados.
export function ReportPreviewCard({ auditId, snapshot, documents }: { auditId: string; snapshot?: SnapshotRecord | null; documents?: DictamenDocumentRecord[] }) {
  const draftDoc = documents?.find((doc) => doc.kind === 'DRAFT');
  const finalDoc = documents?.find((doc) => doc.kind === 'FINAL');

  return (
    <section className="rounded-lg border border-line bg-surface-1 p-6">
      <h2 className="text-lg font-semibold text-ink">Estado del dictamen</h2>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <MiniStat label="Snapshot" value={snapshot ? snapshot.status : 'Sin crear'} muted={!snapshot} />
        <MiniStat label="Borrador" value={draftDoc ? 'Generado' : 'Pendiente'} muted={!draftDoc} />
        <MiniStat label="Final" value={finalDoc ? 'Generado' : 'Pendiente'} muted={!finalDoc} />
      </div>

      {snapshot && (
        <div className="mt-4 rounded-lg bg-surface-2 p-3 text-xs text-muted">
          <p>Huella del snapshot: <code className="text-ink">{snapshot.snapshotFingerprint.slice(0, 20)}…</code></p>
          <p className="mt-1">Plantilla: <code className="text-ink">{snapshot.templateHash.slice(0, 12)}…</code> · Política {snapshot.policyCode} V{snapshot.policyVersion}</p>
          {snapshot.approvedAt && <p className="mt-1">Aprobado por {snapshot.approvedBy} el {formatDateTime(snapshot.approvedAt)}</p>}
        </div>
      )}

      {(draftDoc || finalDoc) && (
        <div className="mt-4 space-y-2">
          {draftDoc && <DocRow label="Borrador (no final)" doc={draftDoc} auditId={auditId} />}
          {finalDoc && <DocRow label="Documento FINAL (inmutable)" doc={finalDoc} auditId={auditId} final />}
        </div>
      )}
    </section>
  );
}

function MiniStat({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 text-center ${muted ? 'border-line bg-surface-2' : label === 'Final' && value === 'Generado' ? 'border-success/20 bg-success/10' : 'border-success/20 bg-success/10'}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${muted ? 'text-subtle' : 'text-ink'}`}>{value}</p>
    </div>
  );
}

function DocRow({ label, doc, auditId, final }: { label: string; doc: DictamenDocumentRecord; auditId: string; final?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 rounded-lg p-3 text-sm ${final ? 'bg-success/10' : 'bg-surface-2'}`}>
      <div className="min-w-0">
        <p className={`font-semibold ${final ? 'text-ink' : 'text-ink'}`}>{label}</p>
        <p className="truncate text-xs text-muted">SHA-256 {doc.pdfSha256.slice(0, 16)}…</p>
      </div>
      <a className={`shrink-0 font-medium hover:underline ${final ? 'text-success' : 'text-brand'}`} href={`/api/audits/${auditId}/dictamen/${doc.id}/download`}>Ver PDF</a>
    </div>
  );
}
