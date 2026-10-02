// =============================================================================
// Barra de filtros del Resumen. Solo lectura y estado local: al cambiar un
// control se emite el objeto completo de filtros (nunca mutado) para que la
// página decida cuándo recargar.
// =============================================================================

import type { ReactNode } from 'react';
import { useEffect, useId, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { AUDIT_RESULTS, CASE_STATUSES } from '../../skills/audit/types';
import type { DashboardDimension, DashboardFilterOptions, DashboardFilters } from '../../lib/dashboard';
import { defaultDateRange, EMPTY_DASHBOARD_FILTER_OPTIONS, fetchDashboardFilterOptions } from '../../lib/dashboard';
import { CASE_STATUS_LABELS, RESULT_LABELS } from '../../lib/labels';
import { Button } from '../ui';

const CONTROL_CLASS =
  'w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink';
const LABEL_CLASS = 'mb-1 block text-xs font-medium uppercase tracking-wide text-muted';
const HINT_CLASS = 'sr-only';
const DIMENSION_LABELS: Record<DashboardDimension, string> = {
  country: 'País',
  guideline: 'Lineamiento',
  modality: 'Modalidad',
  project: 'Proyecto',
  responsible: 'Responsable',
  campus: 'Campus',
};

export interface DashboardFiltersBarProps {
  value: DashboardFilters;
  onChange: (next: DashboardFilters) => void;
  allowResultFilter?: boolean;
}

export function DashboardFilters({
  value,
  onChange,
  allowResultFilter = true,
}: DashboardFiltersBarProps): ReactNode {
  const baseId = useId();
  const [options, setOptions] = useState<DashboardFilterOptions>(EMPTY_DASHBOARD_FILTER_OPTIONS);
  const [optionsError, setOptionsError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetchDashboardFilterOptions(controller.signal).then(
      setOptions,
      () => {
        if (!controller.signal.aborted) setOptionsError(true);
      },
    );
    return () => controller.abort();
  }, []);
  const fromId = `${baseId}-from`;
  const toId = `${baseId}-to`;
  const monthId = `${baseId}-month`;
  const resultId = `${baseId}-result`;
  const statusId = `${baseId}-status`;
  const fromHintId = `${baseId}-from-hint`;
  const toHintId = `${baseId}-to-hint`;
  const resultHintId = `${baseId}-result-hint`;
  const statusHintId = `${baseId}-status-hint`;

  const monthValue =
    value.from.slice(0, 7) === value.to.slice(0, 7) &&
    value.from.endsWith('-01') &&
    value.to === lastDayOfMonth(value.from.slice(0, 7))
      ? value.from.slice(0, 7)
      : '';

  const setMonth = (month: string): void => {
    if (month === '') return;
    onChange({ ...value, from: `${month}-01`, to: lastDayOfMonth(month) });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-2 lg:grid-cols-12">
        <fieldset className="lg:col-span-5">
          <legend className={LABEL_CLASS}>Rango de fechas</legend>
          <div className="grid gap-2 sm:grid-cols-2">
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

        <div className="lg:col-span-2">
          <label htmlFor={monthId} className={LABEL_CLASS}>Mes</label>
          <input
            id={monthId}
            name="month"
            type="month"
            value={monthValue}
            onChange={(event) => setMonth(event.target.value)}
            aria-label="Filtrar un mes completo"
            className={CONTROL_CLASS}
          />
        </div>

        {allowResultFilter && (
          <div className="lg:col-span-3">
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
        )}

        <div className="lg:col-span-2">
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

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {(Object.keys(DIMENSION_LABELS) as DashboardDimension[]).map((dimension) => {
          const values = options[dimension];
          if (values.length === 0) return null;
          const id = `${baseId}-${dimension}`;
          return (
            <div key={dimension}>
              <label htmlFor={id} className={LABEL_CLASS}>{DIMENSION_LABELS[dimension]}</label>
              <select
                id={id}
                name={dimension}
                value={value[dimension] ?? ''}
                onChange={(event) => onChange({ ...value, [dimension]: event.target.value || null })}
                className={CONTROL_CLASS}
              >
                <option value="">Todos</option>
                {values.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {optionsError ? (
          <p role="status" className="text-xs text-warning">No se pudieron cargar los valores de filtros adicionales.</p>
        ) : <span />}
        <Button
          type="button"
          variant="secondary"
          onClick={() => onChange(defaultDateRange())}
          className="inline-flex items-center gap-2 px-3 py-2"
        >
          <RotateCcw size={14} aria-hidden="true" />
          Limpiar filtros
        </Button>
      </div>
    </div>
  );
}

function lastDayOfMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const day = new Date(Date.UTC(year ?? 2000, monthNumber ?? 1, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, '0')}`;
}
