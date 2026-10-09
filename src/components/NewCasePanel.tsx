// =============================================================================
// Panel de alta de caso. Solo UI: la creación real vive en el backend.
//
// ORDEN DEL ALTA (plan 2026-10-08, Fase 3, Paso 3.4)
//   seleccionar archivos -> `createCase` -> `uploadEvidence` por archivo ->
//   guardar notas de Back Office / HelpDesk -> navegar, SI Y SOLO SI al menos
//   una evidencia subió con éxito.
//
// LA EXIGENCIA DE EVIDENCIA ES DE INTERFAZ, NO DE DATOS (Fase 1, Opción A)
//   `POST /api/cases` crea la fila antes de que exista evidencia. Si el alta
//   tiene éxito y fallan TODAS las subidas, la fila queda persistida aunque la
//   interfaz no navegue. Eso se maneja aquí: se muestra el error y se ofrece
//   reintentar SOLO la carga. El reintento reutiliza el `caseId` ya creado y
//   nunca vuelve a llamar a `createCase`, así que no se duplica la fila.
//
// NINGÚN COMPENSACIÓN EN SERVIDOR
//   No hay cambios en `api/**` ni en `src/server/**`: el presupuesto de Vercel
//   Hobby está en 12 de 12 Functions y la garantía es de interfaz.
//
// REUTILIZACIÓN SIN DUPLICAR LÓGICA
//   - La secuencia de subida vive en `useEvidenceUpload`, el mismo motor que
//     usa `EvidenceUploader` dentro del expediente.
//   - Las notas usan el vocabulario cerrado (`NOTE_AREAS`) y el mismo cliente
//     `saveAreaComment`. Guardar notas nunca dispara una auditoría.
// =============================================================================

import type { ChangeEvent, FormEvent, ReactNode } from 'react';
import { useId, useRef, useState } from 'react';
import { ArrowRight, FilePlus2, FolderOpen, ShieldCheck, Upload, FileText, Music2, MessageSquare, X } from 'lucide-react';
import { createCase, saveAreaComment, toErrorState, type AppRole, type AreaCommentArea } from '../lib/api';
import { isLocalDashboardPreview } from '../lib/local-dashboard-preview';
import { getLocalPreviewCases, localPreviewCaseLabel } from '../lib/local-ui-preview';
import { goToCase } from '../lib/useHashRoute';
import { useEvidenceUpload, uploadItemKey } from '../lib/useEvidenceUpload';
import { AREA_COMMENT_LABELS, CASE_KIND_LABELS, CASE_STATUS_LABELS, CASE_STATUS_TONE, EVIDENCE_ACCEPT } from '../lib/labels';
import { formatBytes, formatDateTime } from '../lib/format';
import { Badge, Button, ErrorCard, Panel } from './ui';

/** Mensaje amigable cuando el servidor devuelve 401 (sesión requerida). */
const AUTH_ERROR_MESSAGE = 'El servidor requiere autenticación. La interfaz está en modo demo: los datos no se cargarán hasta que configure una sesión válida.';

/**
 * Solo las dos áreas que el expediente puede usar. Coincide con
 * `QUICK_AREAS` de `AreaQuickComments`: la bitácora completa de cinco áreas vive
 * en el panel del dictamen y jamás cruza al modelo.
 */
const NOTE_AREAS = ['BACK_OFFICE', 'HELPDESK'] as const satisfies readonly AreaCommentArea[];

/** Solo las dos áreas del alta. Escribir en `SCHOOL_SERVICES` es un error de tipos. */
type NoteArea = (typeof NOTE_AREAS)[number];

/**
 * Mismo límite que valida el servidor (`AREA_COMMENT_MAX` en
 * `src/server/area-comments.ts`).
 *
 * NO se aplica como `maxLength`: el navegador recortaría en silencio al pegar y
 * el usuario no sabría que su texto cambió. En su lugar hay contador, mensaje de
 * error y guardado bloqueado, como en `AreaQuickComments`.
 */
const MAX_NOTE_LENGTH = 4000;

