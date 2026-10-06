// =============================================================================
// Visor de evidencia dentro de la columna central del detalle de caso.
//
// Sustituye al modal `EvidenceViewer`: la evidencia se lee en el mismo sitio
// donde ya vive el expediente, sin capas superpuestas ni otro `role="dialog"`
// que_War el foco.
//
// El alcance se resuelve server-side (evidenceId → caso → identidad), y la URL
// es relativa, así que la cookie de sesión viaja sola en cada petición.
// =============================================================================

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
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
import { PdfCanvas } from './PdfCanvas';
import { Spinner } from './ui';

export interface EvidencePaneProps {
  evidence: Evidence;
}

export function EvidencePane({ evidence }: EvidencePaneProps): ReactNode {
  const kind = kindFromMime(evidence.mimeType);
  const downloadUrl = evidenceDownloadUrl(evidence.id);
  const previewUrl = evidencePreviewUrl(evidence.id);

  return (
    <div className="evidence-pane">
      <header className="evidence-pane-header">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-ink">{evidence.filename}</h2>
          <p className="mt-0.5 text-xs text-muted">
            {EVIDENCE_KIND_LABELS[kind]} · {formatBytes(evidence.sizeBytes)} · {evidence.mimeType || '—'}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <a
            href={downloadUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-lg border border-line bg-surface-3 px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-[#1f262f]"
          >
            Abrir<span className="sr-only"> {evidence.filename} en otra pestaña</span>
          </a>
          <a
            href={downloadUrl}
            download
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-[#0b1220] transition-colors hover:bg-brand/85"
          >
            Descargar<span className="sr-only"> {evidence.filename}</span>
          </a>
        </div>
      </header>

      <div className="evidence-pane-body">
        {isImageMime(evidence.mimeType) && (
          <img
            src={previewUrl}
            alt={evidenceAltText(evidence.filename, evidence.mimeType)}
            className="evidence-pane-image"
          />
        )}

        {isAudioMime(evidence.mimeType) && (
          <div className="flex flex-col gap-4">
            <audio controls src={downloadUrl} className="w-full">
              Tu navegador no puede reproducir este audio. Usa el botón Descargar.
            </audio>
            {evidence.transcript !== null ? (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Transcripción ({formatDuration(evidence.transcript.durationSeconds)})
                </h3>
                <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
                  {textOrDash(evidence.transcript.transcript)}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted">
                Este audio todavía no tiene transcripción. Cuando termine de procesarse, aparecerá aquí.
              </p>
            )}
          </div>
        )}

        {isPdfMime(evidence.mimeType) && <PdfCanvas url={previewUrl} filename={evidence.filename} />}

        {kind === 'TEXT' && (
          <TextPreview url={previewUrl} />
        )}

        {/* Rama de seguridad ante un kind nuevo. Hoy es código inalcanzable:
            `kindFromMime` cae siempre a 'TEXT', y `verifyFileSignature` ya
            limita lo que se puede subir a la allowlist de MIME. Se mantiene
            para que añadir un kind no deje el panel en blanco. */}
        {!isImageMime(evidence.mimeType) &&
          !isAudioMime(evidence.mimeType) &&
          !isPdfMime(evidence.mimeType) &&
          kind !== 'TEXT' && (
            <p className="text-sm text-muted">
              Este tipo de archivo no tiene vista previa. Podés abrirlo o descargarlo para revisarlo.
            </p>
          )}
      </div>
    </div>
  );
}

/**
 * Texto plano: se pide por `fetch` en lugar de usar el `extracted_text` del
 * caso. Trae el binario original —que es lo que el operador subió— y evita
 * ampliar el contrato de la API para una vista que el servidor ya puede servir.
 * `Content-Type: text/plain` más `<pre>`: se muestra literal, sin interpretar
 * ninguna etiqueta que el archivo pudiera contener.
 */
function TextPreview({ url }: { url: string }): ReactNode {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setText(null);
    setError(null);

    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`El servidor respondió ${response.status}.`);
        const body = await response.text();
        setText(body.trim() === '' ? '' : body);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'No se pudo leer el archivo.');
      }
    })();

    return () => controller.abort();
  }, [url]);

  if (error !== null) {
    return (
      <p className="text-sm text-danger">
        No se pudo mostrar el texto: {error} Podés descargarlo para abrirlo.
      </p>
    );
  }

  if (text === null) {
    return <Spinner label="Cargando el contenido del archivo" />;
  }

  if (text === '') {
    return <p className="text-sm text-muted">El archivo está vacío.</p>;
  }

  return (
    <pre className="evidence-pane-text">
      {/* <pre> escapa el contenido: el texto del archivo nunca se interpreta como HTML. */}
      {text}
    </pre>
  );
}