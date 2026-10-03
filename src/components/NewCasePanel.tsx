// =============================================================================
// Panel de alta de caso. Solo UI: la creación real vive en el backend.
// =============================================================================

import type { FormEvent, ReactNode } from 'react';
import { useId, useState } from 'react';
import { ArrowRight, FilePlus2, FolderOpen, ShieldCheck, Upload, FileText, Music2, MessageSquare, X } from 'lucide-react';
import { createCase, toErrorState } from '../lib/api';
import { isLocalDashboardPreview } from '../lib/local-dashboard-preview';
import { getLocalPreviewCases, localPreviewCaseLabel } from '../lib/local-ui-preview';
import { goToCase } from '../lib/useHashRoute';
import { CASE_STATUS_LABELS, CASE_STATUS_TONE } from '../lib/labels';
import { formatDateTime } from '../lib/format';
import { Badge, Button, ErrorCard, Panel } from './ui';

/** Mensaje amigable cuando el servidor devuelve 401 (sesión requerida). */
const AUTH_ERROR_MESSAGE = 'El servidor requiere autenticación. La interfaz está en modo demo: los datos no se cargarán hasta que configure una sesión válida.';

export function NewCasePanel(): ReactNode {
  return isLocalDashboardPreview() ? <NewCasePreview /> : <NewCaseForm />;
}

function NewCaseForm(): ReactNode {
  const formId = useId();
  const identifierId = `${formId}-identifier`;

  const [studentIdentifier, setStudentIdentifier] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createCase(studentIdentifier.trim() === '' ? undefined : studentIdentifier.trim());
      goToCase(created.id);
    } catch (err) {
      const state = toErrorState(err);
      const message = state.category === 'AUTH_ERROR' ? AUTH_ERROR_MESSAGE : state.message;
      setCreateError(message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Crear caso de cancelación</h1>
        <p className="mt-1 text-sm text-muted">Abre un expediente para reunir evidencia y solicitar su auditoría.</p>
      </header>
      <div className="new-case-layout">
        <Panel title={<span className="inline-flex items-center gap-2"><FilePlus2 size={18} aria-hidden="true" />Información del caso</span>} description="El identificador es opcional y puede añadirse después.">
          <form onSubmit={(event) => void handleCreate(event)} className="flex flex-col gap-4">
            <div>
              <label htmlFor={identifierId} className="mb-1.5 block text-sm font-medium text-ink">
                Matrícula o identificador del estudiante
              </label>
              <input
                id={identifierId}
                name="studentIdentifier"
                type="text"
                value={studentIdentifier}
                onChange={(event) => setStudentIdentifier(event.target.value)}
                placeholder="Ej. 202312345"
                aria-describedby={`${formId}-hint`}
                className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm text-ink placeholder:text-muted"
              />
              <p id={`${formId}-hint`} className="mt-1.5 text-xs text-muted">
                Si todavía no tienes este dato, puedes continuar sin él.
              </p>
            </div>
            {createError !== null && <ErrorCard message={createError} />}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <a href="#/casos" className="text-sm font-medium text-muted hover:text-ink">Cancelar</a>
              <Button type="submit" variant="primary" loading={creating} loadingLabel="Creando caso">
                Crear y abrir expediente <ArrowRight size={16} aria-hidden="true" />
              </Button>
            </div>
          </form>
        </Panel>

        <aside className="new-case-next-steps">
          <h2 className="text-base font-semibold text-ink">Siguientes pasos</h2>
          <p className="mt-1 text-sm text-muted">El expediente conserva la evidencia original y su preparación técnica.</p>
          <ol className="mt-5 flex flex-col gap-4">
            <li className="new-case-step"><span><FolderOpen size={17} aria-hidden="true" /></span><div><strong>Cargar evidencias</strong><p>Adjunta archivos al expediente abierto.</p></div></li>
            <li className="new-case-step"><span><Upload size={17} aria-hidden="true" /></span><div><strong>Esperar preparación</strong><p>Consulta el estado de validación y transcripción.</p></div></li>
            <li className="new-case-step"><span><ShieldCheck size={17} aria-hidden="true" /></span><div><strong>Auditar con IA</strong><p>El dictamen cita evidencia y procedimiento.</p></div></li>
          </ol>
        </aside>
      </div>
    </div>
  );
}

