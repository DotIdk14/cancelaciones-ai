// =============================================================================
// Raiz de la SPA. Hash routing manual: `#/`, `#/calidad`, `#/ia-costos`,
// `#/nuevo`, `#/casos` y `#/casos/:id`.
// Ahora con login: la API exige sesión por cookie httpOnly.
// =============================================================================

import type { MouseEvent, ReactNode } from 'react';
import { Suspense, lazy, useEffect } from 'react';
import { AppHeader } from './components/AppHeader';
import { AppDock } from './components/AppDock';
import { CaseDetailPage } from './components/CaseDetailPage';
import { CaseDetailPreview } from './components/CaseDetailPreview';
import { CaseListPage } from './components/CaseListPage';
import { LoginScreen } from './components/LoginScreen';
import { NewCasePanel } from './components/NewCasePanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Panel, Spinner } from './components/ui';
import type { AppRole, SessionSnapshot, WorkflowState } from './lib/api';
import { cx } from './lib/cx';
import { WORKFLOW_STATE_LABELS } from './lib/labels';
import { isLocalDashboardPreview } from './lib/local-dashboard-preview';
import {
  getLocalPreviewRole,
  getLocalPreviewWorkflowState,
  localPreviewHref,
  PREVIEW_ROLE_LABELS,
  PREVIEW_ROLES,
  PREVIEW_WORKFLOW_STATES,
} from './lib/local-ui-preview';
import { useHashRoute } from './lib/useHashRoute';
import type { AppRoute } from './lib/useHashRoute';
import { useSession } from './lib/useSession';
import { capabilitiesForRole } from './server/capabilities';

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

function CurrentRoute({
  route,
  previewOnly,
  role,
  previewWorkflow,
  capabilities,
}: {
  route: AppRoute;
  previewOnly: boolean;
  role: AppRole | null;
  previewWorkflow: WorkflowState;
  capabilities: SessionSnapshot['capabilities'];
}): ReactNode {
  return (
    <Suspense fallback={<DashboardFallback />}>
      {renderRoute(route, previewOnly, role, previewWorkflow, capabilities)}
    </Suspense>
  );
}

function renderRoute(
  route: AppRoute,
  previewOnly: boolean,
  role: AppRole | null,
  previewWorkflow: WorkflowState,
  capabilities: SessionSnapshot['capabilities'],
): ReactNode {
  switch (route.name) {
    case 'case':
      return previewOnly ? (
        <CaseDetailPreview caseId={route.caseId} role={role} workflowState={previewWorkflow} />
      ) : (
        <CaseDetailPage caseId={route.caseId} role={role} capabilities={capabilities} />
      );
    case 'cases':
      return <CaseListPage />;
    // El dock ofrece "Nueva auditoría" y "Expedientes" como entradas distintas, así que
    // `#/nuevo` muestra solo el alta y `#/casos` la lista. Ambas pantallas se
    // componían antes en `CaseListPage`; aquí solo se usa el panel que la
    // etiqueta del enlace promete.
    case 'new-case':
      return <NewCasePanel role={role} canWrite={capabilities.canWriteOwnedCases} />;
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
  role = null,
  previewWorkflow = 'PENDING_COORDINATOR',
  capabilities = { canReadAllCases: false, canReviewOwnCases: false, canFinalizeAnyCase: false, canWriteOwnedCases: false, canManageCases: false },
}: {
  onSignOut?: () => void;
  previewOnly?: boolean;
  role?: AppRole | null;
  previewWorkflow?: WorkflowState;
  capabilities?: SessionSnapshot['capabilities'];
}): ReactNode {
  const route = useHashRoute();
  const restrictedRoute = !capabilities.canReadAllCases &&
    (route.name === 'dashboard' || route.name === 'quality' || route.name === 'ai-costs');
  const displayRoute: AppRoute = restrictedRoute ? { name: 'cases' } : route;
  const routeKey = route.name === 'case' ? `${route.name}:${route.caseId}` : route.name;

  useEffect(() => {
    const workspace = document.querySelector<HTMLElement>('.app-workspace');
    if (workspace !== null) workspace.scrollTop = 0;
  }, [routeKey]);

  useEffect(() => {
    if (restrictedRoute && window.location.hash !== '#/casos') window.location.hash = '#/casos';
  }, [restrictedRoute, routeKey]);

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

  return (
    <div className="application-shell min-h-screen bg-background text-ink">
      <a
        href="#contenido"
        onClick={skipToContent}
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface-3 focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink"
      >
        Saltar al contenido
      </a>
      <AppHeader onSignOut={onSignOut} previewOnly={previewOnly} role={role} />
      {previewOnly && (
        <div className="local-preview-toolbar flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-warning/30 bg-surface-2 px-4 py-2 text-center text-sm text-warning">
          <span className="local-preview-note" role="status">Vista previa local: datos ficticios, sin conexión a InsForge.</span>
          <LocalRoleSwitch role={role} workflow={previewWorkflow} />
          <LocalWorkflowSwitch role={role} workflow={previewWorkflow} />
        </div>
      )}
      <div className="app-workspace">
        <main
          id="contenido"
          // `tabIndex={-1}` hace que el destino del skip link reciba el foco de
          // forma programática sin entrar en el orden de tabulación.
          tabIndex={-1}
        className="app-content min-w-0 px-4 py-6 sm:px-6 lg:px-8"
        >
          <CurrentRoute
            route={displayRoute}
            previewOnly={previewOnly}
            role={role}
            previewWorkflow={previewWorkflow}
            capabilities={capabilities}
          />
        </main>
      </div>
      <AppDock capabilities={capabilities} previewOnly={previewOnly} />
    </div>
  );
}

