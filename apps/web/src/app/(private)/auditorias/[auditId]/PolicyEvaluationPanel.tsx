'use client';

import { useState } from 'react';
import type { EvaluatedRule, MissingData, PolicyEvaluation } from '@cancelaciones/policy-engine';

export function PolicyEvaluationPanel({ auditId }: { auditId: string }) {
  const [result, setResult] = useState<PolicyEvaluation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function evaluate() {
    setLoading(true); setError('');
    try {
      const response = await fetch(`/api/audits/${auditId}/policy`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ policyCode: 'GDM_GAM_PRD_MLG_003', policyVersion: '5', facts: [] }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? 'No fue posible evaluar la política.');
      setResult(data.evaluation as PolicyEvaluation);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Error desconocido.'); } finally { setLoading(false); }
  }
  return <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
    <h2 className="text-xl font-bold text-ink">Evaluación normativa</h2>
    <p className="mt-2 text-sm text-slate-600">Versión fijada: GDM_GAM_PRD_MLG_003 V5. Los hechos deben estar congelados antes de ejecutar.</p>
    <button onClick={evaluate} disabled={loading} className="mt-4 w-full rounded-xl bg-brand px-5 py-3 font-semibold text-white disabled:opacity-60">{loading ? 'Evaluando…' : 'Evaluar política'}</button>
    {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
    {result && <div className="mt-5 space-y-4 text-sm">
      <p><strong>Resultado sugerido:</strong> {result.suggestedOutcome ?? 'INDETERMINADO'}</p>
      <p><strong>Estado:</strong> {result.outcomeStatus} {result.reviewRequired ? '· REQUIERE REVISIÓN' : ''}</p>
      <div><strong>Reglas evaluadas</strong>{result.evaluatedRules.map((rule: EvaluatedRule) => <div key={rule.ruleId} className="mt-2 rounded-xl border border-slate-200 p-3"><div className="flex justify-between"><span>{rule.ruleId}</span><span className="font-semibold">{rule.status}</span></div><p className="mt-1 text-xs text-slate-500">{rule.source.section}, pág. {rule.source.page}</p></div>)}</div>
      {result.missingData.length > 0 && <p><strong>Datos faltantes:</strong> {result.missingData.map((item: MissingData) => item.factType).join(', ')}</p>}
      {result.conflicts.length > 0 && <p className="text-red-700"><strong>Conflictos:</strong> {result.conflicts.length}</p>}
    </div>}
  </div>;
}
