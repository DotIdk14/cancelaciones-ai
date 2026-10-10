// @vitest-environment jsdom

// =============================================================================
// Listado de casos: resolución efectiva y su origen.
//
// Lo que estos tests fijan:
//   1. Un caso con revisión muestra el distintivo `Humano`; uno sin ella, `IA`.
//   2. El distintivo es la MISMA señal para las dos fuentes, y acompaña siempre al
//      resultado, porque una resolución sin origen no es auditable.
//   3. Un caso sin resolución efectiva se ve EXACTAMENTE como antes: no se
//      inventa un distintivo ni un resultado que el servidor no envió.
// =============================================================================

import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CaseSummary } from '../src/lib/api';
import { CasesPanel } from '../src/components/CasesPanel';

function fakeResponse(status: number, body: unknown): Response {
  return { status, json: async () => body } as unknown as Response;
}

function makeCase(overrides: Partial<CaseSummary> = {}): CaseSummary {
  return {
    id: 'case-1',
    status: 'COMPLETED',
    studentIdentifier: 'UTEL-2026-001',
    evidenceCount: 2,
    createdAt: '2026-02-01T10:00:00Z',
    updatedAt: '2026-02-03T09:00:00Z',
    ...overrides,
  };
}

async function renderList(cases: CaseSummary[], canReadAllCases = false): Promise<void> {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    if (init?.method === 'PATCH') return fakeResponse(200, { case: {} });
    if (init?.method === 'DELETE') return fakeResponse(200, { deleted: true });
    const status = url.searchParams.get('status');
    const creatorRole = url.searchParams.get('creatorRole');
    const creatorId = url.searchParams.get('creatorId');
    const filtered = cases.filter((item) => (!status || item.status === status)
      && (!creatorRole || item.creatorRole === creatorRole)
      && (!creatorId || item.creatorId === creatorId));
    const scoped = creatorRole || creatorId ? filtered : cases;
    const statusCounts = {
      ALL: scoped.length,
      READY: scoped.filter((item) => item.status === 'READY').length,
      AUDITING: scoped.filter((item) => item.status === 'AUDITING').length,
      COMPLETED: scoped.filter((item) => item.status === 'COMPLETED').length,
      DRAFT: scoped.filter((item) => item.status === 'DRAFT').length,
      ERROR: scoped.filter((item) => item.status === 'ERROR').length,
    };
    const creatorOptions = [...new Map(cases.flatMap((item) => item.creatorId && item.creatorRole
      ? [[item.creatorId, {
        creatorId: item.creatorId,
        role: item.creatorRole,
        name: item.studentIdentifier === 'AGENTE-UNO' ? 'Ana Pérez' : item.studentIdentifier === 'AGENTE-DOS' ? 'Luis Gómez' : 'Mariana Ruiz',
      }]]
      : [])).values()];
    return fakeResponse(200, { cases: filtered, nextCursor: null, statusCounts, creatorOptions });
  }));
  const view = render(createElement(CasesPanel, { canReadAllCases }));
  // Espera a que la lista llegue del servidor.
  await vi.waitFor(() => {
    if (cases.length > 0) expect(view.container.querySelector('tbody tr')).not.toBeNull();
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('CasesPanel — resolución efectiva', () => {
  it('muestra Humano para el caso revisado y IA para el que sólo tiene dictamen', async () => {
    await renderList([
      makeCase({ id: 'case-human', effectiveResolution: { result: 'DICTAMINACION', source: 'HUMAN' } }),
      makeCase({ id: 'case-ai', effectiveResolution: { result: 'CANCELACION_VENTA', source: 'AI' } }),
    ]);

    expect(screen.getAllByText('Humano').length).toBeGreaterThan(0);
    expect(screen.getAllByText('IA').length).toBeGreaterThan(0);
    // El resultado viaja con su origen: "Dictaminación" sin más sería ambiguo.
    expect(screen.getAllByText('Dictaminación').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Cancelación de venta').length).toBeGreaterThan(0);
  });

  it('abre el expediente para continuar la revisión', async () => {
    await renderList([makeCase({ id: 'case-human', effectiveResolution: { result: 'BAJA', source: 'HUMAN' } })]);

    const link = screen.getByRole('link', { name: /abrir expediente/i });
    expect(link.getAttribute('href')).toBe('#/casos/case-human');
  });

  it('un caso sin revisión se ve exactamente como antes: sin distintivo de origen', async () => {
    await renderList([makeCase({ id: 'case-plain' })]);

    expect(screen.queryByText('Humano')).toBeNull();
    expect(screen.queryByText('IA')).toBeNull();
    const row = screen.getByRole('row', { name: /UTEL-2026-001/ });
    expect(row.textContent).toContain('UTEL-2026-001');
    expect(row.textContent).toContain('2');
    expect(screen.getAllByText('Completado').length).toBeGreaterThan(0);
  });

  it('no inventa resolución cuando el servidor no envía ninguna', async () => {
    await renderList([makeCase({ id: 'case-null', effectiveResolution: null })]);

    expect(screen.queryByText('Humano')).toBeNull();
    expect(screen.queryByText('IA')).toBeNull();
    expect(screen.getAllByText('Sin dictamen').length).toBeGreaterThan(0);
  });

  it('filtra por identificador y conserva el conteo visible', async () => {
    await renderList([
      makeCase({ id: 'case-one', studentIdentifier: 'UTEL-2026-001' }),
      makeCase({ id: 'case-two', studentIdentifier: 'UTEL-2025-002', status: 'DRAFT' }),
    ]);

    fireEvent.change(screen.getByRole('searchbox', { name: /buscar por folio/i }), { target: { value: '2025' } });
    expect(screen.getByRole('row', { name: /UTEL-2025-002/ })).toBeTruthy();
    expect(screen.queryByRole('row', { name: /UTEL-2026-001/ })).toBeNull();
    expect(screen.getByText('Mostrando 1 de 2 expedientes')).toBeTruthy();
  });

  it('filtra por estado y actualiza el expediente seleccionado', async () => {
    await renderList([
      makeCase({ id: 'case-completed' }),
      makeCase({ id: 'case-draft', status: 'DRAFT' }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: /borradores/i }));
    await vi.waitFor(() => expect(screen.getByRole('row', { name: /UTEL-2026-001/ })).toBeTruthy());
    expect(screen.getByRole('link', { name: /abrir expediente/i }).getAttribute('href')).toBe('#/casos/case-draft');
  });

  it('permite filtrar los expedientes globales por Coordinador o Asesor', async () => {
    await renderList([
      makeCase({ id: 'case-coordinator', creatorRole: 'coordinator', studentIdentifier: 'COORD-001' }),
      makeCase({ id: 'case-advisor', creatorRole: 'user', studentIdentifier: 'ASESOR-001' }),
    ], true);

    fireEvent.change(screen.getByRole('combobox', { name: /filtrar por perfil del creador/i }), {
      target: { value: 'coordinator' },
    });

    await vi.waitFor(() => expect(screen.getByRole('row', { name: /COORD-001/ })).toBeTruthy());
    expect(screen.queryByRole('row', { name: /ASESOR-001/ })).toBeNull();
  });

  it('filtra por una persona creadora individual y muestra su nombre en la tabla', async () => {
    const creatorOne = '10000000-0000-4000-8000-000000000001';
    const creatorTwo = '10000000-0000-4000-8000-000000000002';
    await renderList([
      makeCase({ id: 'case-agent-one', creatorRole: 'user', creatorId: creatorOne, studentIdentifier: 'AGENTE-UNO' }),
      makeCase({ id: 'case-agent-two', creatorRole: 'user', creatorId: creatorTwo, studentIdentifier: 'AGENTE-DOS' }),
      makeCase({ id: 'case-coordinator', creatorRole: 'coordinator', creatorId: '20000000-0000-4000-8000-000000000001', studentIdentifier: 'COORD-001' }),
    ], true);

    expect(screen.getByRole('row', { name: /AGENTE-UNO/ }).textContent).toContain('Ana Pérez');
    expect(screen.getByRole('row', { name: /AGENTE-UNO/ }).textContent).not.toContain(creatorOne);
    fireEvent.change(screen.getByRole('combobox', { name: /filtrar por creador de caso/i }), {
      target: { value: creatorTwo },
    });

    await vi.waitFor(() => expect(screen.getByRole('row', { name: /AGENTE-DOS/ })).toBeTruthy());
    expect(screen.queryByRole('row', { name: /AGENTE-UNO/ })).toBeNull();
    expect(screen.queryByRole('row', { name: /COORD-001/ })).toBeNull();
  });

  it('carga la siguiente página bajo demanda y conserva el contrato incremental', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fakeResponse(200, {
        cases: [makeCase({ id: 'case-page-one' })],
        nextCursor: 'cursor-page-two',
        statusCounts: { ALL: 2, READY: 0, AUDITING: 0, COMPLETED: 2, DRAFT: 0, ERROR: 0 },
      }))
      .mockResolvedValueOnce(fakeResponse(200, {
        cases: [makeCase({ id: 'case-page-two', studentIdentifier: 'UTEL-2026-002' })],
        nextCursor: null,
      }));
    vi.stubGlobal('fetch', fetchMock);
    render(createElement(CasesPanel));

    await vi.waitFor(() => expect(screen.getByRole('row', { name: /UTEL-2026-001/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /mostrar más/i }));
    await vi.waitFor(() => expect(screen.getByRole('row', { name: /UTEL-2026-002/i })).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('cursor=cursor-page-two');
    expect(screen.getByText('Mostrando 2 de 2 expedientes')).toBeTruthy();
  });
});

describe('CasesPanel — clasificación prueba/real', () => {
  it('muestra la etiqueta persistente de prueba frente a la de real', async () => {
    await renderList([
      makeCase({ id: 'case-test', isTest: true }),
      makeCase({ id: 'case-real', isTest: false }),
    ]);

    // La etiqueta acompaña a CADA fila: la prueba y el caso real se distinguen.
    const testRow = screen.getByRole('row', { name: /Prueba/ });
    expect(testRow.textContent).toContain('Prueba');
    const realRow = screen.getByRole('row', { name: /Real/ });
    expect(realRow.textContent).toContain('Real');
  });

  it('un caso sin clasificación explícita del servidor se rotula como real', async () => {
    await renderList([makeCase({ id: 'case-plain' })]);

    const row = screen.getByRole('row', { name: /UTEL-2026-001/ });
    expect(row.textContent).toContain('Real');
  });
});

describe('CasesPanel — acciones múltiples de administración', () => {
  it('marca juntos los expedientes seleccionados como prueba', async () => {
    await renderList([
      makeCase({ id: 'case-1', canManageCases: true, isTest: false }),
      makeCase({ id: 'case-2', studentIdentifier: 'UTEL-2026-002', canManageCases: true, isTest: false }),
    ]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar expediente UTEL-2026-001' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar expediente UTEL-2026-002' }));
    fireEvent.click(screen.getByRole('button', { name: /marcar prueba/i }));

    await vi.waitFor(() => {
      const updates = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PATCH');
      expect(updates).toHaveLength(2);
      expect(updates.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([{ isTest: true }, { isTest: true }]);
    });
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('2 expedientes seleccionados'));
  });

  it('borra varios dictámenes solo tras confirmación y no habilita los protegidos', async () => {
    await renderList([
      makeCase({ id: 'case-1', canManageCases: true, auditId: 'audit-1', auditHasHumanReview: false }),
      makeCase({ id: 'case-2', studentIdentifier: 'UTEL-2026-002', canManageCases: true, auditId: 'audit-2', auditHasHumanReview: false }),
    ]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar expediente UTEL-2026-001' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar expediente UTEL-2026-002' }));
    fireEvent.click(screen.getByRole('button', { name: /borrar dictámenes/i }));

    await vi.waitFor(() => {
      const deletions = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'DELETE');
      expect(deletions).toHaveLength(2);
      expect(deletions.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
        { target: 'audit', auditId: 'audit-1' },
        { target: 'audit', auditId: 'audit-2' },
      ]);
    });
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('2 dictámenes seleccionados'));

    cleanup();
    await renderList([
      makeCase({ id: 'case-reviewed', canManageCases: true, auditId: 'audit-reviewed', auditHasHumanReview: true }),
    ]);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar expediente UTEL-2026-001' }));
    expect(screen.getByRole('button', { name: /borrar dictámenes/i })).toHaveProperty('disabled', true);
  });

  it('permite borrar los dictámenes elegibles y omite los que tienen revisión humana', async () => {
    await renderList([
      makeCase({ id: 'case-eligible', canManageCases: true, auditId: 'audit-eligible', auditHasHumanReview: false }),
      makeCase({ id: 'case-reviewed', studentIdentifier: 'UTEL-2026-002', canManageCases: true, auditId: 'audit-reviewed', auditHasHumanReview: true }),
    ]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar expediente UTEL-2026-001' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar expediente UTEL-2026-002' }));
    expect(screen.getByRole('button', { name: /borrar dictámenes/i })).toHaveProperty('disabled', false);
    expect(screen.getByText(/se pueden borrar 1 de 2 dictámenes seleccionados/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /borrar dictámenes/i }));

    await vi.waitFor(() => {
      const deletions = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'DELETE');
      expect(deletions).toHaveLength(1);
      expect(JSON.parse(String(deletions[0]?.[1]?.body))).toEqual({ target: 'audit', auditId: 'audit-eligible' });
    });
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('se omitirá 1 caso'));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Se eliminarán también todos los archivos de evidencia'));
  });
});