/**
 * Selector de rol de la VISTA PREVIA LOCAL.
 *
 * Es SOLO presentación y SOLO desarrollo: vive dentro del aviso `previewOnly`,
 * que únicamente se monta con `?preview=dashboard` y `import.meta.env.DEV`.
 * Cambiar el rol aquí NO altera la sesión ni la autorización del servidor: los
 * enlaces solo reescriben el parámetro `?role=` de la URL y la app recarga con
 * la vista de ese rol. Nunca existe en producción porque el aviso no se monta
 * fuera de la vista previa.
 */
function LocalRoleSwitch({
  role,
  workflow,
}: {
  role: AppRole | null;
  workflow: WorkflowState;
}): ReactNode {
  // El fragmento actual se conserva en los enlaces: si no, cambiar de rol
  // recargaría en el dashboard y el revisor perdería la ruta que estaba viendo.
  const hash = typeof window === 'undefined' ? '' : window.location.hash;
  const linkClass = (active: boolean): string =>
    cx(
      'rounded-full border px-2.5 py-0.5 text-xs font-medium no-underline',
      active
        ? 'border-warning bg-warning/20 text-warning'
        : 'border-warning/40 text-warning hover:bg-warning/10',
    );
  return (
    <nav
      aria-label="Rol de la vista previa local"
      className="inline-flex flex-wrap items-center justify-center gap-1.5"
    >
      <span className="font-medium">Rol de la vista previa (solo local):</span>
      {PREVIEW_ROLES.map((previewRole) => {
        const active = role === previewRole;
        return (
          <a
            key={previewRole}
            href={localPreviewHref(previewRole, workflow, hash)}
            aria-current={active ? 'true' : undefined}
            className={linkClass(active)}
          >
            {PREVIEW_ROLE_LABELS[previewRole]}
          </a>
        );
      })}
    </nav>
  );
}

/**
 * Selector del ESTADO DEL FLUJO simulado de la vista previa local.
 *
 * Igual que el selector de rol, es SOLO presentación y SOLO desarrollo: cambia
 * qué etapa del flujo en dos etapas muestra el expediente de demostración (qué
 * formulario ve cada rol). Nunca persiste nada ni toca el servidor.
 */
function LocalWorkflowSwitch({
  role,
  workflow,
}: {
  role: AppRole | null;
  workflow: WorkflowState;
}): ReactNode {
  const hash = typeof window === 'undefined' ? '' : window.location.hash;
  const linkClass = (active: boolean): string =>
    cx(
      'rounded-full border px-2.5 py-0.5 text-xs font-medium no-underline',
      active
        ? 'border-warning bg-warning/20 text-warning'
        : 'border-warning/40 text-warning hover:bg-warning/10',
    );
  return (
    <nav
      aria-label="Estado del flujo de la vista previa local"
      className="inline-flex flex-wrap items-center justify-center gap-1.5"
    >
      <span className="font-medium">Estado del flujo (solo local):</span>
      {PREVIEW_WORKFLOW_STATES.map((state) => {
        const active = workflow === state;
        return (
          <a
            key={state}
            href={localPreviewHref(role ?? 'coordinator', state, hash)}
            aria-current={active ? 'true' : undefined}
            className={linkClass(active)}
          >
            {WORKFLOW_STATE_LABELS[state]}
          </a>
        );
      })}
    </nav>
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
  const { status, signOut, sessionExpired, authError, role, capabilities } = useSession();

  if (status === 'loading') return <AuthLoadingScreen />;
  if (status === 'anon') return <LoginScreen authError={authError} sessionExpired={sessionExpired} />;
  return <Shell onSignOut={() => { void signOut(); }} role={role} capabilities={capabilities} />;
}

export function App(): ReactNode {
  const localPreview = isLocalDashboardPreview();
  // Rol y estado del flujo de la vista previa: SOLO presentación y solo se leen
  // en desarrollo. No alteran la sesión ni la autorización del servidor.
  const previewRole = localPreview ? getLocalPreviewRole() : null;
  const previewWorkflow = localPreview ? getLocalPreviewWorkflowState() : 'PENDING_COORDINATOR';

  return (
    <ErrorBoundary>
      {localPreview ? (
        <Shell
          previewOnly
          role={previewRole}
          previewWorkflow={previewWorkflow}
          capabilities={capabilitiesForRole(previewRole)}
        />
      ) : (
        <AuthenticatedApp />
      )}
    </ErrorBoundary>
  );
}
