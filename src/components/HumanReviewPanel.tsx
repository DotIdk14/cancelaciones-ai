// =============================================================================
// Revisión humana del dictamen, dentro del detalle del caso.
// =============================================================================
// Es una sección DISCRETA, al final de la página y sin robarle protagonismo al
// dictamen de la IA: el resultado del modelo es lo que la persona vino a ver, y
// la revisión humana es un apunte sobre él.
//
// LO QUE NO HACE, y es lo importante: no modifica `result_json`. El dictamen de
// la IA se queda como está, con su confianza y su trazabilidad; lo que se guarda
// es un dictamen humano aparte, y el dashboard calcula la coincidencia. Si esto
// sobrescribiera el resultado, se perdería la evidencia de qué decidió el modelo
// y la comparación no sería posible.
//
// EL SELECTOR REUTILIZA `AUDIT_RESULTS`, el vocabulario cerrado del Skill. No hay
// "Improcedente" ni ninguna otra opción: si la IA se equivocó, eso se dice en las
// notas, y el dictamen sigue siendo una de las seis clasificaciones normativas.
// Una lista propia haría que "IA vs humano" dejara de comparar dos cosas del mismo
// dominio.

import type { ReactNode } from 'react';
import { useCallback, useEffect, useId, useState } from 'react';
import { Save } from 'lucide-react';
import { AUDIT_RESULTS, type AuditResultType } from '../skills/audit/types';
import { RESULT_LABELS } from '../lib/labels';
import { formatDateTime } from '../lib/format';
import { Badge, Button, ErrorCard, Panel, Spinner } from './ui';

const CONTROL_CLASS =
  'w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink';
const LABEL_CLASS = 'mb-1 block text-xs font-medium uppercase tracking-wide text-muted';
const HINT_CLASS = 'sr-only';

export interface HumanReview {
  id: string;
  auditId: string;
  result: AuditResultType;
  notes: string | null;
  reviewedBy: string;
  reviewedAt: string;
}

interface ReviewResponse {
  review: HumanReview | null;
  aiResult: AuditResultType | null;
}

export interface HumanReviewPanelProps {
  caseId: string;
}

