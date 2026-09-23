import Link from 'next/link';
import type { ReactNode } from 'react';
import { createAudit } from '@/server/actions/audits';

export const dynamic = 'force-dynamic';

const preparedFiles = [
  { type: 'PDF', name: 'solicitud_cancelacion_firmada.pdf', size: '1.4 MB', status: 'OCR concluido · Firma autógrafa detectada', progress: 100, validation: 'Verificado' },
  { type: 'AUD', name: 'llamada_asesor_retencion.mp3', size: '4.2 MB', status: 'Transcripción en streaming', progress: 78, validation: 'Procesando' },
  { type: 'IMG', name: 'identificacion_ine_anverso.jpg', size: '850 KB', status: 'OCR concluido · Clave elector coincidente', progress: 100, validation: 'Verificado' },
];

function FieldBadge({ children }: { children: ReactNode }) {
  return <span className="rounded-md border border-brand/20 bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">{children}</span>;
}

function StatusBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' }) {
  const toneClass = tone === 'success' ? 'border-success/20 bg-success/10 text-success' : tone === 'warning' ? 'border-warning/20 bg-warning/10 text-warning' : 'border-line bg-surface-2 text-muted';
  return <span className={`rounded-md border px-2 py-1 text-xs font-medium ${toneClass}`}>{children}</span>;
}

