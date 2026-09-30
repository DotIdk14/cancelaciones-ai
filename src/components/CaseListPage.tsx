// =============================================================================
// Página de casos: composición de los paneles de alta y de listado.
// =============================================================================

import type { ReactNode } from 'react';
import { CasesPanel } from './CasesPanel';
import { NewCasePanel } from './NewCasePanel';

export function CaseListPage(): ReactNode {
  return (
    <div className="flex flex-col gap-5">
      <NewCasePanel />
      <CasesPanel />
    </div>
  );
}
