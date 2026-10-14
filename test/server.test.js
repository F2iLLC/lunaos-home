import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { get } from 'node:http';
import { createAppServer } from '../server.js';

test('local server exposes only application assets and rejects arbitrary writes', async t => {
  const server = createAppServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  for (const path of ['/', '/styles.css', '/app.js', '/tasks.js', '/vault.js', '/draft-client.js']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.ok((await response.text()).length > 0);
  }
  for (const path of ['/README.md', '/.git/config', '/.env', '/server.js', '/package.json', '/%2e%2e/server.js']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
  const rejected = await fetch(base + '/', { method: 'POST', body: 'fictional content' });
  assert.equal(rejected.status, 405);
  assert.equal(rejected.headers.get('allow'), 'GET, HEAD');
  const head = await fetch(base + '/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('draft API rejects foreign sites, rebinding hosts, bad input and stale edits', async t => {
  const server = createAppServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'X-Home-Preview': '1', 'Content-Type': 'application/json', Origin: base };
  const post = (path, value, extra = {}) => fetch(base + path, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(value) });
  assert.equal((await fetch(base + '/api/draft')).status, 403);
  assert.equal((await post('/api/example', {}, { Origin: 'https://foreign.example' })).status, 403);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    get(base, { headers: { Host: 'foreign.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(foreignHostStatus, 403);
  assert.equal((await post('/api/example', {}, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await post('/api/example', {}, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post('/api/example', 'x'.repeat(65537))).status, 413);
  assert.equal((await fetch(base + '/api/example', { method: 'POST', headers, body: '{' })).status, 400);
  const { draft } = await (await post('/api/example', {})).json();
  assert.equal(draft.people.length, 2);
  assert.equal((await post('/api/example', {})).status, 409);
  const change = { draftId: draft.id, personId: draft.people[0].id, itemId: draft.people[0].fields[0].id, revision: 0, action: 'confirm' };
  assert.equal((await post('/api/review', change)).status, 200);
  assert.equal((await post('/api/review', change)).status, 409);
  assert.equal((await post('/api/discard', { draftId: draft.id, revision: 0 })).status, 409);
  assert.equal((await post('/api/discard', { draftId: draft.id, revision: 1 })).status, 200);
  assert.equal((await (await fetch(base + '/api/draft', { headers })).json()).draft, null);
});
