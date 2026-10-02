// =============================================================================
// Cabecera global: identidad del producto y acceso al dashboard (`#/`).
// =============================================================================

import type { ReactNode } from 'react';
import { shellWidth } from '../lib/layout';
import { useHashRoute } from '../lib/useHashRoute';
import { Button } from './ui';

interface AppHeaderProps {
  onSignOut: () => void;
}

export function AppHeader({ onSignOut }: AppHeaderProps): ReactNode {
  const route = useHashRoute();
  return (
    <header className="border-b border-line bg-surface-1">
      <div
        className={`mx-auto flex w-full flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6 ${shellWidth(route.name)}`}
      >
        <div className="min-w-0">
          <a href="#/" className="text-base font-semibold text-ink hover:text-brand">
            Auditor├¡a de Cancelaciones
          </a>
          <p className="text-xs text-muted">Cancelaciones, bajas y deserci├│n ┬À UTEL</p>
        </div>
        <Button variant="ghost" onClick={onSignOut}>
          Cerrar sesi├│n
        </Button>
      </div>
    </header>
  );
}