function NewCasePreview(): ReactNode {
  const [files, setFiles] = useState<File[]>([]);
  const [student, setStudent] = useState('');
  const [ticket, setTicket] = useState('');
  const recent = getLocalPreviewCases().slice(0, 3);
  const addFiles = (incoming: FileList | null): void => {
    if (incoming) setFiles((current) => [...current, ...Array.from(incoming)]);
  };

  return (
    <div className="new-case-page flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Crear / cargar nuevo caso de cancelación</h1>
        <p className="mt-1 text-sm text-muted">Agrupa las evidencias de una solicitud para su auditoría por el sistema y el equipo humano.</p>
      </header>
      <div className="new-case-layout">
        <div className="flex flex-col gap-4">
          <Panel title="Información del caso" description="Captura los datos del ticket y del estudiante.">
            <div className="new-case-fields">
              <label className="new-case-field"><span>Ticket / folio <em>*</em></span><input value={ticket} onChange={(event) => setTicket(event.target.value)} placeholder="Introduce el número de ticket" /></label>
              <label className="new-case-field"><span>Estudiante <em>*</em></span><input value={student} onChange={(event) => setStudent(event.target.value)} placeholder="Buscar por nombre, matrícula o ID…" /></label>
            </div>
            <p className="mt-2 text-xs text-muted">Vista local: no consulta directorios estudiantiles ni guarda datos.</p>
          </Panel>
          <Panel title="Expediente y evidencias digitales" description="Archivos locales visibles solo durante esta sesión del navegador.">
            <label className="preview-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files); }}>
              <Upload size={30} aria-hidden="true" />
              <strong>Arrastra y suelta archivos de evidencia aquí</strong>
              <span>Audio, documentos, capturas e historial de conversación</span>
              <span className="preview-file-button">Explorar archivos locales</span>
              <input type="file" multiple accept=".mp3,.wav,.pdf,.txt,.json,.jpg,.jpeg,.png" onChange={(event) => addFiles(event.target.files)} />
              <small>MP3, WAV, PDF, TXT, JSON, JPG y PNG</small>
            </label>
            <div className="preview-files-heading"><strong>Archivos seleccionados ({files.length})</strong><span>Sin carga al servidor</span></div>
            {files.length === 0 ? <p className="preview-no-files">Todavía no hay archivos seleccionados.</p> : <ul className="preview-file-list">{files.map((file, index) => <li key={`${file.name}-${index}`}><span className="preview-file-icon">{file.type.startsWith('audio/') ? <Music2 size={17} /> : file.type.startsWith('text/') ? <MessageSquare size={17} /> : <FileText size={17} />}</span><span className="min-w-0 flex-1"><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(1)} MB · Solo vista local</small></span><button type="button" aria-label={`Quitar ${file.name}`} onClick={() => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}><X size={16} /></button></li>)}</ul>}
            <p className="preview-note">El flujo productivo conserva los archivos originales y valida su preparación antes de iniciar una auditoría.</p>
            <div className="new-case-preview-actions"><a href="#/casos">Cancelar</a><Button disabled title="Requiere una sesión productiva para guardar evidencia">Guardar y ejecutar auditoría IA</Button></div>
            <p className="text-right text-xs text-muted">Inicia sesión en producción para guardar este caso.</p>
          </Panel>
        </div>
        <aside className="new-case-next-steps">
          <div className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold text-ink">Expedientes recientes</h2><a href="#/casos">Ver todos</a></div>
          <div className="preview-recent-list">{recent.map((item) => <a key={item.id} href={`#/casos/${encodeURIComponent(item.id)}`}><div className="flex items-start justify-between gap-2"><strong>{localPreviewCaseLabel(item.id)}</strong><Badge tone={CASE_STATUS_TONE[item.status]}>{CASE_STATUS_LABELS[item.status]}</Badge></div><span>{item.studentIdentifier ?? 'Sin estudiante vinculado'}</span><small>Actualizado {formatDateTime(item.updatedAt)}</small></a>)}</div>
          <Button variant="secondary" disabled title="La importación masiva no está disponible en este flujo">Importar lote masivo (CSV / JSON)</Button>
        </aside>
      </div>
    </div>
  );
}
