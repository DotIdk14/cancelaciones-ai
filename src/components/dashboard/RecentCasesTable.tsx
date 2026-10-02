// =============================================================================
// Tabla de casos recientes. Muestra como máximo 5 filas: es un atajo para
// entrar a un caso, no un listado completo (eso vive en `#/casos`).
// =============================================================================

import type { ReactNode } from 'react';
import type { RecentCaseRow } from '../../lib/dashboard';
import { formatDateTime, formatPercent, textOrDash } from '../../lib/format';
import { RESULT_LABELS, RESULT_TONE } from '../../lib/labels';
import { goToCase } from '../../lib/useHashRoute';
import { cx } from '../../lib/cx';
import { Badge, Button, DataTable } from '../ui';

const TH_CLASS =
  'border-b border-line px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted';
const TH_ACTION_CLASS = `${TH_CLASS} text-right`;
const TD_CLASS = 'border-b border-line/70 px-3 py-2.5 text-ink';

const MAX_ROWS = 5;

function EvidenceBadge({ missing }: { missing: number }): ReactNode {
  if (missing === 0) return <Badge tone="success">Completa</Badge>;
  if (missing === 1) return <Badge tone="warning">Falta 1</Badge>;
  return <Badge tone="danger">Faltan {missing}</Badge>;
}

export function RecentCasesTable({ cases }: { cases: RecentCaseRow[] }): ReactNode {
  const rows = cases.slice(0, MAX_ROWS);
  if (rows.length === 0) return null;

  return (
    <DataTable caption="Casos recientes con su resolución, confianza y evidencia pendiente">
      <thead>
        <tr>
          <th scope="col" className={TH_CLASS}>
            Caso
          </th>
          <th scope="col" className={TH_CLASS}>
            Estudiante
          </th>
          <th scope="col" className={TH_CLASS}>
            Resolución IA
          </th>
          <th scope="col" className={TH_CLASS}>
            Confianza
          </th>
          <th scope="col" className={TH_CLASS}>
            Evidencia
          </th>
          <th scope="col" className={TH_CLASS}>
            Fecha
          </th>
          <th scope="col" className={TH_ACTION_CLASS}>
            <span className="sr-only">Acción</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.caseId}>
            {/* 1.3.1: el identificador es la cabecera natural de la fila. Las
                demás celdas son estado/dictamen, así que sin `scope="row"` al
                recorrer la tabla se perdía de qué caso habla cada una. */}
            <th scope="row" className={cx(TD_CLASS, 'font-normal text-left')}>
              <span className="font-mono text-sm">{row.shortId}</span>
            </th>
            <td className={TD_CLASS}>{textOrDash(row.studentIdentifier)}</td>
            <td className={TD_CLASS}>
              {row.result === null ? (
                <Badge tone="neutral">Sin dictamen</Badge>
              ) : (
                <Badge tone={RESULT_TONE[row.result]}>{RESULT_LABELS[row.result]}</Badge>
              )}
            </td>
            <td className={TD_CLASS}>{formatPercent(row.confidence)}</td>
            <td className={TD_CLASS}>
              <EvidenceBadge missing={row.missingEvidenceCount} />
            </td>
            <td className={TD_CLASS}>{formatDateTime(row.date)}</td>
            <td className={cx('text-right', TD_CLASS)}>
              <Button
                variant="secondary"
                className="px-3 py-1.5 text-xs"
                aria-label={`Ver el caso ${row.shortId}`}
                onClick={() => goToCase(row.caseId)}
              >
                Ver
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}
