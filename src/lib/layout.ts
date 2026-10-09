// =============================================================================
// Ancho del shell: una sola fuente de verdad para cabecera, dock y
// contenido.
//
// Antes cada componente decidía su `max-w` por su cuenta: `AppHeader` y
// rutas del dashboard mantienen más espacio para sus gráficas y tablas.
//
// La regla es la que ya se quería: las vistas del dashboard van más anchas
// porque tienen gráficas y tablas; el resto mantiene la lectura cómoda.
// =============================================================================

import type { AppRoute } from './useHashRoute';

/** Rutas del dashboard: caben más contenido, por eso usan `max-w-6xl`. */
const DASHBOARD_ROUTES: ReadonlySet<AppRoute['name']> = new Set([
  'dashboard',
  'quality',
  'ai-costs',
]);

/** `true` si la ruta es una vista del dashboard. */
export function isDashboardRoute(name: AppRoute['name']): boolean {
  return DASHBOARD_ROUTES.has(name);
}

/**
 * Clase de ancho para el contenedor interior de cabecera y
 * contenido. Se aplica siempre en los tres, para que compartan márgenes.
 */
export function shellWidth(name: AppRoute['name']): string {
  return isDashboardRoute(name) ? 'max-w-6xl' : 'max-w-5xl';
}
