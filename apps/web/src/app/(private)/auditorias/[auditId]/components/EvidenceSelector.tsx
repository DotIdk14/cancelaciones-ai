'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EvidenceRow } from './types';

// Selector de evidencias determinantes para el dictamen PDF. Solo incluye
// evidencias de la propia auditoria; el guardado valida la pertenencia en el servidor.
export function EvidenceSelector({ auditId, evidences = [], selection = [] }: { auditId: string; evidences?: EvidenceRow[]; selection?: string[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(selection);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  function toggle(evidenceId: string) {
    setSelected((current) => current.includes(evidenceId) ? current.filter((id) => id !== evidenceId) : [...current, evidenceId]);
    setMessage('');
  }

  async function save() {
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch(`/api/audits/${auditId}/evidence-selection`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ evidenceIds: selected }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? 'No fue posible guardar la selección.');
      setMessage(`Selección guardada: ${selected.length} evidencia(s).`);
      router.refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'No fue posible guardar la selección.');
    } finally {
      setSaving(false);
    }
  }

  if (evidences.length === 0) {
    return (
      <section className="rounded-lg border border-line bg-surface-1 p-6">
        <h2 className="text-lg font-semibold text-ink">Evidencias para el dictamen</h2>
        <p className="mt-3 text-sm text-muted">Aún no hay evidencias subidas.</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-line bg-surface-1 p-6">
      <h2 className="text-lg font-semibold text-ink">Evidencias para el dictamen</h2>
      <p className="mt-2 text-sm text-muted">Selecciona las evidencias que respaldan el análisis. Solo estas se referencian en el PDF.</p>
      <div className="mt-4 space-y-2">
        {evidences.map((evidence) => {
          const isSelected = selected.includes(evidence.id);
          return (
            <label key={evidence.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition ${isSelected ? 'border-brand bg-brand/10' : 'border-line bg-surface-2 hover:border-white/15'}`}>
              <input type="checkbox" checked={isSelected} onChange={() => toggle(evidence.id)} className="h-4 w-4 accent-brand" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{evidence.originalFilename}</span>
                <span className="block text-xs text-muted">{evidence.detectedMimeType} · {Math.round(evidence.sizeBytes / 1024)} KB · {evidence.status}</span>
              </span>
            </label>
          );
        })}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-muted">{selected.length} seleccionada(s) de {evidences.length}</p>
        <button type="button" onClick={() => void save()} disabled={saving}
          className="inline-flex items-center rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-background transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60">
          {saving ? 'Guardando…' : 'Guardar selección'}
        </button>
      </div>
      {message && <p className="mt-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-muted">{message}</p>}
    </section>
  );
}
