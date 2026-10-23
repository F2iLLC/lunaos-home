import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createWindowsPreview } from '../lib/windows-preview.js';
import { VaultConflictError } from '../lib/vault-record-contract.js';
import { createAppServer } from '../server.js';

test('versioned GUI and MCP assistant use one grant and revision service', { timeout: 20000 }, async t => {
  let tick = 0;
  const rows = new Map();
  const store = {
    contractVersion: 2,
    async read(id) { return structuredClone(rows.get(id) ?? null); },
    async create(id, data) {
      if (rows.has(id)) throw new VaultConflictError();
      const revision = crypto.randomUUID(); rows.set(id, { revision, data }); return { revision };
    },
    async edit(id, data, expectedRevision) {
      if (rows.get(id)?.revision !== expectedRevision) throw new VaultConflictError();
      const revision = crypto.randomUUID(); rows.set(id, { revision, data }); return { revision };
    },
  };
  const preview = createWindowsPreview({ store, now: () => tick });
  const server = createAppServer({ windowsPreview: preview });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await preview.shutdown(); server.close(); server.closeAllConnections(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const gui = async input => {
    const response = await fetch(base + '/api/windows-preview', { method: 'POST', headers: {
      'Content-Type': 'application/json', 'X-Home-Preview': '1', 'X-Home-Windows-Key': preview.key, Origin: base,
    }, body: JSON.stringify(input) });
    return { status: response.status, body: await response.json() };
  };
  const client = new Client({ name: 'versioned-fictional-contract-check', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../scripts/windows-vault-assistant.mjs', import.meta.url))],
    env: { LUNA_HOME_WINDOWS_URL: base, LUNA_HOME_WINDOWS_ASSISTANT_KEY: preview.assistantKey }, stderr: 'pipe',
  });
  transport.stderr?.on('data', () => {});
  t.after(() => client.close());
  await client.connect(transport);
  const call = async (operation, arguments_) => {
    const result = await client.callTool({ name: `home_example_${operation}`, arguments: arguments_ });
    return { isError: result.isError === true, body: JSON.parse(result.content[0].text) };
  };
  const id = { recordId: 'alex-work' };
  const denied = await call('create', id);
  assert.equal(denied.body.code, 'DENIED');
  assert.equal((await gui({ action: 'assistant-approve', mode: 'setup' })).status, 200);
  const created = await call('create', id);
  assert.equal(created.isError, false);
  assert.equal(created.body.version, 2);
  assert.match(created.body.revision, /^[0-9a-f-]{36}$/);
  const local = (await gui({ action: 'approve', mode: 'setup' })).body;
  assert.equal(local.contractVersion, 2);
  const target = { action: 'record', grantId: local.grantId, recordId: 'alex-work' };
  const read = await gui({ ...target, operation: 'read' });
  assert.equal(read.body.revision, created.body.revision);
  assert.equal(read.body.data.value, 'Willow Studio');
  assert.equal((await gui({ ...target, operation: 'edit' })).body.code, 'INVALID');
  const edited = await gui({ ...target, operation: 'edit', expectedRevision: read.body.revision });
  assert.equal(edited.body.status, 'applied');
  assert.notEqual(edited.body.revision, read.body.revision);
  const stale = await call('edit', { ...id, expectedRevision: created.body.revision });
  assert.equal(stale.body.code, 'CONFLICT');
  assert.equal(rows.get('alex-work').data.value, 'Willow Workshop');
  assert.equal((await call('read', id)).body.code, 'DISCLOSURE_REQUIRED');
  await gui({ action: 'assistant-share', recordId: 'alex-work', field: 'value' });
  const shared = await call('read', id);
  assert.deepEqual(shared.body.data, { value: 'Willow Workshop' });
  assert.equal(shared.body.revision, edited.body.revision);
  tick = 60000;
  assert.equal((await call('edit', { ...id, expectedRevision: edited.body.revision })).body.code, 'DENIED');
  assert.equal((await gui({ ...target, operation: 'read' })).body.code, 'DENIED');
});
