// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CaseDetailPage } from '../src/components/CaseDetailPage';
import { getCase, type CaseDetailResponse } from '../src/lib/api';
vi.mock('../src/lib/api', async (original) => ({ ...await original<typeof import('../src/lib/api')>(), getCase: vi.fn(), getAreaComments: vi.fn().mockResolvedValue([]) }));
afterEach(cleanup);
it('presenta latencias reales en segundos y conserva el diagnóstico de referencia inválida', async () => {
  vi.mocked(getCase).mockResolvedValue({
    case: { id: 'case-1', status: 'ERROR', studentIdentifier: null, canWrite: false, createdAt: '2026-10-13T10:00:00Z', updatedAt: '2026-10-13T10:00:00Z' },
    evidences: [], audits: [], review: null, comparison: null, effectiveResolution: null,
    audit: { id: 'audit-1', caseId: 'case-1', status: 'ERROR', resultJson: null, errorCategory: 'INVALID_AI_RESPONSE', createdAt: '2026-10-13T10:00:00Z', providerMetadata: { openrouterAttempts: [37011, 35353].map(latencyMs => ({ latencyMs, failureCategory: 'INVALID_EVIDENCE_REFERENCE', path: 'evidenceSummary.1.evidenceId', detail: 'evidencia inexistente ev-inventada' })) } },
  } as unknown as CaseDetailResponse);
  render(<CaseDetailPage caseId="case-1" role="manager" />);
  expect(await screen.findByText(/Intento 1 · 37\.0 s/)).toBeTruthy();
  expect(screen.getByText(/Intento 2 · 35\.4 s/)).toBeTruthy();
  expect(screen.getAllByText('evidenceSummary.1.evidenceId')).toHaveLength(2);
  expect(screen.queryByText(/10:16:51/)).toBeNull();
});
