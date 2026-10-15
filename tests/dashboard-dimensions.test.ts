import { describe, expect, it } from 'vitest';
import {
  CASE_DIMENSION_COLUMN,
  DASHBOARD_DIMENSIONS,
  DIMENSION_LABELS,
} from '../src/lib/dashboard-shared';

describe('dimensiones del dashboard', () => {
  it('la lista de dimensiones incluye salesChannel exactamente una vez', () => {
    expect([...DASHBOARD_DIMENSIONS]).toEqual([
      'country',
      'salesChannel',
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
      expect(CASE_DIMENSION_COLUMN[dimension]).toBe(dimension === 'salesChannel' ? 'sales_channel' : dimension);
    }
  });
});
