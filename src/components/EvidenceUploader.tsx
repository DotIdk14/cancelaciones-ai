// =============================================================================
// Subida de evidencias. El endpoint NO usa multipart: se envía el `File` crudo
// con `content-type` = mime del archivo y `x-file-name` = nombre URL-encoded.
// =============================================================================

import type { ChangeEvent, ReactNode } from 'react';
import { useId, useRef, useState } from 'react';
import { toErrorState, uploadEvidence } from '../lib/api';
import { formatBytes } from '../lib/format';
import { EVIDENCE_ACCEPT } from '../lib/labels';
import { Panel, Spinner } from './ui';

export interface EvidenceUploaderProps {
  caseId: string;
  onUploaded?: () => void | Promise<void>;
  disabled?: boolean;
}

type UploadStatus = 'uploading' | 'done' | 'error';

interface UploadItem {
  id: string;
  name: string;
  sizeBytes: number;
  status: UploadStatus;
  message?: string;
  category?: string;
}

export function EvidenceUploader({ caseId, onUploaded, disabled = false }: EvidenceUploaderProps): ReactNode {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const [items, setItems] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function patch(id: string, changes: Partial<UploadItem>): void {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  }

  function clearFinished(): void {
    setItems((prev) => prev.filter((item) => item.status === 'uploading'));
  }

  async function handleChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;

    const queued: UploadItem[] = files.map((file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`,
      name: file.name,
      sizeBytes: file.size,
      status: 'uploading',
    }));
    setItems((prev) => [...queued, ...prev]);
    setBusy(true);
    setAnnouncement(`Subiendo ${files.length} archivo${files.length === 1 ? '' : 's'}…`);

    const failures: string[] = [];
    let ok = 0;

    // Secuencial: evita ráfagas de subidas grandes y da progreso legible.
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const item = queued[i];
      if (!file || !item) continue;
      try {
        await uploadEvidence(caseId, file);
        patch(item.id, { status: 'done' });
        ok += 1;
      } catch (err) {
        const state = toErrorState(err);
        patch(item.id, { status: 'error', message: state.message, category: state.category });
        failures.push(file.name);
      }
    }

    setBusy(false);
    // Permite volver a seleccionar el mismo archivo.
    if (inputRef.current) inputRef.current.value = '';

    const parts = [`${ok} de ${files.length} archivo(s) subidos.`];
    if (failures.length > 0) parts.push(`Fallaron: ${failures.join(', ')}.`);
    setAnnouncement(parts.join(' '));

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
