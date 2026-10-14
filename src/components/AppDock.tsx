import type { ReactNode } from 'react';
import { ClipboardCheck, Coins, FileSpreadsheet, FolderOpen, LayoutDashboard, LifeBuoy, Plus, ShieldCheck } from 'lucide-react';
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
  { name: 'quality', href: '#/calidad', label: 'Calidad', Icon: ShieldCheck, allowed: (c) => c.canManageCases, previewAllowed: true },
  { name: 'ai-costs', href: '#/ia-costos', label: 'Actividad y consumo', Icon: Coins, allowed: (c) => c.canManageCases, previewAllowed: true },
  { name: 'cases', href: '#/casos', label: 'Expedientes', Icon: FolderOpen, allowed: (c) => c.canReadAllCases || c.canReviewOwnCases, previewAllowed: true },
  { name: 'new-case', href: '#/nuevo', label: 'Nueva auditoría', Icon: Plus, allowed: (c) => c.canWriteOwnedCases || c.canManageCases, previewAllowed: true },
  { name: 'incidents', href: '#/incidencias', label: 'Incidencias', Icon: LifeBuoy, allowed: (c) => c.canManageCases, previewAllowed: true },
  { name: 'flokzu-review', href: '#/revision-flokzu', label: 'Revisión Flokzu', Icon: ClipboardCheck, allowed: (c) => c.canImportCases, previewAllowed: true },
  { name: 'flokzu-import', href: '#/importacion-tickets', label: 'Importar tickets', Icon: FileSpreadsheet, allowed: (c) => c.canImportCases },
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
