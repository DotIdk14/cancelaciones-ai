// =============================================================================
// Navegación principal horizontal. NO es sidebar: el layout es centrado y
// mobile-first, así que un sidebar fijo rompería el diseño.
//
// El ancho viene de `shellWidth` (ver `src/lib/layout.ts`), el MISMO que usan
// la cabecera y el contenido: si el nav midiera menos que el contenido, las
// pestañas no cuadrarían con los bloques que enmarcan.
// =============================================================================

import type { ReactNode } from 'react';
import { Coins, FilePlus2, FolderOpen, LayoutDashboard, ShieldCheck } from 'lucide-react';
import { cx } from '../lib/cx';
import { shellWidth } from '../lib/layout';
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
  cases: ['case'],
};

/** `true` si la entrada corresponde a la ruta actual, contando sus alias. */
function isCurrentRoute(item: AppRoute['name'], current: AppRoute['name']): boolean {
  if (item === current) return true;
  return (ACTIVE_ALIASES[item] ?? []).includes(current);
}

/** `false` entre grupos para dibujar el separador vertical. */
type NavEntry = NavItem | false;

const ENTRIES: readonly NavEntry[] = [
  { name: 'dashboard', hash: '#/', label: 'Resumen', Icon: LayoutDashboard },
  { name: 'quality', hash: '#/calidad', label: 'Calidad', Icon: ShieldCheck },
  { name: 'ai-costs', hash: '#/ia-costos', label: 'IA & Costos', Icon: Coins },
  false,
  { name: 'new-case', hash: '#/nuevo', label: 'Nuevo caso', Icon: FilePlus2 },
  { name: 'cases', hash: '#/casos', label: 'Casos', Icon: FolderOpen },
];

/** En el preview local solo tienen sentido las vistas de dashboard. */
const PREVIEW_ROUTES = new Set<AppRoute['name']>(['dashboard', 'quality', 'ai-costs']);

export function AppNav({ previewOnly = false }: { previewOnly?: boolean }): ReactNode {
  const route = useHashRoute();
  const entries = previewOnly
    ? ENTRIES.filter((entry): entry is NavItem => entry !== false && PREVIEW_ROUTES.has(entry.name))
    : ENTRIES;

  return (
    <nav aria-label="Navegación principal" className="border-b border-line bg-surface-1">
      <div
        className={`mx-auto flex w-full items-center gap-1 overflow-x-auto px-4 sm:px-6 ${shellWidth(route.name)}`}
      >
        {entries.map((entry) => {
          if (entry === false) {
            return (
              <span
                key="separador"
                aria-hidden="true"
                className="mx-1 h-5 w-px self-center bg-line"
              />
            );
          }

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
                'flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'border-brand text-ink'
                  : 'border-transparent text-muted hover:border-line hover:text-ink',
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
