// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, it, expect, vi } from 'vitest';
import { StudentHistory } from '../src/components/StudentHistory';
import { previewStudentHistory } from '../src/lib/local-student-history-preview';
import { getStudentHistory, getAuditVersion } from '../src/lib/api';
vi.mock('../src/lib/api', () => ({ getStudentHistory: vi.fn(), getAuditVersion: vi.fn(), getCase: vi.fn(), reconcileCaseRequests: vi.fn() }));
afterEach(cleanup);
it('consulta versiones en el menú sin abrir otro diálogo ni cambiar el expediente', async () => {
 const history = { ...previewStudentHistory, studentIdentifier: '00123', items: previewStudentHistory.items.map(item => ({ ...item, versions: [{ id: 'historical', status: 'COMPLETED', createdAt: '2026-10-12T10:00:00Z', result: 'BAJA', retired: false }] })) };
 vi.mocked(getStudentHistory).mockResolvedValue(history);
 const select = vi.fn();
 render(<StudentHistory caseId="demo-1" studentIdentifier="00123" canReconcile={false} embedded onSelectAudit={select} />);
 await waitFor(() => expect(screen.getAllByRole('button', { name: 'Consultar versión' })).toHaveLength(2));
 fireEvent.click(screen.getAllByRole('button', { name: 'Consultar versión' })[0]!);
 expect(select).toHaveBeenCalledWith(history.items[0]!.id, 'historical');
 expect(screen.queryByRole('dialog')).toBeNull();
 expect(getAuditVersion).not.toHaveBeenCalled();
});
