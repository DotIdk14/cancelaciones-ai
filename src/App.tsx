// =============================================================================
// Raiz de la SPA. Hash routing manual: `#/`, `#/calidad`, `#/ia-costos`,
// `#/nuevo`, `#/casos` y `#/casos/:id`.
// Sin login: el backend usa el API key administrativo de InsForge.
// =============================================================================

import type { ReactNode } from 'react';
import { Suspense, lazy } from 'react';
import { AppHeader } from './components/AppHeader';
import { AppNav } from './components/AppNav';
import { CaseDetailPage } from './components/CaseDetailPage';
import { CaseListPage } from './components/CaseListPage';
import { NewCasePanel } from './components/NewCasePanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Panel, Spinner } from './components/ui';
import { cx } from './lib/cx';
import { useHashRoute } from './lib/useHashRoute';
import type { AppRoute } from './lib/useHashRoute';

// -----------------------------------------------------------------------------
// Dashboard en carga diferida
//
// `OverviewPage` arrastra Recharts (~118 kB gzip). Con import estático eso
// entraba en el chunk principal y se descargaba en TODAS las rutas, incluso
// `#/casos`, donde no se usa. Con `lazy` + un import dinámico, Recharts queda
// en su propio chunk que el navegador pide únicamente al entrar al dashboard.
// -----------------------------------------------------------------------------

const OverviewPage = lazy(async () => ({
  default: (await import('./components/dashboard/OverviewPage')).OverviewPage,
}));

const QualityPage = lazy(async () => ({
  default: (await import('./components/dashboard/QualityPage')).QualityPage,
}));

const AiCostsPage = lazy(async () => ({
  default: (await import('./components/dashboard/AiCostsPage')).AiCostsPage,
}));

/** Rutas del dashboard: caben más contenido, por eso usan `max-w-6xl`. */
const DASHBOARD_ROUTES = new Set<AppRoute['name']>(['dashboard', 'quality', 'ai-costs']);

/**
 * Estado de carga del chunk del dashboard. Usa las mismas primitivas que el
 * resto de la app (`Panel` + `Spinner`) para no romper la rejilla visual: si
 * aparece, la pantalla mantiene el ancho y los bordes del resto de paneles.
 */
function DashboardFallback(): ReactNode {
  return (
    <Panel title="Cargando">
      <div
        aria-busy="true"
        className="flex min-h-64 flex-col items-center justify-center gap-3 text-center"
      >
        <Spinner label="Cargando vista" className="h-6 w-6" />
        <p className="text-sm text-muted">Cargando la vista del panel…</p>
      </div>
    </Panel>
  );
}

function CurrentRoute({ route }: { route: AppRoute }): ReactNode {
  return <Suspense fallback={<DashboardFallback />}>{renderRoute(route)}</Suspense>;
}

function renderRoute(route: AppRoute): ReactNode {
  switch (route.name) {
    case 'case':
      return <CaseDetailPage caseId={route.caseId} />;
    case 'cases':
      return <CaseListPage />;
    // El nav ofrece "Nuevo caso" y "Casos" como entradas distintas, así que
    // `#/nuevo` muestra solo el alta y `#/casos` la lista. Ambas pantallas se
    // componían antes en `CaseListPage`; aquí solo se usa el panel que la
    // etiqueta del enlace promete.
    case 'new-case':
      return <NewCasePanel />;
    case 'quality':
      return <QualityPage />;
    case 'ai-costs':
      return <AiCostsPage />;
    case 'dashboard':
      return <OverviewPage />;
  }
}

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
      <AppNav />
      <main
        id="contenido"
        className={cx(
          'mx-auto w-full px-4 py-6 sm:px-6',
          DASHBOARD_ROUTES.has(route.name) ? 'max-w-6xl' : 'max-w-5xl',
        )}
      >
        <CurrentRoute route={route} />
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
