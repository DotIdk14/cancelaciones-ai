import { describe, expect, it } from 'vitest';
import {
  getLocalDashboardPreviewCosts,
  getLocalDashboardPreviewQuality,
  getLocalDashboardPreviewSummary,
  isLocalDashboardPreview,
} from '../src/lib/local-dashboard-preview';
import {
  getLocalPreviewRole,
  getLocalPreviewWorkflowState,
  localPreviewHref,
  PREVIEW_ROLES,
  PREVIEW_WORKFLOW_STATES,
} from '../src/lib/local-ui-preview';
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

describe('selector de rol de la vista previa local', () => {
  it('acepta los tres roles y cae a Coordinador ante un valor ausente o inválido', () => {
    for (const role of PREVIEW_ROLES) {
      expect(getLocalPreviewRole(`?preview=dashboard&role=${role}`)).toBe(role);
    }
    expect(getLocalPreviewRole('?preview=dashboard')).toBe('coordinator');
    expect(getLocalPreviewRole('?preview=dashboard&role=root')).toBe('coordinator');
  });
});

describe('estado del flujo de la vista previa local', () => {
  it('acepta los tres estados y cae a PENDING_COORDINATOR ante un valor ausente o inválido', () => {
    for (const state of PREVIEW_WORKFLOW_STATES) {
      expect(getLocalPreviewWorkflowState(`?preview=dashboard&workflow=${state}`)).toBe(state);
    }
    expect(getLocalPreviewWorkflowState('?preview=dashboard')).toBe('PENDING_COORDINATOR');
    expect(getLocalPreviewWorkflowState('?preview=dashboard&workflow=inventado')).toBe(
      'PENDING_COORDINATOR',
    );
  });

  it('los enlaces conservan el fragmento (la ruta) al cambiar rol o estado', () => {
    // Sin el hash, cambiar de rol recargaría en el dashboard.
    expect(localPreviewHref('user', 'PENDING_ADVISOR', '#/casos/demo-case-001')).toBe(
      '?preview=dashboard&role=user&workflow=PENDING_ADVISOR#/casos/demo-case-001',
    );
    expect(localPreviewHref('coordinator', 'FINALIZED', '')).toBe(
      '?preview=dashboard&role=coordinator&workflow=FINALIZED',
    );
  });
});
