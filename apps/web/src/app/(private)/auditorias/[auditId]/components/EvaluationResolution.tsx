'use client';

import type { AuditEvaluationResponse } from '@/server/audit-engine/evaluation-response';
import { buildEvaluationViewModel } from './evaluation-view-model';

/**
 * Resolución de la auditoría con su calificador de revisión.
 *
 * ## Jerarquía visual, que es la regla del producto
 *
 * ```
 * HUMAN_REVIEW_DOES_NOT_ERASE_CLOSEST_OUTCOME
 * ```
 *
 * La resolución es el elemento principal: tipografía mayor y peso fuerte. El
 * estado de revisión es un calificador **separado**, con `role="status"` y
 * `aria-live="polite"`, para que un lector de pantalla lo anuncie sin que el
 * auditor tenga que buscarlo. Nunca se sustituye el uno por el otro: un
 * `REQUIRES_HUMAN_REVIEW` sin resolución sería un `INDETERMINATE` con otro
 * nombre, y una resolución sin calificador podría leerse como dictamen.
 *
 * La lógica de qué versión se muestra está en `evaluation-view-model.ts`; aquí no
 * hay decisiones de presentación, sólo marcado.
 */
export function EvaluationResolution({ response }: { response: AuditEvaluationResponse }) {
  const model = buildEvaluationViewModel(response);
  const normative = model.kind === 'NORMATIVE';

  return (
    <section aria-labelledby="evaluacion-resolucion" className="rounded-lg border border-line bg-surface-2 p-4">
      <h2 id="evaluacion-resolucion" className="text-xs font-semibold uppercase tracking-wide text-muted">
        Resolución de la auditoría
      </h2>

      {/* Valor principal. Para lectores de pantalla es el encabezado del grupo. */}
      <p
        className={
          normative
            ? 'mt-2 text-2xl font-bold text-success'
            : 'mt-2 text-2xl font-bold text-default'
        }
      >
        {model.resolution}
      </p>

      {/*
        Calificador. `role="status"` + `aria-live="polite"` para que se anuncie
        al actualizarse sin interrumpir. Se pinta después de la resolución en el
        DOM porque visualmente acompaña, no precede: el auditor necesita leer la
        respuesta antes que el aviso.
      */}
      {model.qualifier ? (
        <p
          role="status"
          aria-live="polite"
          className="mt-2 inline-flex items-center rounded border border-warning/25 bg-warning/10 px-2 py-1 text-sm font-medium text-warning"
        >
          {model.qualifier}
        </p>
      ) : null}

      <p className="mt-2 text-sm text-muted">{model.statusLabel}</p>

      <p className="mt-3 text-sm text-default">{model.reason}</p>

      {model.supportExplanation ? (
        <p className="mt-2 text-xs text-muted">{model.supportExplanation}</p>
      ) : null}

      {model.pendingItems.length > 0 ? (
        <>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">
            Qué falta para cerrar el caso
          </h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-default">
            {model.pendingItems.map((item) => (
              <li key={`${item.kind}:${item.id}`}>{item.whatToDo}</li>
            ))}
          </ul>
        </>
      ) : null}

      {/*
        Enlace a la traza por huella. El identificador completo se expone en el
        `title` para que sea copiable; visualmente se abrevia porque no se lee.
      */}
      <p className="mt-4 text-xs text-muted">
        Autoridad: {model.normativeSource}. Traza{' '}
        <code title={model.traceFingerprint}>{model.traceFingerprint.slice(0, 12)}</code>
      </p>
    </section>
  );
}
