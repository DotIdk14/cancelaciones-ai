'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';

type DeleteAuditButtonProps = {
  auditId: string;
  auditLabel?: string;
  /** Si se indica, redirige tras eliminar (p. ej. desde la vista de detalle). */
  redirectTo?: Route;
  compact?: boolean;
};

/**
 * Botón para eliminar una auditoría. Llama al DELETE /api/audits/:auditId,
 * que pasa por public.delete_audit() en la base: la función valida autorización
 * y registra SIEMPRE en audit_log quién eliminó la auditoría, cuándo y con qué
 * motivo. El botón pide confirmación explícita antes de borrar.
 */
export function DeleteAuditButton({ auditId, auditLabel, redirectTo, compact }: DeleteAuditButtonProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/audits/${auditId}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim().slice(0, 500) || null }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message ?? 'No fue posible eliminar la auditoría.');
      }
      if (redirectTo) {
        router.replace(redirectTo);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible eliminar la auditoría.');
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => {
          setConfirming(true);
          setError(null);
        }}
        className={
          compact
            ? 'inline-flex items-center rounded-md border border-danger/40 px-2.5 py-1.5 text-xs font-medium text-danger hover:bg-danger/10'
            : 'inline-flex items-center rounded-md border border-danger/40 px-4 py-2 text-sm font-medium text-danger hover:bg-danger/10'
        }
      >
        Eliminar
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Confirmar borrado de auditoría">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface-1 p-5 shadow-2xl">
        <h3 className="text-base font-semibold text-danger">Eliminar auditoría</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Se eliminará de forma permanente {auditLabel ? <>«{auditLabel}» </> : null}
          <span className="font-mono text-xs text-subtle">({auditId})</span>, incluidos sus archivos,
          corridas y dictámenes. Esta acción no se puede deshacer.
        </p>
        <label className="mt-4 block text-xs font-medium text-muted" htmlFor={`delete-reason-${auditId}`}>
          Motivo (opcional, queda registrado en el log)
        </label>
        <input
          id={`delete-reason-${auditId}`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={500}
          placeholder="Ej. Expediente duplicado o capturado por error…"
          disabled={busy}
          className="mt-1 w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-subtle focus:border-brand"
        />
        {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
              setError(null);
            }}
            disabled={busy}
            className="rounded-md border border-line bg-surface-2 px-4 py-2 text-sm font-medium text-ink hover:bg-white/5 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy}
            className="rounded-md bg-danger px-4 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-60"
          >
            {busy ? 'Eliminando…' : 'Eliminar definitivamente'}
          </button>
        </div>
      </div>
    </div>
  );
}