export function NewCasePanel({ role = null }: { role?: AppRole | null }): ReactNode {
  // El Gerente es solo lectura: no crea casos, NI siquiera en la vista previa
  // local. El servidor lo rechaza igual (403); esto es presentación.
  if (role === 'manager') return <NewCaseReadOnly />;
  if (isLocalDashboardPreview()) return <NewCasePreview />;
  return <NewCaseForm />;
}

/** Estado del alta cuando el rol no puede crear casos (Gerente). */
function NewCaseReadOnly(): ReactNode {
  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Crear caso de cancelación</h1>
      </header>
      <Panel title="Solo lectura" description="Tu rol no puede crear casos.">
        <p role="status" className="text-sm text-muted">
          El Gerente consulta todos los casos, pero no los crea ni los modifica. Pide a un Asesor que
          abra el expediente.
        </p>
      </Panel>
    </div>
  );
}

/**
 * Una entrada de la lista del alta: un archivo que aún NO subió con éxito,
 * con su estado actual.
 *
 * `entries` es la única fuente de verdad. La lista que se pinta y el lote que
 * se envía salen de aquí, así que no pueden discrepar.
 */
interface EvidenceEntry {
  /** Identidad de la fila, estable entre renders. Es lo que se quita. */
  key: string;
  /** Identidad del ARCHIVO: dos filas del mismo archivo comparten `fileKey`. */
  fileKey: string;
  file: File;
  status: 'pending' | 'uploading' | 'error';
  message?: string;
  category?: string;
}

/** Fila de evidencia del panel del alta: nombre, tamaño, estado y error. */
interface EvidenceRow {
  key: string;
  name: string;
  sizeBytes: number;
  status: 'pending' | 'uploading' | 'error';
  message?: string;
  category?: string;
}

/** Identidad del archivo, no de la fila: permite reconciliar un reintento. */
function entryKeyFor(file: File): string {
  return uploadItemKey(file.name, file.size);
}

function newEntry(file: File, key: string): EvidenceEntry {
  return { key, fileKey: entryKeyFor(file), file, status: 'pending' };
}

function entryToRow(entry: EvidenceEntry): EvidenceRow {
  return {
    key: entry.key,
    name: entry.file.name,
    sizeBytes: entry.file.size,
    status: entry.status,
    message: entry.message,
    category: entry.category,
  };
}

/**
 * Resumen de la lista: distingue lo que el ALTA va a enviar de lo que quedó sin
 * subir. Contar `rows` sería falso: los fallidos se muestran en la lista pero
 * el botón de alta no los envía.
 */
function summarizeUploads(fresh: number, failed: number): string {
  const parts: string[] = [];
  if (fresh > 0) parts.push(`${fresh} por enviar`);
  if (failed > 0) parts.push(`${failed} sin subir`);
  return parts.length > 0 ? `${parts.join(' · ')}.` : '';
}

