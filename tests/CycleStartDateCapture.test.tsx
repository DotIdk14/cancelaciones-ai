// @vitest-environment jsdom
// =============================================================================
// Ventana de captura de la fecha de inicio de clases en el expediente.
//
// Lo que fija:
//
//   1. Aparece SOLO cuando el dictamen emitido no acreditó la fecha y nadie la
//      ha capturado. Si el dictamen ya trae fecha, o si ya está capturada, la
//      ventana no aparece.
//   2. La fecha es un DATO HUMANO con procedencia: se guarda una sola vez por
//      PATCH y nunca dispara una auditoría por su cuenta
//      (DO_NOT_REPROCESS_AI_UNNECESSARILY).
//   3. "Volver a auditar" NO es una segunda vía de auditoría: enfoca el botón
//      de auditar que ya existe en el expediente.
//   4. Corregir una fecha que ya alimentó un dictamen lo dice y advierte que la
//      re-auditoría consume cuota.
//   5. Nombre (1-120) y fecha son obligatorios: sin los dos no se guarda.
// =============================================================================

import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AUDIT_TRIGGER_ID, CycleStartDateCapture } from '../src/components/CycleStartDateCapture';
import { CaseDetailPage } from '../src/components/CaseDetailPage';
import type { CaseDetailResponse } from '../src/lib/api';
import type { AuditResult } from '../src/skills/audit/schema';
import { formatDate, formatDateTime } from '../src/lib/format';
import { validAuditResult } from './fixtures/audit-result';

const NO_DETERMINABLE = { cycleStartDate: null, relationToCycleStart: 'NO_DETERMINABLE' };

function fakeResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface TrackedRequest {
  url: string;
  method: string;
  body: string | null;
}

function stubFetch(
  caseResponse: CaseDetailResponse | null,
  areaComments: unknown[] = [],
): { requests: TrackedRequest[] } {
  const requests: TrackedRequest[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      requests.push({ url, method, body: typeof init?.body === 'string' ? init.body : null });

      if (url.endsWith('/api/cases/case-1') && method === 'GET') {
        return caseResponse === null ? fakeResponse(404, {}) : fakeResponse(200, caseResponse);
      }
      if (url.endsWith('/api/cases/case-1') && method === 'PATCH') {
        const sent = JSON.parse(String(init?.body ?? '{}')) as {
          cycleStartDate?: string;
          cycleStartDateByName?: string;
        };
        return fakeResponse(200, {
          case: {
            ...caseResponse?.case,
            cycleStartDate: sent.cycleStartDate ?? null,
            cycleStartDateByName: sent.cycleStartDateByName ?? null,
            cycleStartDateAt: '2026-10-08T12:00:00.000Z',
          },
        });
      }
      if (url.endsWith('/api/cases/case-1/area-comments') && method === 'GET') {
        return fakeResponse(200, { comments: areaComments });
      }
      if (url.endsWith('/api/cases/case-1/review') && method === 'GET') {
        return fakeResponse(200, { review: null, comparison: null, effectiveResolution: null });
      }
      return fakeResponse(404, {});
    }),
  );
  return { requests };
}

function completedAudit(resultJson: AuditResult): CaseDetailResponse['audit'] {
  return {
    id: 'audit-1',
    caseId: 'case-1',
    status: 'COMPLETED',
    provider: 'openrouter',
    model: 'google/gemini-2.5-flash',
    resultJson,
    errorCategory: null,
    latencyMs: 1200,
    evidenceFingerprint: 'fp-1',
    attemptNumber: 1,
    deadlineAt: null,
    createdAt: '2026-10-01T10:00:00.000Z',
  };
}

function verdictWithoutCycleStart(): AuditResult {
  return {
    ...validAuditResult,
    temporalAnalysis: {
      ...validAuditResult.temporalAnalysis,
      cycleStartDate: null,
      cycleStartEvidenceIds: [],
      cycleStartEvidenceText: null,
      relationToCycleStart: 'NO_DETERMINABLE',
    },
  };
}

