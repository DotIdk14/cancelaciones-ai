import { describe, expect, it } from 'vitest';
import { updateCaseDimensions } from '../src/server/cases';
import type { InsForgeClient } from '../src/server/insforge';

interface UpdateCall {
  patch: Record<string, unknown>;
  column: string;
  value: unknown;
}

/** Cliente InsForge mínimo: registra los `update` y no habla con nadie. */
function fakeClient(calls: UpdateCall[]) {
  const query = {
    update(patch: Record<string, unknown>) {
      const call: UpdateCall = { patch, column: '', value: undefined };
      calls.push(call);
      return {
        eq(column: string, value: unknown) {
          call.column = column;
          call.value = value;
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { database: { from: () => query } } as unknown as InsForgeClient;
}

describe('updateCaseDimensions', () => {
  it('escribe país y canal cuando ambos vienen determinados', async () => {
    const calls: UpdateCall[] = [];

    await updateCaseDimensions(fakeClient(calls), 'case-1', { country: 'MX', channel: 'WHATSAPP' });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.patch).toEqual({ country: 'MX', channel: 'WHATSAPP' });
    expect(calls[0]!.column).toBe('id');
    expect(calls[0]!.value).toBe('case-1');
  });

  it('un valor indeterminable no borra el que ya estaba: la clave no viaja', async () => {
    const calls: UpdateCall[] = [];

    await updateCaseDimensions(fakeClient(calls), 'case-1', { country: 'MX', channel: null });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.patch).toEqual({ country: 'MX' });
    expect('channel' in calls[0]!.patch).toBe(false);
  });

  it('si no hay nada que proyectar, no toca la base', async () => {
    const calls: UpdateCall[] = [];

    await updateCaseDimensions(fakeClient(calls), 'case-1', { country: null, channel: null });

    expect(calls).toHaveLength(0);
  });

  it('nunca envía claves con valor null ni undefined', async () => {
    const calls: UpdateCall[] = [];

    await updateCaseDimensions(fakeClient(calls), 'case-1', { country: null, channel: 'CRM' });

    for (const call of calls) {
      for (const value of Object.values(call.patch)) {
        expect(value).not.toBeNull();
        expect(value).not.toBeUndefined();
      }
    }
  });
});