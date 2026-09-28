import { describe, expect, it } from 'vitest';
import { formatDateTime } from './format';

describe('formatDateTime', () => {
  it('formatea una fecha ISO de forma estable en es-MX', () => {
    expect(formatDateTime('2026-01-02T03:04:00.000Z')).toContain('2026');
  });
});