function NewCaseForm(): ReactNode {
  const formId = useId();
  const identifierId = `${formId}-identifier`;
  const evidenceId = `${formId}-evidence`;
  const evidenceHintId = `${evidenceId}-hint`;
  const evidenceRequiredId = `${formId}-evidence-required`;
  const notesErrorId = `${formId}-notes-error`;

  const [studentIdentifier, setStudentIdentifier] = useState('');
  /** Clasificación explícita del caso: `false` = real (default), `true` = prueba. */
  const [isTest, setIsTest] = useState(false);
  /**
   * Archivos elegidos y AÚN NO SUBIDOS CON ÉXITO, cada uno con su estado.
   *
   * Es la única fuente de verdad de la lista y del envío. Se fusionan aquí los
   * archivos recién elegidos con los que fallaron: antes vivían en dos estados
   * separados y la lista era un `or` exclusivo entre ellos, así que un archivo
   * añadido tras un fallo total quedaba invisible.
   */
  const [entries, setEntries] = useState<EvidenceEntry[]>([]);
  /** Claves de fila incesantes. Mismo patrón que `sequence` en useEvidenceUpload. */
  const nextEntryKey = useRef(0);
  /** Se rellena tras `createCase`: permite reintentar sin duplicar el caso. */
  const [caseId, setCaseId] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  /** Fallo al guardar notas con el caso y la evidencia ya creados (paso 2.9). */
  const [notesError, setNotesError] = useState<string | null>(null);
  const [notesPending, setNotesPending] = useState(false);

  const [notes, setNotes] = useState<Record<NoteArea, string>>({ BACK_OFFICE: '', HELPDESK: '' });
  // El servidor rechaza con 400 lo que pase del límite. Sin esto, "Reintentar
  // notas" reenvía el mismo texto y el alta entra en bucle.
  const noteTooLong = NOTE_AREAS.find((area) => notes[area].length > MAX_NOTE_LENGTH) ?? null;

  const { busy: uploading, announcement, runUploads } = useEvidenceUpload();

  const busy = creating || uploading || notesPending;
  // El error de notas se anuncia desde CADA textarea: solo uno de los dos puede
  // ser el que hay que corregir, y el lector de pantalla debe oírlo en ambos.
  const noteErrorDesc = notesError !== null || noteTooLong !== null ? ` ${notesErrorId}` : '';
  // La lista y el envío salen del MISMO estado, así que no pueden discrepar.
  // `entries` solo contiene archivos que NO han subido con éxito: los exitosos
  // se retiran al terminar el lote, así que ninguno se vuelve a enviar.
  const rows = entries.map(entryToRow);
  // Nunca intentados: es lo que envía el alta. Los fallidos tienen su propia
  // acción ("Reintentar carga") para que un archivo nuevo no arrastre en el
  // mismo lote la reintención de los anteriores.
  const freshFiles = entries.filter((entry) => entry.status === 'pending').map((entry) => entry.file);
  // Ya intentados y fallidos: solo reintentables, nunca automáticos.
  const failedEntries = entries.filter((entry) => entry.status === 'error');
  // Sin evidencia pendiente no hay alta: la exigencia vive aquí, en la interfaz.
  const canSubmit = freshFiles.length > 0 && !busy && noteTooLong === null;
  // Queda algo sin subir mientras haya CUALQUIER fallido, no solo si falló todo:
  // añadir un archivo nuevo no puede hacer desaparecer la reintención de los
  // anteriores, o se irían sin subir sin confirmación al navegar.
  const hasFailedUploads = caseId !== null && failedEntries.length > 0;
  /** El alta solo envía los pendientes, así que el contador no puede usar `rows`. */
  const uploadSummary = summarizeUploads(freshFiles.length, failedEntries.length);

  function handleEvidenceChange(event: ChangeEvent<HTMLInputElement>): void {
    const picked = Array.from(event.target.files ?? []);
    // Permite volver a seleccionar el mismo archivo después.
    event.target.value = '';
    if (picked.length === 0) return;
    // Contador MONÓTONO, no `entries.length`: quitar una fila baja la longitud
    // del array y la siguiente adición heredaría una clave viva. Como
    // `handleRemove` filtra por clave, eso borraría dos archivos de una vez.
    const added = picked.map((file) => {
      nextEntryKey.current += 1;
      return newEntry(file, `${formId}-new-${nextEntryKey.current}`);
    });
    setEntries((current) => [...current, ...added]);
    setCreateError(null);
  }

  function handleNoteChange(area: NoteArea, value: string): void {
    setNotes((previous) => ({ ...previous, [area]: value }));
    setNotesError(null);
  }

  /** Quita UNA entrada por su clave, no por posición: el índice no es estable. */
  function handleRemove(key: string): void {
    setEntries((current) => current.filter((entry) => entry.key !== key));
  }

  /**
   * Guarda las notas que tengan contenido.
   *
   * Devuelve `true` si se pudo guardar todo. Un fallo NO borra el trabajo ya
   * hecho (caso y evidencia): solo habilita el reintento de notas (paso 2.9).
   * Guardar notas nunca dispara una auditoría.
   */
  async function saveNotes(targetCaseId: string): Promise<boolean> {
    // Nunca se envía texto que el servidor va a rechazar.
    if (noteTooLong !== null) return false;
    const drafts = NOTE_AREAS.filter((area) => notes[area].trim() !== '');
    if (drafts.length === 0) return true;

    setNotesPending(true);
    setNotesError(null);
    try {
      for (const area of drafts) {
        await saveAreaComment(targetCaseId, { area, comment: notes[area] });
      }
      return true;
    } catch (cause) {
      const state = toErrorState(cause);
      setNotesError(state.message);
      return false;
    } finally {
      setNotesPending(false);
    }
  }

  /** Crea el caso UNA sola vez. Un reintento reutiliza el `caseId` existente. */
  async function ensureCase(): Promise<string | null> {
    if (caseId !== null) return caseId;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createCase(studentIdentifier.trim() === '' ? undefined : studentIdentifier.trim(), isTest);
      setCaseId(created.id);
      return created.id;
    } catch (cause) {
      const state = toErrorState(cause);
      setCreateError(state.category === 'AUTH_ERROR' ? AUTH_ERROR_MESSAGE : state.message);
      return null;
    } finally {
      setCreating(false);
    }
  }

  /**
   * Sube un lote y, si sube AL MENOS uno, guarda las notas y navega.
   *
   * `batch` son únicamente archivos que aún no subieron con éxito: un reintento
   * jamás vuelve a enviar los ya exitosos (riesgo 2 del plan). Los fallidos se
   * quedan en `entries` con su error para que sigan visibles y reintentables.
   */
  async function uploadAndFinish(batch: File[]): Promise<void> {
    // Antes de `ensureCase`: crear el caso y descubrir después que no hay nada
    // que subir dejaría una fila huérfana sin evidencia.
    if (batch.length === 0) return;
    const targetCaseId = await ensureCase();
    if (targetCaseId === null) return;

    // Marca el lote como "subiendo" antes de tocar la red: la lista no puede
    // ofrecer enviar de nuevo mientras la petición está en vuelo.
    const batchKeys = new Set(batch.map((file) => entryKeyFor(file)));
    setEntries((current) =>
      current.map((entry) =>
        batchKeys.has(entry.fileKey) ? { ...entry, status: 'uploading' } : entry,
      ),
    );

    const outcome = await runUploads(targetCaseId, batch);

    // Los exitosos salen de la lista; los fallidos permanecen con su error.
    // `outcome.failed` es la fuente exacta: leer `items` aquí daría el render
    // anterior y dejaría fuera archivos que acaban de subir.
    const failedByKey = new Map(outcome.failed.map((failure) => [entryKeyFor(failure.file), failure]));
    setEntries((current) =>
      current.flatMap((entry) => {
        // Fuera del lote (p. ej. añadido mientras subía): se queda como estaba.
        if (!batchKeys.has(entry.fileKey)) return [entry];
        const failure = failedByKey.get(entry.fileKey);
        // Subió con éxito: sale de la lista. Jamás se vuelve a enviar.
        if (failure === undefined) return [];
        // Falló: sigue visible con su error y es reintentable.
        return [{ ...entry, status: 'error' as const, message: failure.message, category: failure.category }];
      }),
    );

    // FALLO TOTAL: la fila ya existe pero sin evidencia. No se navega y el alta
    // no se presenta como exitosa; se ofrece reintentar la carga.
    if (outcome.uploaded === 0) return;

    // Éxito (parcial o total). Los fallidos ya quedan anunciados por el motor
    // en la región `aria-live` y, si hizo falta, se reintentan desde el
    // expediente con "Adjuntar evidencias".
    if (!(await saveNotes(targetCaseId))) return;
    goToCase(targetCaseId);
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;
    await uploadAndFinish(freshFiles);
  }

  async function handleRetryUploads(): Promise<void> {
    if (failedEntries.length === 0 || busy) return;
    // Reintenta SOLO lo fallido: nunca toca un archivo que ya subió.
    await uploadAndFinish(failedEntries.map((entry) => entry.file));
  }

  async function handleRetryNotes(): Promise<void> {
    if (caseId === null || notesPending) return;
    if (!(await saveNotes(caseId))) return;
    goToCase(caseId);
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Crear caso de cancelación</h1>
        <p className="mt-1 text-sm text-muted">Abre un expediente para reunir evidencia y solicitar su auditoría.</p>
      </header>
      <div className="new-case-layout">
        <div className="flex flex-col gap-4">
          <Panel
            title={<span className="inline-flex items-center gap-2"><FilePlus2 size={18} aria-hidden="true" />Información del caso</span>}
            description="El identificador es opcional y puede añadirse después."
          >
            <form onSubmit={(event) => void handleCreate(event)} className="flex flex-col gap-4" noValidate>
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

              {/*
                El `fieldset` + `legend` ya dan el nombre y la agrupación del
                conjunto de radios. Un `role="radiogroup"` anidado quedaba sin
                nombre accesible y duplicaba ese grupo, así que se eliminó: la
                descripción se asocia al propio `fieldset`.
              */}
              <fieldset className="flex flex-col gap-2" aria-describedby={`${formId}-kind-hint`}>
                <legend className="text-sm font-medium text-ink">Clasificación del caso</legend>
                <p id={`${formId}-kind-hint`} className="text-xs text-muted">
                  Marca «Prueba» para datos de demostración o pruebas. Los casos de prueba no cuentan en
                  las métricas operativas.
                </p>
                <div className="flex flex-wrap gap-3">
                  {([
                    { value: false, label: CASE_KIND_LABELS.real },
                    { value: true, label: CASE_KIND_LABELS.test },
                  ] as const).map((option) => {
                    const inputId = `${formId}-kind-${option.value ? 'test' : 'real'}`;
                    const selected = isTest === option.value;
                    return (
                      <label
                        key={inputId}
                        htmlFor={inputId}
                        className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                          selected ? 'border-brand/50 bg-brand/5 text-ink' : 'border-line bg-surface-2 text-muted'
                        }`}
                      >
                        <input
                          id={inputId}
                          type="radio"
                          name="caseKind"
                          value={option.value ? 'test' : 'real'}
                          checked={selected}
                          onChange={() => setIsTest(option.value)}
                          className="h-4 w-4 accent-brand"
                        />
                        {option.label}
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              {createError !== null && <ErrorCard message={createError} />}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                <a href="#/casos" className="text-sm font-medium text-muted hover:text-ink">Cancelar</a>
                <Button
                  type="submit"
                  variant="primary"
                  loading={busy}
                  loadingLabel="Creando caso"
                  disabled={!canSubmit}
                  aria-describedby={
                    // El bloqueo del botón puede venir de dos sitios y el lector
                    // de pantalla necesita saber cuál: falta evidencia o la nota
                    // excede el límite del servidor.
                    freshFiles.length === 0
                      ? evidenceRequiredId
                      : noteTooLong !== null
                        ? notesErrorId
                        : undefined
                  }
                >
                  Crear y abrir expediente <ArrowRight size={16} aria-hidden="true" />
                </Button>
              </div>
            </form>
          </Panel>

          <Panel
            title={<span className="inline-flex items-center gap-2"><Upload size={18} aria-hidden="true" />Evidencias iniciales</span>}
            description="Se necesita al menos un archivo para abrir el expediente."
          >
            <label htmlFor={evidenceId} className="block text-sm font-medium text-ink">
              Archivos de evidencia
            </label>
            <p id={evidenceHintId} className="mt-1 text-xs text-muted">
              Formatos: PNG, JPG, WEBP, PDF, MP3, WAV, M4A, OGG. Puedes seleccionar varios a la vez.
            </p>
            <input
              id={evidenceId}
              type="file"
              multiple
              accept={EVIDENCE_ACCEPT}
              disabled={busy}
              aria-describedby={`${evidenceHintId} ${evidenceRequiredId}`}
              onChange={handleEvidenceChange}
              className="mt-3 block w-full rounded-xl border border-dashed border-line bg-surface-2 px-3 py-3 text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface-3 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-ink hover:file:bg-[#1f262f] disabled:cursor-not-allowed disabled:opacity-55"
            />
            <p id={evidenceRequiredId} className="mt-1.5 text-xs text-muted">
              {rows.length === 0 ? 'Selecciona al menos un archivo de evidencia para crear el caso.' : uploadSummary}
            </p>

            {/* El progreso se anuncia: no puede depender solo del color. */}
            <div role="status" aria-live="polite" className="mt-2 min-h-5 text-sm text-muted">
              {announcement}
            </div>

            {rows.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1.5">
                {rows.map((row) => (
                  <li
                    key={row.key}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate text-ink">{row.name}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-muted">{formatBytes(row.sizeBytes)}</span>
                      {row.status === 'pending' && <span className="text-xs text-muted">Pendiente de subir</span>}
                      {row.status === 'uploading' && <span className="text-xs text-muted">Subiendo…</span>}
                      {row.status === 'error' && (
                        <span className="text-xs font-medium text-danger">
                          {row.category ?? 'ERROR'} · {row.message}
                        </span>
                      )}
                      {row.status !== 'uploading' && (
                        <button
                          type="button"
                          onClick={() => handleRemove(row.key)}
                          className="rounded px-1 text-xs text-muted hover:text-danger"
                        >
                          <X size={14} aria-hidden="true" />
                          <span className="sr-only">Quitar {row.name}</span>
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {hasFailedUploads && (
              <div className="mt-4 flex flex-col gap-3">
                <ErrorCard
                  title="Archivos sin subir"
                  message={
                    freshFiles.length === 0
                      ? 'El caso ya quedó creado, pero sin evidencia. Reintenta la carga para poder abrir el expediente.'
                      : `Estos archivos no se pudieron subir. Puedes enviar los pendientes y reintentar estos después, o reintentarlos ahora.`
                  }
                  onRetry={() => void handleRetryUploads()}
                  retryLabel="Reintentar carga"
                  retrying={busy}
                />
              </div>
            )}
          </Panel>

          <Panel
            title={<span className="inline-flex items-center gap-2"><MessageSquare size={18} aria-hidden="true" />Notas de Back Office y HelpDesk</span>}
            description="Opcionales. Son contexto humano: no son política ni evidencia y por sí solas no deciden el resultado."
          >
            <div className="flex flex-col gap-4">
              {NOTE_AREAS.map((area) => {
                const label = AREA_COMMENT_LABELS[area];
                const textareaId = `${formId}-note-${area}`;
                const countId = `${textareaId}-count`;
                const text = notes[area];
                const tooLong = text.length > MAX_NOTE_LENGTH;
                const describedBy = `${countId}${noteErrorDesc}`;
                return (
                  <div key={area}>
                    <label htmlFor={textareaId} className="block text-sm font-semibold text-ink">
                      {label}
                    </label>
                    <textarea
                      id={textareaId}
                      rows={2}
                      value={text}
                      onChange={(event) => handleNoteChange(area, event.target.value)}
                      placeholder={`Comentario de ${label}`}
                      aria-describedby={describedBy}
                      className="mt-1.5 w-full resize-y rounded-lg border border-line bg-surface-1 p-2 text-sm text-ink placeholder:text-muted"
                    />
                    <p
                      id={countId}
                      className={`mt-1 text-xs tabular-nums ${tooLong ? 'text-danger' : 'text-muted'}`}
                    >
                      {text.length}/{MAX_NOTE_LENGTH}
                    </p>
                  </div>
                );
              })}
            </div>

            {noteTooLong !== null && (
              <p role="alert" className="mt-3 text-sm font-medium text-danger">
                La nota de {AREA_COMMENT_LABELS[noteTooLong]} supera los {MAX_NOTE_LENGTH} caracteres. Acórtala para
                continuar.
              </p>
            )}

            {notesError !== null && (
              <div id={notesErrorId} className="mt-3">
                <ErrorCard
                  title="No se pudieron guardar las notas"
                  message={`${notesError} El caso y su evidencia ya están guardados.`}
                  onRetry={() => void handleRetryNotes()}
                  retryLabel="Reintentar notas"
                  retrying={notesPending}
                />
              </div>
            )}
          </Panel>
        </div>

        <aside className="new-case-next-steps">
          <h2 className="text-base font-semibold text-ink">Siguientes pasos</h2>
          <p className="mt-1 text-sm text-muted">El expediente conserva la evidencia original y su preparación técnica.</p>
          <ol className="mt-5 flex flex-col gap-4">
            <li className="new-case-step"><span><FolderOpen size={17} aria-hidden="true" /></span><div><strong>Cargar más evidencias</strong><p>Desde el expediente puedes adjuntar archivos adicionales.</p></div></li>
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
