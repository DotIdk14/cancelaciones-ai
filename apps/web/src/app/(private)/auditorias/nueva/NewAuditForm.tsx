'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useFormStatus } from 'react-dom';

type NewAuditFormProps = {
  action: (formData: FormData) => void | Promise<void>;
};

function StatusBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' }) {
  const toneClass = tone === 'success' ? 'border-success/20 bg-success/10 text-success' : tone === 'warning' ? 'border-warning/20 bg-warning/10 text-warning' : 'border-line bg-surface-2 text-muted';
  return <span className={`rounded-md border px-2 py-1 text-xs font-medium ${toneClass}`}>{children}</span>;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileTypeLabel(file: File) {
  const extension = file.name.split('.').pop()?.toUpperCase();
  return extension?.slice(0, 4) || 'FILE';
}

/**
 * Fila de archivos con estados reales del ciclo de subida. Vive dentro del
 * <form>, por eso puede leer el estado pendiente del server action con
 * useFormStatus: mientras la accion corre (subida + encolado) las filas pasan
 * de "Preparado" a "Subiendo…". Los estados posteriores (En cola, Procesando,
 * Hechos extraídos, Dictamen listo) se muestran en el workspace destino.
 */
function FileQueue({ files, totalBytes }: { files: File[]; totalBytes: number }) {
  const { pending } = useFormStatus();

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface-1">
      <div className="border-b border-line px-5 py-4">
        <h2 className="font-semibold text-ink">Fila de archivos</h2>
        <p className="mt-1 text-sm text-muted">Los archivos se suben cuando presiones «Subir e integrar al workspace»; después el workspace los procesa y genera el dictamen.</p>
      </div>
      <div className="divide-y divide-line">
        {files.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted">Aún no hay archivos seleccionados.</div>
        ) : files.map((file) => {
          const uploading = pending;
          return (
            <div key={`${file.name}-${file.size}-${file.lastModified}`} className="grid gap-4 px-5 py-4 md:grid-cols-[52px_1fr_140px_120px] md:items-center">
              <span className="w-fit rounded-md border border-line bg-background px-2 py-1 font-mono text-xs text-muted">{fileTypeLabel(file)}</span>
              <div>
                <p className="font-medium text-ink">{file.name}</p>
                <p className="mt-1 text-sm text-muted">{formatBytes(file.size)} · {uploading ? 'Subiendo y almacenando…' : 'Listo para subir al crear la auditoría'}</p>
              </div>
              <div className="h-2 rounded-full bg-background">
                <div className={`h-2 rounded-full transition-all ${uploading ? 'w-full bg-brand animate-pulse' : 'w-0 bg-muted'}`} style={{ width: uploading ? '100%' : '0%' }} />
              </div>
              <StatusBadge tone={uploading ? 'warning' : 'neutral'}>{uploading ? 'Subiendo…' : 'Preparado'}</StatusBadge>
            </div>
          );
        })}
      </div>
      <div className="flex flex-col justify-between gap-4 border-t border-line bg-surface-2 px-5 py-4 xl:flex-row xl:items-center">
        <div className="text-sm text-muted">
          <p><span className="text-ink">{files.length} archivos</span> listos para subir · Tamaño total: <span className="text-ink">{formatBytes(totalBytes)}</span></p>
          <p className="mt-1 text-xs text-subtle">El destino se genera automáticamente al crear la auditoría; la subida inicia en ese momento.</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link href="/auditorias" className="rounded-lg border border-line px-5 py-2.5 text-center text-sm font-semibold text-muted hover:bg-white/5 hover:text-ink">Cancelar</Link>
          <button type="submit" disabled={pending} className="rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-background hover:bg-white disabled:cursor-wait disabled:opacity-60">{pending ? 'Subiendo…' : 'Subir e integrar al workspace'}</button>
        </div>
      </div>
    </div>
  );
}

