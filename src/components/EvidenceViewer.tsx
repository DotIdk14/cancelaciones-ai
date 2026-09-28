// =============================================================================
// Visor modal de evidencia. Usa la cookie de sesión automáticamente porque la
// URL es relativa y del mismo origen.
// =============================================================================

import type { ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';
import type { Evidence } from '../lib/api';
import { evidenceDownloadUrl, evidencePreviewUrl } from '../lib/api';
import { formatBytes, formatDuration, textOrDash } from '../lib/format';
import {
  EVIDENCE_KIND_LABELS,
  evidenceAltText,
  isAudioMime,
  isImageMime,
  isPdfMime,
  kindFromMime,
} from '../lib/labels';

export interface EvidenceViewerProps {
  evidence: Evidence;
  onClose: () => void;
}

export function EvidenceViewer({ evidence, onClose }: EvidenceViewerProps): ReactNode {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const kind = kindFromMime(evidence.mimeType);
  const downloadUrl = evidenceDownloadUrl(evidence.id);
  const previewUrl = evidencePreviewUrl(evidence.id);

  // Escape cierra; el foco entra al diálogo; el scroll del body se bloquea.
  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-surface-1"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-sm font-semibold text-ink">
              {evidence.filename}
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              {EVIDENCE_KIND_LABELS[kind]} · {formatBytes(evidence.sizeBytes)} · {evidence.mimeType || '—'}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar visor de evidencia"
            className="shrink-0 rounded-lg border border-line bg-surface-3 px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-[#1f262f]"
          >
            Cerrar
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto bg-surface-2 p-4">
          {isImageMime(evidence.mimeType) && (
            <img
              src={previewUrl}
              alt={evidenceAltText(evidence.filename, evidence.mimeType)}
              className="mx-auto max-h-[60vh] w-auto rounded-lg border border-line"
            />
          )}

          {isAudioMime(evidence.mimeType) && (
            <div className="flex flex-col gap-4">
              <audio controls src={downloadUrl} className="w-full">
                Tu navegador no puede reproducir este audio. Usa el botón Descargar.
              </audio>
              {evidence.transcript !== null && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Transcripción ({formatDuration(evidence.transcript.durationSeconds)})
                  </h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
                    {textOrDash(evidence.transcript.transcript)}
                  </p>
                </div>
              )}
            </div>
          )}

          {isPdfMime(evidence.mimeType) && (
            <p className="text-sm text-muted">
              Los documentos PDF no se renderizan dentro de la aplicación. Abre el archivo en una pestaña
              nueva o descárgalo para revisarlo.
            </p>
          )}

          {!isImageMime(evidence.mimeType) &&
            !isAudioMime(evidence.mimeType) &&
            !isPdfMime(evidence.mimeType) && (
              <p className="text-sm text-muted">
                Este tipo de archivo no tiene vista previa. Puedes abrirlo o descargarlo para revisarlo.
              </p>
            )}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">
          <a
            href={downloadUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-xl border border-line bg-surface-3 px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-[#1f262f]"
          >
            Abrir en otra pestaña
            <span className="sr-only"> {evidence.filename}</span>
          </a>
          <a
            href={downloadUrl}
            download
            className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-[#0b1220] transition-colors hover:bg-brand/85"
          >
            Descargar
            <span className="sr-only"> {evidence.filename}</span>
          </a>
        </footer>
      </div>
    </div>
  );
}
