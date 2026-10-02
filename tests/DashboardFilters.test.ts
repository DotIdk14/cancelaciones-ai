// @vitest-environment jsdom

// =============================================================================
// Barra de filtros del dashboard.
//
// El caso que importa es `allowResultFilter={false}` (pantalla "IA & Costos"):
// el endpoint ignora `result` a propósito, así que el control debe RETIRARSE.
// Si alguien lo reintrodujera, el usuario volvería a filtrar por un criterio
// que no cambia nada y creería que sí.
// =============================================================================

import { createElement } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUDIT_RESULTS, CASE_STATUSES } from '../src/skills/audit/types';
import type { DashboardFilters } from '../src/lib/dashboard';
import { DashboardFilters } from '../src/components/dashboard/DashboardFilters';

afterEach(cleanup);

const VALUE: DashboardFilters = {
  from: '2026-09-01',
  to: '2026-09-30',
  result: null,
  status: null,
};

function mount(props: Partial<React.ComponentProps<typeof DashboardFilters>> = {}) {
  const onChange = vi.fn();
  const view = render(
    createElement(DashboardFilters, { value: VALUE, onChange, ...props }),
  );
  const q = (name: string) => view.container.querySelector(`[name="${name}"]`);
  return { onChange, q, view };
}

describe('DashboardFilters — controles', () => {
  it('muestra rango, resultado y estado por defecto', () => {
    const { q } = mount();
    expect(q('from')).not.toBeNull();
    expect(q('to')).not.toBeNull();
    expect(q('result')).not.toBeNull();
    expect(q('status')).not.toBeNull();
  });

  it('el selector de resultado ofrece el vocabulario cerrado de la auditoría', () => {
    const { q } = mount();
    const opciones = [...(q('result') as HTMLSelectElement).options].map((o) => o.value);
    // La primera opción es "todos"; el resto es exactamente AUDIT_RESULTS.
    expect(opciones[0]).toBe('');
    expect(opciones.slice(1)).toEqual([...AUDIT_RESULTS]);
  });

  it('el selector de estado ofrece el vocabulario cerrado de casos', () => {
    const { q } = mount();
    const opciones = [...(q('status') as HTMLSelectElement).options].map((o) => o.value);
    expect(opciones.slice(1)).toEqual([...CASE_STATUSES]);
  });

  it('cada control tiene su etiqueta asociada (accesibilidad)', () => {
    const { view } = mount();
    for (const name of ['from', 'to', 'result', 'status']) {
      const control = view.container.querySelector(`[name="${name}"]`);
      const id = control?.getAttribute('id');
      expect(id, `falta id en ${name}`).toBeTruthy();
      const label = view.container.querySelector(`label[for="${id}"]`);
      expect(label, `falta <label for="${id}">`).not.toBeNull();
    }
  });

  it('los campos de fecha quedan acotados por la otra punta del rango', () => {
    const { q } = mount();
    expect(q('from')?.getAttribute('max')).toBe(VALUE.to);
    expect(q('to')?.getAttribute('min')).toBe(VALUE.from);
  });
});

describe('DashboardFilters — emisión de cambios', () => {
  it('cambiar la fecha inicial emite el objeto completo, sin mutar el anterior', () => {
    const { onChange, q } = mount();
    fireEvent.change(q('from') as HTMLInputElement, { target: { value: '2026-09-05' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    const emitido = onChange.mock.calls[0]?.[0] as DashboardFilters;
    expect(emitido).toEqual({ ...VALUE, from: '2026-09-05' });
    // El objeto de props no se toca: la página decide cuándo recargar.
    expect(VALUE.from).toBe('2026-09-01');
  });

  it('seleccionar un resultado lo emite como string', () => {
    const { onChange, q } = mount();
    fireEvent.change(q('result') as HTMLSelectElement, { target: { value: 'BAJA' } });
    expect(onChange.mock.calls[0]?.[0]).toEqual({ ...VALUE, result: 'BAJA' });
  });

  it('volver a "todos" emite null, no cadena vacía', () => {
    const conFiltro: DashboardFilters = { ...VALUE, result: 'BAJA', status: 'COMPLETED' };
    const onChange = vi.fn();
    const view = render(
      createElement(DashboardFilters, { value: conFiltro, onChange }),
    );
    fireEvent.change(view.container.querySelector('[name="result"]') as HTMLSelectElement, {
      target: { value: '' },
    });
    expect(onChange.mock.calls[0]?.[0]).toEqual({ ...conFiltro, result: null });
  });

  it('seleccionar un estado lo emite como string', () => {
    const { onChange, q } = mount();
    fireEvent.change(q('status') as HTMLSelectElement, { target: { value: 'COMPLETED' } });
    expect(onChange.mock.calls[0]?.[0]).toEqual({ ...VALUE, status: 'COMPLETED' });
  });
});

describe('DashboardFilters — allowResultFilter={false} (pantalla IA & Costos)', () => {
  it('retira el selector de resultado', () => {
    const { q } = mount({ allowResultFilter: false });
    expect(q('result')).toBeNull();
  });

  it('conserva el rango de fechas y el estado del caso', () => {
    const { q } = mount({ allowResultFilter: false });
    expect(q('from')).not.toBeNull();
    expect(q('to')).not.toBeNull();
    expect(q('status')).not.toBeNull();
  });

  it('sigue emitiendo cambios de estado correctamente', () => {
    const { onChange, q } = mount({ allowResultFilter: false });
    fireEvent.change(q('status') as HTMLSelectElement, { target: { value: 'COMPLETED' } });
    expect(onChange.mock.calls[0]?.[0]).toEqual({ ...VALUE, status: 'COMPLETED' });
  });

  it('no deja etiquetas huérfanas apuntando al control retirado', () => {
    const { view } = mount({ allowResultFilter: false });
    const labels = [...view.container.querySelectorAll('label')];
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      const forId = label.getAttribute('for');
      if (forId === null) continue; // <legend> no usa `for`
      // `useId()` genera ids con `:` (p. ej. ":r1:"), que no valen como
      // selector CSS: se resuelve por id, no por querySelector.
      const doc = view.container.ownerDocument;
      expect(doc.getElementById(forId), `label huérfano: ${forId}`).not.toBeNull();
    }
  });
});