export default function NewAuditPage() {
  return (
    <section className="mx-auto max-w-[1320px] px-6 py-8">
      <div className="mb-5 flex flex-col justify-between gap-3 border-b border-line pb-5 lg:flex-row lg:items-end">
        <div>
          <Link href="/auditorias" className="text-sm font-medium text-muted hover:text-ink">← Volver a auditorías</Link>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-ink">Preparación del expediente</h1>
            <StatusBadge tone="warning">En captura</StatusBadge>
          </div>
          <p className="mt-1 text-sm text-muted">Caso demo local — visual Phase 8 · Política GDM_GAM_PRD_MLG_003 V5</p>
        </div>
        <div className="rounded-lg border border-line bg-surface-1 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-subtle">CaVe</p>
          <p className="mt-1 font-mono text-lg font-semibold text-ink">TCK-2026-0892</p>
        </div>
      </div>

      <form action={createAudit} className="rounded-2xl border border-line bg-background/40 p-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.8fr)_minmax(320px,0.9fr)]">
          <div className="rounded-xl border border-line bg-surface-1 p-4">
            <label className="flex min-h-[185px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-line bg-background px-5 py-6 text-center hover:border-brand/60 hover:bg-surface-2">
              <input name="evidences" required multiple type="file" accept=".pdf,.jpg,.jpeg,.png,.mp3,.wav,.csv,.xml" className="sr-only" />
              <span className="rounded-lg border border-line bg-surface-2 px-3 py-1 text-xs font-medium text-muted">Carga de archivos</span>
              <h2 className="mt-3 text-xl font-semibold text-ink">Arrastra tus archivos aquí o haz clic para explorar</h2>
              <p className="mt-1.5 max-w-2xl text-sm text-muted">Validación inmediata, OCR y transcripción automática al soltar.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-1.5 text-xs text-subtle">
                {['PDF', 'JPG', 'PNG', 'MP3', 'WAV', 'CSV', 'XML', 'Máx. 50 MB'].map((item) => <span key={item} className="rounded-md border border-line bg-surface-1 px-2 py-0.5">{item}</span>)}
              </div>
            </label>
          </div>

          <aside className="rounded-xl border border-line bg-surface-1 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-ink">Datos extraídos o necesarios</h2>
                <p className="mt-0.5 text-xs text-muted">Confirma o completa lo faltante.</p>
              </div>
              <StatusBadge>Preparación</StatusBadge>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <label className="block text-sm font-medium text-muted">
                CaVe <span className="text-danger">*</span>
                <input name="externalCaseId" required defaultValue="TCK-2026-0892" placeholder="TCK-2026-0892" className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-1.5 font-mono text-sm text-ink outline-none placeholder:text-subtle focus:border-brand" />
              </label>
              <label className="block text-sm font-medium text-muted">
                Nombre
                <input name="studentName" defaultValue="Alumno Demo Local" placeholder="Nombre si existe" className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-1.5 text-sm text-ink outline-none placeholder:text-subtle focus:border-brand" />
              </label>
              <label className="block text-sm font-medium text-muted">
                Matrícula
                <input name="studentId" placeholder="A01234567" className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-1.5 text-sm text-ink outline-none placeholder:text-subtle focus:border-brand" />
              </label>
              <label className="block text-sm font-medium text-muted">
                Inicio clases <span className="text-danger">*</span>
                <input name="classStartDate" required type="date" defaultValue="2026-08-12" className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-1.5 text-sm text-ink outline-none focus:border-brand" />
              </label>
              <label className="block text-sm font-medium text-muted sm:col-span-2 lg:col-span-1 xl:col-span-2">
                Inicio ticket <span className="text-danger">*</span>
                <input name="ticketStartDate" required type="datetime-local" defaultValue="2026-09-18T16:40" className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-1.5 text-sm text-ink outline-none focus:border-brand" />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5"><FieldBadge>CaVe detectado</FieldBadge><FieldBadge>Fechas sugeridas</FieldBadge></div>
          </aside>

          <div className="overflow-hidden rounded-xl border border-line bg-surface-1">
          <div className="border-b border-line px-5 py-4">
            <h2 className="font-semibold text-ink">Fila de archivos</h2>
            <p className="mt-1 text-sm text-muted">Progreso de carga, validación técnica e indexación previa.</p>
          </div>
          <div className="divide-y divide-line">
            {preparedFiles.map((file) => (
              <div key={file.name} className="grid gap-4 px-5 py-4 md:grid-cols-[52px_1fr_140px_96px_80px] md:items-center">
                <span className="w-fit rounded-md border border-line bg-background px-2 py-1 font-mono text-xs text-muted">{file.type}</span>
                <div>
                  <p className="font-medium text-ink">{file.name}</p>
                  <p className="mt-1 text-sm text-muted">{file.size} · {file.status}</p>
                </div>
                <div className="h-2 rounded-full bg-background"><div className="h-2 rounded-full bg-muted" style={{ width: `${file.progress}%` }} /></div>
                <StatusBadge tone={file.validation === 'Verificado' ? 'success' : 'neutral'}>{file.progress}% · {file.validation}</StatusBadge>
                <button type="button" className="text-left text-sm font-medium text-subtle hover:text-danger">Eliminar</button>
              </div>
            ))}
          </div>
          <div className="flex flex-col justify-between gap-4 border-t border-line bg-surface-2 px-5 py-4 xl:flex-row xl:items-center">
            <div className="text-sm text-muted">
              <p><span className="text-ink">3 archivos</span> preparados para indexación · Tamaño total en buffer: <span className="text-ink">6.45 MB</span></p>
              <p className="mt-1 font-mono text-xs text-subtle">Destino: /expedientes/2026/TCK-0892/raw</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link href="/auditorias" className="rounded-lg border border-line px-5 py-2.5 text-center text-sm font-semibold text-muted hover:bg-white/5 hover:text-ink">Cancelar</Link>
              <button type="submit" className="rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-background hover:bg-white">Subir e integrar al workspace</button>
            </div>
          </div>
          </div>

          <aside className="rounded-xl border border-line bg-surface-1 p-5">
            <h2 className="text-base font-semibold text-ink">Evidencias faltantes / datos faltantes</h2>
            <p className="mt-1 text-xs text-muted">Errores y bloqueos antes de integrar al workspace.</p>
            <div className="mt-5 space-y-3 text-sm">
              <div className="rounded-lg border border-warning/20 bg-warning/5 px-3 py-2 text-warning">Conflicto: otro documento sugiere fecha de ticket 18/09/2026 16:35.</div>
              <div className="rounded-lg border border-line bg-background px-3 py-2 text-muted">Falta capturar CaVe si el campo queda vacío.</div>
              <div className="rounded-lg border border-line bg-background px-3 py-2 text-muted">Falta confirmar fecha de inicio de clases.</div>
              <div className="rounded-lg border border-line bg-background px-3 py-2 text-muted">Agrega al menos una evidencia válida.</div>
            </div>
            <div className="mt-5 border-t border-line pt-4 text-xs text-muted">
              <div className="flex items-center justify-between"><span>Almacenamiento</span><StatusBadge tone="success">Cifrado</StatusBadge></div>
              <div className="mt-2 flex items-center justify-between"><span>Integridad</span><span className="font-mono text-ink">SHA-256</span></div>
              <div className="mt-2 font-mono text-subtle">/expedientes/2026/TCK-0892/raw</div>
            </div>
          </aside>
        </div>
      </form>
    </section>
  );
}
