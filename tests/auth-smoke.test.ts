import { describe, expect, it } from 'vitest';
import { fakeAuthContext } from './helpers/auth';

describe('auth helper', () => {
  it('devuelve un contexto falso', () => {
    const auth = fakeAuthContext();
    expect(auth.sub).toBe('00000000-0000-0000-0000-000000000001');
    expect(auth.role).toBe('user');
  });
});
