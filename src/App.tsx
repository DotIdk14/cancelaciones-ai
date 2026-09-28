// =============================================================================
// Raiz de la SPA. Hash routing manual: `#/` y `#/casos/:id`.
// Sin login: el backend usa el API key administrativo de InsForge.
// =============================================================================

import type { ReactNode } from 'react';
import { AppHeader } from './components/AppHeader';
import { CaseDetailPage } from './components/CaseDetailPage';
import { CaseListPage } from './components/CaseListPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useHashRoute } from './lib/useHashRoute';

function Shell(): ReactNode {
  const route = useHashRoute();

  return (
    <div className="min-h-screen bg-background">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface-3 focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink"
      >
        Saltar al contenido
      </a>
      <AppHeader />
      <main id="contenido" className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        {route.name === 'case' ? <CaseDetailPage caseId={route.caseId} /> : <CaseListPage />}
      </main>
    </div>
  );
}

export function App(): ReactNode {
  return (
    <ErrorBoundary>
      <Shell />
    </ErrorBoundary>
  );
}
