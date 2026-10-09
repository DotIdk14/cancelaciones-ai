// Etapa 2 de revisión humana: decisión final del Coordinador.
import type { FormEvent, ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { finalizeCaseReview, toErrorState, workflowStateOf } from '../lib/api';
import type { AppRole, CaseReviewDto, CoordinatorDecision, ErrorState, WorkflowState } from '../lib/api';
import type { AuditResultType } from '../skills/audit/types';
import { cx } from '../lib/cx';
import { formatDateTime } from '../lib/format';
import {
  COORDINATOR_DECISION_LABELS,
  REVIEW_COMMENT_LIMITS,
  REVIEW_RESULT_OPTIONS,
  RESULT_DESCRIPTIONS,
  RESULT_LABELS,
  resolutionLabel,
} from '../lib/labels';
import { Badge, Button, DataRow, ErrorCard, Panel, SectionTitle } from './ui';

/** Etiqueta de la decisión de etapa 2, para los radios del Coordinador. */
const DECISION_OPTIONS: ReadonlyArray<{ value: CoordinatorDecision; label: string; description: string }> = [
  {
    value: 'APPROVE',
    label: 'Aprobar la resolución del Asesor',
    description: 'Conserva la resolución propuesta. No se cambia nada de lo registrado por el Asesor.',
  },
  {
    value: 'CHANGE',
    label: 'Cambiar la resolución',
    description: 'Sustituye la resolución propuesta por otra distinta del vocabulario vigente.',
  },
];

// Etapa 2 — decisión final del Coordinador
// =============================================================================

/**
 * Etapa 2. Muestra la decisión final si ya existe; ofrece el formulario al
 * Coordinador cuando el caso está `PENDING_COORDINATOR`; y para Asesor/Gerente
 * deja constancia de que el caso está pendiente, sin controles de mutación.
 */
export function CoordinatorStage({
  caseId,
  review,
  workflowState,
  role,
  onSubmitted,
}: {
  caseId: string;
  review: CaseReviewDto;
  workflowState?: WorkflowState;
  role: AppRole | null;
  onSubmitted?: () => void;
}): ReactNode {
  const state = workflowStateOf(review, workflowState);
  if (state === 'FINALIZED') {
    return <CoordinatorDecisionRecord review={review} />;
  }
  if (role === 'coordinator') {
    return <CoordinatorFinalizeForm caseId={caseId} review={review} onSubmitted={onSubmitted} />;
  }
  const message =
    role === 'manager'
      ? 'Solo lectura: la finalización del caso la registra un Coordinador.'
      : 'Pendiente de la decisión del Coordinador. Tu decisión de Asesor quedó registrada y no se puede modificar.';
  return (
    <Panel
      title="Decisión del Coordinador"
      description="Finalización del flujo de revisión en dos etapas."
    >
      <p role="status" className="text-sm text-muted">
        {message}
      </p>
    </Panel>
  );
}

/** Formulario de la etapa 2. Sólo lo ve el Coordinador. */
function CoordinatorFinalizeForm({
  caseId,
  review,
  onSubmitted,
}: {
  caseId: string;
  review: CaseReviewDto;
  onSubmitted?: () => void;
}): ReactNode {
  const [decision, setDecision] = useState<CoordinatorDecision | ''>('');
  const [resolution, setResolution] = useState<AuditResultType | ''>('');
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<ErrorState | null>(null);
  const [finalized, setFinalized] = useState<CaseReviewDto | null>(null);

  const trimmed = comment.trim();
  const tooLong = trimmed.length > REVIEW_COMMENT_LIMITS.max;
  // La resolución de cambio debe ser DISTINTA de la del Asesor: la del Asesor no
  // se ofrece, así que "misma" no es una opción representable.
  const resolutionOptions = REVIEW_RESULT_OPTIONS.filter((option) => option !== review.result);
  const canSubmit =
    (decision === 'APPROVE' || (decision === 'CHANGE' && resolution !== '')) && !tooLong && !sending;

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      if (decision === '' || !canSubmit) return;
      setSending(true);
      setError(null);
      try {
        const data = await finalizeCaseReview(caseId, {
          decision,
          ...(decision === 'CHANGE' && resolution !== '' ? { resolution } : {}),
          comment: trimmed,
        });
        setFinalized(data.review);
        onSubmitted?.();
      } catch (err) {
        setError(toErrorState(err));
      } finally {
        setSending(false);
      }
    },
    [canSubmit, caseId, decision, onSubmitted, resolution, trimmed],
  );

  if (finalized !== null) {
    return <CoordinatorDecisionRecord review={finalized} />;
  }

  const commentErrorId = 'coordinador-comment-error';
  const formErrorId = 'coordinador-form-error';

  return (
    <Panel
      title="Decisión del Coordinador"
      description="Aprueba la resolución del Asesor o cámbiala por otra distinta. No se modifica la decisión del Asesor."
    >
      <form className="flex flex-col gap-5" onSubmit={(event) => void handleSubmit(event)} aria-busy={sending}>
        <fieldset className="flex flex-col gap-2" disabled={sending}>
          <legend className="text-sm font-semibold text-ink">Decisión final</legend>
          <p className="text-xs text-muted">
            La resolución propuesta por el Asesor es <strong>{resolutionLabel(review.result)}</strong>.
          </p>
          {DECISION_OPTIONS.map((option) => {
            const inputId = `coordinador-decision-${option.value}`;
            const descId = `${inputId}-desc`;
            return (
              <div
                key={option.value}
                className={cx(
                  'rounded-xl border p-3 transition-colors',
                  decision === option.value ? 'border-brand/50 bg-brand/5' : 'border-line bg-surface-2',
                )}
              >
                <div className="flex items-start gap-2.5">
                  <input
                    id={inputId}
                    type="radio"
                    name="coordinador-decision"
                    value={option.value}
                    checked={decision === option.value}
                    onChange={() => setDecision(option.value)}
                    aria-describedby={descId}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
                  />
                  <label htmlFor={inputId} className="text-sm font-medium text-ink">
                    {option.label}
                  </label>
                </div>
                <p id={descId} className="mt-1 pl-7 text-xs text-muted">
                  {option.description}
                </p>
              </div>
            );
          })}
        </fieldset>

        {decision === 'CHANGE' && (
          <fieldset className="flex flex-col gap-2" disabled={sending}>
            <legend className="text-sm font-semibold text-ink">Resolución final distinta</legend>
            <p className="text-xs text-muted">
              Elige la resolución que sustituye a la del Asesor. No puede ser la misma.
            </p>
            <div className="flex flex-col gap-2">
              {resolutionOptions.map((option) => {
                const inputId = `coordinador-resolution-${option}`;
                const descId = `${inputId}-desc`;
                return (
                  <div
                    key={option}
                    className={cx(
                      'rounded-xl border p-3 transition-colors',
                      resolution === option ? 'border-brand/50 bg-brand/5' : 'border-line bg-surface-2',
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      <input
                        id={inputId}
                        type="radio"
                        name="coordinador-resolution"
                        value={option}
                        checked={resolution === option}
                        onChange={() => setResolution(option)}
                        aria-describedby={descId}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
                      />
                      <label htmlFor={inputId} className="text-sm font-medium text-ink">
                        {RESULT_LABELS[option]}
                      </label>
                    </div>
                    <p id={descId} className="mt-1 pl-7 text-xs text-muted">
                      {RESULT_DESCRIPTIONS[option]}
                    </p>
                  </div>
                );
              })}
            </div>
          </fieldset>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="coordinador-comment" className="text-sm font-semibold text-ink">
            Comentario del Coordinador <span className="font-normal text-muted">(opcional)</span>
          </label>
          <textarea
            id="coordinador-comment"
            name="comment"
            rows={4}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            disabled={sending}
            aria-invalid={tooLong ? true : undefined}
            aria-describedby={tooLong ? commentErrorId : undefined}
            className={cx(
              'w-full rounded-xl border bg-surface-2 px-3 py-2 text-sm text-ink',
              'placeholder:text-subtle disabled:cursor-not-allowed disabled:opacity-60',
              tooLong ? 'border-danger/60' : 'border-line',
            )}
          />
          {tooLong && (
            <p id={commentErrorId} className="text-xs text-danger">
              El comentario excede el máximo de {REVIEW_COMMENT_LIMITS.max} caracteres.
            </p>
          )}
        </div>

        {error !== null && (
          <div id={formErrorId}>
            <ErrorCard title="No se pudo registrar la decisión" message={error.message} />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant="primary"
            disabled={!canSubmit}
            loading={sending}
            loadingLabel="Registrando la decisión"
            aria-describedby={error !== null ? formErrorId : undefined}
          >
            Finalizar el caso
          </Button>
          <p className="text-xs text-muted">
            La decisión final es única e inmutable: no se puede reabrir ni sustituir.
          </p>
        </div>
      </form>
    </Panel>
  );
}

/** Decisión final registrada del Coordinador. Solo lectura. */
export function CoordinatorDecisionRecord({ review }: { review: CaseReviewDto }): ReactNode {
  const decision = review.coordinatorDecision ?? null;
  if (decision === null) return null;
  return (
    <Panel
      title="Decisión del Coordinador"
      description="Finalización del flujo de revisión. La resolución del Asesor se conserva aparte."
      labelledBy="decision-coordinador"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Decisión final</p>
          <div className="mt-2">
            <Badge tone={decision === 'APPROVE' ? 'success' : 'brand'}>
              {COORDINATOR_DECISION_LABELS[decision]}
            </Badge>
          </div>
        </div>
        {review.coordinatorCreatedAt != null && (
          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Registrada</p>
            <p className="text-sm text-ink">{formatDateTime(review.coordinatorCreatedAt)}</p>
          </div>
        )}
      </div>

      <dl className="mt-4">
        <DataRow label="Resolución propuesta por el Asesor" value={resolutionLabel(review.result)} />
        <DataRow
          label="Resolución final"
          value={
            decision === 'CHANGE' && review.coordinatorResolution
              ? resolutionLabel(review.coordinatorResolution)
              : resolutionLabel(review.result)
          }
        />
      </dl>

      {review.coordinatorComment != null && review.coordinatorComment !== '' && (
        <div className="mt-4">
          <SectionTitle>Comentario del Coordinador</SectionTitle>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">
            {review.coordinatorComment}
          </p>
        </div>
      )}
    </Panel>
  );
}

// =============================================================================
