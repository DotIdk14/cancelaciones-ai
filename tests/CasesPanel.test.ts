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
import { shortId } from '../src/lib/format';
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

async function renderList(cases: CaseSummary[]): Promise<void> {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => fakeResponse(200, { cases })),
  );
  const view = render(createElement(CasesPanel));
  // Espera a que la lista llegue del servidor.
  await vi.waitFor(() => {
    if (cases.length > 0) expect(view.container.querySelector('tbody tr')).not.toBeNull();
  });
}

afterEach(() => {
  cleanup();
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
    const row = screen.getByRole('row', { name: new RegExp(shortId('case-plain'), 'i') });
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
    expect(screen.getByRole('row', { name: /case-two/i })).toBeTruthy();
    expect(screen.queryByRole('row', { name: /case-one/i })).toBeNull();
    expect(screen.getByText('Mostrando 1 de 2 expedientes')).toBeTruthy();
  });

  it('filtra por estado y actualiza el expediente seleccionado', async () => {
    await renderList([
      makeCase({ id: 'case-completed' }),
      makeCase({ id: 'case-draft', status: 'DRAFT' }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: /borradores/i }));
    expect(screen.getByRole('row', { name: /case-dra/i })).toBeTruthy();
    expect(screen.queryByRole('row', { name: /case-compl/i })).toBeNull();
    expect(screen.getByRole('link', { name: /abrir expediente/i }).getAttribute('href')).toBe('#/casos/case-draft');
  });
});

describe('CasesPanel — clasificación prueba/real', () => {
  it('muestra la etiqueta persistente de prueba frente a la de real', async () => {
    await renderList([
      makeCase({ id: 'case-test', isTest: true }),
      makeCase({ id: 'case-real', isTest: false }),
    ]);

    // La etiqueta acompaña a CADA fila: la prueba y el caso real se distinguen.
    const testRow = screen.getByRole('row', { name: new RegExp(shortId('case-test'), 'i') });
    expect(testRow.textContent).toContain('Prueba');
    const realRow = screen.getByRole('row', { name: new RegExp(shortId('case-real'), 'i') });
    expect(realRow.textContent).toContain('Real');
  });

  it('un caso sin clasificación explícita del servidor se rotula como real', async () => {
    await renderList([makeCase({ id: 'case-plain' })]);

    const row = screen.getByRole('row', { name: new RegExp(shortId('case-plain'), 'i') });
    expect(row.textContent).toContain('Real');
  });
});
