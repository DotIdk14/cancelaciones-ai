// =============================================================================
// Revisión humana del caso y comparación con la IA.
//
// QUÉ MUESTRA ESTE ARCHIVO, Y POR QUÉ SON TRES COSAS DISTINTAS
//   1. El DICTAMEN ORIGINAL de la auditoría, en su propio panel (`AuditResultPanel`).
//   2. La RESOLUCIÓN FINAL HUMANA, que aquí se registra y que, si existe, manda
//      sobre el dictamen. No lo modifica ni lo oculta.
//   3. La CONCLUSIÓN DE LA COMPARACIÓN, que es un juicio con trazabilidad sobre
//      la distancia entre 1 y 2. No es un segundo dictamen: no trae `result`, no
//      reclasifica y no sustituye nada.
//
// DOS MÉTRICAS QUE NO SON LA MISMA
//   `agrees` es el acierto MEDIDO (¿coincide el dictamen con la decisión de la
//   persona?). `confidence` es la confianza que la IA DECLARA sobre SU propia
//   comparación. Presentarlos juntos sin nombrarlos es exactamente el error que
//   hace que alguien lea "74%" como "acertó el 74% de las veces". Aquí se
//   separan, y `confidence` nunca se presenta como porcentaje de acierto.
//
// LA REVISIÓN ES ÚNICA
//   Cuando existe, es la resolución final y las auditorías posteriores NO la
//   sobrescriben. Por eso este panel desaparece cuando `review !== null`, y por
//   eso un 409 no ofrece reenviar: la única salida es leer la que ya está.
// =============================================================================

import type { FormEvent, ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, getCaseReview, retryComparison, submitCaseReview, toErrorState } from '../lib/api';
import type {
  AuditDetail,
  CaseReviewDto,
  ComparisonDto,
  EffectiveResolution,
  ErrorState,
} from '../lib/api';
import type { AuditResultType } from '../skills/audit/types';
import { cx } from '../lib/cx';
import { DASH, formatDateTime, formatLatency, formatPercent, shortId } from '../lib/format';
import {
  COMPARISON_STATUS_LABELS,
  RESOLUTION_SOURCE_LABELS,
  RESULT_DESCRIPTIONS,
  RESULT_LABELS,
  REVIEW_COMMENT_LIMITS,
  REVIEW_RESULT_OPTIONS,
  errorCategoryMessage,
  isValidReviewComment,
  resolutionLabel,
  resolutionTone,
} from '../lib/labels';
import { usePolling } from '../lib/usePolling';
import { Badge, Button, Chip, DataRow, ErrorCard, Panel, SectionTitle, Spinner } from './ui';

/** Mismo intervalo que el poll de auditoría: la comparación tarda segundos. */
const COMPARISON_POLL_MS = 4000;
/** Consultas de estado de una comparación en curso (≈6 min). */
const MAX_RUNNING_POLLS = 90;

// =============================================================================
// CaseReviewPanel — el formulario. Sólo existe si NO hay revisión.
// =============================================================================

/**
 * Estados del envío. Son estados de LA INTERFAZ, no del negocio: el estado real
 * (revisión registrada, comparación RUNNING/ERROR) vive en el servidor y se
 * recupera con `getCaseReview`, no se adivina desde aquí.
 */
type ReviewPhase = 'idle' | 'sending' | 'comparing' | 'done' | 'error';

export interface CaseReviewPanelProps {
  caseId: string;
  audit: AuditDetail | null;
  review: CaseReviewDto | null;
  /** Se llama tras registrar la revisión, para que el padre refresque el caso. */
  onSubmitted?: () => void;
}

