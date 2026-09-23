'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatDateTime } from '@/lib/format';
import type { HumanReviewRecord } from './types';

// Revisión humana del dictamen sugerido. APPROVE no exige razon; CORRECT si la exige.
export function HumanReviewCard({ auditId, review, machineOutcome }: { auditId: string; review?: HumanReviewRecord | null; machineOutcome?: string | null }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [decisionType, setDecisionType] = useState<'APPROVE' | 'CORRECT'>(review?.decisionType ?? 'APPROVE');
  const [humanReason, setHumanReason] = useState(review?.humanReason ?? '');
  const [savedAt, setSavedAt] = useState('');

  async function submit() {
    setError('');
    setSaving(true);
    try {
      const response = await fetch(`/api/audits/${auditId}/human-review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decisionType, humanOutcome: decisionType === 'CORRECT' ? 'Ajustado por humano' : null, humanReason: humanReason.trim() || null }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? 'No fue posible guardar la revisión.');
      setSavedAt(new Date().toISOString());
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible guardar la revisión.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-lg border border-line bg-surface-1 p-6">
      <h2 className="text-lg font-semibold text-ink">Revisión humana</h2>
      <p className="mt-2 text-sm text-muted">Compara la decisión de la máquina con la evidencia. CORRECT exige una razón; no altera la decisión automática original.</p>

      {review ? (
        <div className="mt-4 rounded-lg border border-success/20 bg-success/10 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-success/10 px-3 py-1 text-xs font-semibold text-success">{review.decisionType === 'APPROVE' ? 'Aprobada' : 'Corregida'}</span>
            <span className="text-xs text-muted">Revisada por {review.reviewedBy} · {formatDateTime(review.reviewedAt)}</span>
          </div>
          {review.humanReason && <p className="mt-2 text-muted">{review.humanReason}</p>}
          {review.humanOutcome && <p className="mt-1 text-muted">Resultado ajustado: {review.humanOutcome}</p>}
        </div>
      ) : (
        <p className="mt-4 rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">Aún no hay revisión humana registrada. La decisión de la máquina actual es {machineOutcome ?? 'indeterminada'}.</p>
      )}

      <div className="mt-5 space-y-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setDecisionType('APPROVE')}
            className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${decisionType === 'APPROVE' ? 'bg-success/20 text-success border border-success/20' : 'border border-line text-muted hover:bg-surface-2'}`}
          >Aprobar dictamen</button>
          <button
            type="button"
            onClick={() => setDecisionType('CORRECT')}
            className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${decisionType === 'CORRECT' ? 'border border-warning/20 bg-warning/20 text-warning' : 'border border-line text-muted hover:bg-surface-2'}`}
          >Corregir dictamen</button>
        </div>

        <label className="block text-sm font-semibold text-muted">Motivo {decisionType === 'CORRECT' ? '(obligatorio)' : '(opcional)'}
          <textarea
            value={humanReason}
            onChange={(event) => setHumanReason(event.target.value)}
            rows={3}
            placeholder={decisionType === 'CORRECT' ? 'Explica por qué la decisión de la máquina debe corregirse.' : 'Nota opcional del revisor…'}
            className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-sm text-muted outline-none ring-0 transition focus:border-brand"
          />
        </label>

        {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        {savedAt && <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">Revisión guardada.</p>}

        <div className="flex justify-end">
          <button type="button" onClick={() => void submit()} disabled={saving || (decisionType === 'CORRECT' && !humanReason.trim())}
            className="inline-flex items-center rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-background shadow-sm transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60">
            {saving ? 'Guardando…' : review ? 'Actualizar revisión' : 'Registrar revisión'}
          </button>
        </div>
      </div>
    </section>
  );
}
