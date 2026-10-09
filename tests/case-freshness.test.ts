import { describe, expect, it } from 'vitest';
import { caseToSummary } from '../src/server/dto';
import type { CaseSummaryRow } from '../src/server/cases';

function summaryRow(overrides: Partial<CaseSummaryRow> = {}): CaseSummaryRow {
  return {
    id: 'case-1',
    status: 'COMPLETED',
    student_identifier: null,
    created_by: 'owner-1',
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    evidence: [],
    audit: {
      id: 'audit-1',
      case_id: 'case-1',
      status: 'COMPLETED',
      provider: 'openrouter',
      model: 'test-model',
      result_json: { audit: { result: 'CANCELACION_VENTA' } },
      error_category: null,
      latency_ms: 100,
      evidence_fingerprint: 'old-fingerprint',
      attempt_number: 1,
      deadline_at: null,
      provider_metadata: null,
      created_at: '2026-10-01T00:00:00.000Z',
    },
    auditIsCurrent: true,
    ...overrides,
  };
}

describe('proyección de dictamen actual e histórico', () => {
  it('no presenta una auditoría antigua como resolución vigente', () => {
    const dto = caseToSummary(summaryRow({ auditIsCurrent: false }));
    expect(dto.auditIsCurrent).toBe(false);
    expect(dto.effectiveResolution).toBeNull();
  });

  it('mantiene la resolución humana aunque el dictamen IA sea antiguo', () => {
    const dto = caseToSummary(summaryRow({
      auditIsCurrent: false,
      review: { result: 'DICTAMINACION' } as never,
    }));
    expect(dto.effectiveResolution).toEqual({ result: 'DICTAMINACION', source: 'HUMAN' });
  });

  it('presenta como vigente el dictamen cuyo fingerprint coincide', () => {
    const dto = caseToSummary(summaryRow({ auditIsCurrent: true }));
    expect(dto.effectiveResolution).toEqual({ result: 'CANCELACION_VENTA', source: 'AI' });
  });
});
