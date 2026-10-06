// @vitest-environment jsdom

import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { OriginBreakdownPoint } from '../src/lib/dashboard';
import { OriginBreakdownChart } from '../src/components/dashboard/charts/OriginBreakdownChart';

afterEach(cleanup);

function point(overrides: Partial<OriginBreakdownPoint>): OriginBreakdownPoint {
  return { value: 'MX', label: 'México', count: 1, ...overrides };
}

describe('OriginBreakdownChart', () => {
  it('resume el reparto en texto accesible, con la etiqueta en español', () => {
    const data = [point({ value: 'MX', label: 'México', count: 4 })];

    render(createElement(OriginBreakdownChart, { data, dimension: 'country' }));

    // El `sr-only` es el requisito 1.1.1(A): el número del `LabelList` no está
    // emparejado con la etiqueta del eje para un lector de pantalla.
    expect(screen.getByText(/Distribución de 4 caso\(s\) por país de origen/)).toBeTruthy();
    expect(screen.getByText(/México: 4/)).toBeTruthy();
  });

  it('nombra el canal cuando la dimensión es canal', () => {
    const data = [point({ value: 'WHATSAPP', label: 'WhatsApp', count: 2 })];

    render(createElement(OriginBreakdownChart, { data, dimension: 'channel' }));

    expect(screen.getByText(/por canal de origen/)).toBeTruthy();
    expect(screen.getByText(/WhatsApp: 2/)).toBeTruthy();
  });

  it('muestra "Sin determinar" en vez de un gráfico vacío', () => {
    const data = [point({ value: 'Sin determinar', label: 'Sin determinar', count: 3 })];

    render(createElement(OriginBreakdownChart, { data, dimension: 'country' }));

    expect(screen.getByText(/Sin determinar: 3/)).toBeTruthy();
  });

  it('no renderiza nada sin datos', () => {
    const { container } = render(createElement(OriginBreakdownChart, { data: [], dimension: 'country' }));

    expect(container.textContent).toBe('');
  });
});