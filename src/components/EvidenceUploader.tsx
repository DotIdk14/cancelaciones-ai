// =============================================================================
// Subida de evidencias. El endpoint NO usa multipart: se envía el `File` crudo
// con `content-type` = mime del archivo y `x-file-name` = nombre URL-encoded.
//
// La secuencia (carga secuencial, estado y error por archivo, anuncio de
// progreso) vive en `useEvidenceUpload`: es la MISMA que usa el alta de caso,
// para no duplicar la lógica de subida en dos pantallas.
// =============================================================================

import type { ChangeEvent, ReactNode } from 'react';
import { useId, useRef } from 'react';
import { useEvidenceUpload } from '../lib/useEvidenceUpload';
import { formatBytes } from '../lib/format';
import { EVIDENCE_ACCEPT } from '../lib/labels';
import { Panel, Spinner } from './ui';

export interface EvidenceUploaderProps {
  caseId: string;
  onUploaded?: () => void | Promise<void>;
  disabled?: boolean;
}

export function EvidenceUploader({ caseId, onUploaded, disabled = false }: EvidenceUploaderProps): ReactNode {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const inputRef = useRef<HTMLInputElement>(null);
  const { items, busy, announcement, runUploads, clearFinished } = useEvidenceUpload();

  async function handleChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;

    await runUploads(caseId, files);
    // Permite volver a seleccionar el mismo archivo.
    if (inputRef.current) inputRef.current.value = '';

    if (onUploaded) await onUploaded();
  }

  return (
    <Panel
      id="evidence-uploader"
      title="Subir evidencias"
      description="Imágenes, PDF o audio. Cada archivo se procesa de forma independiente."
    >
      <label htmlFor={inputId} className="block text-sm font-medium text-ink">
        Archivos de evidencia
      </label>
      <p id={hintId} className="mt-1 text-xs text-muted">
        Formatos: PNG, JPG, WEBP, PDF, MP3, WAV, M4A, OGG. Puedes seleccionar varios a la vez.
      </p>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        multiple
        disabled={disabled || busy}
        accept={EVIDENCE_ACCEPT}
        aria-describedby={hintId}
        onChange={(event) => void handleChange(event)}
        className="mt-3 block w-full rounded-xl border border-dashed border-line bg-surface-2 px-3 py-3 text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface-3 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-ink hover:file:bg-[#1f262f] disabled:cursor-not-allowed disabled:opacity-55"
      />

      <div role="status" aria-live="polite" className="mt-2 flex items-center gap-2 text-sm text-muted">
        {busy && <Spinner label="Subiendo archivos" className="h-3.5 w-3.5" />}
        <span>{announcement}</span>
      </div>

      {items.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">Progreso de subida</h3>
            {!busy && (
              <button
                type="button"
                onClick={clearFinished}
                className="rounded-lg px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-3 hover:text-ink"
              >
                Limpiar completados
              </button>
            )}
          </div>
          <ul className="flex flex-col gap-1.5">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm"
              >
                <span className="min-w-0 truncate text-ink">{item.name}</span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-muted">{formatBytes(item.sizeBytes)}</span>
                  {item.status === 'uploading' && (
                    <>
                      <Spinner label={`Subiendo ${item.name}`} className="h-3.5 w-3.5" />
                      <span className="text-xs text-muted">Subiendo…</span>
                    </>
                  )}
                  {item.status === 'done' && <span className="text-xs font-medium text-success">Subida</span>}
                  {item.status === 'error' && (
                    <span className="text-xs font-medium text-danger">
                      {item.category ?? 'ERROR'} · {item.message}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
