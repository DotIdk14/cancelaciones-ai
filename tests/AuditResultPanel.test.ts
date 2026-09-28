// @vitest-environment jsdom

import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuditDetail } from '../src/lib/api';
import type { AuditResult } from '../src/skills/audit/schema';
import { AuditResultPanel } from '../src/components/AuditResultPanel';
import { validAuditResult } from './fixtures/audit-result';

afterEach(cleanup);

describe('AuditResultPanel', () => {
  it('renders legacy persisted results with absent arrays without crashing', () => {
    const historical = JSON.parse(JSON.stringify(validAuditResult)) as {
      audit: Record<string, unknown>;
      [key: string]: unknown;
    };
    historical.audit.result = 'EVIDENCIA_INSUFICIENTE';
    historical.audit.missingEvidence = [{
      title: 'Contacto efectivo',
      reason: 'No se acredita una interacción efectiva.',
      relatedProcedureSection: '5.8',
    }];
    delete historical.audit.provisionalResolution;
    delete historical.audit.procedureChecks;
    delete historical.audit.supportingEvidenceIds;
    delete historical.audit.observations;
    delete historical.facts;
    delete historical.timeline;
    delete historical.conflicts;

    const audit: AuditDetail = {
      id: 'audit-1',
      caseId: 'case-1',
      status: 'COMPLETED',
      provider: 'openrouter',
      model: 'google/gemini-2.5-flash',
      resultJson: historical as unknown as AuditResult,
      errorCategory: null,
      latencyMs: 1200,
      evidenceFingerprint: null,
      attemptNumber: 1,
      deadlineAt: null,
      createdAt: '2026-09-28T00:00:00Z',
    };

    expect(() => render(createElement(AuditResultPanel, { audit, evidences: [] }))).not.toThrow();
    expect(screen.getByText('Orientación provisional')).toBeTruthy();
    expect(screen.getByText('Esta auditoría anterior no guardó una orientación provisional.')).toBeTruthy();
    expect(screen.getAllByText('Contacto efectivo')).toHaveLength(2);
  });
});