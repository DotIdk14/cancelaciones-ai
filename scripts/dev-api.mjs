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
    { methods: ['GET'], pattern: /^\/api\/auth\/me$/, file: fromRoot('api/auth/me.ts') },
    { methods: ['POST'], pattern: /^\/api\/auth\/sign-in$/, file: fromRoot('api/auth/sign-in/index.ts') },
    { methods: ['POST'], pattern: /^\/api\/auth\/sign-up$/, file: fromRoot('api/auth/sign-up/index.ts') },
    { methods: ['POST'], pattern: /^\/api\/auth\/sign-out$/, file: fromRoot('api/auth/sign-out/index.ts') },
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
    if (!route) return next();

    const match = pathname.match(route.pattern);
    const query = { ...Object.fromEntries(url.searchParams) };
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