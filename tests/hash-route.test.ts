// =============================================================================
// Enrutado por hash. `parseHash` es puro: es la función que decide qué pantalla
// se pinta, y un fallo aquí deja al usuario en una pantalla rota o, peor, en la
// pantalla equivocada creyendo que es la correcta.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { parseHash, type AppRoute } from '../src/lib/useHashRoute';

describe('parseHash — rutas del dashboard', () => {
  it.each([
    ['#/', 'dashboard'],
    ['#', 'dashboard'],
    ['#/calidad', 'quality'],
    ['#/ia-costos', 'ai-costs'],
    ['#/nuevo', 'new-case'],
    ['#/casos', 'cases'],
  ])('%s -> %s', (hash, esperado) => {
    expect(parseHash(hash)).toEqual({ name: esperado } as AppRoute);
  });

  it('tolera barras verticales sobrantes en los extremos', () => {
    expect(parseHash('#//casos//')).toEqual({ name: 'cases' });
    expect(parseHash('#/calidad/')).toEqual({ name: 'quality' });
  });
});

describe('parseHash — detalle de caso', () => {
  it('extrae el identificador del caso', () => {
    expect(parseHash('#/casos/abc-123')).toEqual({ name: 'case', caseId: 'abc-123' });
  });

  it('decodifica identificadores escapados en el hash', () => {
    // Un UUID con caracteres que el navegador escapa al escribir el fragmento.
    expect(parseHash('#/casos/9e29e329%2D252e')).toEqual({
      name: 'case',
      caseId: '9e29e329-252e',
    });
  });

  it('un id mal escapado no rompe: se usa el segmento tal cual', () => {
    expect(parseHash('#/casos/%E0%A4%A')).toEqual({ name: 'case', caseId: '%E0%A4%A' });
  });

  it('sin id cae a la lista, no a una pantalla rota', () => {
    expect(parseHash('#/casos/')).toEqual({ name: 'cases' });
  });
});

describe('parseHash — rutas desconocidas', () => {
  it.each(['#/no-existe', '#/dashboard', '#/casos-y-mas'])(
    'cualquier hash no reconocido cae al dashboard: %s',
    (hash) => {
      expect(parseHash(hash)).toEqual({ name: 'dashboard' });
    },
  );

  it('una ruta con demasiados segmentos cae al dashboard', () => {
    // `#/casos/:id/extra` no es una ruta válida: no debe interpretarse como caso.
    expect(parseHash('#/casos/abc/extra')).toEqual({ name: 'dashboard' });
    expect(parseHash('#/calidad/extra')).toEqual({ name: 'dashboard' });
  });

  it('el hash vacío (recarga en la raíz) es el dashboard', () => {
    expect(parseHash('')).toEqual({ name: 'dashboard' });
  });
});
