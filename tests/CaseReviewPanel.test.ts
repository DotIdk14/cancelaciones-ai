// @vitest-environment jsdom

// =============================================================================
// Revisión humana + comparación con IA — panel de caso (frontend).
//
// Lo que estos tests fijan, y que es la parte fácil de romper sin darse cuenta:
//
//   1. El formulario del Asesor NO aparece si no hay dictamen emitido, NI si ya
//      hay revisión (la revisión es ÚNICA por caso). Tampoco lo ve quien no
//      puede registrarlo: el gating por rol es SOLO presentación.
//   2. El botón de enviar se DESHABILITA sin resolución elegida, o con notas por
//      encima del máximo del servidor (2000 caracteres recortados). El
//      comentario es opcional y la atribución la deriva el servidor de la sesión:
//      el cliente NUNCA envía `reviewerName`.
//   3. Un 409 dice que la revisión ya existe y NO ofrece reenviarla.
//   4. Un `comparison.status === 'RUNNING'` al montar retoma el polling contra
//      el servidor, y recargar NO duplica revisión ni comparación.
//   5. El reintento existe SÓLO desde ERROR, y su mensaje aclara que no vuelve
//      a pedir el cuestionario ni la revisión.
//   6. `agrees` (acierto medido) y `confidence` (confianza declarada por la IA
//      sobre SU comparación) se presentan como dos cosas distintas.
// =============================================================================

import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppRole, AuditDetail, CaseReviewDto, ComparisonDto, EffectiveResolution, WorkflowState } from '../src/lib/api';
import { CaseReviewPanel, CaseReviewRecord } from '../src/components/CaseReviewPanel';
import { RESULT_LABELS } from '../src/lib/labels';
import { validAuditResult } from './fixtures/audit-result';

// --- Fetch -------------------------------------------------------------------

/** Respuesta mínima con la superficie que consume `src/lib/api`. */
function fakeResponse(status: number, body: unknown): Response {
  return { status, json: async () => body } as unknown as Response;
}

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

function stubFetch(handler: (call: FetchCall) => Response): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string; body?: unknown }) => {
      const call: FetchCall = {
        url: String(input),
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      };
      calls.push(call);
      return handler(call);
    }),
  );
  return calls;
}

// --- Fixtures ----------------------------------------------------------------

const COMMENT = 'El contacto efectivo previo está acreditado en la evidencia.';

const COMPARISON_RESULT = {
  agrees: false,
  explanation: 'El dictamen original aplicó la baja sin evaluar el supuesto de solicitud previa.',
  confidence: 0.74,
  discrepancyReason: 'No se evaluó la solicitud previa al inicio de ciclo.',
  procedureSections: ['5.3', '5.8'],
  evidenceIds: ['ev-1'],
  model: { provider: 'openrouter' as const, model: 'google/gemini-2.5-flash-lite' },
  usage: { promptTokens: 800, completionTokens: 120, totalTokens: 920, estimatedCostUSD: 0.0003 },
};

function makeAudit(status: AuditDetail['status'] = 'COMPLETED'): AuditDetail {
  return {
    id: 'audit-1',
    caseId: 'case-1',
    status,
    provider: 'openrouter',
    model: 'google/gemini-2.5-flash',
    resultJson: status === 'COMPLETED' ? validAuditResult : null,
    errorCategory: null,
    latencyMs: 1200,
    evidenceFingerprint: null,
    attemptNumber: 1,
    deadlineAt: null,
    createdAt: '2026-02-01T10:10:00Z',
  };
}

function makeReview(overrides: Partial<CaseReviewDto> = {}): CaseReviewDto {
  return {
    id: 'review-1',
    caseId: 'case-1',
    auditId: 'audit-1',
    // Valor LEGACY a propósito: antes de reducir el vocabulario humano a 6
    // opciones, una persona podía resolver con DICTAMINACION. El frontend debe
    // seguir mostrando esas revisiones antiguas (isKnownHuman es superset).
    result: 'DICTAMINACION',
    reviewerName: 'Revisora de pruebas',
    comment: COMMENT,
    createdAt: '2026-02-03T09:00:00Z',
    ...overrides,
  };
}

