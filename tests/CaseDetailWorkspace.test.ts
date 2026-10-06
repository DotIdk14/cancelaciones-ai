// @vitest-environment jsdom

// =============================================================================
// Espacio de trabajo del caso: buscador y cronología.
//
// Lo que estos tests fijan:
//
//   1. El buscador FILTRA de verdad. Antes era un `label` decorativo sin input,
//      así que el caso se podía abrir y "Buscar en el expediente" no hacía nada.
//      Ahora filtra la pestaña activa sobre lo ya cargado y avisa cuántas
//      coincidencias hay y dónde.
//
//   2. La cronología separa lo que NO es lo mismo: los hechos del cliente, que
//      extrae el modelo de la evidencia, y los clics de la plataforma. Las
//      subidas de evidencia son una entrada única y colapsada, no un evento por
//      archivo: una cronología del caso no es un inventario de cargas.
//
//   3. Un caso sin auditoría NO muestra "Sin eventos adicionales" al lado de
//      "Expediente creado". Ese texto era inalcanzable por construcción y
//      además era falso: el expediente siempre tiene al menos un evento.
// =============================================================================

import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaseDetailResponse, Evidence } from '../src/lib/api';
import { CaseDetailPage } from '../src/components/CaseDetailPage';
import { EvidenceList } from '../src/components/EvidenceList';

const getCase = vi.fn();

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api')>();
  return {
    ...actual,
    getCase: (...args: unknown[]) => getCase(...args),
    deleteEvidence: vi.fn(),
    getAudit: vi.fn(),
    startAudit: vi.fn(),
  };
});

// --------------------------------------------------------------------- fixtures

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'ev-1',
    caseId: 'case-1',
    filename: 'captura.png',
    mimeType: 'image/png',
    sizeBytes: 1024,
    hash: 'abcdef0123456789',
    storagePath: 'cases/case-1/captura.png',
    processingStatus: 'READY',
    processingError: null,
    transcript: null,
    createdAt: '2026-02-02T10:00:00Z',
    ...overrides,
  };
}

function makeDetail(overrides: Partial<CaseDetailResponse> = {}): CaseDetailResponse {
  return {
    case: {
      id: 'case-1',
      status: 'COMPLETED',
      studentIdentifier: 'UTEL-2026-001',
      createdAt: '2026-02-01T09:00:00Z',
      updatedAt: '2026-02-03T09:00:00Z',
    },
    evidences: [],
    audit: null,
    audits: [],
    review: null,
    comparison: null,
    effectiveResolution: null,
    ...overrides,
  } as CaseDetailResponse;
}

/** Dictamen mínimo: sólo los campos que la vista de detalle lee. */
function makeResult() {
  return {
    // `AuditResultPanel` lee `usage` sin defensivas; sin esto el panel revienta.
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, estimatedCostUSD: 0.01 },
    model: 'google/gemini-2.5-flash',
    case: { matricula: 'UTEL-2026-001', studentName: 'Alumna Prueba', program: 'Licenciatura', cycle: '2026-1', cycleStartDate: '2026-01-05' },
    conflicts: [],
    temporalAnalysis: null,
    facts: [
      {
        key: 'matricula',
        label: 'Apertura de matrícula',
        value: '2026-01-15',
        confidence: 0.9,
        evidenceIds: ['ev-1'],
        evidenceText: 'La alumna inició su programa en enero.',
      },
    ],
    audit: {
      result: 'CANCELACION_VENTA',
      procedureSection: '5.7',
      confidence: 0.82,
      reasoning: 'La alumna pidió cancelar dentro del primer mes.',
      procedureChecks: [
        {
          procedureSection: '5.7',
          criterion: 'Solicitud dentro del primer mes',
          status: 'ACREDITADO',
          reasoning: 'El audio es del 20 de enero.',
        },
      ],
    },
    timeline: [
      { date: '2026-01-15', event: 'Apertura de matrícula', evidenceIds: ['ev-1'] },
      { date: '2026-02-02', event: 'Solicitud de cancelación de venta', evidenceIds: ['ev-1'] },
    ],
  };
}