function readyCase(audit: CaseDetailResponse['audit']): CaseDetailResponse {
  return {
    case: {
      id: 'case-1',
      status: 'READY',
      studentIdentifier: 'A12345',
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:00:00.000Z',
      cycleStartDate: null,
      cycleStartDateByName: null,
      cycleStartDateAt: null,
    },
    evidences: [
      {
        id: 'ev-1',
        caseId: 'case-1',
        filename: 'captura.png',
        mimeType: 'image/png',
        sizeBytes: 1234,
        hash: 'deadbeef',
        storagePath: 'evidences/case-1/ev-1',
        processingStatus: 'READY',
        processingError: null,
        transcript: null,
        createdAt: '2026-10-01T10:00:00.000Z',
      },
    ],
    audit,
    audits: [],
    review: null,
    comparison: null,
    effectiveResolution: null,
  };
}

/**
 * La sección es una `region` con nombre propio: dentro del expediente completo
 * hay otros botones "Guardar" (notas de las áreas) y otro "Volver a auditar"
 * (el del panel del dictamen), así que las búsquedas se acotan a esta sección.
 */
function captureSection(): ReturnType<typeof within> {
  return within(screen.getByRole('region', { name: 'Captura de la fecha de inicio de clases' }));
}

async function fillAndSave(date: string, name: string): Promise<void> {
  const dateInput = await screen.findByLabelText('Fecha de inicio de clases');
  fireEvent.change(dateInput, { target: { value: date } });
  fireEvent.change(screen.getByLabelText('Nombre de quien la captura'), { target: { value: name } });
  fireEvent.click(captureSection().getByRole('button', { name: 'Guardar' }));
}

beforeAll(() => {
  // jsdom no implementa scrollIntoView: el foco de esta ventana lo usa.
  Element.prototype.scrollIntoView = vi.fn();
});

afterAll(() => {
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
});

