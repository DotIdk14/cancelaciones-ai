// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { HistoryComparisonDetails } from '../src/components/HistoryComparisonDetails';
import { getCase, type CaseDetailResponse } from '../src/lib/api';
vi.mock('../src/lib/api', () => ({ getCase: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const detail = (id: string): CaseDetailResponse => ({ case: { id, studentName: id }, evidences: [{ id: `e-${id}`, caseId: id, filename: `${id}.pdf` }], audit: null } as CaseDetailResponse);
it('consulta y conserva los archivos en la columna de su ticket sin IA', async () => {
  vi.mocked(getCase).mockImplementation(async id => detail(id));
  render(<HistoryComparisonDetails tickets={[{ id: 'a', externalCaseId: 'CaVe-A' }, { id: 'b', externalCaseId: 'CaVe-B' }]} />);
  await screen.findByRole('table');
  expect(getCase).toHaveBeenCalledTimes(2);
  const row = screen.getByText('Evidencias de este expediente').closest('tr')!;
  expect(row.querySelectorAll('td')[0]?.textContent).toBe('a.pdf');
  expect(row.querySelectorAll('td')[1]?.textContent).toBe('b.pdf');
});
it('rechaza una respuesta que mezcla identidades de evidencia', async () => {
  vi.mocked(getCase).mockImplementation(async id => ({ ...detail(id), evidences: detail('otro').evidences }));
  render(<HistoryComparisonDetails tickets={[{ id: 'a', externalCaseId: null }, { id: 'b', externalCaseId: null }]} />);
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(screen.queryByRole('table')).toBeNull();
});
