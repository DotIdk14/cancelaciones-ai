// =============================================================================
// Barra de filtros del Resumen. Solo lectura y estado local: al cambiar un
// control se emite el objeto completo de filtros (nunca mutado) para que la
// página decida cuándo recargar.
// =============================================================================

import type { ReactNode } from 'react';
import { useId } from 'react';
import { AUDIT_RESULTS, CASE_STATUSES } from '../../skills/audit/types';
import type { DashboardFilters } from '../../lib/dashboard';
import { CASE_STATUS_LABELS, RESULT_LABELS } from '../../lib/labels';

const CONTROL_CLASS =
  'w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink';
const LABEL_CLASS = 'mb-1 block text-xs font-medium uppercase tracking-wide text-muted';
const HINT_CLASS = 'sr-only';

export interface DashboardFiltersBarProps {
  value: DashboardFilters;
  onChange: (next: DashboardFilters) => void;
}

export function DashboardFilters({ value, onChange }: DashboardFiltersBarProps): ReactNode {
  const baseId = useId();
  const fromId = `${baseId}-from`;
  const toId = `${baseId}-to`;
  const resultId = `${baseId}-result`;
  const statusId = `${baseId}-status`;
  const fromHintId = `${baseId}-from-hint`;
  const toHintId = `${baseId}-to-hint`;
  const resultHintId = `${baseId}-result-hint`;
  const statusHintId = `${baseId}-status-hint`;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-end">
      <fieldset>
        <legend className={LABEL_CLASS}>Rango de fechas</legend>
        <div className="flex gap-2">
          <div>
            <label htmlFor={fromId} className={HINT_CLASS}>
              Desde
            </label>
            <input
              id={fromId}
              name="from"
              type="date"
              value={value.from}
              max={value.to}
              onChange={(event) => onChange({ ...value, from: event.target.value })}
              aria-describedby={fromHintId}
              className={CONTROL_CLASS}
            />
            <p id={fromHintId} className={HINT_CLASS}>
              Fecha inicial del periodo, en formato año-mes-día.
            </p>
          </div>
          <div>
            <label htmlFor={toId} className={HINT_CLASS}>
              Hasta
            </label>
            <input
              id={toId}
              name="to"
              type="date"
              value={value.to}
              min={value.from}
              onChange={(event) => onChange({ ...value, to: event.target.value })}
              aria-describedby={toHintId}
              className={CONTROL_CLASS}
            />
            <p id={toHintId} className={HINT_CLASS}>
              Fecha final del periodo, en formato año-mes-día.
            </p>
          </div>
        </div>
      </fieldset>

      <div className="sm:w-52">
        <label htmlFor={resultId} className={LABEL_CLASS}>
          Resultado de la auditoría
        </label>
        <select
          id={resultId}
          name="result"
          value={value.result ?? ''}
          onChange={(event) => onChange({ ...value, result: event.target.value === '' ? null : event.target.value })}
          aria-describedby={resultHintId}
          className={CONTROL_CLASS}
        >
          <option value="">Todos los resultados</option>
          {AUDIT_RESULTS.map((result) => (
            <option key={result} value={result}>
              {RESULT_LABELS[result]}
            </option>
          ))}
        </select>
        <p id={resultHintId} className={HINT_CLASS}>
          Filtra por el dictamen que emitió la auditoría. Sin selección se muestran todos.
        </p>
      </div>

      <div className="sm:w-52">
        <label htmlFor={statusId} className={LABEL_CLASS}>
          Estado del caso
        </label>
        <select
          id={statusId}
          name="status"
          value={value.status ?? ''}
          onChange={(event) => onChange({ ...value, status: event.target.value === '' ? null : event.target.value })}
          aria-describedby={statusHintId}
          className={CONTROL_CLASS}
        >
          <option value="">Todos los estados</option>
          {CASE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {CASE_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        <p id={statusHintId} className={HINT_CLASS}>
          Filtra por el estado del caso. Sin selección se muestran todos.
        </p>
      </div>
    </div>
  );
}
