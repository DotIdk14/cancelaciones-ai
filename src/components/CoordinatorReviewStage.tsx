// Etapa 2 de revisión humana: decisión final del Coordinador.
import type { FormEvent, ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { finalizeCaseReview, toErrorState, workflowStateOf } from '../lib/api';
import type { AppRole, AuditDetail, CaseReviewDto, CoordinatorDecision, ErrorState, WorkflowState } from '../lib/api';
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
import { EVIDENCE_CHANNELS, EVIDENCE_COUNTRIES } from '../skills/audit/types';
import { CHANNEL_LABELS, COUNTRY_LABELS } from '../lib/labels';
import { ModalShell } from './OperationProgressDialog';
import { PROCEDURE_SECTION_OPTIONS } from '../lib/procedure-sections';

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
  canFinalize = false,
  canChangeResolution = false,
  canAddComment = false,
  caseCountry = null,
  caseChannel = null,
  externalCaseId = null,
  studentIdentifier = null,
  audit = null,
  onSubmitted,
}: {
  caseId: string;
  review: CaseReviewDto;
  workflowState?: WorkflowState;
  role: AppRole | null;
  canFinalize?: boolean;
  canChangeResolution?: boolean;
  canAddComment?: boolean;
  caseCountry?: string | null;
  caseChannel?: string | null;
  externalCaseId?: string | null;
  studentIdentifier?: string | null;
  audit?: AuditDetail | null;
  onSubmitted?: () => void;
}): ReactNode {
  const state = workflowStateOf(review, workflowState);
  if (state === 'FINALIZED') {
    return <CoordinatorDecisionRecord review={review} />;
  }
  if (canFinalize) {
    return <CoordinatorFinalizeForm caseId={caseId} review={review} caseCountry={caseCountry} caseChannel={caseChannel} externalCaseId={externalCaseId} studentIdentifier={studentIdentifier} audit={audit} canChangeResolution={canChangeResolution} canAddComment={canAddComment} onSubmitted={onSubmitted} />;
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
  caseCountry,
  caseChannel,
  externalCaseId,
  studentIdentifier,
  audit,
  canChangeResolution,
  canAddComment,
  onSubmitted,
}: {
  caseId: string;
  review: CaseReviewDto;
  caseCountry: string | null;
  caseChannel: string | null;
  externalCaseId: string | null;
  studentIdentifier: string | null;
  audit: AuditDetail | null;
  canChangeResolution: boolean;
  canAddComment: boolean;
  onSubmitted?: () => void;
}): ReactNode {
  const [decision, setDecision] = useState<CoordinatorDecision | ''>('');
  const [resolution, setResolution] = useState<AuditResultType | ''>('');
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<ErrorState | null>(null);
  const [finalized, setFinalized] = useState<CaseReviewDto | null>(null);
  const [country, setCountry] = useState(caseCountry ?? '');
  const [channel, setChannel] = useState(caseChannel ?? '');
  const [showOriginModal, setShowOriginModal] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [procedureSection, setProcedureSection] = useState('');

  const trimmed = comment.trim();
  const tracePrefix = decision === 'CHANGE' && procedureSection ? `Fundamento V5: sección ${procedureSection}.\n` : '';
  const tooLong = `${tracePrefix}${trimmed}`.length > REVIEW_COMMENT_LIMITS.max;
  // La resolución de cambio debe ser DISTINTA de la del Asesor: la del Asesor no
  // se ofrece, así que "misma" no es una opción representable.
  const resolutionOptions = REVIEW_RESULT_OPTIONS.filter((option) => option !== review.result);
  const aiAudit = audit?.resultJson?.audit ?? null;
  const aiResolution = aiAudit?.result ?? null;
  const missingEvidence = aiAudit?.missingEvidence ?? [];
  const canSubmit =
    (decision === 'APPROVE' || (decision === 'CHANGE' && canChangeResolution && resolution !== '' && procedureSection !== '')) &&
    (canAddComment || trimmed === '') && !tooLong && !sending;

  const submitDecision = useCallback(async (): Promise<void> => {
      if (decision === '' || !canSubmit || !country || !channel) return;
      setSending(true);
      setError(null);
      try {
        const data = await finalizeCaseReview(caseId, {
          decision,
          ...(decision === 'CHANGE' && resolution !== '' ? { resolution } : {}),
          comment: [decision === 'CHANGE' ? `Fundamento V5: sección ${procedureSection}.` : '', trimmed].filter(Boolean).join('\n'),
          country,
          channel,
        });
        setFinalized(data.review);
        setShowOriginModal(false);
        onSubmitted?.();
      } catch (err) {
        setError(toErrorState(err));
      } finally {
        setSending(false);
      }
    }, [canSubmit, caseId, channel, country, decision, onSubmitted, procedureSection, resolution, trimmed]);

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (decision === '' || !canSubmit) return;
    if (!country || !channel) {
      setShowOriginModal(true);
      return;
    }
    setConfirming(true);
  }, [canSubmit, channel, country, decision]);

  if (finalized !== null) {
    return <CoordinatorDecisionRecord review={finalized} />;
  }

  const commentErrorId = 'coordinador-comment-error';
  const formErrorId = 'coordinador-form-error';

  return (
    <Panel
      title="Decisión del Coordinador"
      description={canChangeResolution
        ? 'Aprueba la resolución del Asesor o cámbiala por otra distinta. No se modifica la decisión del Asesor.'
        : 'Puedes aprobar la resolución del Asesor.'}
    >
      <form className="flex flex-col gap-5" onSubmit={handleSubmit} aria-busy={sending}>
        <fieldset className="flex flex-col gap-2" disabled={sending}>
          <legend className="text-sm font-semibold text-ink">Decisión final</legend>
          <p className="text-xs text-muted">
            La resolución propuesta por el Asesor es <strong>{resolutionLabel(review.result)}</strong>.
          </p>
          {DECISION_OPTIONS.filter((option) => option.value !== 'CHANGE' || canChangeResolution).map((option) => {
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
          <div className="flex flex-col gap-4">
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
          <label htmlFor="coordinador-procedure-section" className="flex flex-col gap-1.5 text-sm font-semibold text-ink">
            Lineamiento V5 que fundamenta el cambio <span className="font-normal text-danger">(obligatorio)</span>
            <select id="coordinador-procedure-section" value={procedureSection} onChange={(event) => setProcedureSection(event.target.value)} disabled={sending} required className="rounded-lg border border-line bg-surface-2 px-3 py-2 font-normal text-ink">
              <option value="">Selecciona una sección del procedimiento V5</option>
              {PROCEDURE_SECTION_OPTIONS.map((section) => <option key={section.value} value={section.value}>{section.label}</option>)}
            </select>
            <span className="text-xs font-normal text-muted">Procedimiento GDM_GAM_PRD_MLG_003, versión 5. Puedes elegir una sección aunque la IA no la haya citado. La sección y el comentario quedarán registrados con la decisión del Coordinador.</span>
          </label>
          </div>
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
            disabled={sending || !canAddComment}
            aria-invalid={tooLong ? true : undefined}
            aria-describedby={tooLong ? commentErrorId : undefined}
            className={cx(
              'w-full rounded-xl border bg-surface-2 px-3 py-2 text-sm text-ink',
              'placeholder:text-subtle disabled:cursor-not-allowed disabled:opacity-60',
              tooLong ? 'border-danger/60' : 'border-line',
            )}
          />
          {!canAddComment && <p className="text-xs text-muted">Solo el propietario puede agregar comentarios.</p>}
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
            className="min-h-12 px-6 text-base"
            disabled={!canSubmit}
            loading={sending}
            loadingLabel="Registrando la decisión"
            aria-describedby={error !== null ? formErrorId : undefined}
          >
            Finalizar auditoría
          </Button>
          <p className="text-xs text-muted">
            La decisión final es única e inmutable: no se puede reabrir ni sustituir.
          </p>
        </div>
      </form>
      {confirming && (
        <ModalShell title="Confirma la finalización de la auditoría" onClose={() => setConfirming(false)}>
          <p className="mb-4 text-sm text-muted">Verifica el resumen. La decisión final se guardará una sola vez y conservará la resolución propuesta por el Asesor.</p>
          <dl className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2 p-4 text-sm">
            <DataRow label="Ticket" value={externalCaseId || caseId.slice(0, 8)} />
            <DataRow label="Matrícula" value={studentIdentifier || 'Sin matrícula'} />
            <DataRow label="Resultado formal de IA" value={aiResolution ? resolutionLabel(aiResolution) : 'No disponible'} />
            {aiAudit?.provisionalResolution && <DataRow label="Propuesta preliminar de IA" value={`${resolutionLabel(aiAudit.provisionalResolution.result)} · sección ${aiAudit.provisionalResolution.procedureSection}`} />}
            <DataRow label="Resolución del Asesor" value={resolutionLabel(review.result)} />
            <DataRow label="Resolución final" value={decision === 'CHANGE' && resolution ? resolutionLabel(resolution) : resolutionLabel(review.result)} />
            <DataRow label="Lineamiento V5" value={decision === 'CHANGE' ? `Sección ${procedureSection}` : (aiAudit?.procedureSection ? `Sección ${aiAudit.procedureSection}` : 'No disponible en el dictamen')} />
            <DataRow label="Estado" value="Auditoría finalizada. El cierre del ticket en Flokzu se administra por separado." />
          </dl>
          {missingEvidence.length > 0 && <div className="mt-4 rounded-xl border border-warning/30 bg-warning/5 p-3"><strong className="text-sm text-warning">Evidencias faltantes o advertencias ({missingEvidence.length})</strong><ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-ink">{missingEvidence.map((item, index) => <li key={`${item.title}-${index}`}>{item.title}: {item.reason}</li>)}</ul><p className="mt-2 text-xs text-muted">La propuesta puede ser preliminar. Estas advertencias permanecen en el dictamen.</p></div>}
          <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={() => setConfirming(false)} disabled={sending}>Volver a revisar</Button><Button variant="primary" onClick={() => void submitDecision()} disabled={!canSubmit} loading={sending} loadingLabel="Finalizando auditoría">Confirmar y finalizar auditoría</Button></div>
        </ModalShell>
      )}
      {showOriginModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowOriginModal(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="origin-required-title" className="w-full max-w-lg rounded-2xl border border-line bg-surface-1 p-5 shadow-xl">
            <h2 id="origin-required-title" className="text-lg font-semibold text-ink">Completa el origen antes de finalizar</h2>
            <p className="mt-2 text-sm text-muted">El dictamen final requiere país y canal. Tu decisión y comentario se conservarán mientras completas estos datos.</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">País
                <select required value={country} onChange={(event) => setCountry(event.target.value)} className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-ink">
                  <option value="">Selecciona un país</option>
                  {EVIDENCE_COUNTRIES.map((value) => <option key={value} value={value}>{COUNTRY_LABELS[value]}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Canal de origen · evidencia
                <select required value={channel} onChange={(event) => setChannel(event.target.value)} className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-ink">
                  <option value="">Selecciona un canal</option>
                  {EVIDENCE_CHANNELS.map((value) => <option key={value} value={value}>{CHANNEL_LABELS[value]}</option>)}
                </select>
              </label>
            </div>
            <p className="mt-3 text-xs text-muted">Registra el canal que se acredita en la evidencia. El canal de venta reportado por Flokzu es un dato distinto.</p>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowOriginModal(false)} disabled={sending}>Volver</Button>
              <Button variant="primary" onClick={() => { setShowOriginModal(false); setConfirming(true); }} disabled={!country || !channel || sending}>Continuar a confirmación</Button>
            </div>
          </section>
        </div>
      )}
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
