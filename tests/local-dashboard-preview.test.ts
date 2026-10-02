import { describe, expect, it } from 'vitest';
import {
  getLocalDashboardPreviewCosts,
  getLocalDashboardPreviewQuality,
  getLocalDashboardPreviewSummary,
  isLocalDashboardPreview,
} from '../src/lib/local-dashboard-preview';
import type { DashboardFilters } from '../src/lib/dashboard';

const filters: DashboardFilters = {
  from: '2026-09-01',
  to: '2026-10-02',
  result: null,
  status: null,
};

describe('vista previa local del dashboard', () => {
  it('solo se habilita en desarrollo con el parámetro explícito', () => {
    expect(isLocalDashboardPreview('?preview=dashboard', true)).toBe(true);
    expect(isLocalDashboardPreview('', true)).toBe(false);
    expect(isLocalDashboardPreview('?preview=dashboard', false)).toBe(false);
  });

  it('devuelve informes ficticios y deja claro que no hay revisiones reales', () => {
    expect(getLocalDashboardPreviewSummary(filters).kpi.auditedCases).toBeGreaterThan(0);
    expect(getLocalDashboardPreviewCosts(filters, 'week').granularity).toBe('week');
    expect(getLocalDashboardPreviewQuality(filters).humanReview.message).toContain('datos ficticios');
  });
});
