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
    channel: null,
    ...overrides,
  };
}

describe('RecentCasesTable — origen', () => {
  it('muestra el país y el canal en español', () => {
    render(createElement(RecentCasesTable, { cases: [caseRow({ country: 'MX', channel: 'WHATSAPP' })] }));

    expect(screen.getByText('México')).toBeTruthy();
    expect(screen.getByText('WhatsApp')).toBeTruthy();
  });

  it('un origen no determinable se lee "Sin determinar", nunca como celda vacía', () => {
    const { container } = render(
      createElement(RecentCasesTable, { cases: [caseRow({ country: null, channel: null })] }),
    );

    expect(screen.getAllByText('Sin determinar')).toHaveLength(2);
    // Ninguna celda de la fila quedó vacía por el origen.
    expect(container.querySelectorAll('td:empty')).toHaveLength(0);
  });

  it('declara las dos columnas nuevas en la cabecera', () => {
    render(createElement(RecentCasesTable, { cases: [caseRow()] }));

    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toContain('País');
    expect(headers).toContain('Canal');
  });
});

describe('DashboardFilters — etiqueta de dimensión', () => {
  it('el option del canal muestra WhatsApp con el código crudo como valor', async () => {
    fetchOptions.mockResolvedValue({ ...EMPTY_DASHBOARD_FILTER_OPTIONS, channel: ['WHATSAPP'] });

    render(
      createElement(DashboardFilters, {
        value: { from: '2026-10-01', to: '2026-10-31', result: null, status: null },
        onChange: () => undefined,
      }),
    );

    await waitFor(() => expect(screen.getByLabelText('Canal')).toBeTruthy());
    const select = screen.getByLabelText('Canal');
    const option = within(select).getByRole('option', { name: 'WhatsApp' });

    expect((option as HTMLOptionElement).value).toBe('WHATSAPP');
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