'use client';

import type { EvaluatedRule } from './types';

// Lista de reglas normativas evaluadas, agrupada por estado.
const ruleStatusLabels: Record<string, string> = {
  SATISFIED: 'Satisfecha',
  NOT_APPLICABLE: 'No aplica',
  UNKNOWN: 'Sin confirmar',
  CONFLICTED: 'En conflicto',
  BLOCKED: 'Bloqueada',
};

export function RuleGroupList({ rules = [], ruleLabels = {} }: { rules?: EvaluatedRule[]; ruleLabels?: Record<string, string> }) {
  const groups = ['SATISFIED', 'NOT_APPLICABLE', 'UNKNOWN', 'CONFLICTED', 'BLOCKED']
    .map((status) => ({ status, items: rules.filter((rule) => rule.status === status) }))
    .filter((group) => group.items.length > 0);

  if (rules.length === 0) {
    return <p className="mt-3 text-sm text-muted">No hay reglas evaluadas.</p>;
  }

  return (
    <div className="mt-4 space-y-4">
      {groups.length === 0 && rules.map((rule) => <RuleDetail key={rule.ruleId} rule={rule} ruleLabels={ruleLabels} />)}
      {groups.map((group) => (
        <div key={group.status}>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{ruleStatusLabels[group.status] ?? group.status} · {group.items.length}</p>
          <div className="mt-2 space-y-2">{group.items.map((rule) => <RuleDetail key={rule.ruleId} rule={rule} ruleLabels={ruleLabels} />)}</div>
        </div>
      ))}
    </div>
  );
}

function RuleDetail({ rule, ruleLabels }: { rule: EvaluatedRule; ruleLabels: Record<string, string> }) {
  return (
    <details className="rounded-lg border border-line p-3">
      <summary className="cursor-pointer font-semibold">{ruleLabels[rule.ruleId] ?? rule.ruleId} · {rule.status}</summary>
      <p className="mt-2 text-muted">Fuente: {rule.source.documentCode}, versión {rule.source.version}, sección {rule.source.section}, página {rule.source.page}.</p>
      {rule.conditions.map((condition) => (
        <div key={condition.id} className="mt-2 rounded-lg bg-surface-2 p-2 text-xs">
          <p className="font-medium">{condition.description}</p>
          {condition.observedValue && <p className="mt-1 font-medium text-muted">Dato observado: {condition.observedValue}</p>}
          <p className="text-muted">Resultado normativo: {condition.state === 'TRUE' ? 'Sí cumple' : condition.state === 'FALSE' ? 'No cumple' : condition.state === 'NOT_APPLICABLE' ? 'No aplica' : 'No se puede confirmar con la evidencia disponible'}</p>
        </div>
      ))}
    </details>
  );
}
