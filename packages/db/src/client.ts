export interface DatabaseClient {
  from(table: string): any;
  rpc?(fn: string, args?: Record<string, unknown>): any;
}

export interface InsForgeClientOptions {
  url: string;
  anonKey: string;
  serviceKey?: string;
  fetchImpl?: typeof fetch;
}

export class DatabaseRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'DatabaseRequestError';
    this.status = status;
  }
}

function databaseUrl(baseUrl: string, path: string, query: Record<string, string> = {}): string {
  const search = new URLSearchParams(query).toString();
  return `${baseUrl.replace(/\/+$/, '')}/api/database/${path}${search ? `?${search}` : ''}`;
}

async function assertOk(response: Response): Promise<Response> {
  if (response.ok) return response;

  let message = `La base de datos respondio ${response.status}`;
  try {
    const payload = (await response.json()) as { message?: string };
    if (payload?.message) message = payload.message;
  } catch {
    // la respuesta no traia JSON: se conserva el mensaje por status
  }
  throw new DatabaseRequestError(message, response.status);
}

function firstRow(payload: unknown): unknown {
  if (!Array.isArray(payload)) return payload ?? null;
  return payload.length > 0 ? payload[0] : null;
}

/**
 * Una baseUrl que no parsea produce un fallo mucho más tarde y mucho más
 * confuso (un `fetch` que lanza `Failed to parse URL` en la primera consulta,
 * con la traza de la petición ya iniciada). Se falla en la construcción del
 * cliente, que es donde todavía se sabe de dónde salió el valor.
 */
function assertUsableBaseUrl(baseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('InsForge: la URL no valida como URL absoluta.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`InsForge: la URL no valida como origen http/https (recibido "${parsed.protocol}").`);
  }
}

/**
 * Cliente minimo de la base de datos de InsForge: solo `from()` para lecturas y
 * `rpc()` para funciones de base de datos. No define reglas de dominio.
 */
export function createClientFromInsForge(options: InsForgeClientOptions): DatabaseClient {
  if (!options.url) throw new Error('InsForge: la URL es obligatoria');
  if (!options.anonKey) throw new Error('InsForge: la anonKey es obligatoria');
  assertUsableBaseUrl(options.url);

  const apiKey = options.serviceKey ?? options.anonKey;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    Authorization: `Bearer ${apiKey}`,
  };

  return {
    from(table: string) {
      if (!table) throw new Error('InsForge: el nombre de la tabla es obligatorio');

      const filters: Record<string, string> = {};
      let columns: string | undefined;
      let orderedBy: string | undefined;
      let ascending = false;
      let maxRows: number | undefined;
      let skipRows: number | undefined;
      let singleRow = false;
      let method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET';
      let body: unknown;

      const builder = {
        select(next?: string) {
          columns = next;
          return builder;
        },
        insert(rows: Record<string, unknown>[]) {
          method = 'POST';
          body = rows;
          return builder;
        },
        update(patch: Record<string, unknown>) {
          method = 'PATCH';
          body = patch;
          return builder;
        },
        eq(column: string, value: string) {
          filters[column] = `eq.${value}`;
          return builder;
        },
        in(column: string, values: string[]) {
          filters[column] = `in.(${values.join(',')})`;
          return builder;
        },
        lt(column: string, value: string) {
          filters[column] = `lt.${value}`;
          return builder;
        },
        order(column: string, opts?: { ascending?: boolean }) {
          orderedBy = column;
          ascending = opts?.ascending ?? false;
          return builder;
        },
        limit(count: number) {
          maxRows = count;
          return builder;
        },
        range(from: number, to: number) {
          skipRows = from;
          maxRows = to - from + 1;
          return builder;
        },
        /**
         * Colapsa la respuesta a una fila. Se resuelve en el cliente y no con una
         * cabecera `Accept` especial: la respuesta de este endpoint ya es un array,
         * así que no hace falta asumir un contrato de servidor distinto del que
         * usan las lecturas, y `null` es la respuesta honesta para "no hay fila".
         */
        single() {
          singleRow = true;
          return builder;
        },
        async then<R>(onFulfilled: (value: { data: unknown; error: null }) => R) {
          const query: Record<string, string> = { ...filters };
          if (columns) query.select = columns;
          if (orderedBy) query.order = `${orderedBy}.${ascending ? 'asc' : 'desc'}`;
          if (singleRow && maxRows === undefined) maxRows = 1;
          if (maxRows !== undefined) query.limit = String(maxRows);
          if (skipRows !== undefined) query.offset = String(skipRows);

          const init: RequestInit = { method, headers };
          if (body !== undefined) init.body = JSON.stringify(body);

          const response = await fetchImpl(databaseUrl(options.url, table, query), init);
          await assertOk(response);
          const payload = await response.json();
          return onFulfilled({ data: singleRow ? firstRow(payload) : payload, error: null });
        },
      };

      return builder;
    },

    async rpc(fn: string, args: Record<string, unknown> = {}) {
      const response = await fetchImpl(databaseUrl(options.url, `rpc/${fn}`), {
        method: 'POST',
        headers,
        body: JSON.stringify(args),
      });
      await assertOk(response);
      return { data: await response.json(), error: null };
    },
  };
}
