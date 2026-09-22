'use client';

import { useState } from 'react';
import type { EvaluatedRule, PolicyEvaluation } from '@cancelaciones/policy-engine';

export function PolicyEvaluationPanel({ auditId, factRunId }: { auditId: string; factRunId?: string }) {
  const [result, setResult] = useState<PolicyEvaluation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function evaluate() {
    setLoading(true); setError('');
    try {
      const response = await fetch(`/api/audits/${auditId}/policy`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ policyCode: 'GDM_GAM_PRD_MLG_003', policyVersion: '5', factRunId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? 'No fue posible evaluar la política.');
      setResult(data.evaluation as PolicyEvaluation);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Error desconocido.'); } finally { setLoading(false); }
  }
  return <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
    <h2 className="text-xl font-bold text-ink">Dictamen normativo</h2>
    <p className="mt-2 text-sm text-slate-600">La decisión se basa en los hechos encontrados y en GDM_GAM_PRD_MLG_003 V5.</p>
    <button onClick={evaluate} disabled={loading || !factRunId} className="mt-4 w-full rounded-xl bg-brand px-5 py-3 font-semibold text-white disabled:opacity-60">{loading ? 'Generando dictamen…' : 'Generar dictamen'}</button>
    {!factRunId && <p className="mt-3 text-sm text-amber-700">Primero confirma los hechos identificados.</p>}
    {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
    {result && <div className="mt-5 space-y-5 text-sm">
      <section className="rounded-2xl bg-slate-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Resultado sugerido</p>
        <p className="mt-1 text-lg font-bold text-ink">{result.suggestedOutcome ?? 'Sin resultado sugerible'}</p>
        {result.suggestedReason && <p className="mt-1 text-slate-600">{result.suggestedReason}</p>}
        <p className="mt-3"><strong>Estado:</strong> {result.decisionStatus} {result.reviewRequired ? '· REQUIERE REVISIÓN' : ''}</p>
        <p className="mt-2 text-slate-600">{result.explanation}</p>
      </section>
      <RuleGroup title="Reglas a favor" ruleIds={result.supportingRules} rules={result.evaluatedRules} />
      <RuleGroup title="Reglas en contra / exclusiones" ruleIds={result.opposingRules} rules={result.evaluatedRules} />
      <RuleGroup title="Reglas pendientes" ruleIds={result.pendingRules} rules={result.evaluatedRules} />
      <RuleGroup title="Reglas bloqueadas" ruleIds={result.blockedRules} rules={result.evaluatedRules} />
      {result.conflicts.length > 0 && <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800"><strong>Conflictos no resueltos</strong>{result.conflicts.map((conflict) => <p key={conflict.ruleIds.join(',')} className="mt-1">{conflict.reason}</p>)}</section>}
      {(result.missingFacts.length > 0 || result.missingEvidence.length > 0) && <section><strong>Datos / evidencias faltantes</strong><p className="mt-1 text-slate-600">{[...result.missingFacts, ...result.missingEvidence].join(', ')}</p></section>}
      {result.missingNormativeSources.length > 0 && <section><strong>Fuentes normativas faltantes</strong><p className="mt-1 text-slate-600">{result.missingNormativeSources.join(', ')}</p></section>}
      {result.softwareCoverageGaps.length > 0 && <section><strong>Cobertura de software faltante</strong><p className="mt-1 text-slate-600">{result.softwareCoverageGaps.join(', ')}</p></section>}
      {result.nextActions.length > 0 && <section><strong>Qué necesito para cerrar el dictamen</strong><ol className="mt-2 list-decimal space-y-1 pl-5">{result.nextActions.map((action, index) => <li key={`${action.type}-${index}`}>{action.description} <span className="text-xs text-slate-500">({action.affectedRules.join(', ')})</span></li>)}</ol></section>}
      <details><summary className="cursor-pointer font-semibold">Ver trazabilidad completa</summary><div className="mt-3 space-y-2">{result.evaluatedRules.map((rule: EvaluatedRule) => <div key={rule.ruleId} className="rounded-xl border border-slate-200 p-3"><div className="flex justify-between"><span>{rule.ruleId}</span><span className="font-semibold">{rule.status}</span></div><p className="mt-1 text-xs text-slate-500">{rule.source.documentCode} V{rule.source.version} · {rule.source.section}, pág. {rule.source.page}</p></div>)}</div></details>
    </div>}
  </div>;
}

function RuleGroup({ title, ruleIds, rules }: { title: string; ruleIds: string[]; rules: EvaluatedRule[] }) {
  if (ruleIds.length === 0) return null;
  return <section><strong>{title}</strong><p className="mt-1 text-xs text-slate-500">{ruleIds.join(', ')}</p><div className="mt-2 space-y-2">{rules.filter((rule) => ruleIds.includes(rule.ruleId)).map((rule) => <div key={rule.ruleId} className="rounded-xl border border-slate-200 p-3"><div className="flex justify-between"><span>{rule.ruleId}</span><span className="font-semibold">{rule.status}</span></div><p className="mt-1 text-xs text-slate-500">{rule.source.documentCode} V{rule.source.version} · {rule.source.section}, pág. {rule.source.page}</p></div>)}</div></section>;
}
