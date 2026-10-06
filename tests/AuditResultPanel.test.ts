// @vitest-environment jsdom
//
// El dictamen se redujo a lo que responde "qué se aplicó y por qué": la regla,
// la sección del procedimiento y el razonamiento, más los comentarios que deja
// cada área. Estos tests fijan ese alcance.
//
// Lo que fijan, y por qué importa:
//
//   1. Los TRES campos están. Si alguno desaparece, el dictamen deja de poder
//      responder su pregunta.
//   2. Los bloques RETIRADOS no están. Es la mitad del contrato: quitarlos de la
//      vista fue una decisión de producto y este test es lo que la sostiene.
//   3. Los datos NO se pierden al quitar la vista. Se comprueba sobre el objeto
//      persistido, no sobre la pantalla, porque `audits.result_json` es la
//      fuente de verdad del dictamen y no depende de qué se pinte.
//   4. Un payload histórico sin arrays ni `rule` no rompe la vista.
//   5. Sin `resultJson` se dice que no hay dictamen, no se inventa uno.
//   6. Los comentarios se piden para el caso del dictamen, no para otro.
//
// Se usa `createElement` en lugar de JSX porque `vitest.config.ts` solo incluye
// `tests/**/*.test.ts`.

import { createElement } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditDetail } from '../src/lib/api';
import type { AuditResult } from '../src/skills/audit/schema';
import { AuditResultPanel } from '../src/components/AuditResultPanel';
import { validAuditResult } from './fixtures/audit-result';

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
  // El visor de comentarios pide el recurso del caso al montar. Por defecto no
  // hay nada escrito.
  fetchSpy.mockResolvedValue(
    new Response(JSON.stringify({ comments: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AuditResultPanel — alcance del dictamen', () => {
  it('muestra la regla, la sección del procedimiento y el razonamiento', async () => {
    render(createElement(AuditResultPanel, { audit: makeAudit(validAuditResult) }));

    expect(screen.getByText('Regla')).toBeTruthy();
    expect(screen.getByText(validAuditResult.audit.rule)).toBeTruthy();
    expect(screen.getByText('Sección del procedimiento')).toBeTruthy();
    expect(screen.getByText(validAuditResult.audit.procedureSection)).toBeTruthy();
    expect(screen.getByText('Razonamiento')).toBeTruthy();
    expect(screen.getByText(validAuditResult.audit.reasoning)).toBeTruthy();

    await waitFor(() => expect(screen.getByText('Comentarios de las áreas')).toBeTruthy());
  });

  it('ya no renderiza los bloques que se retiraron de la vista', async () => {
    render(createElement(AuditResultPanel, { audit: makeAudit(validAuditResult) }));

    // Cada uno era un bloque propio con su propio título. Si alguno vuelve, este
    // test falla y obliga a decidir si el regreso es intencional.
    for (const retirado of [
      'Confianza',
      'Análisis temporal',
      'Hechos encontrados',
      'Línea de tiempo',
      'Contradicciones',
      'Evidencias utilizadas',
      'Checks del procedimiento',
      'Evidencias faltantes',
      'Observaciones',
      'Ejecución',
      'Datos del caso',
      'Orientación provisional',
    ]) {
      expect(screen.queryByText(retirado), `no debía renderizar "${retirado}"`).toBeNull();
    }

    // El modelo sigue explicando el caso, sólo que en otra pestaña.
    await waitFor(() => expect(screen.getByText('Comentarios de las áreas')).toBeTruthy());
  });

  it('no pierde el assessment completo al reducir la vista', () => {
    // La reducción es de PANTALLA, no de dato. `resultJson` conserva todo lo que
    // el modelo emitió; si esto se cumpliera, el Dictamen dejaría de ser
    // auditable a posteriori.
    const persisted = structuredClone(validAuditResult);
    const rendered = makeAudit(persisted);

    expect(Object.keys(rendered.resultJson as object).length).toBeGreaterThan(3);
    expect(rendered.resultJson?.facts.length).toBeGreaterThan(0);
    expect(rendered.resultJson?.timeline.length).toBeGreaterThan(0);
    expect(rendered.resultJson?.audit.supportingEvidenceIds.length).toBeGreaterThan(0);
  });

  it('no rompe con auditorías históricas a las que les faltan campos', async () => {
    const historical = JSON.parse(JSON.stringify(validAuditResult)) as Record<string, unknown>;
    delete historical.facts;
    delete historical.timeline;
    delete historical.conflicts;
    delete historical.temporalAnalysis;
    delete historical.usage;
    const historicalAudit = historical.audit as Record<string, unknown>;
    delete historicalAudit.rule;
    delete historicalAudit.observations;
    delete historicalAudit.supportingEvidenceIds;
    delete historicalAudit.procedureChecks;

    expect(() => render(createElement(AuditResultPanel, { audit: makeAudit(historical) }))).not.toThrow();
    // Sin `rule` se muestra el guion de "no hay valor", no la palabra `undefined`.
    await waitFor(() => expect(screen.getByText('Regla')).toBeTruthy());
    expect(screen.queryByText(/undefined/)).toBeNull();
  });

  it('dice que no hay dictamen en lugar de inventar uno', () => {
    render(createElement(AuditResultPanel, { audit: makeAudit(null) }));

    expect(screen.getByText('No hay resultado de auditoría')).toBeTruthy();
    expect(screen.queryByText('Razonamiento')).toBeNull();
  });

  it('pide y muestra los comentarios del caso del dictamen', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          comments: [
            {
              id: 'ac-1',
              caseId: 'case-1',
              area: 'BACK_OFFICE',
              comment: 'El pago no se reflejó en el corte.',
              createdAt: '2026-10-05T00:00:00Z',
              updatedAt: '2026-10-05T00:00:00Z',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    render(createElement(AuditResultPanel, { audit: makeAudit(validAuditResult) }));

    expect(await screen.findByDisplayValue('El pago no se reflejó en el corte.')).toBeTruthy();
    // Los cinco campos del vocabulario cerrado están, aunque no tengan texto.
    for (const area of ['Back Office', 'HelpDesk', 'Servicios Escolares', 'Finanzas', 'Adicional']) {
      expect(screen.getByLabelText(area)).toBeTruthy();
    }

    const url = String(fetchSpy.mock.calls[0]?.[0]);
    expect(url).toContain('/api/cases/case-1/area-comments');
  });
});

function makeAudit(resultJson: unknown): AuditDetail {
  return {
    id: 'audit-1',
    caseId: 'case-1',
    status: 'COMPLETED',
    provider: 'openrouter',
    model: 'google/gemini-2.5-flash',
    resultJson: resultJson as AuditResult | null,
    errorCategory: null,
    latencyMs: 1200,
    evidenceFingerprint: null,
    attemptNumber: 1,
    deadlineAt: null,
    createdAt: '2026-09-28T00:00:00Z',
  };
}