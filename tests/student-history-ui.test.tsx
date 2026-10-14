// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { it, expect, vi } from 'vitest';
import { StudentHistory } from '../src/components/StudentHistory';
vi.mock('../src/lib/student-history', () => ({ readStudentHistory: vi.fn(async () => ({ studentIdentifier: '00123', studentName: 'Estudiante sintético', summary: { cases: 2, audits: 3, evidences: 4, previousCases: 1, lastRequestAt: '2026-10-13' }, cases: ['CaVe-1','CaVe-2'].map((id, index) => ({ id, externalCaseId: id, createdAt: '2026-10-12', status: 'DRAFT', policy: index ? 'Política B' : 'Política A', evidenceCount: index + 1, auditCount: 1, latestAudit: null, workflowState: 'PENDING_ADVISOR', finalResolution: null })), nextOffset: null })) }));
it('abre historial y compara tickets distintos sin IA', async () => {
 render(<StudentHistory caseId="CaVe-2" />);
 await waitFor(() => expect(screen.getByText(/Esta matrícula tiene 1/)).toBeTruthy());
 fireEvent.click(screen.getByText(/Ver historial/));
 expect(screen.getByText(/2 expedientes · 3 ejecuciones/)).toBeTruthy();
 for(const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox);
 expect(screen.getByRole('table')).toBeTruthy();
 expect(screen.getByRole('heading', { name: 'Comparación de solicitudes' })).toBeTruthy();
 expect(screen.getAllByText('Política A').length).toBe(2);
});
