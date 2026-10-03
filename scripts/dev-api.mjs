// =============================================================================
// dev-api — monta los handlers de Vercel /api dentro del dev server de Vite.
// =============================================================================
// Importa cada ruta con server.ssrLoadModule() (transforma TS sobre la marcha)
// y traduce Node http req/res al mismo contrato que usa Vercel:
//   - req.query = params de ruta + query string
//   - req.body  = JSON ya parseado (igual que el runtime de Vercel)
// =============================================================================

function createDevApiMiddleware(server) {
  const fromRoot = (file) => `/${file}`;

  const routes = [
    // Una función por familia (Vercel Hobby limita a 12 Functions por
    // deployment): `api/dashboard/[view].ts` sirve las cuatro vistas y
    // `api/auth/[action].ts` sirve session+refresh. Las URLs son las mismas.
    { methods: ['GET'], pattern: /^\/api\/dashboard\/([^/]+)$/, file: fromRoot('api/dashboard/[view].ts'), params: ['view'] },
    { methods: ['GET'], pattern: /^\/api\/health\/ai$/, file: fromRoot('api/health/ai.ts') },
    { methods: ['POST', 'DELETE'], pattern: /^\/api\/auth\/([^/]+)$/, file: fromRoot('api/auth/[action].ts'), params: ['action'] },
    { methods: ['GET', 'POST'], pattern: /^\/api\/cases$/, file: fromRoot('api/cases/index.ts') },
    {
      methods: ['GET'],
      pattern: /^\/api\/cases\/([^/]+)$/,
      file: fromRoot('api/cases/[caseId]/index.ts'),
      params: ['caseId'],
    },
    {
      methods: ['POST'],
      pattern: /^\/api\/cases\/([^/]+)\/evidence$/,
      file: fromRoot('api/cases/[caseId]/evidence/index.ts'),
      params: ['caseId'],
    },
    {
      methods: ['DELETE'],
      pattern: /^\/api\/cases\/([^/]+)\/evidence\/([^/]+)$/,
      file: fromRoot('api/cases/[caseId]/evidence/[evidenceId]/index.ts'),
      params: ['caseId', 'evidenceId'],
    },
    {
      methods: ['GET'],
      pattern: /^\/api\/evidence\/([^/]+)\/download$/,
      file: fromRoot('api/evidence/[evidenceId]/download.ts'),
      params: ['evidenceId'],
    },
    {
      methods: ['GET', 'POST'],
      pattern: /^\/api\/cases\/([^/]+)\/audit$/,
      file: fromRoot('api/cases/[caseId]/audit/index.ts'),
      params: ['caseId'],
    },
    // Rutas de caso registradas explicitamente porque Vite no descubre
    // /api/cases/[caseId]/** por sí solo: sin esta tabla, review y comparison
    // darían 404 en el dev server aunque los handlers existan y en Vercel
    // funcionen. Se declaran después de las de cases/[caseId] para no alterar
    // el orden de resolución actual.
    {
      methods: ['GET', 'POST'],
      pattern: /^\/api\/cases\/([^/]+)\/review$/,
      file: fromRoot('api/cases/[caseId]/review/index.ts'),
      params: ['caseId'],
    },
    {
      methods: ['POST'],
      pattern: /^\/api\/cases\/([^/]+)\/comparison$/,
      file: fromRoot('api/cases/[caseId]/comparison/index.ts'),
      params: ['caseId'],
    },
  ];

  async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks.map((chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))));
    if (raw.length === 0) return {};
    try {
      return JSON.parse(raw.toString('utf-8'));
    } catch {
      return null;
    }
  }

  return async function devApiMiddleware(req, res, next) {
    let url;
    try {
      url = new URL(req.url ?? '/', 'http://dev.local');
    } catch {
      return next();
    }
    const pathname = url.pathname;
    const method = (req.method ?? 'GET').toUpperCase();

    const route = routes.find(
      (candidate) =>
        candidate.methods.includes(method) &&
        candidate.pattern.test(pathname),
    );
    if (!route) {
      // La ruta existe pero con otro método. En Vercel el runtime invoca la
      // función igualmente y es el handler el que responde 405 con su `Allow`;
      // aquí se reproduce esa respuesta para que el dev server no devuelva un
      // 404 vacío y engañe a quien prueba la API a mano.
      const known = routes.find((candidate) => candidate.pattern.test(pathname));
      if (known && !res.headersSent) {
        res.statusCode = 405;
        res.setHeader('Allow', known.methods.join(', '));
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(
          JSON.stringify({
            error: { category: 'VALIDATION_ERROR', message: `Método ${method} no soportado` },
          }),
        );
        return;
      }
      return next();
    }

    const match = pathname.match(route.pattern);
    // `Object.fromEntries` colapsa los parámetros REPETIDOS a la última
    // aparición, y con eso un `?country=A&country=B` aplicaría en silencio el
    // filtro `B`, que no es el que se pidió. Aquí un repetido se expone como
    // ARRAY, que es la forma que los validadores ya rechazan. Sirve para que esa
    // barrera se pueda probar en local y no solo en producción.
    const query = {};
    for (const [key, value] of url.searchParams) {
      if (key in query) {
        // Un solo elemento es indistinguible de un valor simple, así que solo se
        // acumula a partir del segundo.
        query[key] = Array.isArray(query[key]) ? [...query[key], value] : [query[key], value];
        continue;
      }
      query[key] = value;
    }
    (route.params ?? []).forEach((name, index) => {
      query[name] = decodeURIComponent(match[index + 1]);
    });
    req.query = query;

    const contentType = req.headers['content-type'] ?? '';
    if (contentType.includes('application/json')) {
      req.body = await readBody(req);
    }

    try {
      const module = await server.ssrLoadModule(route.file);
      const handler = module.default ?? module.handler;
      await handler(req, res);
    } catch (error) {
      console.error('[dev-api] error en', pathname, error instanceof Error ? error.message : error);
      if (!res.headersSent && typeof res.statusCode === 'number') {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: { category: 'UNKNOWN', message: 'Error interno del servidor' } }));
      } else {
        res.end();
      }
    }
  };
}

export { createDevApiMiddleware };