export function CaseReviewPanel({ caseId, audit, review, onSubmitted }: CaseReviewPanelProps): ReactNode {
  const [result, setResult] = useState<AuditResultType | ''>('');
  const [comment, setComment] = useState('');
  const [phase, setPhase] = useState<ReviewPhase>('idle');
  const [error, setError] = useState<ErrorState | null>(null);
  /** El servidor dijo que la revisión ya existe: el formulario desaparece. */
  const [conflict, setConflict] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [submitted, setSubmitted] = useState<{
    review: CaseReviewDto;
    comparison: ComparisonDto | null;
    effectiveResolution: EffectiveResolution | null;
  } | null>(null);

  // El caso cambia de ruta: se descarta todo el estado del formulario anterior.
  useEffect(() => {
    setResult('');
    setComment('');
    setPhase('idle');
    setError(null);
    setConflict(false);
    setLoadingExisting(false);
    setSubmitted(null);
  }, [caseId]);

  /*
   * Foco gestionado al cambiar de vista.
   *
   * Cuando el formulario se sustituye (envío correcto, o 409 porque la revisión
   * ya existía) el elemento que tenía el foco se desmonta y el foco cae al
   * `<body>`, que no está en el orden de tabulación: la siguiente tecla Tab
   * manda a la persona al principio del documento sin aviso. Se lleva entonces
   * al contenedor que Took over, que es `tabIndex={-1}` y por tanto recibe el
   * foco sin entrar al orden de tabulación por sí mismo.
   */
  const takeoverRef = useRef<HTMLDivElement | null>(null);
  const hasTakeover = submitted !== null || conflict;

  useEffect(() => {
    if (!hasTakeover) return;
    takeoverRef.current?.focus();
  }, [hasTakeover]);

  // Longitud del comentario YA RECORTADO: la misma que valida el servidor.
  const trimmed = comment.trim();
  const commentLength = trimmed.length;
  const commentValid = isValidReviewComment(commentLength);
  const lengthError = comment.length === 0 ? null : commentLengthError(commentLength);
  const sending = phase === 'sending';
  const canSubmit = result !== '' && commentValid && !sending && !conflict;

  /*
   * Los callbacks van ANTES de cualquier `return` condicional, y no por estilo.
   * `audit.status` cambia en caliente mientras esta pantalla está montada: una
   * auditoría que pasa de RUNNING a COMPLETED hace que este panel pase de "no
   * existe" a "existe" en la MISMA instancia. Si un hook se declarara después
   * del `return null`, ese montaje declararía menos hooks que el siguiente y
   * React abortaría con "Rendered fewer hooks than expected" justo en el
   * momento en que el usuario acaba de obtener su dictamen.
   */
  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      // `result === ''` se comprueba aquí y no sólo en `canSubmit` para que el
      // tipo se estreche a una resolución concreta antes de construir el body.
      if (result === '' || !canSubmit) return;
      setPhase('sending');
      setError(null);
      try {
        const data = await submitCaseReview(caseId, { result, comment: trimmed });
        setSubmitted({ ...data, effectiveResolution: null });
        setPhase(data.comparison?.status === 'RUNNING' ? 'comparing' : 'done');
        onSubmitted?.();
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          // La revisión es única por caso: no hay nada que reenviar, sólo leer.
          setConflict(true);
          setPhase('done');
          return;
        }
        setError(toErrorState(err));
        setPhase('error');
      }
    },
    [canSubmit, caseId, onSubmitted, result, trimmed],
  );

  const loadExisting = useCallback(async (): Promise<void> => {
    setLoadingExisting(true);
    setError(null);
    try {
      const data = await getCaseReview(caseId);
      if (data.review === null) {
        setError({ category: 'NOT_FOUND', message: 'No se encontró ninguna revisión registrada para este caso.' });
        return;
      }
      setSubmitted({ review: data.review, comparison: data.comparison, effectiveResolution: data.effectiveResolution });
    } catch (err) {
      setError(toErrorState(err));
    } finally {
      setLoadingExisting(false);
    }
  }, [caseId]);

  // Condición de existencia, y es una sola: sin dictamen emitido no hay nada que
  // revisar, y con revisión registrada este panel no debe existir. La revisión
  // es única, así que "ya existe" significa "no se vuelve a ofrecer".
  if (review !== null || audit === null || audit.status !== 'COMPLETED') {
    return null;
  }

  const commentHintId = 'revision-comment-hint';
  const commentCounterId = 'revision-comment-counter';
  const commentErrorId = 'revision-comment-error';
  const formErrorId = 'revision-form-error';

  // Tras un envío correcto se muestra la revisión ya registrada. Se devuelve sin
  // Panel propio para no duplicar el encabezado que ella ya trae.
  if (submitted !== null) {
    return (
      <div ref={takeoverRef} tabIndex={-1}>
        <CaseReviewRecord
          caseId={caseId}
          review={submitted.review}
          comparison={submitted.comparison}
          effectiveResolution={submitted.effectiveResolution}
        />
      </div>
    );
  }

  if (conflict) {
    return (
      <div ref={takeoverRef} tabIndex={-1}>
        <Panel
          title="Revisión humana"
          description="Este caso ya tiene una revisión registrada y es su resolución final."
        >
          <div className="flex flex-col gap-4">
            {error !== null && (
              <ErrorCard title="No se pudo registrar la revisión" message={error.message} />
            )}
            <Button onClick={() => void loadExisting()} loading={loadingExisting} loadingLabel="Consultando la revisión">
              Ver la revisión registrada
            </Button>
            <p className="text-xs text-muted">
              La revisión humana es única por caso y no se puede sustituir ni duplicar. Para cambiar
              una decisión hay que abrir un caso nuevo con la evidencia que la sostienen.
            </p>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <Panel
      title="Revisión humana"
      description="Registra la resolución final del caso. No modifica el dictamen de la auditoría: la compara con él y deja constancia de la diferencia."
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => void handleSubmit(event)}
        aria-busy={sending}
      >
        {/* ------------------------------------------------- resolución */}
        <fieldset className="flex flex-col gap-1" disabled={sending}>
          <legend className="text-sm font-semibold text-ink">Resolución final del caso</legend>
          <p className="text-xs text-muted">
            Elige el resultado del vocabulario vigente. Es la decisión que gobierna el caso; las
            auditorías posteriores no la sobrescriben.
          </p>
          <div className="mt-2 flex flex-col gap-2">
            {REVIEW_RESULT_OPTIONS.map((option) => {
              const inputId = `revision-result-${option}`;
              const descId = `${inputId}-desc`;
              const selected = result === option;
              return (
                <div
                  key={option}
                  className={cx(
                    'rounded-xl border p-3 transition-colors',
                    selected ? 'border-brand/50 bg-brand/5' : 'border-line bg-surface-2',
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <input
                      id={inputId}
                      type="radio"
                      name="revision-result"
                      value={option}
                      checked={selected}
                      onChange={() => setResult(option)}
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

        {/* ------------------------------------------------- comentario */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="revision-comment" className="text-sm font-semibold text-ink">
            Comentario de la revisión
            <span className="ml-1 font-normal text-danger">(obligatorio)</span>
          </label>
          <p id={commentHintId} className="text-xs text-muted">
            Explica por qué la resolución humana coincide o difiere del dictamen original. Es la
            justificación que la comparación citará después.
          </p>
          <textarea
            id="revision-comment"
            name="comment"
            rows={5}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            disabled={sending}
            required
            aria-required="true"
            aria-invalid={lengthError !== null ? true : undefined}
            aria-describedby={cx(
              commentHintId,
              commentCounterId,
              lengthError !== null ? commentErrorId : undefined,
            )}
            className={cx(
              'w-full rounded-xl border bg-surface-2 px-3 py-2 text-sm text-ink',
              'placeholder:text-subtle disabled:cursor-not-allowed disabled:opacity-60',
              lengthError !== null ? 'border-danger/60' : 'border-line',
            )}
          />
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs text-muted">
              Obligatorio: entre {REVIEW_COMMENT_LIMITS.min} y {REVIEW_COMMENT_LIMITS.max} caracteres.
            </p>
            <p id={commentCounterId} className="font-mono text-xs text-muted">
              {commentLength} / {REVIEW_COMMENT_LIMITS.max}
            </p>
          </div>
          {lengthError !== null && (
            <p id={commentErrorId} className="text-xs text-danger">
              {lengthError}
            </p>
          )}
        </div>

        {error !== null && (
          <div id={formErrorId}>
            <ErrorCard title="No se pudo registrar la revisión" message={error.message} />
          </div>
        )}

        {/* ------------------------------------------------- envío */}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant="primary"
            disabled={!canSubmit}
            loading={sending}
            loadingLabel="Registrando la revisión"
            aria-describedby={error !== null ? formErrorId : undefined}
          >
            Registrar la revisión
          </Button>
          {sending && (
            <span role="status" className="flex items-center gap-2 text-sm text-muted">
              <Spinner label="Registrando la revisión" className="h-3.5 w-3.5" />
              Registrando la revisión…
            </span>
          )}
          <p className="text-xs text-muted">
            La revisión es única por caso. Una vez registrada, es la resolución final.
          </p>
        </div>
      </form>
    </Panel>
  );
}

/** Mensaje de longitud. Redactado SIN repetir el texto de los límites visibles. */
function commentLengthError(length: number): string | null {
  if (length < REVIEW_COMMENT_LIMITS.min) {
    return `Falta justificación: el comentario necesita al menos ${REVIEW_COMMENT_LIMITS.min} caracteres.`;
  }
  if (length > REVIEW_COMMENT_LIMITS.max) {
    return `El comentario excede el máximo de ${REVIEW_COMMENT_LIMITS.max} caracteres.`;
  }
  return null;
}

// =============================================================================
// CaseReviewRecord — la revisión ya registrada y el estado de su comparación.
// =============================================================================

export interface CaseReviewRecordProps {
  caseId: string;
  review: CaseReviewDto;
  comparison: ComparisonDto | null;
  effectiveResolution?: EffectiveResolution | null;
}

/**
 * Revisión registrada, su comparación y el reintento.
 *
 * Es la mitad "de lectura" del flujo y se monta con datos del servidor, así que
 * recargar durante la comparación NO duplica nada: el polling es un `GET`.
 */
export function CaseReviewRecord({
  caseId,
  review,
  comparison,
  effectiveResolution: effectiveResolutionProp = null,
}: CaseReviewRecordProps): ReactNode {
  const [live, setLive] = useState<ComparisonDto | null>(comparison);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<ErrorState | null>(null);
  const [comparisonTimedOut, setComparisonTimedOut] = useState(false);
  const pollsRef = useRef(0);

  // La propia revisión humana ES una resolución vigente; si el servidor no la
  // devuelve explícitamente, se deriva del registro para no mostrar '—'.
  const effectiveResolution = effectiveResolutionProp ?? {
    result: review.result,
    source: 'HUMAN' as const,
  };

  // El padre puede entregar otra comparación (p. ej. tras recargar el caso): se
  // adopta la del servidor, se reinicia el contador de consultas y se cancela
  // cualquier bandera de agotamiento anterior.
  useEffect(() => {
    setLive(comparison);
    pollsRef.current = 0;
    setComparisonTimedOut(false);
  }, [comparison]);

  const tick = useCallback(async (): Promise<void> => {
    if (pollsRef.current >= MAX_RUNNING_POLLS) {
      setComparisonTimedOut(true);
      return;
    }
    pollsRef.current += 1;
    const data = await getCaseReview(caseId);
    setLive(data.comparison);
  }, [caseId]);

  // Sólo se consulta mientras la comparación está en curso. Con ERROR el
  // reintento es explícito, con COMPLETED no hay nada que preguntar, y si se
  // agota el límite de consultas se deja de preguntar para no dejar el spinner
  // infinito.
  usePolling(tick, live?.status === 'RUNNING' && !comparisonTimedOut ? COMPARISON_POLL_MS : null);

  const handleRetry = useCallback(async (): Promise<void> => {
    setComparisonTimedOut(false);
    setRetrying(true);
    setRetryError(null);
    try {
      setLive(await retryComparison(caseId));
      pollsRef.current = 0;
    } catch (err) {
      setRetryError(toErrorState(err));
    } finally {
      setRetrying(false);
    }
  }, [caseId]);

  const resultLabel = resolutionLabel(review.result);
  const outcome = live?.status === 'COMPLETED' ? live.resultJson : null;

  return (
    <Panel
      title="Revisión humana"
      description="Resolución final del caso. Es la decisión de la persona y no altera el dictamen original de la auditoría."
      labelledBy="revision-humana"
    >
      {/* ------------------------------------------------- la decisión */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Resolución final</p>
          <div className="mt-2">
            <Badge tone={resolutionTone(review.result)}>{resultLabel}</Badge>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Registrada</p>
          <p className="text-sm text-ink">{formatDateTime(review.createdAt)}</p>
        </div>
      </div>

      <div className="mt-4">
        <SectionTitle>Comentario</SectionTitle>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">
          {review.comment}
        </p>
      </div>

      <dl className="mt-4">
        <DataRow label="Dictamen comparado" value={`Auditoría ${shortId(review.auditId)}`} />
        <DataRow
          label="Resolución vigente"
          value={
            effectiveResolution === null || effectiveResolution.source !== 'HUMAN'
              ? DASH
              : `${resolutionLabel(effectiveResolution.result)} · ${RESOLUTION_SOURCE_LABELS[effectiveResolution.source]}`
          }
        />
      </dl>

      <p className="mt-4 text-xs text-muted">
        Esta decisión resuelve el caso. No modifica el dictamen original de la auditoría, que sigue
        visible con su resultado y su trazabilidad.
      </p>

      {/* ------------------------------------------------- comparación */}
      <div aria-live="polite" className="mt-5 flex flex-col gap-3">
        <SectionTitle>Comparación con la IA</SectionTitle>

        {live === null ? (
          <p className="text-sm text-muted">
            La revisión está registrada y es la resolución final del caso. La comparación todavía no
            se ha iniciado.
          </p>
        ) : live.status === 'RUNNING' ? (
          comparisonTimedOut ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-warning">
                La comparación está tardando demasiado. Actualiza el caso para consultar el estado
                real.
              </p>
              <div>
                <Button
                  variant="secondary"
                  onClick={() => void handleRetry()}
                  loading={retrying}
                  loadingLabel="Reintentando la comparación"
                >
                  Reintentar la comparación
                </Button>
              </div>
              <p className="text-xs text-muted">
                El reintento sólo repite la comparación: no vuelve a pedir el cuestionario al
                estudiante ni vuelve a leer las evidencias.
              </p>
              {retryError !== null && <ErrorCard message={retryError.message} />}
            </div>
          ) : (
            <div role="status" className="flex items-center gap-2 text-sm text-brand">
              <Spinner label="Comparación en curso" className="h-3.5 w-3.5" />
              <span>Comparando el dictamen original con la resolución humana…</span>
            </div>
          )
        ) : live.status === 'ERROR' ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium text-danger">
              {COMPARISON_STATUS_LABELS.ERROR} · {errorCategoryMessage(live.errorCategory)}
            </p>
            <p className="text-xs text-muted">
              La revisión sigue siendo la resolución final. Lo que falló es sólo la comparación.
            </p>
            <div>
              <Button
                variant="secondary"
                onClick={() => void handleRetry()}
                loading={retrying}
                loadingLabel="Reintentando la comparación"
              >
                Reintentar la comparación
              </Button>
            </div>
            <p className="text-xs text-muted">
              El reintento sólo repite la comparación: no vuelve a pedir el cuestionario al
              estudiante ni vuelve a leer las evidencias.
            </p>
            <p className="text-xs text-muted">
              No crea una segunda revisión ni una segunda comparación: reabre la misma.
            </p>
            {retryError !== null && <ErrorCard message={retryError.message} />}
          </div>
        ) : outcome === null ? (
          <p className="text-sm text-muted">
            La comparación terminó sin un veredicto utilizable, así que no se afirma coincidencia ni
            discrepancia.
          </p>
        ) : (
          <ComparisonOutcomeView comparison={live} />
        )}
      </div>
    </Panel>
  );
}

// -----------------------------------------------------------------------------
// Conclusión de la comparación
// -----------------------------------------------------------------------------

function ComparisonOutcomeView({ comparison }: { comparison: ComparisonDto }): ReactNode {
  const outcome = comparison.resultJson;
  if (outcome === null) return null;

  return (
    <div className="flex flex-col gap-3">
      {/* `agrees` es el acierto MEDIDO y va con su propio rótulo explícito. */}
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Conclusión</p>
        <p
          className={cx(
            'mt-1 text-base font-semibold',
            outcome.agrees ? 'text-success' : 'text-warning',
          )}
        >
          {outcome.agrees
            ? 'Coincide con la resolución humana'
            : 'No coincide con la resolución humana'}
        </p>
      </div>

      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">{outcome.explanation}</p>

      {outcome.discrepancyReason !== null && (
        <div className="rounded-xl border border-warning/30 bg-warning/5 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Causa de la discrepancia</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">
            {outcome.discrepancyReason}
          </p>
        </div>
      )}

      <dl>
        {/*
          `confidence` NO es un porcentaje de acierto: es la confianza que la IA
          declara sobre SU comparación. El rótulo lo dice entero para que nadie
          lo lea como una métrica de desempeño del modelo sobre casos reales.
        */}
        <DataRow
          label="Confianza declarada por la IA en su comparación"
          value={formatPercent(outcome.confidence)}
        />
        <DataRow
          label="Secciones del procedimiento aplicadas"
          value={
            outcome.procedureSections.length === 0 ? (
              DASH
            ) : (
              <span className="flex flex-wrap gap-1.5">
                {outcome.procedureSections.map((section) => (
                  <Chip key={section} title={`Sección ${section} del Procedimiento V5`}>
                    {section}
                  </Chip>
                ))}
              </span>
            )
          }
        />
        <DataRow
          label="Evidencias citadas"
          value={
            outcome.evidenceIds.length === 0 ? (
              DASH
            ) : (
              <span className="flex flex-wrap gap-1.5">
                {outcome.evidenceIds.map((id) => (
                  <Chip key={id} title="Identificador de evidencia del expediente">
                    {shortId(id)}
                  </Chip>
                ))}
              </span>
            )
          }
        />
        <DataRow label="Modelo de la comparación" value={`${comparison.provider}/${comparison.model}`} />
        <DataRow label="Latencia" value={formatLatency(comparison.latencyMs)} />
        <DataRow label="Fecha" value={formatDateTime(comparison.updatedAt)} />
      </dl>
    </div>
  );
}