export function HumanReviewPanel({ caseId }: HumanReviewPanelProps): ReactNode {
  const baseId = useId();
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [result, setResult] = useState<AuditResultType | ''>('');
  const [reviewedBy, setReviewedBy] = useState('');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/cases/${encodeURIComponent(caseId)}/review`);
      if (!res.ok) throw new Error('No se pudo cargar la revisión.');
      const body = (await res.json()) as ReviewResponse;
      setData(body);
      // Se precarga el formulario con lo que ya hay, para que corregir una
      // revisión sea editar y no volver a escribirla entera.
      if (body.review !== null) {
        setResult(body.review.result);
        setReviewedBy(body.review.reviewedBy);
        setNotes(body.review.notes ?? '');
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Error desconocido.');
    } finally {
      setIsLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async (): Promise<void> => {
    if (result === '') return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/cases/${encodeURIComponent(caseId)}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          result,
          reviewedBy,
          // El nombre se manda tal cual: el servidor lo resuelve contra
          // `profiles` para obtener el uuid que exige la FK.
          notes: notes.trim() === '' ? null : notes,
        }),
      });
      const body = (await res.json()) as { review?: HumanReview; error?: { message: string } };
      if (!res.ok || body.review === undefined) {
        setSaveError(body.error?.message ?? 'No se pudo guardar la revisión.');
        return;
      }
      setData((current) => ({
        review: body.review ?? null,
        aiResult: current?.aiResult ?? null,
      }));
      setSavedAt(new Date().toISOString());
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Error desconocido.');
    } finally {
      setIsSaving(false);
    }
  }, [caseId, notes, result, reviewedBy]);

  if (isLoading) {
    return (
      <Panel title="Revisión humana" description="Registra el dictamen de una persona sobre este caso.">
        <div role="status" aria-busy="true" className="flex items-center gap-2 py-2">
          <Spinner label="Cargando revisión" className="h-4 w-4" />
          <span className="sr-only">Cargando la revisión humana…</span>
        </div>
      </Panel>
    );
  }

  if (loadError !== null) {
    return (
      <Panel title="Revisión humana" description="Registra el dictamen de una persona sobre este caso.">
        <ErrorCard message={loadError} onRetry={() => void load()} retrying={isLoading} />
      </Panel>
    );
  }

  const review = data?.review ?? null;
  const aiResult = data?.aiResult ?? null;
  const canSave = result !== '' && reviewedBy.trim().length >= 2 && !isSaving;
  // La coincidencia se calcula AQUÍ, con lo que llegó del servidor, y solo si
  // hay ambos dictámenes. Sin revisión no hay nada que comparar: no se pinta
  // "No" ni "Sí", porque sería afirmar algo que no se ha medido.
  const matches = review !== null && aiResult !== null ? review.result === aiResult : null;

  return (
    <Panel
      title="Revisión humana"
      description="El dictamen de la IA no se modifica. Aquí se registra el de una persona, y el dashboard calcula la coincidencia."
    >
      <div className="flex flex-col gap-4">
        {aiResult !== null ? (
          <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <div className="flex items-baseline gap-2">
              <dt className="text-muted">Dictamen IA</dt>
              <dd>
                <Badge tone="brand">{RESULT_LABELS[aiResult]}</Badge>
              </dd>
            </div>
            {review !== null ? (
              <>
                <div className="flex items-baseline gap-2">
                  <dt className="text-muted">Dictamen humano</dt>
                  <dd>
                    <Badge tone={matches === true ? 'success' : 'warning'}>
                      {RESULT_LABELS[review.result]}
                    </Badge>
                  </dd>
                </div>
                <div className="flex items-baseline gap-2">
                  <dt className="text-muted">Coincide</dt>
                  <dd>
                    <Badge tone={matches === true ? 'success' : 'warning'}>
                      {matches === true ? 'Sí' : 'No'}
                    </Badge>
                  </dd>
                </div>
              </>
            ) : null}
          </dl>
        ) : (
          <p className="text-sm text-muted">
            Este caso todavía no tiene una auditoría completada, así que no hay dictamen que revisar.
          </p>
        )}

        {review !== null ? (
          <p className="text-xs text-muted">
            Revisado por {review.reviewedBy} el {formatDateTime(review.reviewedAt)}.
            {review.notes !== null && review.notes !== '' ? ` «${review.notes}»` : ''}
          </p>
        ) : null}

        {saveError !== null ? (
          <ErrorCard message={saveError} onRetry={() => void save()} retrying={isSaving} />
        ) : null}
        {savedAt !== null && saveError === null ? (
          <p role="status" className="text-xs text-success">
            Revisión guardada.
          </p>
        ) : null}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          className="flex flex-col gap-3"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${baseId}-result`} className={LABEL_CLASS}>
                Dictamen humano
              </label>
              <select
                id={`${baseId}-result`}
                name="result"
                value={result}
                onChange={(event) => setResult(event.target.value as AuditResultType | '')}
                aria-describedby={`${baseId}-result-hint`}
                className={CONTROL_CLASS}
              >
                <option value="">Sin registrar</option>
                {AUDIT_RESULTS.map((value) => (
                  <option key={value} value={value}>
                    {RESULT_LABELS[value]}
                  </option>
                ))}
              </select>
              <p id={`${baseId}-result-hint`} className={HINT_CLASS}>
                Usa el mismo vocabulario que la auditoría. Para indicar que la IA se
                equivocó, escribe la razón en las notas.
              </p>
            </div>
            <div>
              <label htmlFor={`${baseId}-reviewer`} className={LABEL_CLASS}>
                Responsable de la revisión
              </label>
              <input
                id={`${baseId}-reviewer`}
                name="reviewedBy"
                type="text"
                value={reviewedBy}
                onChange={(event) => setReviewedBy(event.target.value)}
                aria-describedby={`${baseId}-reviewer-hint`}
                className={CONTROL_CLASS}
              />
              <p id={`${baseId}-reviewer-hint`} className={HINT_CLASS}>
                Nombre de quien revisa. Queda registrado junto al dictamen.
              </p>
            </div>
          </div>

          <div>
            <label htmlFor={`${baseId}-notes`} className={LABEL_CLASS}>
              Notas (opcional)
            </label>
            <textarea
              id={`${baseId}-notes`}
              name="notes"
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              aria-describedby={`${baseId}-notes-hint`}
              className={CONTROL_CLASS}
            />
            <p id={`${baseId}-notes-hint`} className={HINT_CLASS}>
              Motivo de la revisión. Opcional.
            </p>
          </div>

          <div>
            <Button type="submit" disabled={!canSave}>
              {isSaving ? <Spinner label="Guardando" className="h-4 w-4" /> : <Save size={14} aria-hidden="true" />}
              {review === null ? 'Registrar revisión' : 'Actualizar revisión'}
            </Button>
          </div>
        </form>
      </div>
    </Panel>
  );
}