function makeComparison(overrides: Partial<ComparisonDto> = {}): ComparisonDto {
  return {
    id: 'cmp-1',
    caseReviewId: 'review-1',
    auditId: 'audit-1',
    status: 'COMPLETED',
    resultJson: COMPARISON_RESULT,
    provider: 'openrouter',
    model: 'google/gemini-2.5-flash-lite',
    errorCategory: null,
    latencyMs: 2100,
    deadlineAt: null,
    createdAt: '2026-02-03T09:00:05Z',
    updatedAt: '2026-02-03T09:00:07Z',
    ...overrides,
  };
}

function makeEffective(result: string, source: EffectiveResolution['source']): EffectiveResolution {
  return { result, source };
}

const noop = (): void => undefined;

// --- Helpers de render -------------------------------------------------------

function renderPanel(overrides: {
  audit?: AuditDetail | null;
  review?: CaseReviewDto | null;
  role?: AppRole | null;
  workflowState?: WorkflowState;
  onSubmitted?: () => void;
} = {}): HTMLElement {
  const view = render(
    createElement(CaseReviewPanel, {
      caseId: 'case-1',
      audit: overrides.audit === undefined ? makeAudit() : overrides.audit,
      review: overrides.review === undefined ? null : overrides.review,
      // El formulario de Asesor sólo existe para el rol que puede registrarlo.
      role: overrides.role === undefined ? 'user' : overrides.role,
      workflowState: overrides.workflowState,
      onSubmitted: overrides.onSubmitted ?? noop,
    }),
  );
  return view.container;
}

function renderForm(onSubmitted: () => void = noop): HTMLFormElement {
  const container = renderPanel({ onSubmitted });
  const form = container.querySelector('form');
  if (form === null) throw new Error('el formulario de revisión no se montó');
  return form;
}

function renderRecord(comparison: ComparisonDto | null): HTMLElement {
  const view = render(
    createElement(CaseReviewRecord, {
      caseId: 'case-1',
      review: makeReview(),
      comparison,
      effectiveResolution: makeEffective('DICTAMINACION', 'HUMAN'),
      reviewAuditResult: validAuditResult.audit.result,
    }),
  );
  return view.container;
}

function commentBox(): HTMLTextAreaElement {
  return screen.getByLabelText(/notas de la revisión/i) as HTMLTextAreaElement;
}

function chooseReview(resultLabel = 'Baja'): void {
  // El comentario es opcional y la atribución la pone el servidor: para habilitar
  // el envío basta con elegir una resolución.
  fireEvent.click(screen.getByRole('radio', { name: resultLabel }));
}

function submitButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /registrar la revisión/i }) as HTMLButtonElement;
}

