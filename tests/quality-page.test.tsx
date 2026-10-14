// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { QualityPage } from '../src/components/dashboard/QualityPage';
import { getLocalDashboardPreviewQuality } from '../src/lib/local-dashboard-preview';
import { defaultDateRange } from '../src/lib/dashboard';
import type { QualityReport } from '../src/lib/dashboard';

const state = vi.hoisted(() => ({ report: null as QualityReport | null }));
vi.mock('../src/lib/useDashboard', () => ({ useAiQuality: () => ({ data: state.report, isLoading: false, error: null, reload: vi.fn() }) }));
vi.mock('../src/components/dashboard/DashboardFilters', () => ({ DashboardFilters: () => null }));
afterEach(cleanup);

it('filtra los casos sin alterar la coincidencia ni su muestra de referencia', () => {
  state.report = getLocalDashboardPreviewQuality(defaultDateRange());
  render(<QualityPage />);
  const summary = screen.getByRole('region', { name: 'Resumen de calidad' });
  const before = summary.textContent;
  fireEvent.click(screen.getByRole('button', { name: /^Coinciden: / }));
  expect(summary.textContent).toBe(before);
  const table = screen.getByRole('region', { name: 'Casos de calidad' });
  expect(table.textContent).toContain('CaVe-101');
  expect(table.textContent).not.toContain('CaVe-102');
});

it('explica que aún no puede medirse la coincidencia cuando faltan revisiones', () => {
  const report = getLocalDashboardPreviewQuality(defaultDateRange());
  const pending = report.evaluation!.rows.filter(row => ['PENDING_ADVISOR', 'PENDING_COORDINATOR'].includes(row.state));
  state.report = { ...report, evaluation: { ...report.evaluation!, rows: pending, issued: pending.length,
    finalized: 0, validComparisons: 0, agreements: 0, disagreements: 0, agreementRate: null,
    coverageRate: 0, pendingEvaluation: pending.length } };
  render(<QualityPage />);
  expect(screen.getByText('Aún sin evaluar')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain('todavía no podemos medir');
  fireEvent.click(screen.getByRole('button', { name: '¿Qué falta revisar?' }));
  expect(screen.getByRole('button', { name: /Falta revisión del Asesor: 1 casos/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: /Falta cierre del Coordinador: 1 casos/ })).toBeTruthy();
});