export function NewAuditForm({ action }: NewAuditFormProps) {
  const [files, setFiles] = useState<File[]>([]);
  const totalBytes = files.reduce((total, file) => total + file.size, 0);

  return (
    <form action={action} className="rounded-2xl border border-line bg-background/40 p-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.8fr)_minmax(320px,0.9fr)]">
        <div className="rounded-xl border border-line bg-surface-1 p-4">
          <label className="flex min-h-[185px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-line bg-background px-5 py-6 text-center hover:border-brand/60 hover:bg-surface-2">
            <input name="evidences" required multiple type="file" accept=".pdf,.jpg,.jpeg,.png,.mp3,.wav,.csv,.xml" className="sr-only" onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />
            <span className="rounded-lg border border-line bg-surface-2 px-3 py-1 text-xs font-medium text-muted">Carga de archivos</span>
            <h2 className="mt-3 text-xl font-semibold text-ink">Arrastra tus archivos aquí o haz clic para explorar</h2>
            <p className="mt-1.5 max-w-2xl text-sm text-muted">Al crear la auditoría los archivos se suben y se encola su procesamiento automático.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-1.5 text-xs text-subtle">
              {['PDF', 'JPG', 'PNG', 'MP3', 'WAV', 'CSV', 'XML', 'Max. 50 MB'].map((item) => <span key={item} className="rounded-md border border-line bg-surface-1 px-2 py-0.5">{item}</span>)}
            </div>
          </label>
        </div>

        <aside className="rounded-xl border border-line bg-surface-1 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-ink">Datos necesarios</h2>
              <p className="mt-0.5 text-xs text-muted">Captura los datos mínimos antes de integrar el workspace.</p>
            </div>
            <StatusBadge>Preparación</StatusBadge>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <label className="block text-sm font-medium text-muted">
              CaVe <span className="text-danger">*</span>
              <input name="externalCaseId" required placeholder="CaVe o ticket" className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-1.5 font-mono text-sm text-ink outline-none placeholder:text-subtle focus:border-brand" />
            </label>
            <label className="block text-sm font-medium text-muted">
              Nombre
              <input name="studentName" placeholder="Nombre si existe" className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-1.5 text-sm text-ink outline-none placeholder:text-subtle focus:border-brand" />
            </label>
            <label className="block text-sm font-medium text-muted">
              Matrícula
              <input name="studentId" placeholder="Matrícula si existe" className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-1.5 text-sm text-ink outline-none placeholder:text-subtle focus:border-brand" />
            </label>
            <label className="block text-sm font-medium text-muted">
              Inicio clases <span className="text-danger">*</span>
              <input name="classStartDate" required type="date" className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-1.5 text-sm text-ink outline-none focus:border-brand" />
            </label>
            <label className="block text-sm font-medium text-muted sm:col-span-2 lg:col-span-1 xl:col-span-2">
              Inicio ticket <span className="text-danger">*</span>
              <input name="ticketStartDate" required type="datetime-local" className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-1.5 text-sm text-ink outline-none focus:border-brand" />
            </label>
          </div>
        </aside>

        <FileQueue files={files} totalBytes={totalBytes} />

        <aside className="rounded-xl border border-line bg-surface-1 p-5">
          <h2 className="text-base font-semibold text-ink">Pendientes antes de integrar</h2>
          <p className="mt-1 text-xs text-muted">Validaciones mínimas del expediente nuevo.</p>
          <div className="mt-5 space-y-3 text-sm">
            <div className="rounded-lg border border-line bg-background px-3 py-2 text-muted">Captura CaVe.</div>
            <div className="rounded-lg border border-line bg-background px-3 py-2 text-muted">Confirma fecha de inicio de clases.</div>
            <div className="rounded-lg border border-line bg-background px-3 py-2 text-muted">Confirma fecha de inicio del ticket.</div>
            <div className="rounded-lg border border-line bg-background px-3 py-2 text-muted">Agrega al menos una evidencia válida.</div>
          </div>
          <div className="mt-5 border-t border-line pt-4 text-xs text-muted">
            <div className="flex items-center justify-between"><span>Almacenamiento</span><StatusBadge tone="success">Cifrado</StatusBadge></div>
            <div className="mt-2 flex items-center justify-between"><span>Integridad</span><span className="font-mono text-ink">SHA-256</span></div>
            <div className="mt-2 text-subtle">Sin ruta asignada hasta crear la auditoría.</div>
          </div>
        </aside>
      </div>
    </form>
  );
}