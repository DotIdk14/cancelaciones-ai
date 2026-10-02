// =============================================================================
// Cabecera global: identidad del producto y acceso al dashboard (`#/`).
// =============================================================================

import type { ReactNode } from 'react';
import { Button } from './ui';

interface AppHeaderProps {
  onSignOut: () => void;
}

export function AppHeader({ onSignOut }: AppHeaderProps): ReactNode {
  return (
    <header className="border-b border-line bg-surface-1">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <a href="#/" className="text-base font-semibold text-ink hover:text-brand">
            Auditoría de Cancelaciones
          </a>
          <p className="text-xs text-muted">Cancelaciones, bajas y deserción · UTEL</p>
        </div>
        <Button variant="ghost" onClick={onSignOut}>
          Cerrar sesión
        </Button>
      </div>
    </header>
  );
}
