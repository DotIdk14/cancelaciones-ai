import type { ReactNode } from 'react';
import { Coins, FolderOpen, LayoutDashboard, Plus, ShieldCheck } from 'lucide-react';
import type { SessionSnapshot } from '../lib/api';
import { cx } from '../lib/cx';
import { useHashRoute } from '../lib/useHashRoute';
import type { AppRoute } from '../lib/useHashRoute';

type Capabilities = SessionSnapshot['capabilities'];

interface DockItem {
  name: AppRoute['name'];
  href: string;
  label: string;
  Icon: typeof LayoutDashboard;
  allowed: (capabilities: Capabilities) => boolean;
  previewAllowed?: boolean;
}

const DOCK_ITEMS: readonly DockItem[] = [
  { name: 'dashboard', href: '#/', label: 'Resumen', Icon: LayoutDashboard, allowed: (c) => c.canReadAllCases, previewAllowed: true },
  { name: 'quality', href: '#/calidad', label: 'Calidad', Icon: ShieldCheck, allowed: (c) => c.canReadAllCases, previewAllowed: true },
  { name: 'ai-costs', href: '#/ia-costos', label: 'IA y Costos', Icon: Coins, allowed: (c) => c.canReadAllCases, previewAllowed: true },
  { name: 'cases', href: '#/casos', label: 'Expedientes', Icon: FolderOpen, allowed: (c) => c.canReadAllCases || c.canReviewOwnCases, previewAllowed: true },
  { name: 'new-case', href: '#/nuevo', label: 'Nueva auditoría', Icon: Plus, allowed: (c) => c.canWriteOwnedCases, previewAllowed: true },
];

export function AppDock({
  capabilities,
  previewOnly = false,
}: {
  capabilities: Capabilities;
  previewOnly?: boolean;
}): ReactNode {
  const route = useHashRoute();
  const items = DOCK_ITEMS.filter((item) => item.allowed(capabilities) && (!previewOnly || item.previewAllowed));

  return (
    <nav className="app-dock" aria-label="Navegación principal">
      <ul className="app-dock-items">
        {items.map(({ name, href, label, Icon }) => {
          const active = name === route.name || (name === 'cases' && route.name === 'case');
          return (
            <li className="app-dock-item" key={name}>
              <a
                href={href}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                data-tooltip={label}
                className={cx('app-dock-link', active && 'app-dock-link-active')}
              >
                <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
                <span className="app-dock-label" aria-hidden="true">{label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
