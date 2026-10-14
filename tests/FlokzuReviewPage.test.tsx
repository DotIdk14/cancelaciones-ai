// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FlokzuReviewPage } from '../src/components/FlokzuReviewPage';
import { getFlokzuReview, getFlokzuTicket, getFlokzuImportHistory, decideFlokzuTicket, type FlokzuTicketDetail } from '../src/lib/api';

vi.mock('../src/lib/api', () => ({ getFlokzuReview: vi.fn(), getFlokzuTicket: vi.fn(), getFlokzuImportHistory: vi.fn(), decideFlokzuTicket: vi.fn() }));
const detail: FlokzuTicketDetail = {
  ticket: { id: 'case-1', externalCaseId: 'CaVe-321', studentIdentifier: 'TEST-321', studentName: 'Estudiante sintético',
    classification: 'VERIFY', reviewState: 'OPEN', eligible: false, discrepancy: false, reason: 'Motivo anterior', revision: 1,
    assignedTo: null, updatedAt: '2026-10-14T12:00:00Z', campus: null, policy: null, requestDate: null,
    currentTask: '[SER] [APLICACION] [CV]', salesChannelReported: 'INC_INCONCERT' },
  data: { academic: { campus: null, university: null, countryReported: null, program: null, level: null, block: null, programKey: null, entryDate: null },
    procedure: { policyReported: null, motive: null, description: null, requestDate: null, administrativeStartDate: null },
    operations: { currentTask: '[SER] [APLICACION] [CV]', statusReported: 'APLICA', finalizedReported: null, reviewerReported: null, supervisorReported: null, requesterReported: null, requesterArea: null, salesChannelReported: 'INC_INCONCERT' }, evidenceReferences: [] },
  history: [], historyNextOffset: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getFlokzuImportHistory).mockResolvedValue({ imports: [], cases: [], casesNextOffset: null, assignmentOptions: [] });
  vi.mocked(getFlokzuReview).mockResolvedValue({ tickets: [detail.ticket], nextOffset: null, counts: { pending: 1, rejected: 0, finalized: 0, otherStage: 0, discrepancies: 0 } });
  vi.mocked(getFlokzuTicket).mockResolvedValue(detail);
});
afterEach(cleanup);

it('abre desde otra celda de la fila y muestra etapa, canal, motivo concreto y siguiente paso', async () => {
  render(<FlokzuReviewPage />);
  const row = await screen.findByRole('row', { name: 'Revisar ticket CaVe-321' });
  fireEvent.click(within(row).getByText('Sin asignación'));
  const panel = screen.getByLabelText('Detalle administrativo del ticket');
  expect(await within(panel).findByText('Por qué aparece aquí')).toBeTruthy();
  expect(within(panel).getByText(/Tarea actual = “\[SER\]/)).toBeTruthy();
  expect(within(panel).getByText('INC_INCONCERT')).toBeTruthy();
  expect(within(panel).getByText('Qué hacer ahora')).toBeTruthy();
  expect(within(panel).getByText(/La clasificación guardada es/).textContent).toContain('vuelve a importar');
  expect(getFlokzuTicket).toHaveBeenCalledTimes(1);
  expect(decideFlokzuTicket).not.toHaveBeenCalled();
});
it.each(['Enter', ' '])('abre la fila con teclado: %s', async key => {
  render(<FlokzuReviewPage />);
  fireEvent.keyDown(await screen.findByRole('row', { name: 'Revisar ticket CaVe-321' }), { key });
  await within(screen.getByLabelText('Detalle administrativo del ticket')).findByText('Qué hacer ahora');
  expect(getFlokzuTicket).toHaveBeenCalledWith('case-1');
});
it('nombra el ticket cuyo detalle falló y permite reintentar', async () => {
  vi.mocked(getFlokzuTicket).mockRejectedValueOnce(new Error('Servicio no disponible'));
  render(<FlokzuReviewPage />);
  fireEvent.click(await screen.findByRole('row', { name: 'Revisar ticket CaVe-321' }));
  expect((await screen.findByRole('alert')).textContent).toContain('No se pudo abrir el detalle de CaVe-321');
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await within(screen.getByLabelText('Detalle administrativo del ticket')).findByText('Qué hacer ahora')).toBeTruthy();
});