describe('CycleStartDateCapture · ventana de captura', () => {
  it('aparece cuando el dictamen no pudo determinar la fecha y nadie la ha capturado', () => {
    stubFetch(null);
    render(
      <CycleStartDateCapture
        caseId="case-1"
        assessment={NO_DETERMINABLE}
        cycleStartDate={null}
        cycleStartDateByName={null}
        cycleStartDateAt={null}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Falta la fecha de inicio de clases' })).toBeTruthy();
    expect(screen.getByText(/no pudo acreditarla con la evidencia del expediente/i)).toBeTruthy();
    expect(screen.getByLabelText('Fecha de inicio de clases')).toBeTruthy();
    expect(screen.getByLabelText('Nombre de quien la captura')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ahora no' })).toBeTruthy();
  });

  it('no aparece si el dictamen ya acreditó la fecha', () => {
    stubFetch(null);
    const { container } = render(
      <CycleStartDateCapture
        caseId="case-1"
        assessment={{ cycleStartDate: '2026-01-12', relationToCycleStart: 'DESPUES_DEL_INICIO' }}
        cycleStartDate={null}
        cycleStartDateByName={null}
        cycleStartDateAt={null}
        onSaved={vi.fn()}
      />,
    );

    expect(container.textContent).toBe('');
  });

  it('no aparece si no hay dictamen emitido', () => {
    stubFetch(null);
    const { container } = render(
      <CycleStartDateCapture
        caseId="case-1"
        assessment={null}
        cycleStartDate={null}
        cycleStartDateByName={null}
        cycleStartDateAt={null}
        onSaved={vi.fn()}
      />,
    );

    expect(container.textContent).toBe('');
  });

  it('con fecha capturada muestra su procedencia y no la ventana de captura', () => {
    stubFetch(null);
    render(
      <CycleStartDateCapture
        caseId="case-1"
        assessment={NO_DETERMINABLE}
        cycleStartDate="2026-08-21"
        cycleStartDateByName="Ana Ruiz"
        cycleStartDateAt="2026-10-02T15:30:00.000Z"
        onSaved={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        `Fecha de inicio de clases: ${formatDate('2026-08-21')} · capturada por Ana Ruiz el ${formatDateTime('2026-10-02T15:30:00.000Z')}`,
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Falta la fecha de inicio de clases' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Corregir' })).toBeTruthy();
  });

  it('guardar hace UN PATCH y no dispara ninguna auditoría', async () => {
    const onSaved = vi.fn();
    const { requests } = stubFetch(null);
    render(
      <CycleStartDateCapture
        caseId="case-1"
        assessment={NO_DETERMINABLE}
        cycleStartDate={null}
        cycleStartDateByName={null}
        cycleStartDateAt={null}
        onSaved={onSaved}
      />,
    );

    await fillAndSave('2026-08-21', 'Ana Ruiz');

    expect(await screen.findByText(/guardada/i)).toBeTruthy();
    const patches = requests.filter((item) => item.method === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0]!.body).toContain('2026-08-21');
    expect(patches[0]!.body).toContain('Ana Ruiz');
    expect(requests.filter((item) => item.method === 'POST')).toHaveLength(0);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('bloquea el guardado si falta el nombre o la fecha', () => {
    const { requests } = stubFetch(null);
    render(
      <CycleStartDateCapture
        caseId="case-1"
        assessment={NO_DETERMINABLE}
        cycleStartDate={null}
        cycleStartDateByName={null}
        cycleStartDateAt={null}
        onSaved={vi.fn()}
      />,
    );

    const save = screen.getByRole('button', { name: 'Guardar' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Fecha de inicio de clases'), { target: { value: '2026-08-21' } });
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Nombre de quien la captura'), { target: { value: '   ' } });
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Nombre de quien la captura'), { target: { value: 'Ana Ruiz' } });
    expect(save.disabled).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it('corregir una fecha que el dictamen ya usó lo dice y advierte que consume cuota', async () => {
    const { requests } = stubFetch(null);
    render(
      <CycleStartDateCapture
        caseId="case-1"
        assessment={{ cycleStartDate: '2026-01-12', relationToCycleStart: 'DESPUES_DEL_INICIO' }}
        cycleStartDate="2026-01-12"
        cycleStartDateByName="Ana Ruiz"
        cycleStartDateAt="2026-10-02T15:30:00.000Z"
        onSaved={vi.fn()}
      />,
    );

    // Con la fecha coincidente, el dictamen vigente SÍ la usa: no hay aviso.
    expect(screen.queryByText(/consume cuota/i)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Corregir' }));
    await fillAndSave('2026-01-19', 'Ana Ruiz');

    expect(await screen.findByText('Corrección de la fecha guardada.')).toBeTruthy();
    expect(
      captureSection().getByText(/el dictamen vigente ya no usa esta fecha/i),
    ).toBeTruthy();
    expect(captureSection().getByText(/consume cuota/i)).toBeTruthy();
    expect(captureSection().getByRole('button', { name: 'Volver a auditar' })).toBeTruthy();
    expect(requests.filter((item) => item.method === 'POST')).toHaveLength(0);
  });
});

describe('CycleStartDateCapture · "Volver a auditar" enfoca el botón que ya existe', () => {
  it('el aviso lleva el foco al botón de auditar del expediente, sin auditar', async () => {
    const caseResponse = readyCase(completedAudit(verdictWithoutCycleStart()));
    const { requests } = stubFetch(caseResponse);

    render(<CaseDetailPage caseId="case-1" />);

    await fillAndSave('2026-08-21', 'Ana Ruiz');
    expect(await screen.findByText(/guardada/i)).toBeTruthy();

    await userEvent.click(captureSection().getByRole('button', { name: 'Volver a auditar' }));

    const auditButton = document.getElementById(AUDIT_TRIGGER_ID);
    expect(auditButton).not.toBeNull();
    expect(document.activeElement).toBe(auditButton);
    // Enfocar NO es auditar: la vía de auditoría sigue siendo la de siempre.
    expect(requests.filter((item) => item.method === 'POST' && item.url.endsWith('/audit'))).toHaveLength(0);
  });
});