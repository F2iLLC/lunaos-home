import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createDraftStore, exampleProposal, DraftError } from './lib/drafts.js';
import { VaultAccessError } from './lib/vault-sessions.js';

const routes = new Map([
  ['/', ['index.html', 'text/html']],
  ['/styles.css', ['styles.css', 'text/css']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/tasks.js', ['tasks.js', 'text/javascript']],
  ['/vault.js', ['vault.js', 'text/javascript']],
  ['/draft-client.js', ['draft-client.js', 'text/javascript']],
]);

export function createAppServer({ drafts = createDraftStore(), windowsPreview } = {}) {
  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    const port = request.socket.localPort;
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(request.headers.host)) {
      response.writeHead(403).end();
      return;
    }
    if (request.url.startsWith('/api/')) {
      const send = (status, value) => {
        response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(value));
      };
      const origin = `http://${request.headers.host}`;
      if (request.headers['x-home-preview'] !== '1' ||
          (request.headers.origin && request.headers.origin !== origin) ||
          (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin')) {
        send(403, { error: 'Open this preview on this computer to continue.' });
        return;
      }
      try {
        if (request.url === '/api/windows-preview' && windowsPreview) {
          if (!windowsPreview.acceptsKey(request.headers['x-home-windows-key'])) {
            send(403, { error: 'Open the link from this Windows preview to continue.' }); return;
          }
          if (request.method !== 'POST') { send(405, { error: 'Use a preview action.' }); return; }
          if (request.headers['content-type'] !== 'application/json') { send(415, { error: 'Unsupported request.' }); return; }
          const chunks = [];
          let bytes = 0;
          for await (const chunk of request) {
            bytes += chunk.length;
            if (bytes > 2048) { send(413, { error: 'That request is too large.' }); return; }
            chunks.push(chunk);
          }
          const result = await windowsPreview.request(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          send(200, result);
          return;
        }
        if (request.url === '/api/draft' && request.method === 'GET') {
          send(200, { draft: drafts.read() });
          return;
        }
        if (!['/api/example', '/api/review', '/api/discard'].includes(request.url)) {
          send(404, { error: 'That preview action is not available.' });
          return;
        }
        if (request.method !== 'POST') { send(405, { error: 'That action needs a change request.' }); return; }
        if (request.headers['content-type'] !== 'application/json') { send(415, { error: 'This preview needs a structured change.' }); return; }
        const chunks = [];
        let bytes = 0;
        for await (const chunk of request) {
          bytes += chunk.length;
          if (bytes <= 65536) chunks.push(chunk);
        }
        if (bytes > 65536) { send(413, { error: 'That change is too large for this preview.' }); return; }
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const draft = request.url === '/api/example' ? drafts.stage(exampleProposal)
          : request.url === '/api/review' ? drafts.review(input) : drafts.discard(input);
        send(200, { draft });
      } catch (error) {
        send(error instanceof VaultAccessError ? 409 : error instanceof DraftError ? error.status : 400, {
          ...(error instanceof VaultAccessError ? { code: error.code } : {}),
          error: error instanceof DraftError || error instanceof VaultAccessError ? error.message : 'That change could not be read. Refresh and try again.',
        });
      }
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const previewRoute = windowsPreview && ({
      '/windows-vault': ['windows-vault.html', 'text/html'],
      '/windows-vault.js': ['windows-vault.js', 'text/javascript'],
    })[request.url];
    const route = previewRoute || routes.get(request.url);
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
