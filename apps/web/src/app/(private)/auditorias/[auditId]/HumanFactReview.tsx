'use client';

import { useState } from 'react';

export function HumanFactReview({ auditId, factId }: { auditId: string; factId: string }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  async function review(decision: 'VALID' | 'INVALID') {
    const message = decision === 'VALID'
      ? 'Confirma que este dato sí está respaldado por la evidencia. Se guardará una revisión humana y se generará un nuevo dictamen.'
      : 'Confirma que este dato no está respaldado por la evidencia. Se excluirá de una nueva evaluación y se generará un nuevo dictamen.';
    if (!window.confirm(message)) return;
    setSaving(true);
    setSaved('');
    try {
      const response = await fetch(`/api/audits/${auditId}/fact-reviews`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ factId, decision }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? 'No fue posible guardar la revisión.');
      setSaved('Revisión guardada. Usa “Rehacer auditoría” para recalcular el dictamen.');
    } catch (error) {
      setSaved(error instanceof Error ? error.message : 'No fue posible guardar la revisión.');
    } finally {
      setSaving(false);
    }
  }
  return <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
    <span className="text-xs text-slate-500">Validación humana:</span>
    <button type="button" disabled={saving} onClick={() => void review('VALID')} className="rounded-lg border border-emerald-200 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">Sí está respaldado</button>
    <button type="button" disabled={saving} onClick={() => void review('INVALID')} className="rounded-lg border border-amber-200 px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50">No está respaldado</button>
    {saved && <span className="w-full text-xs text-slate-600">{saved}</span>}
  </div>;
}
