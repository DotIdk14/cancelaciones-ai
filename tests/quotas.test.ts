// =============================================================================
// REGRESIONES del servicio de cuotas.
// Contrato que se fija aquí:
//   - El sujeto (usuario, email, IP) NUNCA viaja en claro a la base: va hasheado.
//   - Denegado → 429 con `retryAfterSeconds` para que el cliente pueda esperar.
//   - Proveedor caído o respuesta inesperada → 503 (fail-closed: si no se puede
//     admitir, NO se llama al proveedor de IA y no se cobra al usuario).
// =============================================================================

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { setTestEnv } from './helpers/env';

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

const rpcCalls: RpcCall[] = [];
let rpcResult: { data: unknown; error: unknown } = { data: [{ admitted: true, retry_after_seconds: 0 }], error: null };

vi.mock('../src/server/insforge', () => ({
  createServerClient: () => ({
    database: {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        return rpcResult;
      },
    },
  }),
}));

beforeEach(() => {
  setTestEnv();
  rpcCalls.length = 0;
  rpcResult = { data: [{ admitted: true, retry_after_seconds: 0 }], error: null };
});

describe('cuotas · el sujeto viaja hasheado, nunca en claro', () => {
  it('el hash es determinista, opaco y no contiene el sujeto', async () => {
    const { hashQuotaSubject } = await import('../src/server/quotas');
    const hash = hashQuotaSubject('alumno@utel.edu.uy');

    expect(hash).toBe(hashQuotaSubject('alumno@utel.edu.uy'));
    expect(hash).not.toBe(hashQuotaSubject('otro@utel.edu.uy'));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('alumno');
    expect(hash).not.toContain('@');
  });

  it('la cuota por IP no envía la IP en claro', async () => {
    const { checkLoginIpQuota } = await import('../src/server/quotas');

    await checkLoginIpQuota('203.0.113.7');

    const call = rpcCalls[0];
    expect(call?.args.p_operation).toBe('login');
    expect(call?.args.p_context_hash).toBe('ip');
    expect(JSON.stringify(call?.args)).not.toContain('203.0.113.7');
  });

  it('la cuota pagada pasa el userId (para traza) y un contexto opaco', async () => {
    const { checkPaidQuota } = await import('../src/server/quotas');

    await checkPaidQuota('usuario-1', 'audit:caso-1:fp');

    const call = rpcCalls[0];
    expect(call?.fn).toBe('admit_or_reject_quota');
    expect(call?.args.p_operation).toBe('paid');
    expect(call?.args.p_user_id).toBe('usuario-1');
    expect(call?.args.p_context_hash).toBe('audit:caso-1:fp');
  });
});

describe('cuotas · fail-closed', () => {
  it('denegado → 429 con Retry-After disponible', async () => {
    rpcResult = { data: [{ admitted: false, retry_after_seconds: 137 }], error: null };
    const { checkPaidQuota } = await import('../src/server/quotas');

    let status: number | undefined;
    let retryAfter: number | undefined;
    try {
      await checkPaidQuota('usuario-1', 'audit:caso-1:fp');
    } catch (error) {
      status = (error as { status?: number }).status;
      retryAfter = (error as { retryAfterSeconds?: number }).retryAfterSeconds;
    }

    expect(status).toBe(429);
    expect(retryAfter).toBe(137);
  });

  it('servicio de cuotas caído → 503 (no se admits aunque no haya limite)', async () => {
    rpcResult = { data: null, error: { statusCode: 500, message: 'caido' } };
    const { checkPaidQuota } = await import('../src/server/quotas');
    await expect(checkPaidQuota('usuario-1', 'ctx')).rejects.toMatchObject({ status: 503 });
  });

  it('respuesta inesperada (sin admitted) → 503, nunca paso silencioso', async () => {
    rpcResult = { data: { otra_cosa: true }, error: null };
    const { checkPaidQuota } = await import('../src/server/quotas');
    await expect(checkPaidQuota('usuario-1', 'ctx')).rejects.toMatchObject({ status: 503 });
  });

  it('respuesta vacía → 503 (nunca se asume que hay cupo)', async () => {
    rpcResult = { data: [], error: null };
    const { checkPaidQuota } = await import('../src/server/quotas');
    await expect(checkPaidQuota('usuario-1', 'ctx')).rejects.toMatchObject({ status: 503 });
  });

  it('retry_afterSeconds ausente o corrupto cae en un valor por defecto', async () => {
    rpcResult = { data: [{ admitted: false, retry_after_seconds: 'mucho' }], error: null };
    const { checkPaidQuota } = await import('../src/server/quotas');

    let retryAfter: number | undefined;
    try {
      await checkPaidQuota('usuario-1', 'ctx');
    } catch (error) {
      retryAfter = (error as { retryAfterSeconds?: number }).retryAfterSeconds;
    }
    expect(retryAfter).toBe(60);
  });
});