function makeDetailWithAudit(): CaseDetailResponse {
  return makeDetail({
    evidences: [
      makeEvidence({ id: 'ev-1', filename: 'captura.png', createdAt: '2026-02-02T10:00:00Z' }),
      makeEvidence({ id: 'ev-2', filename: 'audio-asesor.m4a', createdAt: '2026-02-02T10:05:00Z' }),
    ],
    audit: {
      id: 'aud-1',
      status: 'COMPLETED',
      resultJson: makeResult(),
      provider: 'google',
      model: 'gemini-2.5-flash',
      createdAt: '2026-02-03T09:00:00Z',
    },
  } as Partial<CaseDetailResponse>);
}

async function renderDetail(detail: CaseDetailResponse): Promise<void> {
  getCase.mockResolvedValue(detail);
  render(createElement(CaseDetailPage, { caseId: 'case-1' }));
  await waitFor(() => {
    expect(screen.queryByText('Cargando caso')).toBeNull();
  });
}

async function openTab(name: RegExp): Promise<void> {
  fireEvent.click(screen.getByRole('tab', { name }));
}

beforeEach(() => {
  getCase.mockReset();
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ----------------------------------------------------------------------- tests

describe('EvidenceList — acciones en su propia fila', () => {
  it('deja los tres controles juntos y separados de los datos del archivo', () => {
    const evidence = makeEvidence({ filename: 'un-archivo-con-nombre-muy-largo.png' });
    const { container } = render(
      createElement(EvidenceList, { evidences: [evidence], onPreview: vi.fn(), onDelete: vi.fn() }),
    );

    const row = container.querySelector('li');
    expect(row).not.toBeNull();

    const view = screen.getByRole('button', { name: /^Ver/ });
    const download = screen.getByRole('link', { name: /^Descargar/ });
    const remove = screen.getByRole('button', { name: /^Eliminar/ });

    // Las tres acciones comparten contenedor: es la fila propia de botones.
    expect(view.parentElement).toBe(download.parentElement);
    expect(download.parentElement).toBe(remove.parentElement);

    // Y ese contenedor no es el bloque de datos. Si compartieran padre, los
    // botones volverían a competir por el ancho de la columna angosta.
    const name = screen.getByTitle(evidence.filename);
    expect(name.parentElement).not.toBe(view.parentElement);
    expect(view.parentElement?.parentElement).toBe(row);
  });

  it('mantiene los controles accesibles por nombre, no sólo por posición', () => {
    const evidence = makeEvidence({ filename: 'captura.png' });
    render(createElement(EvidenceList, { evidences: [evidence], onPreview: vi.fn(), onDelete: vi.fn() }));

    // El nombre legible del archivo va en `sr-only`: sin él, tres botones
    // "Ver" en la misma vista no dicen a qué evidencia se refieren.
    expect(screen.getByRole('button', { name: 'Ver captura.png' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Descargar captura.png' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Eliminar captura.png' })).toBeTruthy();
  });
});

describe('Buscador del expediente', () => {
  it('existe un campo de búsqueda real, no un rótulo decorativo', async () => {
    await renderDetail(makeDetailWithAudit());

    const input = screen.getByRole('searchbox', { name: 'Buscar en el expediente' });
    expect(input).toBeTruthy();
    // El texto que anunciaba el rótulo viejo ahora es el placeholder, o sea
    // que el control existe y se puede escribir en él.
    expect(input.getAttribute('placeholder')).toBe('Buscar en el expediente');
  });

  it('filtra los hechos de la pestaña activa y dice cuántas coincidencias hay', async () => {
    await renderDetail(makeDetailWithAudit());
    await openTab(/Hechos y checks/);

    expect(screen.getByText('Apertura de matrícula')).toBeTruthy();
    expect(screen.getByText('Solicitud dentro del primer mes')).toBeTruthy();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar en el expediente' }), {
      target: { value: 'primer mes' },
    });

    await waitFor(() => {
      expect(screen.getByText(/coincidencias en Hechos y checks/)).toBeTruthy();
    });
    // El check coincide; el hecho queda fuera.
    expect(screen.getByText('Solicitud dentro del primer mes')).toBeTruthy();
    expect(screen.queryByText('Apertura de matrícula')).toBeNull();
  });

  it('avisa cuando no hay coincidencias y no filtra el dictamen completo', async () => {
    await renderDetail(makeDetailWithAudit());
    await openTab(/Cronología/);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar en el expediente' }), {
      target: { value: 'zzz-no-existe-zzz' },
    });

    await waitFor(() => {
      expect(screen.getByText(/Sin coincidencias para/)).toBeTruthy();
    });

    // En el dictamen la búsqueda no aplica, y se dice en vez de fingir un filtro.
    await openTab(/Dictamen/);
    expect(screen.getByText(/no filtra el dictamen completo/)).toBeTruthy();
  });

  it('ofrece saltar a la pestaña que sí tiene coincidencias', async () => {
    await renderDetail(makeDetailWithAudit());

    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar en el expediente' }), {
      target: { value: 'Solicitud de cancelación' },
    });

    const jump = await screen.findByRole('button', { name: 'Cronología' });
    fireEvent.click(jump);

    expect(screen.getByRole('tab', { name: /Cronología/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('se limpia con el botón y con la tecla Escape', async () => {
    await renderDetail(makeDetailWithAudit());
    const input = screen.getByRole('searchbox', { name: 'Buscar en el expediente' }) as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'matrícula' } });
    await waitFor(() => {
      expect(input.value).toBe('matrícula');
    });

    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => {
      expect(input.value).toBe('');
    });

    fireEvent.change(input, { target: { value: 'otra' } });
    await waitFor(() => {
      expect(input.value).toBe('otra');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar la búsqueda' }));
    await waitFor(() => {
      expect(input.value).toBe('');
    });
  });
});

