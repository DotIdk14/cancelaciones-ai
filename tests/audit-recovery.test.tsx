// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useCaseAuditWorkflow } from '../src/components/useCaseAuditWorkflow';
import type { AuditDetail, CaseDetailResponse } from '../src/lib/api';
const api = vi.hoisted(() => ({ getCase: vi.fn(), getAudit: vi.fn(), startAudit: vi.fn() }));
vi.mock('../src/lib/api', async (original) => ({ ...await original<typeof import('../src/lib/api')>(), ...api }));
const audit = { id: 'audit-1', caseId: 'case-1', status: 'COMPLETED', provider: 'openrouter', model: 'synthetic', resultJson: null, errorCategory: null } as AuditDetail;
const detail = { case: { id: 'case-1', status: 'COMPLETED', canWrite: true }, audit, evidences: [], audits: [], auditIsCurrent: true } as unknown as CaseDetailResponse;
beforeEach(() => { vi.clearAllMocks(); api.getCase.mockResolvedValue(detail); });
afterEach(cleanup);
describe('recuperación del flujo de auditoría', () => {
  it('una recuperación anterior no bloquea ni modifica la ruta nueva', async () => {
    let resolveOld!: (value: CaseDetailResponse) => void;
    api.getCase.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const next = { ...detail, case: { ...detail.case, id: 'case-2' }, audit: { ...audit, caseId: 'case-2' } };
    const setDetail = vi.fn();
    const { result, rerender } = renderHook(({ id }) => useCaseAuditWorkflow({ caseId: id, setDetail }), { initialProps: { id: 'case-1' } });
    let pending!: Promise<void>;
    act(() => { pending = result.current.recoverAudit(); });
    rerender({ id: 'case-2' });
    api.getCase.mockResolvedValueOnce(next);
    await act(() => result.current.recoverAudit());
    await act(async () => { resolveOld(detail); await pending; });
    expect(api.getCase).toHaveBeenCalledTimes(2);
    expect(setDetail).toHaveBeenCalledWith(next);
    expect(setDetail).not.toHaveBeenCalledWith(detail);
  });
  it('una respuesta perdida consulta primero el estado y no duplica una auditoría completada', async () => {
    const setDetail = vi.fn();
    const { result } = renderHook(() => useCaseAuditWorkflow({ caseId: 'case-1', setDetail }));
    await act(() => result.current.recoverAudit());
    expect(api.startAudit).not.toHaveBeenCalled();
    expect(setDetail).toHaveBeenCalledWith(detail);
    expect(result.current.auditPhase).toBe('idle');
  });
  it('se une al trabajo RUNNING y actualiza todo el expediente al terminar', async () => {
    const running = { ...audit, status: 'RUNNING' } as AuditDetail;
    api.getCase.mockResolvedValueOnce({ ...detail, audit: running });
    api.getAudit.mockResolvedValue(audit);
    const setDetail = vi.fn();
    const { result } = renderHook(() => useCaseAuditWorkflow({ caseId: 'case-1', setDetail }));
    await act(() => result.current.recoverAudit());
    expect(result.current.auditPhase).toBe('running');
    await act(() => result.current.tickRunning());
    expect(api.startAudit).not.toHaveBeenCalled();
    expect(setDetail).toHaveBeenCalledWith(detail);
    expect(result.current.auditPhase).toBe('idle');
  });
  it('expone los fallos de polling en vez de ocultarlos tras el spinner', async () => {
    api.getAudit.mockRejectedValue(new Error('consulta interrumpida'));
    const { result } = renderHook(() => useCaseAuditWorkflow({ caseId: 'case-1', setDetail: vi.fn() }));
    act(() => result.current.observeLoadedCase({ ...detail, audit: { ...audit, status: 'RUNNING' } }));
    await act(() => result.current.tickRunning());
    expect(result.current.auditPhase).toBe('idle');
    expect(result.current.auditError?.message).toContain('consulta interrumpida');
    expect(api.startAudit).not.toHaveBeenCalled();
  });
  it('no termina la espera usando un dictamen obsoleto', async () => {
    api.startAudit.mockResolvedValue({ kind: 'pending', pendingEvidence: ['audio'] });
    api.getCase.mockResolvedValue({ ...detail, auditIsCurrent: false, evidences: [{ id: 'audio', processingStatus: 'TRANSCRIBING' }] });
    const { result } = renderHook(() => useCaseAuditWorkflow({ caseId: 'case-1', setDetail: vi.fn() }));
    await act(() => result.current.runAudit());
    await act(() => result.current.tickWaiting());
    expect(result.current.auditPhase).toBe('waiting');
    expect(api.startAudit).toHaveBeenCalledTimes(1);
  });
  it('la doble pulsación no envía dos POST', async () => {
    let resolve!: (value: unknown) => void;
    api.startAudit.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const { result } = renderHook(() => useCaseAuditWorkflow({ caseId: 'case-1', setDetail: vi.fn() }));
    let pending!: Promise<void>;
    act(() => { pending = result.current.runAudit(); });
    await act(() => result.current.runAudit());
    expect(api.startAudit).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ kind: 'done', audit }); await pending; });
  });
});
