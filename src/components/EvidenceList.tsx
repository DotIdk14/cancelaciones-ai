// Navegación entre archivos del expediente y acciones de mantenimiento.

import type { ReactNode } from 'react';
import { FileAudio, FileImage, FileText, Trash2 } from 'lucide-react';
import type { Evidence } from '../lib/api';
import type { EvidenceKind, EvidenceStatus } from '../skills/audit/types';
import { formatBytes, formatDuration, shortId } from '../lib/format';
import { EVIDENCE_KIND_LABELS, EVIDENCE_STATUS_LABELS, kindFromMime } from '../lib/labels';
import { evidenceDownloadUrl } from '../lib/api';
import { Badge, EmptyState, Spinner } from './ui';
import type { Tone } from './ui';

const STATUS_TONE: Record<EvidenceStatus, Tone> = {
  UPLOADED: 'neutral', TRANSCRIBING: 'warning', READY: 'success', ERROR: 'danger',
};

const KIND_ICON: Record<EvidenceKind, typeof FileText> = {
  IMAGE: FileImage, PDF: FileText, AUDIO: FileAudio, TEXT: FileText,
};

export interface EvidenceListProps {
  evidences: Evidence[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (evidence: Evidence) => void;
  deletingId?: string | null;
  confirmId?: string | null;
  onConfirmDelete?: (evidence: Evidence) => void;
  onCancelConfirm?: () => void;
  readOnly?: boolean;
}

export function EvidenceList({
  evidences, activeId, onSelect, onDelete, deletingId = null, confirmId = null,
  onConfirmDelete, onCancelConfirm, readOnly = false,
}: EvidenceListProps): ReactNode {
  if (evidences.length === 0) {
    return <EmptyState icon={<FileText size={22} />} title="Sin evidencias" description="Adjunta una imagen, PDF o audio para revisarlo aquí." />;
  }

  return (
    <div className="evidence-navigation-wrap">
      <nav className="evidence-navigation" aria-label="Seleccionar evidencia">
        {evidences.map((evidence) => {
          const kind = kindFromMime(evidence.mimeType);
          const Icon = KIND_ICON[kind];
          const selected = activeId === evidence.id;
          return (
            <button
              key={evidence.id}
              type="button"
              className="evidence-navigation-item"
              aria-current={selected ? 'true' : undefined}
              aria-pressed={selected}
              onClick={() => onSelect(evidence.id)}
              title={evidence.filename}
            >
              <Icon size={17} aria-hidden="true" />
              <span className="evidence-navigation-name">{evidence.filename}</span>
              <span className="evidence-navigation-kind">{EVIDENCE_KIND_LABELS[kind]}</span>
              <Badge tone={STATUS_TONE[evidence.processingStatus]}>
                {evidence.processingStatus === 'TRANSCRIBING' && <Spinner label="Transcribiendo" className="h-3 w-3" />}
                {EVIDENCE_STATUS_LABELS[evidence.processingStatus]}
              </Badge>
            </button>
          );
        })}
      </nav>

      {activeId !== null && evidences.filter((item) => item.id === activeId).map((evidence) => {
        const isConfirming = !readOnly && confirmId === evidence.id;
        const isDeleting = deletingId === evidence.id;
        return (
          <div className="evidence-selection-meta" key={evidence.id}>
            <span title={evidence.hash}>SHA-256 · {shortId(evidence.hash, 10)} · {formatBytes(evidence.sizeBytes)}
              {evidence.transcript !== null && ` · Audio ${formatDuration(evidence.transcript.durationSeconds)}`}
            </span>
            <div>
              <a href={evidenceDownloadUrl(evidence.id)} download>Descargar</a>
              {!readOnly && (isConfirming ? (
                <>
                  <button type="button" onClick={() => onConfirmDelete?.(evidence)} disabled={isDeleting} className="text-danger">
                    {isDeleting ? 'Eliminando…' : 'Confirmar eliminación'}
                  </button>
                  <button type="button" onClick={() => onCancelConfirm?.()} disabled={isDeleting}>Cancelar</button>
                </>
              ) : (
                <button type="button" onClick={() => onDelete(evidence)} aria-label={`Eliminar ${evidence.filename}`} className="evidence-delete-action">
                  <Trash2 size={14} aria-hidden="true" /> Eliminar
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {confirmId !== null && <p aria-live="polite" className="text-xs text-warning">Confirma que deseas eliminar esta evidencia.</p>}
    </div>
  );
}
