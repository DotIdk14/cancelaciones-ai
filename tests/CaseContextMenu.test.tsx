// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CaseContextMenu, type ContextTab } from '../src/components/CaseContextMenu';
import { getHistoricalAudit, getCase, type AuditDetail, type CaseDetailResponse } from '../src/lib/api';
import { validAuditResult } from './fixtures/audit-result';
import { formatDateTime } from '../src/lib/format';

vi.mock('../src/lib/api', async (original) => ({ ...await original<typeof import('../src/lib/api')>(), getHistoricalAudit: vi.fn(), getCase: vi.fn() }));
vi.mock('../src/components/StudentHistory', () => ({ StudentHistory: ({ onSelectAudit }: { onSelectAudit: (caseId: string, auditId: string) => void }) => <button onClick={() => onSelectAudit('other-case', 'other-audit')}>Consultar ticket relacionado</button> }));

const audit: AuditDetail = { id: 'latest', caseId: 'case-1', status: 'COMPLETED', resultJson: validAuditResult, provider: 'openrouter', model: 'test', errorCategory: null, latencyMs: 1, evidenceFingerprint: 'a', attemptNumber: 1, deadlineAt: null, createdAt: '2026-10-13T10:00:00Z' };
function detail(): CaseDetailResponse {
  return { case: { id: 'case-1', studentIdentifier: 'MAT-DEMO', studentName: 'Alumno de prueba', status: 'COMPLETED', createdAt: audit.createdAt, updatedAt: audit.createdAt, externalCaseId: 'CaVe-1' }, evidences: [], audit, audits: [audit, { ...audit, id: 'old', createdAt: '2026-10-12T10:00:00Z' }].map(item => ({ ...item, result: 'CANCELACION_VENTA', confidence: .9 })), review: { id: 'review', caseId: 'case-1', auditId: 'latest', result: 'CANCELACION_VENTA', reviewerName: 'Asesor', comment: '', createdAt: audit.createdAt }, comparison: null, effectiveResolution: { result: 'CANCELACION_VENTA', source: 'HUMAN' } };
}
function Harness({ initialOpen = true, record = detail() }: { initialOpen?: boolean; record?: CaseDetailResponse }) {
  const [open, setOpen] = useState(initialOpen);
  const [tab, setTab] = useState<ContextTab>('data');
  return <><button onClick={() => setOpen(true)}>Abrir contexto</button><div data-testid="visor">Evidencia seleccionada</div><CaseContextMenu detail={record} open={open} tab={tab} onTabChange={setTab} onClose={() => setOpen(false)} notesContent={<input aria-label="Borrador de notas" defaultValue="" />} reviewContent={<input aria-label="Borrador de revisión" defaultValue="" />} /></>;
}
beforeEach(() => { vi.mocked(getHistoricalAudit).mockReset(); vi.mocked(getCase).mockReset(); });
afterEach(cleanup);
it('monta el menú fuera de la rejilla del expediente y no introduce una columna', () => {
  render(<div data-testid="context-grid"><Harness initialOpen /></div>);
  const dialog = screen.getByRole('dialog', { name: 'Contexto del expediente' });
  expect(dialog.parentElement).toBe(document.body);
  expect(screen.getByTestId('context-grid').contains(dialog)).toBe(false);
});

