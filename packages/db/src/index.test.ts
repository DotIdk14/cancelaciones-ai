import { describe, expect, it } from 'vitest';
import { createClientFromInsForge, DatabaseRequestError } from './index';

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function fakeFetch(rows: unknown[], captured: Captured[]) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    captured.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
}

describe('createClientFromInsForge', () => {
  it('rechaza una configuracion incompleta antes de tocar la red', () => {
    expect(() => createClientFromInsForge({ url: '', anonKey: 'anon' })).toThrow('la URL es obligatoria');
    expect(() => createClientFromInsForge({ url: 'https://db.test', anonKey: '' })).toThrow('la anonKey es obligatoria');
  });

  it('arma la consulta de lectura con filtros, columnas, orden y paginado', async () => {
    const captured: Captured[] = [];
    const client = createClientFromInsForge({
      url: 'https://db.test/',
      anonKey: 'anon-key',
      fetchImpl: fakeFetch([{ id: 'audit_1' }], captured),
    });

    const { data } = await client
      .from('audits')
      .select('id,status')
      .eq('status', 'DRAFT')
      .order('created_at', { ascending: true })
      .range(10, 14);

    expect(data).toEqual([{ id: 'audit_1' }]);
    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe(
      'https://db.test/api/database/audits?status=eq.DRAFT&select=id%2Cstatus&order=created_at.asc&limit=5&offset=10',
    );
    expect(captured[0].headers['x-api-key']).toBe('anon-key');
    expect(captured[0].headers.Authorization).toBe('Bearer anon-key');
  });

  it('rechaza una baseUrl que no es una URL http/https usable', () => {
    expect(() => createClientFromInsForge({ url: 'no-es-una-url', anonKey: 'anon' })).toThrow('URL no valida');
    expect(() => createClientFromInsForge({ url: 'ftp://db.test', anonKey: 'anon' })).toThrow('URL no valida');
  });

  it('inserta filas por POST con el array de registros y devuelve lo insertado', async () => {
    const captured: Captured[] = [];
    const client = createClientFromInsForge({
      url: 'https://db.test',
      anonKey: 'anon-key',
      fetchImpl: fakeFetch([{ id: 'run_1' }], captured),
    });

    const { data, error } = await client
      .from('audit_runs')
      .insert([{ audit_id: 'audit_1', run_number: 1 }])
      .select('id,run_number')
      .single();

    expect(error).toBeNull();
    expect(data).toEqual({ id: 'run_1' });
    expect(captured[0].method).toBe('POST');
    expect(captured[0].url).toBe('https://db.test/api/database/audit_runs?select=id%2Crun_number&limit=1');
    expect(captured[0].body).toBe('[{"audit_id":"audit_1","run_number":1}]');
  });

  it('actualiza por PATCH conservando los filtros de la consulta', async () => {
    const captured: Captured[] = [];
    const client = createClientFromInsForge({
      url: 'https://db.test',
      anonKey: 'anon-key',
      fetchImpl: fakeFetch([{ id: 'run_1', status: 'ANALYZING' }], captured),
    });

    const { data } = await client
      .from('audit_runs')
      .update({ status: 'ANALYZING' })
      .eq('id', 'run_1')
      .select('id,status')
      .single();

    expect(data).toEqual({ id: 'run_1', status: 'ANALYZING' });
    expect(captured[0].method).toBe('PATCH');
    expect(captured[0].url).toBe('https://db.test/api/database/audit_runs?id=eq.run_1&select=id%2Cstatus&limit=1');
    expect(captured[0].body).toBe('{"status":"ANALYZING"}');
  });

  it('colapsa a una sola fila con single() y a null cuando no hay ninguna', async () => {
    const captured: Captured[] = [];
    const withRow = createClientFromInsForge({
      url: 'https://db.test',
      anonKey: 'anon-key',
      fetchImpl: fakeFetch([{ id: 'run_1' }], captured),
    });
    const withoutRow = createClientFromInsForge({
      url: 'https://db.test',
      anonKey: 'anon-key',
      fetchImpl: fakeFetch([], captured),
    });

    const found = await withRow.from('audit_runs').select('*').eq('id', 'run_1').single();
    expect(found.data).toEqual({ id: 'run_1' });
    expect(captured[0].url).toBe('https://db.test/api/database/audit_runs?id=eq.run_1&select=*&limit=1');

    const missing = await withoutRow.from('audit_runs').select('*').eq('id', 'run_x').single();
    expect(missing.data).toBeNull();
  });

  it('envia rpc por POST con sus argumentos y propaga el error de la base', async () => {
    const captured: Captured[] = [];
    const client = createClientFromInsForge({
      url: 'https://db.test',
      anonKey: 'anon-key',
      serviceKey: 'service-key',
      fetchImpl: fakeFetch([], captured),
    });

    const ok = await client.rpc!('delete_audit', { p_audit_id: 'audit_9' });
    expect(ok).toEqual({ data: [], error: null });
    expect(captured[0].method).toBe('POST');
    expect(captured[0].url).toBe('https://db.test/api/database/rpc/delete_audit');
    expect(captured[0].body).toBe('{"p_audit_id":"audit_9"}');
    expect(captured[0].headers['x-api-key']).toBe('service-key');

    const failing = createClientFromInsForge({
      url: 'https://db.test',
      anonKey: 'anon-key',
      fetchImpl: (async () =>
        new Response(JSON.stringify({ message: 'permiso denegado' }), { status: 403 })) as unknown as typeof fetch,
    });

    await expect(failing.rpc!('delete_audit', {})).rejects.toBeInstanceOf(DatabaseRequestError);
    await expect(failing.rpc!('delete_audit', {})).rejects.toThrow('permiso denegado');
  });
});
