// =============================================================================
// Página de casos: SOLO el listado.
//
// El alta vive en su propia ruta (`#/nuevo` -> `NewCasePanel`). Antes esta
// página componía ambos paneles, así que el formulario de alta aparecía
// duplicado en `#/casos` y en `#/nuevo`, contradiciendo la etiqueta del nav.
// =============================================================================

import type { ReactNode } from 'react';
import { CasesPanel } from './CasesPanel';

export function CaseListPage({ canReadAllCases = false }: { canReadAllCases?: boolean }): ReactNode {
  return (
    <div className="flex flex-col gap-5">
      <CasesPanel canReadAllCases={canReadAllCases} />
    </div>
  );
}