function retryButton(): HTMLElement | null {
  return screen.queryByRole('button', { name: /reintentar la comparación/i });
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// =============================================================================
describe('CaseReviewPanel — cuándo existe', () => {
  it('no aparece sin auditoría completada (ausente, RUNNING o ERROR)', () => {
    for (const audit of [null, makeAudit('RUNNING'), makeAudit('ERROR')]) {
      const container = renderPanel({ audit });
      expect(container.firstChild).toBeNull();
      expect(screen.queryByRole('group')).toBeNull();
      cleanup();
    }
  });

  it('con revisión ya registrada no ofrece el formulario del Asesor: es única por caso', () => {
    const container = renderPanel({ review: makeReview() });

    // La revisión registrada sí se muestra (es la resolución del Asesor)...
    expect(screen.getByRole('heading', { name: /revisión humana/i })).toBeTruthy();
    // ...pero el formulario del Asesor NO: su decisión es única e inmutable.
    expect(container.querySelector('form')).toBeNull();
    expect(screen.queryByRole('button', { name: /registrar la revisión/i })).toBeNull();
  });

  it('aparece al terminar la auditoría, sin romper el orden de hooks', () => {
    // Una auditoría que pasa de RUNNING a COMPLETED hace que ESTA instancia pase
    // de "no existe" a "existe". Si algún hook estuviera detrás del `return null`,
    // ese remount declararía menos hooks y React abortaría la pantalla justo
    // cuando el usuario acaba de recibir su dictamen.
    const view = render(
      createElement(CaseReviewPanel, { caseId: 'case-1', audit: makeAudit('RUNNING'), review: null, role: 'user', onSubmitted: noop }),
    );
    expect(view.container.firstChild).toBeNull();

    view.rerender(
      createElement(CaseReviewPanel, { caseId: 'case-1', audit: makeAudit('COMPLETED'), review: null, role: 'user', onSubmitted: noop }),
    );

    expect(view.container.querySelector('form')).not.toBeNull();
    // El vocabulario humano tiene 6 opciones: ni matrícula ni dictaminación.
    expect(within(view.container).getAllByRole('radio')).toHaveLength(6);
  });
});

// =============================================================================
describe('CaseReviewPanel — gating por rol (solo presentación)', () => {
  it('el Asesor ve su formulario cuando la etapa está pendiente', () => {
    renderPanel({ role: 'user' });

    expect(screen.getByRole('button', { name: /registrar la revisión/i })).toBeTruthy();
  });

  it('el Asesor NO puede registrar la etapa del Coordinador', () => {
    // Hay revisión de Asesor y falta la decisión final: es la etapa del Coordinador.
    renderPanel({ role: 'user', review: makeReview() });

    expect(screen.queryByRole('button', { name: /finalizar el caso/i })).toBeNull();
    expect(screen.queryByRole('group', { name: /decisión final/i })).toBeNull();
    // Se le deja constancia de que su etapa ya quedó registrada e inmutable.
    expect(screen.getByText(/pendiente de la decisión del coordinador/i)).toBeTruthy();
  });

  it('el Coordinador NO puede registrar la etapa del Asesor', () => {
    // Sin revisión de Asesor todavía no hay nada que finalizar.
    renderPanel({ role: 'coordinator', review: null });

    expect(screen.queryByRole('button', { name: /registrar la revisión/i })).toBeNull();
    expect(screen.getByText(/la etapa de asesor la registra el asesor/i)).toBeTruthy();
  });

  it('el Coordinador sí finaliza cuando la etapa está PENDING_COORDINATOR', () => {
    renderPanel({ role: 'coordinator', review: makeReview(), workflowState: 'PENDING_COORDINATOR' });

    expect(screen.getByRole('button', { name: /finalizar el caso/i })).toBeTruthy();
  });

  it('el Gerente no ve ningún control de mutación, ni del Asesor ni del Coordinador', () => {
    // Etapa pendiente de Asesor: sin formulario de Asesor.
    renderPanel({ role: 'manager', review: null });
    expect(screen.queryByRole('button', { name: /registrar la revisión/i })).toBeNull();
    expect(screen.getByText(/solo lectura/i)).toBeTruthy();
    cleanup();

    // Etapa pendiente de Coordinador: sin formulario de Coordinador.
    renderPanel({ role: 'manager', review: makeReview() });
    expect(screen.queryByRole('button', { name: /finalizar el caso/i })).toBeNull();
    expect(screen.getByText(/solo lectura/i)).toBeTruthy();
  });

  it('con la decisión final registrada nadie ve un formulario: sólo el registro', () => {
    renderPanel({ role: 'coordinator', review: makeReview({ coordinatorDecision: 'APPROVE' }) });

    expect(screen.queryByRole('button', { name: /finalizar el caso/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /registrar la revisión/i })).toBeNull();
    expect(screen.getByText(/decisión del coordinador/i)).toBeTruthy();
  });
});

// =============================================================================
describe('CaseReviewPanel — decisión y datos de la revisión', () => {
  it('permite registrar conformidad con IA sin cambiar el resultado', () => {
    renderForm();

    fireEvent.click(screen.getByRole('button', { name: /estoy de acuerdo con la ia/i }));

    const aiResult = validAuditResult.audit.result;
    expect((screen.getByRole('radio', { name: RESULT_LABELS[aiResult] }) as HTMLInputElement).checked).toBe(true);
  });

  it('requiere elegir una resolución, pero permite dejar las notas vacías', () => {
    renderForm();

    // Sin resolución no hay envío posible...
    expect(submitButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /^baja$/i }));
    // ...y con resolución, el comentario vacío es válido: es opcional.
    expect(submitButton().disabled).toBe(false);
    expect(commentBox().value).toBe('');
  });

  it('permite notas de hasta 2000 caracteres y bloquea las que exceden el límite', () => {
    const form = renderForm();
    chooseReview();
    const box = commentBox();

    expect(submitButton().disabled).toBe(false);

    fireEvent.change(box, { target: { value: 'x'.repeat(2001) } });
    expect(box.value).toHaveLength(2001);
    expect(submitButton().disabled).toBe(true);

    fireEvent.change(box, { target: { value: 'x'.repeat(2000) } });
    expect(submitButton().disabled).toBe(false);

    expect(form).toBeTruthy();
  });

  it('el botón sigue deshabilitado si no se eligió resolución', () => {
    renderForm();

    expect(submitButton().disabled).toBe(true);
  });

  it('muestra los límites y el contador de caracteres', () => {
    renderForm();
    fireEvent.change(commentBox(), { target: { value: '12345' } });

    expect(screen.getByText('5 / 2000')).toBeTruthy();
    expect(screen.getByText(/hasta 2000 caracteres/i)).toBeTruthy();
  });

  it('el selector es un fieldset con radios, no un desplegable', () => {
    renderForm();

    const group = screen.getByRole('group', { name: /resolución final/i });
    // Una opción por cada resultado del vocabulario cerrado que expone el servidor
    // (6, no los 8 del Skill: la persona no elige matrícula ni dictaminación).
    expect(within(group).getAllByRole('radio')).toHaveLength(6);
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});

// =============================================================================
describe('CaseReviewPanel — envío válido', () => {
  it('llama al endpoint con { result, comment } y muestra el estado de comparación', async () => {
    const calls = stubFetch(() =>
      fakeResponse(201, {
        review: makeReview(),
        comparison: makeComparison({ status: 'RUNNING', resultJson: null }),
      }),
    );
    const form = renderForm();

    chooseReview();
    fireEvent.change(commentBox(), { target: { value: `  ${COMMENT}  ` } });
    fireEvent.submit(form);
    await settle();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/cases/case-1/review');
    expect(calls[0]?.method).toBe('POST');
    // Los datos viajan recortados: es exactamente lo que valida el servidor.
    expect(calls[0]?.body).toEqual({
      result: 'BAJA',
      comment: COMMENT,
    });
    // El cliente NUNCA envía la atribución: el servidor la deriva de la sesión y
    // rechazaría un `reviewerName` (schema estricto).
    expect(calls[0]?.body).not.toHaveProperty('reviewerName');

    expect(await screen.findByText(/comparando/i)).toBeTruthy();
  });

  it('muestra la conclusión y separa el acierto medido de la confianza declarada', async () => {
    stubFetch(() =>
      fakeResponse(201, {
        review: makeReview(),
        comparison: makeComparison(),
        effectiveResolution: makeEffective('BAJA', 'HUMAN'),
      }),
    );
    const form = renderForm();

    chooseReview();
    fireEvent.change(commentBox(), { target: { value: COMMENT } });
    fireEvent.submit(form);
    await settle();

    expect(await screen.findByText(COMPARISON_RESULT.discrepancyReason)).toBeTruthy();
    // `agrees` es el acierto medido...
    expect(screen.getByText(/no coincide con la resolución humana/i)).toBeTruthy();
    // ...y `confidence` es la confianza que la IA declara sobre SU comparación.
    // No puede presentarse como porcentaje de acierto.
    expect(screen.getByText(/confianza declarada por la IA en su comparación/i)).toBeTruthy();
    expect(screen.queryByText(/porcentaje de acierto/i)).toBeNull();
  });
});

// =============================================================================
describe('CaseReviewPanel — errores', () => {
  it('un 400 muestra el mensaje del servidor y deja reintentar el envío', async () => {
    stubFetch(() =>
      fakeResponse(400, {
        error: { category: 'VALIDATION_ERROR', message: 'Revisión humana inválida — comment: demasiado corto' },
      }),
    );
    const form = renderForm();

    chooseReview();
    fireEvent.change(commentBox(), { target: { value: COMMENT } });
    fireEvent.submit(form);
    await settle();

    expect(await screen.findByText(/Revisión humana inválida — comment: demasiado corto/)).toBeTruthy();
    // Un 400 no es un conflicto de estado: el formulario sigue ahí.
    expect(submitButton()).toBeTruthy();
  });

  it('un 409 avisa que la revisión ya existe y NO ofrece reenviarla', async () => {
    const onSubmitted = vi.fn();
    stubFetch(() =>
      fakeResponse(409, {
        error: { category: 'VALIDATION_ERROR', message: 'El caso ya tiene una revisión registrada' },
      }),
    );
    const container = renderPanel({ onSubmitted });

    chooseReview();
    fireEvent.change(commentBox(), { target: { value: COMMENT } });
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    await settle();

    expect(await screen.findByText(/ya tiene una revisión registrada/i)).toBeTruthy();
    // Sin formulario y sin botón de envío: la revisión es única por caso.
    expect(screen.queryByRole('button', { name: /registrar la revisión/i })).toBeNull();
    expect(container.querySelector('form')).toBeNull();
    // La única salida es leer la revisión durable, no mandarla otra vez.
    expect(screen.getByRole('button', { name: /ver la revisión registrada/i })).toBeTruthy();
  });

  it('deshabilita el formulario y marca aria-busy mientras se envía', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await gate;
        return fakeResponse(201, {
          review: makeReview(),
          comparison: makeComparison({ status: 'RUNNING', resultJson: null }),
        });
      }),
    );
    const form = renderForm();

    chooseReview();
    fireEvent.change(commentBox(), { target: { value: COMMENT } });
    fireEvent.submit(form);
    await settle();

    expect(submitButton().disabled).toBe(true);
    expect(commentBox().disabled).toBe(true);
    expect(submitButton().getAttribute('aria-busy')).toBe('true');

    await act(async () => {
      release?.();
      await gate;
    });
  });
});

