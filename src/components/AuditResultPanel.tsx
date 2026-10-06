// =============================================================================
// Dictamen: la regla aplicada, la sección del procedimiento, el razonamiento y
// los comentarios que deja cada área.
//
// ALCANCE DEL PANEL (decisión de producto)
//   Se muestra SÓLO lo que responde "qué se aplicó y por qué": la regla, la
//   sección del procedimiento y el razonamiento del modelo, más la bitácora de
//   comentarios de las áreas. Todo lo demás que emitía la auditoría se sigue
//   produciendo y persistiendo, pero se lee en otra parte de la aplicación:
//     · Hechos y checks      → pestaña "Hechos y checks"
//     · Línea de tiempo      → pestaña "Cronología"
//     · Confianza            → columna derecha, junto al resultado
//     · Evidencias, checks,
//       faltantes, análisis
//       temporal, ejecución   → no se renderiza aquí
//
//   Eliminar bloques de la vista NO elimina datos: `audits.result_json` conserva
//   el assessment completo y validado, que es la fuente de verdad del dictamen.
//
// POR QUÉ EL CASE ID VIENE DE `audit` Y NO POR PROP
//   `audit.caseId` es el mismo caso que se está viendo. Pedirlo por prop
//   obligaría a la página a pasarlo sin poder contradecirlo, que es exactamente
//   la clase de dato duplicado que después diverge sin que nadie lo note.
//
// NUNCA INVENTA UN DICTAMEN
//   Si `resultJson` es null se dice que no hay resultado y nada más. Este panel
//   no calcula, no recalcula y no completa: muestra lo que el modelo emitió.
// =============================================================================

import type { ReactNode } from 'react';
import type { AuditDetail } from '../lib/api';
import { textOrDash } from '../lib/format';
import { errorCategoryLabel } from '../lib/labels';
import { AreaComments } from './AreaComments';
import { SectionTitle } from './ui';

export interface AuditResultPanelProps {
  audit: AuditDetail;
}

export function AuditResultPanel({ audit }: AuditResultPanelProps): ReactNode {
  const result = audit.resultJson;

  if (result === null) {
    // El servidor valida con Zod: si esto ocurre, no hay dictamen que mostrar.
    return (
      <div role="alert" className="rounded-2xl border border-danger/40 bg-danger/10 p-5">
        <p className="text-sm font-semibold text-danger">No hay resultado de auditoría</p>
        <p className="mt-1 text-sm text-ink">
          El registro de la auditoría no contiene un resultado utilizable
          {audit.errorCategory !== null ? ` (${errorCategoryLabel(audit.errorCategory)})` : ''}. No se emite
          ningún dictamen. Vuelve a auditar el caso.
        </p>
      </div>
    );
  }

  const { audit: assessment } = result;

  return (
    <div className="rounded-2xl border border-success/30 bg-surface-1 p-5">
      {/* ------------------------------------------------- Regla y sección */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-line bg-surface-2 p-3">
          <SectionTitle>Regla</SectionTitle>
          <p className="mt-1 break-words text-sm text-ink">{textOrDash(assessment.rule)}</p>
        </div>
        <div className="rounded-xl border border-line bg-surface-2 p-3">
          <SectionTitle>Sección del procedimiento</SectionTitle>
          <p className="mt-1 break-words text-sm text-ink">{textOrDash(assessment.procedureSection)}</p>
        </div>
      </div>

      {/* ------------------------------------------------- Razonamiento */}
      <div className="mt-4">
        <SectionTitle>Razonamiento</SectionTitle>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">
          {textOrDash(assessment.reasoning)}
        </p>
      </div>

      {/* ------------------------------------------------- Comentarios por área
          Va dentro del dictamen y no en la columna derecha porque se escribe
          mientras se lee el dictamen: son la respuesta de las áreas a ESTE
          razonamiento. Va al final para que el operador lea primero el criterio
          y después las observaciones que lo comentan. */}
      <AreaComments caseId={audit.caseId} />
    </div>
  );
}