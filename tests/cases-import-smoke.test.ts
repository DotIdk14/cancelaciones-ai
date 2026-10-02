import { describe, expect, it } from 'vitest';
import casesHandler from '../api/cases/index';

describe('cases handler import', () => {
  it('se importa sin colgar', () => {
    expect(typeof casesHandler).toBe('function');
  });
});
