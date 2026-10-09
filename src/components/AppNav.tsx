// =============================================================================
// Navegación principal horizontal. NO es sidebar: el layout es centrado y
// mobile-first, así que un sidebar fijo rompería el diseño.
//
// El ancho viene de `shellWidth` (ver `src/lib/layout.ts`), el MISMO que usan
// la cabecera y el contenido: si el nav midiera menos que el contenido, las
// pestañas no cuadrarían con los bloques que enmarcan.
// =============================================================================

import type { ReactNode } from 'react';
import { Coins, FolderOpen, LayoutDashboard, ShieldCheck } from 'lucide-react';
import type { AppRole } from '../lib/api';
import { cx } from '../lib/cx';
import { useHashRoute } from '../lib/useHashRoute';
import type { AppRoute } from '../lib/useHashRoute';

interface NavItem {
  /** Nombre de la ruta en `AppRoute`, para marcar la activa comparando `route.name`. */
  name: AppRoute['name'];
  hash: string;
  label: string;
  Icon: typeof LayoutDashboard;
}

/**
 * Rutas ADICIONALES que también dejan activa una entrada del nav.
 *
 * `#/casos/:id` se enruta como `{ name: 'case' }` y `#/casos` como
 * `{ name: 'cases' }`, así que comparar solo con `name` dejaba la pestaña
 * "Casos" apagada justo en la pantalla de detalle, que es donde más se necesita
 * estar. Se declara aquí una lista explícita en vez de un `||` suelto dentro del
 * `.map` para que quede a la vista qué entradas aceptan más de una ruta.
 */
const ACTIVE_ALIASES: Readonly<Partial<Record<AppRoute['name'], readonly AppRoute['name'][]>>> = {
  cases: ['case', 'new-case'],
};

/** `true` si la entrada corresponde a la ruta actual, contando sus alias. */
function isCurrentRoute(item: AppRoute['name'], current: AppRoute['name']): boolean {
  if (item === current) return true;
  return (ACTIVE_ALIASES[item] ?? []).includes(current);
}

const ENTRIES: readonly NavItem[] = [
  { name: 'dashboard', hash: '#/', label: 'Resumen', Icon: LayoutDashboard },
  { name: 'quality', hash: '#/calidad', label: 'Calidad', Icon: ShieldCheck },
  { name: 'ai-costs', hash: '#/ia-costos', label: 'IA & Costos', Icon: Coins },
  { name: 'cases', hash: '#/casos', label: 'Casos', Icon: FolderOpen },
];

/** En el preview local solo tienen sentido las vistas de dashboard. */
const PREVIEW_ROUTES = new Set<AppRoute['name']>(['dashboard', 'quality', 'ai-costs', 'cases', 'case']);

/**
 * Vistas globales (agregados de todos los casos). El Asesor NO las ve: su alcance
 * son sus propios casos. Es SOLO presentación; el servidor limita la lectura.
 */
const GLOBAL_ROUTES = new Set<AppRoute['name']>(['dashboard', 'quality', 'ai-costs']);

export function AppNav({
  previewOnly = false,
  horizontal = false,
  role = null,
}: {
  previewOnly?: boolean;
  horizontal?: boolean;
  role?: AppRole | null;
}): ReactNode {
  const route = useHashRoute();
  // `null`/desconocido se trata como Asesor (el alcance más acotado) por defecto.
  const effectiveRole: AppRole = role ?? 'user';
  const entries = ENTRIES.filter((entry) => {
    if (previewOnly && !PREVIEW_ROUTES.has(entry.name)) return false;
    if (effectiveRole === 'user' && GLOBAL_ROUTES.has(entry.name)) return false;
    return true;
  });

  return (
    <nav aria-label="Navegación principal" className={cx('app-nav', horizontal && 'app-nav-horizontal')}>
      <div className="app-nav-items">
        {entries.map((entry) => {
          const { name, hash, label, Icon } = entry;
          // `case` es un alias de `cases`: en el detalle de un caso la pestaña
          // sigue siendo "Casos". Ninguna otra entrada tiene alias, así que el
          // `aria-current` de las demás queda intacto.
          const isActive = isCurrentRoute(name, route.name);

          return (
            <a
              key={name}
              href={hash}
              aria-current={isActive ? 'page' : undefined}
              className={cx(
                'app-nav-link flex items-center gap-3 whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'app-nav-link-active text-ink'
                  : 'text-muted hover:bg-surface-2 hover:text-ink',
              )}
            >
              <Icon size={16} aria-hidden="true" />
              {label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
