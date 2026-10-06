import { describe, expect, it } from 'vitest';
import {
  CASE_DIMENSION_COLUMN,
  DASHBOARD_DIMENSIONS,
  DIMENSION_LABELS,
} from '../src/lib/dashboard-shared';

describe('dimensiones del dashboard', () => {
  it('la lista de dimensiones incluye channel exactamente una vez', () => {
    expect([...DASHBOARD_DIMENSIONS]).toEqual([
      'country',
      'channel',
      'campus',
      'modality',
      'project',
      'responsible',
      'guideline',
    ]);
  });

  it('toda dimensión tiene etiqueta y columna', () => {
    for (const dimension of DASHBOARD_DIMENSIONS) {
      expect(DIMENSION_LABELS[dimension]).toBeTruthy();
      expect(CASE_DIMENSION_COLUMN[dimension]).toBe(dimension);
    }
  });
});