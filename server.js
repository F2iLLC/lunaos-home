import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const routes = new Map([
  ['/', ['index.html', 'text/html']],
  ['/styles.css', ['styles.css', 'text/css']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/tasks.js', ['tasks.js', 'text/javascript']],
]);

export function createAppServer() {
  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const route = routes.get(request.url);
    if (!route) {
      response.writeHead(404).end();
      return;
    }
    try {
      const content = await readFile(new URL(`./src/${route[0]}`, import.meta.url));
      response.writeHead(200, { 'Content-Type': `${route[1]}; charset=utf-8` });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch {
      response.writeHead(500).end('Unable to load the application.');
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createAppServer();
  server.on('error', () => {
    console.error('Could not start Luna OS Home. Check whether port 4173 is already in use.');
    process.exitCode = 1;
  });
  server.listen(4173, '127.0.0.1', () => console.log('Luna OS Home: http://127.0.0.1:4173'));
}
