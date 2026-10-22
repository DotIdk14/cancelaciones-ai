import { useEffect, useId, useState } from 'react';
import { assignCase, getCaseAssignmentOptions } from '../lib/api';
import { Button, ErrorCard, Panel } from './ui';

export function CaseAssignment({ caseId, assignedTo, finalized, onSaved }: { caseId: string; assignedTo: string | null; finalized: boolean; onSaved: () => Promise<void> }) {
  const id = useId();
  const [options, setOptions] = useState<Array<{ userId: string; name: string | null }>>([]);
  const [selected, setSelected] = useState(assignedTo ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void getCaseAssignmentOptions().then(setOptions).catch(() => setError('No se pudieron cargar los Asesores. Actualiza el expediente para reintentar.')); }, []);
  async function save() {
    setBusy(true); setError(null);
    try { await assignCase(caseId, selected || null); await onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar la asignación.'); }
    finally { setBusy(false); }
  }
  return <Panel title="Responsable del expediente">
    <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink">Asesor responsable</label>
    <div className="flex flex-wrap items-center gap-3">
      <select id={id} value={selected} onChange={event => setSelected(event.target.value)} disabled={busy || finalized} className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink">
        <option value="">Sin asignar</option>
        {options.map(a => <option key={a.userId} value={a.userId}>{a.name ?? 'Asesor sin nombre'}</option>)}
      </select>
      <Button onClick={() => void save()} disabled={busy || finalized || selected === (assignedTo ?? '')}>Guardar responsable</Button>
    </div>
    {error && <ErrorCard message={error} />}
  </Panel>;
}