// =============================================================================
describe('CaseReviewRecord — la revisión registrada y su comparación', () => {
  it('muestra la resolución humana prioritaria y conserva el resultado de IA separado', () => {
    renderRecord(null);

    expect(screen.getByRole('heading', { name: /revisión humana/i })).toBeTruthy();
    expect(screen.getAllByText('Dictaminación')).toHaveLength(2);
    expect(screen.getByText('Cancelación de venta')).toBeTruthy();
    expect(screen.getByText('Revisora de pruebas')).toBeTruthy();
    expect(screen.getByText('No coincide')).toBeTruthy();
    expect(screen.getByText(COMMENT)).toBeTruthy();
    // El dictamen de la auditoría vive en su propio panel: aquí se aclara que no se
    // sobrescribe y se cita a qué auditoría se compara.
    expect(screen.getByText(/no modifica el dictamen original/i)).toBeTruthy();
  });

  it('un RUNNING al montar retoma el polling y no duplica nada', async () => {
    vi.useFakeTimers();
    const calls = stubFetch(() =>
      fakeResponse(200, {
        review: makeReview(),
        comparison: makeComparison(),
        effectiveResolution: makeEffective('DICTAMINACION', 'HUMAN'),
      }),
    );
    renderRecord(makeComparison({ status: 'RUNNING', resultJson: null }));

    expect(screen.getByText(/comparando/i)).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });

    expect(calls.length).toBeGreaterThan(0);
    // Sólo lectura: recargar la página NO crea una segunda revisión ni comparación.
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
    expect(calls.some((call) => call.url === '/api/cases/case-1/review')).toBe(true);
    // El tick resuelve la comparación y la conclusión aparece sin recargar.
    expect(screen.getByText(/no coincide con la resolución humana/i)).toBeTruthy();
  });

  it('el botón de reintento aparece sólo en ERROR, con su aclaración', () => {
    renderRecord(makeComparison({ status: 'RUNNING', resultJson: null }));
    expect(retryButton()).toBeNull();
    cleanup();

    renderRecord(makeComparison());
    expect(retryButton()).toBeNull();
    cleanup();

    renderRecord(makeComparison({ status: 'ERROR', resultJson: null, errorCategory: 'RATE_LIMIT' }));
    expect(retryButton()).toBeTruthy();
    // Y aclara que no vuelve a pedir el cuestionario ni la revisión.
    expect(screen.getByText(/no vuelve a pedir/i)).toBeTruthy();
    expect(screen.getByText(/no crea una segunda revisión/i)).toBeTruthy();
  });

  it('el reintento llama a POST /comparison y nunca a POST /review', async () => {
    const calls = stubFetch(() => fakeResponse(200, { comparison: makeComparison() }));
    renderRecord(makeComparison({ status: 'ERROR', resultJson: null, errorCategory: 'RATE_LIMIT' }));

    await act(async () => {
      fireEvent.click(retryButton() as HTMLElement);
      await Promise.resolve();
    });
    await settle();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/cases/case-1/comparison');
    expect(calls[0]?.method).toBe('POST');
    expect(await screen.findByText(/no coincide con la resolución humana/i)).toBeTruthy();
  });

  it('con agrees === true informa coincidencia y no inventa discrepancia', () => {
    renderRecord(makeComparison({ resultJson: { ...COMPARISON_RESULT, agrees: true, discrepancyReason: null } }));

    expect(screen.getByText(/coincide con la resolución humana/i)).toBeTruthy();
    expect(screen.getByText(COMPARISON_RESULT.explanation)).toBeTruthy();
  });

  it('el estado de la comparación se anuncia en una región aria-live', () => {
    const container = renderRecord(makeComparison({ status: 'RUNNING', resultJson: null }));

    const live = container.querySelector('[aria-live]');
    expect(live).not.toBeNull();
    expect(live?.textContent ?? '').toMatch(/comparando/i);
  });

  it('deriva la resolución vigente de la propia revisión humana cuando el servidor no la envía', () => {
    render(
      createElement(CaseReviewRecord, {
        caseId: 'case-1',
        review: makeReview(),
        comparison: null,
      }),
    );

    const row = screen.getByText(/resolución vigente/i).closest('div');
    expect(row?.textContent).toContain('Dictaminación');
    expect(row?.textContent).toContain('Humano');
    expect(row?.textContent).not.toContain('—');
  });

  it('deja de consultar y avisa cuando la comparación se agota, ofreciendo reintento', async () => {
    vi.useFakeTimers();
    const calls = stubFetch((call) => {
      if (call.url === '/api/cases/case-1/comparison' && call.method === 'POST') {
        return fakeResponse(200, { comparison: makeComparison() });
      }
      return fakeResponse(200, {
        review: makeReview(),
        comparison: makeComparison({ status: 'RUNNING', resultJson: null }),
      });
    });
    renderRecord(makeComparison({ status: 'RUNNING', resultJson: null }));

    expect(screen.getByText(/comparando/i)).toBeTruthy();

    // MAX_RUNNING_POLLS consultas + un tick más para disparar el mensaje de agotamiento.
    for (let i = 0; i < 92; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });
    }

    expect(screen.getByText(/tardando demasiado/i)).toBeTruthy();
    expect(screen.queryByText(/comparando/i)).toBeNull();
    expect(screen.getByRole('button', { name: /reintentar la comparación/i })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /reintentar la comparación/i }));
      await Promise.resolve();
    });
    await settle();

    expect(calls.some((call) => call.url === '/api/cases/case-1/comparison' && call.method === 'POST')).toBe(true);
    expect(screen.getByText(/no coincide con la resolución humana/i)).toBeTruthy();
  });
});
