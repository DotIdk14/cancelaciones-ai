// =============================================================================
// Raiz de la SPA. Hash routing manual: `#/`, `#/calidad`, `#/ia-costos`,
// `#/nuevo`, `#/casos` y `#/casos/:id`.
// Ahora con login: la API exige sesión por cookie httpOnly.
// =============================================================================

import type { MouseEvent, ReactNode } from 'react';
import { Suspense, lazy } from 'react';
import { AppHeader } from './components/AppHeader';
import { AppNav } from './components/AppNav';
import { CaseDetailPage } from './components/CaseDetailPage';
import { CaseDetailPreview } from './components/CaseDetailPreview';
import { CaseListPage } from './components/CaseListPage';
import { LoginScreen } from './components/LoginScreen';
import { NewCasePanel } from './components/NewCasePanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Panel, Spinner } from './components/ui';
import { cx } from './lib/cx';
import { isLocalDashboardPreview } from './lib/local-dashboard-preview';
import { useHashRoute } from './lib/useHashRoute';
import type { AppRoute } from './lib/useHashRoute';
import { useSession } from './lib/useSession';

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

function CurrentRoute({ route, previewOnly }: { route: AppRoute; previewOnly: boolean }): ReactNode {
  return <Suspense fallback={<DashboardFallback />}>{renderRoute(route, previewOnly)}</Suspense>;
}

function renderRoute(route: AppRoute, previewOnly: boolean): ReactNode {
  switch (route.name) {
    case 'case':
      return previewOnly ? <CaseDetailPreview caseId={route.caseId} /> : <CaseDetailPage caseId={route.caseId} />;
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

function Shell({
  onSignOut,
  previewOnly = false,
}: {
  onSignOut?: () => void;
  previewOnly?: boolean;
}): ReactNode {
  const route = useHashRoute();
  const displayRoute = route;

  /**
   * El skip link NO puede usar `href="#contenido"`: el hash lo interpreta el
   * enrutador y `parseHash` lo trataría como una ruta desconocida, expulsando
   * al usuario al Resumen y ensuciando la URL. Se mueve el foco con JS y se
   * deja el href como respaldo si no hay JS.
   */
  const skipToContent = (event: MouseEvent<HTMLAnchorElement>): void => {
    const main = document.getElementById('contenido');
    if (!main) return;
    event.preventDefault();
    main.focus();
    main.scrollIntoView();
  };

  const detailRoute = displayRoute.name === 'case';

  return (
    <div className="min-h-screen bg-background text-ink">
      <a
        href="#contenido"
        onClick={skipToContent}
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface-3 focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink"
      >
        Saltar al contenido
      </a>
      <AppHeader onSignOut={onSignOut} previewOnly={previewOnly} />
      {previewOnly && (
        <div
          role="status"
          className="border-b border-warning/30 bg-surface-2 px-4 py-2 text-center text-sm text-warning"
        >
          Vista previa local: datos ficticios, sin conexión a InsForge.
        </div>
      )}
      <div className={cx('app-workspace', detailRoute && 'app-workspace-detail')}>
        <AppNav previewOnly={previewOnly} horizontal={detailRoute} />
        <main
          id="contenido"
          // `tabIndex={-1}` hace que el destino del skip link reciba el foco de
          // forma programática sin entrar en el orden de tabulación.
          tabIndex={-1}
        className="app-content min-w-0 px-4 py-5 sm:px-6 lg:px-7"
        >
          <CurrentRoute route={displayRoute} previewOnly={previewOnly} />
        </main>
      </div>
    </div>
  );
}

function AuthLoadingScreen(): ReactNode {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background">
      <Spinner label="Verificando sesión" className="h-8 w-8" />
      <p className="mt-3 text-sm text-muted">Verificando tu sesión…</p>
    </div>
  );
}

function AuthenticatedApp(): ReactNode {
  const { status, signOut, sessionExpired, authError } = useSession();

  if (status === 'loading') return <AuthLoadingScreen />;
  if (status === 'anon') return <LoginScreen authError={authError} sessionExpired={sessionExpired} />;
  return <Shell onSignOut={signOut} />;
}

export function App(): ReactNode {
  const localPreview = isLocalDashboardPreview();

  return (
    <ErrorBoundary>
      {localPreview ? <Shell previewOnly /> : <AuthenticatedApp />}
    </ErrorBoundary>
  );
}
