// @vitest-environment jsdom

import { createElement } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DashboardFilterOptions, RecentCaseRow } from '../src/lib/dashboard';
import { EMPTY_DASHBOARD_FILTER_OPTIONS } from '../src/lib/dashboard';

const fetchOptions = vi.fn<(signal?: AbortSignal) => Promise<DashboardFilterOptions>>();

vi.mock('../src/lib/dashboard', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/dashboard')>('../src/lib/dashboard');
  return { ...actual, fetchDashboardFilterOptions: (signal?: AbortSignal) => fetchOptions(signal) };
});

const { DashboardFilters } = await import('../src/components/dashboard/DashboardFilters');
const { RecentCasesTable } = await import('../src/components/dashboard/RecentCasesTable');

afterEach(() => {
  cleanup();
  fetchOptions.mockReset();
});

function caseRow(overrides: Partial<RecentCaseRow> = {}): RecentCaseRow {
  return {
    caseId: 'case-1',
    shortId: 'CASE-000',
    result: 'CANCELACION_VENTA',
    confidence: 0.9,
    missingEvidenceCount: 0,
    caseStatus: 'COMPLETED',
    date: '2026-10-01T10:00:00.000Z',
    country: null,
    salesChannel: null,
    ...overrides,
  };
}

describe('RecentCasesTable — origen y canal de venta', () => {
  it('muestra el país y el canal de venta reportado por Flokzu', () => {
    render(createElement(RecentCasesTable, { cases: [caseRow({ country: 'MX', salesChannel: 'INC_INCONCERT' })] }));

    expect(screen.getByText('México')).toBeTruthy();
    expect(screen.getByText('INC_INCONCERT · México')).toBeTruthy();
  });

  it('un origen no determinable se lee "Sin determinar", nunca como celda vacía', () => {
    const { container } = render(
      createElement(RecentCasesTable, { cases: [caseRow({ country: null, salesChannel: null })] }),
    );

    expect(screen.getByText('Sin determinar')).toBeTruthy();
    expect(screen.getByText('No reportado')).toBeTruthy();
    // Ninguna celda de la fila quedó vacía por los datos de origen.
    expect(container.querySelectorAll('td:empty')).toHaveLength(0);
  });

  it('declara las dos columnas nuevas en la cabecera', () => {
    render(createElement(RecentCasesTable, { cases: [caseRow()] }));

    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toContain('País');
    expect(headers).toContain('Canal de venta · país asociado');
  });
});

describe('DashboardFilters — etiqueta de dimensión', () => {
  it('el option del canal de venta muestra el valor reportado por Flokzu', async () => {
    fetchOptions.mockResolvedValue({ ...EMPTY_DASHBOARD_FILTER_OPTIONS, salesChannel: ['INC_INCONCERT'] });

    render(
      createElement(DashboardFilters, {
        value: { from: '2026-10-01', to: '2026-10-31', result: null, status: null },
        onChange: () => undefined,
      }),
    );

    await waitFor(() => expect(screen.getByLabelText('Canal de venta · Flokzu')).toBeTruthy());
    const select = screen.getByLabelText('Canal de venta · Flokzu');
    const option = within(select).getByRole('option', { name: 'INC_INCONCERT · México' });

    expect((option as HTMLOptionElement).value).toBe('INC_INCONCERT');
  });

  it('el option del país muestra México con el código crudo como valor', async () => {
    fetchOptions.mockResolvedValue({ ...EMPTY_DASHBOARD_FILTER_OPTIONS, country: ['MX'] });

    render(
      createElement(DashboardFilters, {
        value: { from: '2026-10-01', to: '2026-10-31', result: null, status: null },
        onChange: () => undefined,
      }),
    );

    await waitFor(() => expect(screen.getByLabelText('País')).toBeTruthy());
    const option = within(screen.getByLabelText('País')).getByRole('option', { name: 'México' });

    expect((option as HTMLOptionElement).value).toBe('MX');
  });
});

it('presenta una petición personal sin atribuir una promesa incumplida al mostrar el resultado persistido', () => {
  render(createElement(RecentCasesTable, { cases: [caseRow({ result: 'CANCELACION_VENTA_PETICION_CLIENTE' })] }));
  expect(screen.getByText('Cancelación de venta a petición del cliente')).toBeTruthy();
  expect(screen.queryByText(/promesa no cumplida/i)).toBeNull();
});