it('conserva el scroll trabajado al cerrar el menú no modal y devuelve el foco', () => {
  const { container } = render(<Harness initialOpen={false} />);
  const trigger = screen.getByText('Abrir contexto');
  container.scrollTop = 120; trigger.focus();
  fireEvent.click(trigger);
  container.scrollTop = 240;
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar contexto del expediente' }));
  expect(container.scrollTop).toBe(240);
  expect(document.activeElement).toBe(trigger);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('cerrado no consulta la API y conserva notas y visor al abrir, cambiar pestañas y cerrar', () => {
  render(<Harness initialOpen={false} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(getHistoricalAudit).not.toHaveBeenCalled(); expect(getCase).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Abrir contexto'));
  fireEvent.change(screen.getByLabelText('Borrador de notas'), { target: { value: 'Nota sin guardar' } });
  fireEvent.click(screen.getByRole('tab', { name: 'Dictamen' }));
  fireEvent.change(screen.getByLabelText('Borrador de revisión'), { target: { value: 'Decisión sin guardar' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar contexto del expediente' }));
  expect(screen.getByTestId('visor').textContent).toBe('Evidencia seleccionada');
  fireEvent.click(screen.getByText('Abrir contexto'));
  expect((screen.getByLabelText('Borrador de revisión') as HTMLInputElement).value).toBe('Decisión sin guardar');
  fireEvent.click(screen.getByRole('tab', { name: 'Datos' }));
  expect((screen.getByLabelText('Borrador de notas') as HTMLInputElement).value).toBe('Nota sin guardar');
});

it('consulta el histórico sin atribuirle la revisión del último dictamen ni cambiar de expediente', async () => {
  const old = { ...audit, id: 'old', resultJson: structuredClone(validAuditResult) };
  old.resultJson.audit.reasoning = 'Justificación histórica';
  vi.mocked(getHistoricalAudit).mockResolvedValue(old);
  render(<Harness />);
  fireEvent.click(screen.getByRole('tab', { name: 'Auditorías' }));
  fireEvent.click(screen.getByRole('button', { name: `Consultar auditoría del ${formatDateTime('2026-10-12T10:00:00Z')}` }));
  expect(await screen.findByText('Justificación histórica')).toBeTruthy();
  expect(screen.getByText('Esta auditoría no tiene una revisión humana vinculada.')).toBeTruthy();
  expect(getHistoricalAudit).toHaveBeenCalledWith('case-1', 'old');
  expect(screen.getByTestId('visor').textContent).toBe('Evidencia seleccionada');
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar contexto del expediente' }));
  fireEvent.click(screen.getByText('Abrir contexto'));
  expect(screen.getByText('Justificación histórica')).toBeTruthy();
  expect(getHistoricalAudit).toHaveBeenCalledTimes(1);
});

it('rechaza una respuesta histórica perteneciente a otro ticket', async () => {
  vi.mocked(getHistoricalAudit).mockResolvedValue({ ...audit, id: 'old', caseId: 'other-case' });
  render(<Harness />); fireEvent.click(screen.getByRole('tab', { name: 'Auditorías' }));
  fireEvent.click(screen.getByRole('button', { name: `Consultar auditoría del ${formatDateTime('2026-10-12T10:00:00Z')}` }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByText(validAuditResult.audit.reasoning).closest('[hidden]')).toBeTruthy();
});

it('ignora una carga antigua cuando se vuelve a seleccionar el dictamen actual', async () => {
  let finish!: (value: AuditDetail) => void;
  vi.mocked(getHistoricalAudit).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<Harness />); fireEvent.click(screen.getByRole('tab', { name: 'Auditorías' }));
  fireEvent.click(screen.getByRole('button', { name: `Consultar auditoría del ${formatDateTime('2026-10-12T10:00:00Z')}` }));
  fireEvent.click(screen.getByRole('tab', { name: 'Auditorías' }));
  fireEvent.click(screen.getByRole('button', { name: `Consultar auditoría del ${formatDateTime(audit.createdAt)}` }));
  const obsolete = { ...audit, id: 'old', resultJson: structuredClone(validAuditResult) }; obsolete.resultJson.audit.reasoning = 'Respuesta tardía'; finish(obsolete);
  await waitFor(() => expect(screen.queryByText('Respuesta tardía')).toBeNull());
  expect(screen.getByText(validAuditResult.audit.reasoning)).toBeTruthy();
});

it('distingue un ticket relacionado y consulta su propio dictamen', async () => {
  const owner = detail(); owner.case = { ...owner.case, id: 'other-case', externalCaseId: 'CaVe-2' }; owner.review = null;
  owner.audit = { ...audit, caseId: 'other-case', id: 'other-audit', resultJson: structuredClone(validAuditResult) };
  owner.audit.resultJson!.audit.reasoning = 'Justificación de otro ticket';
  vi.mocked(getCase).mockResolvedValue(owner);
  render(<Harness />); fireEvent.click(screen.getByRole('tab', { name: 'Auditorías' }));
  fireEvent.click(await screen.findByText('Consultar ticket relacionado'));
  expect(await screen.findByText('Justificación de otro ticket')).toBeTruthy();
  expect(screen.getByText(/Ticket CaVe-2/)).toBeTruthy();
  expect(screen.getByText(/Ticket CaVe-1/)).toBeTruthy();
  expect(getCase).toHaveBeenCalledWith('other-case');
});

it('refresca la revisión humana del ticket actual sin perder la selección histórica', async () => {
  vi.mocked(getHistoricalAudit).mockResolvedValue({ ...audit, id: 'old' });
  const { rerender } = render(<Harness />);
  fireEvent.click(screen.getByRole('tab', { name: 'Auditorías' }));
  fireEvent.click(screen.getByRole('button', { name: `Consultar auditoría del ${formatDateTime('2026-10-12T10:00:00Z')}` }));
  expect(await screen.findByText('Esta auditoría no tiene una revisión humana vinculada.')).toBeTruthy();
  const updated = detail(); updated.review = { ...updated.review!, auditId: 'old', result: 'BAJA' };
  rerender(<Harness record={updated} />);
  expect(screen.getByText('Baja')).toBeTruthy();
  expect(screen.queryByText('Esta auditoría no tiene una revisión humana vinculada.')).toBeNull();
  expect(getHistoricalAudit).toHaveBeenCalledTimes(1);
});
