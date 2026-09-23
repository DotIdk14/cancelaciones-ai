// Mini servidor estatico (dev) para inspeccion visual de PDFs y despliegue local.
// Uso: node scripts/serve.mjs [puerto]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const port = Number(process.argv[2] ?? 8787);

const mime = {
  '.pdf': 'application/pdf',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    let filePath = resolve(root, rel);
    if (!filePath.startsWith(root + sep) && filePath !== root) {
      res.writeHead(403).end('forbidden');
      return;
    }
    let info;
    try {
      info = await stat(filePath);
    } catch {
      res.writeHead(404).end('not found');
      return;
    }
    if (info.isDirectory()) {
      filePath = resolve(filePath, 'index.html');
    }
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath)] ?? 'application/octet-stream' });
    res.end(body);
  } catch (err) {
    res.writeHead(500).end(String(err));
  }
});

server.listen(port, () => {
  console.log(`static server on http://localhost:${port} (root ${root})`);
});