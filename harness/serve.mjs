// Tiny static server for the harness: any unknown path serves harness.html so
// the page can live at a GitHub-like URL (http://localhost:8631/acme/widget).
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json',
};

const port = Number(process.env.PORT || 8631);

createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  let file = null;
  if (path.startsWith('/dist/') || path.startsWith('/harness/')) {
    const candidate = join(root, path);
    if (candidate.startsWith(root) && existsSync(candidate)) file = candidate;
  }
  if (!file) file = join(root, 'harness/harness.html');
  try {
    const body = readFileSync(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(port, () => console.log(`harness at http://localhost:${port}/acme/widget`));