describe('Cronología del caso', () => {
  it('separa la cronología del cliente de los eventos de la plataforma', async () => {
    await renderDetail(makeDetailWithAudit());
    await openTab(/Cronología/);

    expect(screen.getByText('Cronología del cliente')).toBeTruthy();
    expect(screen.getByText('Eventos de la plataforma')).toBeTruthy();

    // Los hechos del cliente están en su bloque...
    const clientSection = screen.getByText('Cronología del cliente').closest('section') as HTMLElement;
    expect(within(clientSection).getByText('Apertura de matrícula')).toBeTruthy();
    expect(within(clientSection).getByText('Solicitud de cancelación de venta')).toBeTruthy();
    // ...y los clics de la plataforma en el suyo, no mezclados.
    expect(within(clientSection).queryByText('Expediente creado')).toBeNull();
  });

  it('agrupa las subidas en una entrada colapsada en vez de una por archivo', async () => {
    await renderDetail(makeDetailWithAudit());
    await openTab(/Cronología/);

    expect(screen.getByText('Se subieron 2 evidencias')).toBeTruthy();
    // La entrada vieja, una por evidencia, ya no existe.
    expect(screen.queryByText('Evidencia adjuntada')).toBeNull();

    // Los nombres quedan detrás de un `<details>`: presentes pero no de frente.
    const disclosure = screen.getByText('Ver 2 archivos').closest('details') as HTMLDetailsElement;
    expect(disclosure.open).toBe(false);
    expect(within(disclosure).getByText('captura.png')).toBeTruthy();
    expect(within(disclosure).getByText('audio-asesor.m4a')).toBeTruthy();
  });

  it('explica por qué la cronología del cliente está vacía sin dictamen', async () => {
    await renderDetail(makeDetail());
    await openTab(/Cronología/);

    // No hay auditoría: no se inventan fechas de matrícula ni de cancelación.
    expect(screen.getByText(/La extrae la auditoría de la evidencia/)).toBeTruthy();
    // Y el expediente sí tiene su propio evento, que no es cronología del cliente.
    expect(screen.getByText('Expediente creado')).toBeTruthy();
    expect(screen.queryByText('Sin eventos adicionales')).toBeNull();
  });

  it('el contador de la pestaña cuenta lo que se muestra', async () => {
    await renderDetail(makeDetailWithAudit());
    const timelineTab = screen.getByRole('tab', { name: /Cronología/ });
    // 2 eventos del cliente + expediente creado + la subida agrupada. Las dos
    // evidencias siguen siendo 1 evento, y el histórico de auditoría va aparte.
    expect(within(timelineTab).getByText('4')).toBeTruthy();
  });
});