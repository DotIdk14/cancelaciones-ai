// =============================================================================
// Fecha de inicio de clases que aportó una persona, en el expediente.
//
// QUÉ ES
//   Un dato HUMANO, no evidencia. La escriben quienes conocen el calendario del
//   ciclo (por eso se pide nombre: la procedencia tiene que ser visible), y solo
//   entra al expediente cuando se audita de nuevo.
//
// CUÁNDO APARECE
//   Cuando hay un dictamen emitido que NO acreditó la fecha con la evidencia
//   (`temporalAnalysis.cycleStartDate === null` o `NO_DETERMINABLE`) y nadie la
//   ha capturado todavía. Si el dictamen ya trae fecha, o si ya hay fecha
//   capturada, esta ventana no aparece: en el segundo caso lo que se muestra es
//   la procedencia, con opción de corregirla.
//
// LO QUE NO HACE
//   Guardar NO audita (DO_NOT_REPROCESS_AI_UNNECESSARILY): un dictamen emitido
//   no se reabre solo. Por eso "Volver a auditar" no es una segunda vía de
//   auditoría: ENFOCA el botón "Auditar con IA" que ya existe en el expediente
//   (`AUDIT_TRIGGER_ID`), que sigue siendo la única forma de auditar y la que
//   aplica la cuota. Corrección incluida: corregir una fecha que ya alimentó un
//   dictamen obliga a volver a auditar, y eso se dice.
// =============================================================================

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pencil, RotateCcw, Save } from 'lucide-react';
import { setCycleStartDate, toErrorState } from '../lib/api';
import { formatDate, formatDateTime } from '../lib/format';
import { Button, SectionTitle } from './ui';

/** Mismo límite que valida el servidor (Zod) para `cycleStartDateByName`. */
const MAX_NAME_LENGTH = 120;

/**
 * Id del botón de auditar del expediente.
 *
 * Es el ÚNICO disparador de auditoría: esta ventana lo enfoca para no crear una
 * segunda vía (ni una segunda fuente de cuota) que se pueda desincronizar del
 * botón real. Vive en `CaseDetailPage` y se exporta desde aquí porque quien lo
 * necesita es justamente esta sección.
 */
export const AUDIT_TRIGGER_ID = 'case-audit-trigger';

export interface CycleStartDateCaptureProps {
  caseId: string;
  /**
   * `temporalAnalysis` del dictamen vigente, o `null` si no hay dictamen
   * emitido. Es `null` también cuando la interfaz recibe un assessment sin ese
   * bloque: sin dictamen no hay nada que esta ventana venga a resolver.
   */
  assessment: { cycleStartDate: string | null; relationToCycleStart: string } | null;
  cycleStartDate: string | null;
  cycleStartDateByName: string | null;
  cycleStartDateAt: string | null;
  /** Avisa al padre para que relea el caso y la fecha quede reflejada arriba. */
  onSaved: () => void | Promise<void>;
}

interface CapturedDate {
  date: string;
  byName: string | null;
  at: string | null;
}

