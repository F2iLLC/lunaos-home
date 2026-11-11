import { request } from 'node:https';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

// The local Home server holds the enrolled relay credentials, never the page.
// No retry: a transport failure after a write has an unknown outcome.
export function createRemoteNotebook({ endpoint, token, certificate }) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || url.pathname !== '/question' || !/^[a-f0-9]{64}$/.test(token) || !certificate)
    throw new TypeError('Invalid notebook relay configuration');
  url.pathname = '/notebook';
  return {
    async request(body, session = randomUUID()) {
      if (typeof session !== 'string' || !/^[a-f0-9-]{32,64}$/.test(session)) throw new TypeError('Invalid session');
      try {
        return await new Promise((resolve, reject) => {
          const data = JSON.stringify(body);
          const req = request(url, { method: 'POST', ca: certificate, minVersion: 'TLSv1.2',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(data), 'X-Home-Session': session } }, res => {
            if (res.statusCode !== 200 || res.headers['content-type'] !== 'application/json') {
              res.resume(); reject(new Error('Notebook unavailable')); return;
            }
            let bytes = 0; const chunks = [];
            res.on('data', chunk => {
              bytes += chunk.length;
              if (bytes > 512 * 1024) { res.destroy(); reject(new Error('Response too large')); }
              else chunks.push(chunk);
            });
            res.on('error', reject);
            res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (error) { reject(error); } });
          });
          const deadline = setTimeout(() => req.destroy(new Error('Notebook timed out')), 15000);
          req.on('close', () => clearTimeout(deadline));
          req.on('error', reject);
          req.end(data);
        });
      } catch {
        return { status: body.action === 'snapshot' ? 'failed' : 'unknown',
          reply: 'I could not confirm the result. Reopen the list before trying again.',
          avatar: { animation: 'puzzled', success: false } };
      }
    },
  };
}

export async function remoteNotebookFromEnvironment(env = process.env) {
  if (!env.LUNA_HOME_NOTEBOOK_RELAY_CONFIG) return undefined;
  if (!isAbsolute(env.LUNA_HOME_NOTEBOOK_RELAY_CONFIG)) throw new TypeError('Absolute relay config path required');
  const config = JSON.parse(await readFile(env.LUNA_HOME_NOTEBOOK_RELAY_CONFIG, 'utf8'));
  return createRemoteNotebook(config);
}
