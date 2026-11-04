// Static server for the built site, so the pages can be previewed exactly as
// GitHub Pages will serve them. No dependencies and no directory listing.
//
//   node scripts/serve.js [--port 8099] [--dir site]

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const dirIndex = args.indexOf('--dir');
const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 8099;
const root = path.resolve(dirIndex >= 0 ? args[dirIndex + 1] : 'site');

const types = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
]);

createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${port}`);
  let filePath = path.join(root, decodeURIComponent(url.pathname));
  if (!filePath.startsWith(root)) {
    response.writeHead(403).end('forbidden');
    return;
  }
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    return;
  }
  response.writeHead(200, {
    'content-type': types.get(path.extname(filePath)) ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(filePath).pipe(response);
}).listen(port, '127.0.0.1', () => {
  console.log(`serving ${root} on http://127.0.0.1:${port}`);
});
