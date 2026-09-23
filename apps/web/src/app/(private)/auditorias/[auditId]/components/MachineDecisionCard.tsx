'use client';

// Decisión de la máquina: resultado sugerido + estado + razón (sin edicion).
import type { PolicyEvaluationShape } from './types';

export function MachineDecisionCard({ evaluation, ruleLabels = {} }: { evaluation?: PolicyEvaluationShape | null; ruleLabels?: Record<string, string> }) {
  if (!evaluation) {
    return (
      <section className="rounded-lg border border-line bg-surface-1 p-6">
        <h2 className="text-lg font-semibold text-ink">Dictamen sugerido</h2>
        <p className="mt-3 text-sm text-muted">Aún no hay un dictamen generado.</p>
      </section>
    );
  }

  return (
    <section id="resultado" className="rounded-lg border border-line bg-surface-1 p-6">
      <h2 className="text-lg font-semibold text-ink">Dictamen sugerido por la máquina</h2>
      <div className="mt-4 rounded-lg border border-success/20 bg-success/10 p-4">
        <p className="text-xs font-medium text-success">Resultado sugerido</p>
        <p className="mt-1 text-xl font-semibold text-ink">{evaluation.suggestedOutcome ?? 'Sin resultado sugerible'}</p>
        <p className="mt-1 text-sm text-muted">Estado: {evaluation.decisionStatus ?? evaluation.outcomeStatus}{evaluation.reviewRequired ? ' · Requiere revisión' : ''}</p>
      </div>

      {evaluation.satisfiedRules.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {evaluation.decisiveRules.length > 0 && <span className="rounded-full border border-success/20 bg-success/10 px-3 py-1 text-xs font-medium text-success">{evaluation.decisiveRules.length} reglas decisivas</span>}
          <span className="rounded-full border border-line bg-surface-2 px-3 py-1 text-xs font-medium text-muted">{evaluation.satisfiedRules.length} reglas satisfechas</span>
          {evaluation.unknownRules.length > 0 && <span className="rounded-full border border-warning/20 bg-warning/10 px-3 py-1 text-xs font-medium text-warning">{evaluation.unknownRules.length} desconocidas</span>}
          {evaluation.notApplicableRules.length > 0 && <span className="rounded-full border border-line bg-surface-2 px-3 py-1 text-xs font-medium text-muted">{evaluation.notApplicableRules.length} no aplican</span>}
        </div>
      )}

      {evaluation.suggestedReason && (
        <div className="mt-4 rounded-lg border border-line bg-surface-2 p-3 text-sm text-muted">
          <p className="font-medium text-ink">Motivo del motor normativo</p>
          <p className="mt-1">{evaluation.suggestedReason}</p>
        </div>
      )}

      {evaluation.policyCode && <p className="mt-3 text-xs text-muted">Política {evaluation.policyCode} · versión {evaluation.policyVersion}</p>}
      {evaluation.evaluatedRules.length > 0 && (
        <details className="mt-1 text-xs text-muted"><summary className="cursor-pointer">Detalles técnicos / reglas utilizadas</summary><p className="mt-1">{evaluation.evaluatedRules.map((rule) => ruleLabels[rule.ruleId] ?? rule.ruleId).join(' · ')}</p></details>
      )}
    </section>
  );
}
