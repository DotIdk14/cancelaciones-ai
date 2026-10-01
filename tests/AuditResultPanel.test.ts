// @vitest-environment jsdom

import { createElement } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuditDetail, Evidence } from '../src/lib/api';
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

  it('muestra el análisis temporal con la relación entre solicitud e inicio', () => {
    const audit = makeAudit(validAuditResult);
    render(createElement(AuditResultPanel, { audit, evidences: [{ id: 'ev-1', filename: 'whatsapp.png' }] as Evidence[] }));

    expect(screen.getByText('Análisis temporal')).toBeTruthy();
    // La fecha aparece también en "Datos del caso" y en el fact, así que se
    // busca dentro de la sección del análisis temporal, no globalmente.
    const temporalSection = screen.getByLabelText('Análisis temporal');
    expect(within(temporalSection).getByText('2026-01-12')).toBeTruthy();
    expect(within(temporalSection).getByText('2026-02-01')).toBeTruthy();
    expect(within(temporalSection).getByText('Inicio de ciclo: 12/01/2026')).toBeTruthy();
    // La relación se muestra en texto legible, no como el enum crudo.
    expect(within(temporalSection).getByText('La solicitud es posterior al inicio de ciclo')).toBeTruthy();
  });

  it('avisa explícitamente cuando no hay evidencia que acredite el inicio de ciclo', () => {
    const historical = JSON.parse(JSON.stringify(validAuditResult)) as Record<string, unknown>;
    historical.temporalAnalysis = {
      cycleStartDate: null,
      cycleStartEvidenceIds: [],
      cycleStartEvidenceText: null,
      cancellationRequestDate: null,
      cancellationRequestEvidenceIds: [],
      relationToCycleStart: 'NO_DETERMINABLE',
      reasoning: 'No hay evidencia del inicio académico.',
    };

    render(createElement(AuditResultPanel, { audit: makeAudit(historical), evidences: [] }));

    expect(screen.getByText('No hay evidencia que acredite la fecha de inicio de ciclo; no se ha supuesto ninguna.')).toBeTruthy();
    expect(screen.getByText('No determinable con las evidencias disponibles')).toBeTruthy();
  });

  it('no rompe con auditorías históricas que no tienen análisis temporal', () => {
    const legacy = JSON.parse(JSON.stringify(validAuditResult)) as Record<string, unknown>;
    delete legacy.temporalAnalysis;

    expect(() => render(createElement(AuditResultPanel, { audit: makeAudit(legacy), evidences: [] }))).not.toThrow();
    expect(screen.queryByText('Análisis temporal')).toBeNull();
  });
});

function makeAudit(resultJson: unknown): AuditDetail {
  return {
    id: 'audit-1',
    caseId: 'case-1',
    status: 'COMPLETED',
    provider: 'openrouter',
    model: 'google/gemini-2.5-flash',
    resultJson: resultJson as AuditResult,
    errorCategory: null,
    latencyMs: 1200,
    evidenceFingerprint: null,
    attemptNumber: 1,
    deadlineAt: null,
    createdAt: '2026-09-28T00:00:00Z',
  };
}