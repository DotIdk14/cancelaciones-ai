// =============================================================================
// Cabecera global: identidad del producto + cierre de sesión.
// =============================================================================

import type { ReactNode } from 'react';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { toErrorState } from '../lib/api';
import { ErrorCard } from './ui';

export function AppHeader(): ReactNode {
  const { user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut(): Promise<void> {
    setSigningOut(true);
    setError(null);
    try {
      await signOut();
    } catch (err) {
      setError(toErrorState(err).message);
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <header className="border-b border-line bg-surface-1">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <a href="#/" className="text-base font-semibold text-ink hover:text-brand">
            Auditoría de Cancelaciones
          </a>
          <p className="text-xs text-muted">Cancelaciones, bajas y deserción · UTEL</p>
        </div>
        <div className="flex items-center gap-3">
          {user !== null && (
            <span className="hidden max-w-[16rem] truncate text-sm text-muted sm:inline" title={user.email}>
              {user.name ?? user.email}
            </span>
          )}
          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            className="rounded-xl border border-line bg-surface-3 px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-[#1f262f] disabled:cursor-not-allowed disabled:opacity-55"
          >
            {signingOut ? 'Cerrando…' : 'Cerrar sesión'}
          </button>
        </div>
      </div>
      {error !== null && (
        <div className="mx-auto w-full max-w-5xl px-4 pb-4 sm:px-6">
          <ErrorCard message={error} />
        </div>
      )}
    </header>
  );
}
