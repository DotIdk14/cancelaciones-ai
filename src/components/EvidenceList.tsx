// =============================================================================
// Listado de evidencias del caso: tipo, tamaño, estado, hash y acciones.
// =============================================================================

import type { ReactNode } from 'react';
import type { Evidence } from '../lib/api';
import type { EvidenceKind, EvidenceStatus } from '../skills/audit/types';
import { formatBytes, formatDuration, shortId } from '../lib/format';
import { EVIDENCE_KIND_LABELS, EVIDENCE_STATUS_LABELS, kindFromMime } from '../lib/labels';
import { evidenceDownloadUrl } from '../lib/api';
import { Badge, EmptyState, Spinner } from './ui';
import type { Tone } from './ui';

const STATUS_TONE: Record<EvidenceStatus, Tone> = {
  UPLOADED: 'neutral',
  TRANSCRIBING: 'warning',
  READY: 'success',
  ERROR: 'danger',
};

const KIND_ICON: Record<EvidenceKind, string> = {
  IMAGE: '🖼️',
  PDF: '📄',
  AUDIO: '🎧',
  TEXT: '📝',
};

export interface EvidenceListProps {
  evidences: Evidence[];
  onPreview: (evidence: Evidence) => void;
  onDelete: (evidence: Evidence) => void;
  deletingId?: string | null;
  confirmId?: string | null;
  onConfirmDelete?: (evidence: Evidence) => void;
  onCancelConfirm?: () => void;
}

export function EvidenceList({
  evidences,
  onPreview,
  onDelete,
  deletingId = null,
  confirmId = null,
  onConfirmDelete,
  onCancelConfirm,
}: EvidenceListProps): ReactNode {
  if (evidences.length === 0) {
    return (
      <EmptyState
        icon="🗂️"
        title="Sin evidencias"
        description="Sube al menos una imagen, PDF o audio para poder ejecutar la auditoría."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {evidences.map((evidence) => {
        const kind = kindFromMime(evidence.mimeType);
        const isConfirming = confirmId === evidence.id;
        const isDeleting = deletingId === evidence.id;
        return (
          <li
            key={evidence.id}
            className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3"
          >
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <span aria-hidden="true" className="text-lg leading-none">
                {KIND_ICON[kind]}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink" title={evidence.filename}>
                  {evidence.filename}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {EVIDENCE_KIND_LABELS[kind]} · {formatBytes(evidence.sizeBytes)} ·{' '}
                  <span title={evidence.hash}>hash {shortId(evidence.hash, 10)}</span>
                </p>
                {evidence.transcript !== null && (
                  <p className="mt-0.5 text-xs text-muted">
                    Transcripción: {formatDuration(evidence.transcript.durationSeconds)}
                  </p>
                )}
                {evidence.processingStatus === 'ERROR' && (
                  <p className="mt-1 text-xs text-danger">
                    No se pudo procesar {kind === 'AUDIO' ? 'el audio' : 'el archivo'}: {evidence.processingError ?? 'causa no disponible'}. Elimínalo y vuelve a subirlo para habilitar la auditoría.
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[evidence.processingStatus]}>
                {evidence.processingStatus === 'TRANSCRIBING' && (
                  <Spinner label="Transcribiendo" className="h-3 w-3" />
                )}
                {EVIDENCE_STATUS_LABELS[evidence.processingStatus]}
              </Badge>

              <button
                type="button"
                onClick={() => onPreview(evidence)}
                className="rounded-lg border border-line bg-surface-3 px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-[#1f262f]"
              >
                Ver
                <span className="sr-only"> {evidence.filename}</span>
              </button>

              <a
                href={evidenceDownloadUrl(evidence.id)}
                download
                className="rounded-lg border border-line bg-surface-3 px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-[#1f262f]"
              >
                Descargar
                <span className="sr-only"> {evidence.filename}</span>
              </a>

              {isConfirming ? (
                <span className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onConfirmDelete?.(evidence)}
                    disabled={isDeleting}
                    className="rounded-lg border border-danger/50 bg-danger/15 px-3 py-1.5 text-xs font-semibold text-danger transition-colors hover:bg-danger/25 disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {isDeleting ? 'Eliminando…' : 'Sí, eliminar'}
                    <span className="sr-only"> {evidence.filename}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onCancelConfirm?.()}
                    disabled={isDeleting}
                    className="rounded-lg px-2 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-3 hover:text-ink disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    Cancelar
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onDelete(evidence)}
                  className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-danger transition-colors hover:bg-danger/10"
                >
                  Eliminar
                  <span className="sr-only"> {evidence.filename}</span>
                </button>
              )}
            </div>
          </li>
        );
      })}
      {confirmId !== null && (
        <li aria-live="polite" className="text-xs text-warning">
          Confirmación de eliminación: revisa el archivo marcado antes de continuar.
        </li>
      )}
    </ul>
  );
}
