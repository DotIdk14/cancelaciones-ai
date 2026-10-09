// =============================================================================
// Cabecera global: identidad del producto y acceso al dashboard (`#/`).
// =============================================================================

import type { ReactNode } from 'react';
import { LogOut, Plus, ShieldCheck, UserRound } from 'lucide-react';
import type { AppRole } from '../lib/api';
import { roleLabel } from '../lib/useSession';
import { Button } from './ui';

interface AppHeaderProps {
  onSignOut?: () => void;
  previewOnly?: boolean;
  role?: AppRole | null;
  canCreate?: boolean;
}

export function AppHeader({ onSignOut, previewOnly = false, role = null, canCreate = false }: AppHeaderProps): ReactNode {
  // Solo los roles con capacidad de escritura ven el alta. El Gerente (o un rol
  // no resuelto) no la ve; el servidor además responde 403.
  const label = roleLabel(role);
  return (
    <header className="app-header sticky top-0 z-30 border-b border-line bg-surface-1">
      <div
        className="app-header-inner flex w-full items-center justify-between gap-4 px-4 sm:px-5"
      >
        <div className="app-brand min-w-0">
          <a href="#/" className="flex min-w-0 items-center gap-3 text-ink hover:text-brand">
            <span className="app-brand-mark" aria-hidden="true"><ShieldCheck size={21} /></span>
            <span className="min-w-0 text-sm font-bold uppercase leading-4 tracking-wide">
              Auditoría<br className="hidden sm:block" /> Cancelaciones
            </span>
          </a>
          <span className="app-organization">UTEL</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          {canCreate && <a href="#/nuevo" className="app-new-case"><Plus size={17} aria-hidden="true" /> <span>Nuevo caso</span></a>}
          {label !== null && (
            <span className="app-preview-user" title={`Rol: ${label}`}>
              <UserRound size={17} aria-hidden="true" />
              <span>{label}</span>
            </span>
          )}
          {previewOnly && <span className="app-preview-user"><UserRound size={17} aria-hidden="true" /><span>Vista local</span></span>}
          {onSignOut && <Button variant="ghost" onClick={onSignOut} className="app-signout"><LogOut size={16} aria-hidden="true" /><span>Cerrar sesión</span></Button>}
        </div>
      </div>
    </header>
  );
}
