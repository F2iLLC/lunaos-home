import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createWindowsPreview, previewLifetimeMs } from '../lib/windows-preview.js';
import { createAppServer } from '../server.js';

function memoryStore() {
  const records = new Map();
  return {
    read: async id => records.get(id),
    create: async (id, value) => { if (records.has(id)) throw Error('duplicate'); records.set(id, value); },
    edit: async (id, value) => { if (!records.has(id)) throw Error('missing'); records.set(id, value); },
  };
}
const request = (grantId, operation, recordId = 'alex-work') => ({ action: 'record', grantId, operation, recordId });
const denied = error => error.code === 'DENIED';

test('Windows GUI controller enforces approved scope, expiry, replacement and end', async () => {
  let tick = 0;
  const preview = createWindowsPreview({ store: memoryStore(), now: () => tick });
  await assert.rejects(preview.request(request(crypto.randomUUID(), 'create')), denied);
  const setup = await preview.request({ action: 'approve', mode: 'setup' });
  await preview.request(request(setup.grantId, 'create'));
  await preview.request(request(setup.grantId, 'create', 'sam-school'));
  await preview.request(request(setup.grantId, 'edit'));
  assert.equal((await preview.request(request(setup.grantId, 'read'))).value, 'Willow Workshop');
  assert.equal((await preview.request(request(setup.grantId, 'read', 'sam-school'))).value, 'Meadow School');
  const read = await preview.request({ action: 'approve', mode: 'read' });
  await assert.rejects(preview.request(request(setup.grantId, 'edit')), denied);
  await assert.rejects(preview.request(request(read.grantId, 'edit')), denied);
  await assert.rejects(preview.request(request(read.grantId, 'create')), denied);
  await assert.rejects(preview.request({ ...request(read.grantId, 'read'), destination: 'claude' }), e => e.code === 'INVALID');
  await assert.rejects(preview.request({ ...request(read.grantId, 'edit'), data: { value: 'arbitrary' } }), e => e.code === 'INVALID');
  await assert.rejects(preview.request(request(read.grantId, 'delete')), e => e.code === 'INVALID');
  await assert.rejects(preview.request(request(read.grantId, 'read', 'other-record')), e => e.code === 'INVALID');
  await preview.request({ action: 'end', grantId: read.grantId });
  await assert.rejects(preview.request(request(read.grantId, 'read')), denied);
  const expiring = await preview.request({ action: 'approve', mode: 'setup' });
  tick = previewLifetimeMs;
  await assert.rejects(preview.request(request(expiring.grantId, 'edit')), denied);
  await assert.rejects(preview.request(request(expiring.grantId, 'read')), denied);
  preview.shutdown();
  await assert.rejects(preview.request({ action: 'approve', mode: 'read' }), denied);
});

test('end from GUI denies queued writes and suppresses late read contents', async () => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let edits = 0;
  const preview = createWindowsPreview({ store: {
    async read() { entered.resolve(); await release.promise; return { memberId: 'alex-example', label: 'Workplace', value: 'Willow Studio' }; },
    async create() {}, async edit() { edits++; },
  } });
  const grant = await preview.request({ action: 'approve', mode: 'setup' });
  const reading = assert.rejects(preview.request(request(grant.grantId, 'read')), denied);
  await entered.promise;
  const editing = assert.rejects(preview.request(request(grant.grantId, 'edit')), denied);
  await preview.request({ action: 'end', grantId: grant.grantId });
  release.resolve();
  await Promise.all([reading, editing]);
  assert.equal(edits, 0);
  preview.shutdown();
});

test('opt-in HTTP preview requires current process capability and same-origin guards', async t => {
  const preview = createWindowsPreview({ store: memoryStore() });
  const server = createAppServer({ windowsPreview: preview });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { preview.shutdown(); server.close(); server.closeAllConnections(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'Content-Type': 'application/json', 'X-Home-Preview': '1', 'X-Home-Windows-Key': preview.key, Origin: base };
  const post = (input, extra = {}) => {
    // fetch normalizes Host to the URL host. Send this adversarial header on the
    // actual wire so the unchanged 403 assertion exercises the intended request.
    if (extra.Host) return new Promise((resolve, reject) => {
      const outgoing = httpRequest(base + '/api/windows-preview', { method: 'POST', headers: { ...headers, ...extra } }, response => {
        response.resume(); resolve({ status: response.statusCode });
      });
      outgoing.on('error', reject); outgoing.end(JSON.stringify(input));
    });
    return fetch(base + '/api/windows-preview', { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(input) });
  };
  assert.equal((await fetch(base + '/windows-vault')).status, 200);
  const approve = { action: 'approve', mode: 'setup' };
  for (const extra of [{ 'X-Home-Windows-Key': '' }, { 'X-Home-Windows-Key': 'wrong' }, { Origin: 'https://foreign.example' }, { 'Sec-Fetch-Site': 'cross-site' }, { Host: 'foreign.example' }]) {
    assert.equal((await post(approve, extra)).status, 403, JSON.stringify(extra));
  }
  assert.equal((await post('x'.repeat(2049))).status, 413);
  assert.equal((await post(approve, { 'Content-Type': 'text/plain' })).status, 415);
  const grant = await (await post(approve)).json();
  assert.equal((await post(request(grant.grantId, 'create'))).status, 200);
  assert.equal((await (await post(request(grant.grantId, 'read'))).json()).value, 'Willow Studio');
  await post({ action: 'end', grantId: grant.grantId });
  assert.equal((await post(request(grant.grantId, 'edit'))).status, 409);
  const ordinary = createAppServer(); ordinary.listen(0, '127.0.0.1'); await once(ordinary, 'listening');
  t.after(() => { ordinary.close(); ordinary.closeAllConnections(); });
  const normal = `http://127.0.0.1:${ordinary.address().port}`;
  assert.equal((await fetch(normal + '/windows-vault')).status, 404);
  assert.equal((await fetch(normal + '/windows-vault.js')).status, 404);
  assert.equal((await fetch(normal + '/api/windows-preview', { method: 'POST', headers: { ...headers, Origin: normal }, body: JSON.stringify(approve) })).status, 404);
});
