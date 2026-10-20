import type { ReactNode } from 'react';

export interface AuditProgressStage {
  label: string;
  status: 'done' | 'attention' | 'current' | 'pending';
}

const STATUS_LABELS: Record<AuditProgressStage['status'], string> = {
  done: 'Completada',
  attention: 'Necesita atención',
  current: 'Siguiente',
  pending: 'Pendiente',
};

export function AuditProgressSteps({ stages, nextAction, actionLabel, onAction }: { stages: AuditProgressStage[]; nextAction?: string; actionLabel?: string; onAction?: () => void }): ReactNode {
  return <section className="case-audit-steps" aria-label="Progreso de la auditoría">
    <ol>
      {stages.map((stage, index) => <li key={stage.label} className={stage.status === 'done' ? 'is-done' : stage.status === 'attention' ? 'needs-attention' : stage.status === 'current' ? 'is-current' : ''}>
        <span className="case-audit-step-number" aria-hidden="true">{stage.status === 'done' ? '✓' : index + 1}</span>
        <span className="case-audit-step-copy"><strong>{stage.label}</strong><small>{STATUS_LABELS[stage.status]}</small></span>
      </li>)}
    </ol>
    {(actionLabel && onAction || nextAction) && <div className="case-audit-steps-footer">
      {actionLabel && onAction && <button type="button" className="case-audit-step-action" onClick={onAction}>{actionLabel}</button>}
      {nextAction && <p aria-live="polite"><strong>Siguiente acción:</strong> {nextAction}</p>}
    </div>}
  </section>;
}