/** Enfoca y trae a la vista, sin romper si el entorno no hace scroll. */
function focusAndScroll(element: HTMLElement | null): void {
  if (element === null) return;
  element.focus();
  if (typeof element.scrollIntoView === 'function') {
    element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

export function CycleStartDateCapture({
  caseId,
  assessment,
  cycleStartDate,
  cycleStartDateByName,
  cycleStartDateAt,
  onSaved,
}: CycleStartDateCaptureProps): ReactNode {
  const [draftDate, setDraftDate] = useState(cycleStartDate ?? '');
  const [draftName, setDraftName] = useState(cycleStartDateByName ?? '');
  /** El formulario abierto encima del resumen: captura o corrección. */
  const [editing, setEditing] = useState(false);
  /** "Ahora no": el expediente no vuelve a pedir la fecha en esta sesión. */
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [wasCorrection, setWasCorrection] = useState(false);
  /**
   * Lo que devolvió el PATCH, más la fecha que el padre tenía antes de
   * guardar. Sirve para dos cosas: mostrar la procedencia al instante (el padre
   * aún no ha recargado) y no tapar una corrección ajena posterior. En cuanto
   * el padre trae un valor DISTINTO al que tenía al guardar, manda el padre.
   */
  const [savedLocally, setSavedLocally] = useState<{ value: CapturedDate; previous: string | null } | null>(null);
  const [reauditRequest, setReauditRequest] = useState(0);

  const sectionRef = useRef<HTMLElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  const fromProps: CapturedDate | null =
    cycleStartDate === null ? null : { date: cycleStartDate, byName: cycleStartDateByName, at: cycleStartDateAt };
  const parentAcknowledged = savedLocally !== null && cycleStartDate !== savedLocally.previous;
  const captured = savedLocally !== null && !parentAcknowledged ? savedLocally.value : fromProps;

  const needsCycleStart =
    assessment !== null &&
    (assessment.cycleStartDate === null || assessment.relationToCycleStart === 'NO_DETERMINABLE');
  /** El dictamen vigente ya usó la fecha capturada: no hay nada que rehacer. */
  const verdictUsesCaptured =
    captured !== null && assessment !== null && assessment.cycleStartDate === captured.date;
  const needsReaudit = captured !== null && !verdictUsesCaptured;
  /**
   * Sin fecha capturada, el formulario se ofrece solo si el dictamen la necesita
   * y nadie lo descartó. Con fecha capturada, el formulario SOLO aparece si se
   * pide corregir: corregir no depende de que el dictamen actual la haya usado
   * (justo cuando la usó es cuando más importa poder corregirla).
   */
  const formOpen = captured === null ? needsCycleStart && !dismissed : editing;

  const trimmedName = draftName.trim();
  const canSave = draftDate.trim() !== '' && trimmedName !== '' && draftName.length <= MAX_NAME_LENGTH;

  useEffect(() => {
    if (formOpen) focusAndScroll(sectionRef.current);
  }, [formOpen]);

  // Al corregir, el foco va al campo de fecha: es el dato que se va a cambiar.
  useEffect(() => {
    if (editing) dateRef.current?.focus();
  }, [editing]);

  // "Volver a auditar" no audita: lleva la mirada y el foco al botón que sí lo
  // hace. Contador en vez de booleano para poder pedir el foco otra vez.
  useEffect(() => {
    if (reauditRequest === 0) return;
    focusAndScroll(document.getElementById(AUDIT_TRIGGER_ID));
  }, [reauditRequest]);

  const openEditor = (): void => {
    setDraftDate(captured?.date ?? '');
    setDraftName(captured?.byName ?? '');
    setEditing(true);
    setNotice(null);
  };

  const save = async (): Promise<void> => {
    const date = draftDate.trim();
    if (date === '' || !canSave) return;
    const correction = captured !== null;
    setBusy(true);
    setNotice(null);
    try {
      const response = await setCycleStartDate(caseId, date, trimmedName);
      setSavedLocally({
        previous: cycleStartDate,
        value: {
          date: response.cycleStartDate ?? date,
          byName: response.cycleStartDateByName ?? trimmedName,
          at: response.cycleStartDateAt ?? null,
        },
      });
      setWasCorrection(correction);
      setEditing(false);
      setNotice({
        tone: 'ok',
        text: correction ? 'Corrección de la fecha guardada.' : 'Fecha de inicio de clases guardada.',
      });
      await onSaved();
    } catch (cause) {
      setNotice({ tone: 'error', text: `No se pudo guardar: ${toErrorState(cause).message}` });
    } finally {
      setBusy(false);
    }
  };

  // Sin dictamen que no la Determinó, o sin fecha y con la ventana descartada:
  // esta sección no tiene nada que decir.
  if ((captured === null && !needsCycleStart) || (captured === null && dismissed)) return null;

  const reauditText = needsReaudit
    ? wasCorrection
      ? 'Corrección guardada: el dictamen vigente ya no usa esta fecha. Vuelve a auditar para compararla con el inicio del ciclo; esa auditoría consume cuota.'
      : 'El dictamen vigente no usa esta fecha. Vuelve a auditar para compararla con el inicio del ciclo; esa auditoría consume cuota.'
    : null;

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-label="Captura de la fecha de inicio de clases"
      className="mt-4 rounded-xl border border-line bg-surface-2 p-3"
    >
      {captured !== null && (
        <div>
          <p className="text-sm font-semibold text-ink">
            Fecha de inicio de clases: {formatDate(captured.date)} · capturada por {captured.byName ?? 'sin nombre'} el{' '}
            {formatDateTime(captured.at)}
          </p>
          <p className="mt-1 text-xs text-muted">
            Es un dato del equipo, no evidencia: solo entra al expediente cuando se audita de nuevo.
          </p>
          <div className="mt-2">
            <Button variant="secondary" onClick={openEditor} disabled={busy}>
              <Pencil size={14} aria-hidden="true" />
              Corregir
            </Button>
          </div>
        </div>
      )}

      {formOpen && (
        <div className={captured === null ? 'mt-3' : 'mt-3 border-t border-line pt-3'}>
          <SectionTitle>
            {captured === null ? 'Falta la fecha de inicio de clases' : 'Corrige la fecha de inicio de clases'}
          </SectionTitle>
          <p className="mt-1 text-xs text-muted">
            {captured === null
              ? 'El dictamen no pudo acreditarla con la evidencia del expediente. Si la capturas, la próxima auditoría podrá comparar la fecha de la solicitud contra el inicio del ciclo.'
              : 'Corrige la fecha que ya capture el equipo. El dato vigente queda con tu nombre, y la próxima auditoría usará este en lugar del anterior.'}
          </p>

          <div className="mt-3 flex flex-col gap-1.5">
            <label htmlFor="cycle-start-date" className="text-sm font-semibold text-ink">
              Fecha de inicio de clases
            </label>
            <input
              id="cycle-start-date"
              ref={dateRef}
              type="date"
              value={draftDate}
              onChange={(event) => {
                setDraftDate(event.target.value);
                setNotice(null);
              }}
              disabled={busy}
              required
              className="w-full rounded-xl border border-line bg-surface-1 px-3 py-2 text-sm text-ink disabled:opacity-60"
            />
          </div>

          <div className="mt-3 flex flex-col gap-1.5">
            <label htmlFor="cycle-start-name" className="text-sm font-semibold text-ink">
              Nombre de quien la captura
            </label>
            <p id="cycle-start-name-hint" className="text-xs text-muted">
              Queda registrado con tu nombre para que se sepa de dónde salió la fecha.
            </p>
            <input
              id="cycle-start-name"
              type="text"
              autoComplete="name"
              maxLength={MAX_NAME_LENGTH}
              value={draftName}
              onChange={(event) => {
                setDraftName(event.target.value);
                setNotice(null);
              }}
              aria-describedby={`cycle-start-name-hint cycle-start-name-count`}
              disabled={busy}
              required
              className="w-full rounded-xl border border-line bg-surface-1 px-3 py-2 text-sm text-ink disabled:opacity-60"
            />
            <span id="cycle-start-name-count" className="text-xs tabular-nums text-muted">
              {draftName.length}/{MAX_NAME_LENGTH}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={() => void save()}
              disabled={!canSave}
              loading={busy}
              loadingLabel="Guardando"
            >
              <Save size={14} aria-hidden="true" />
              Guardar
            </Button>
            {captured === null && (
              <Button variant="secondary" onClick={() => setDismissed(true)} disabled={busy}>
                Ahora no
              </Button>
            )}
          </div>
        </div>
      )}

      <div role="status" aria-live="polite" className="mt-3">
        {notice !== null && (
          <p className={`text-xs ${notice.tone === 'error' ? 'text-danger' : 'text-muted'}`}>{notice.text}</p>
        )}
        {reauditText !== null && (
          <div className="mt-2">
            <p className="text-xs text-muted">{reauditText}</p>
            <Button
              variant="secondary"
              className="mt-2"
              onClick={() => setReauditRequest((previous) => previous + 1)}
            >
              <RotateCcw size={14} aria-hidden="true" />
              Volver a auditar
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}