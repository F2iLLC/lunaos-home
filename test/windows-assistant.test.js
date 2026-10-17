import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createWindowsPreview } from '../lib/windows-preview.js';
import { createAppServer } from '../server.js';

test('stdio assistant and GUI share one service with separate field disclosure', { timeout: 20000 }, async t => {
  let tick = 0;
  let suppressEditReceipt = false;
  let edits = 0;
  const records = new Map();
  const preview = createWindowsPreview({ now: () => tick, store: {
    read: async id => records.get(id),
    create: async (id, value) => { if (records.has(id)) throw Error('duplicate'); records.set(id, value); },
    edit: async (id, value) => { if (!records.has(id)) throw Error('missing'); edits++; records.set(id, value); if (suppressEditReceipt) throw Error('Synthetic lost receipt'); },
  } });
  const server = createAppServer({ windowsPreview: preview }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { preview.shutdown(); server.close(); server.closeAllConnections(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const gui = async input => {
    const response = await fetch(base + '/api/windows-preview', { method: 'POST', headers: {
      'Content-Type': 'application/json', 'X-Home-Preview': '1', 'X-Home-Windows-Key': preview.key, Origin: base,
    }, body: JSON.stringify(input) });
    assert.equal(response.status, 200); return response.json();
  };
  const client = new Client({ name: 'fictional-windows-protocol-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../scripts/windows-vault-assistant.mjs', import.meta.url))],
    env: { LUNA_HOME_WINDOWS_URL: base, LUNA_HOME_WINDOWS_ASSISTANT_KEY: preview.assistantKey }, stderr: 'pipe',
  });
  transport.stderr?.on('data', () => {});
  t.after(() => client.close());
  await client.connect(transport);
  assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), ['home_example_create', 'home_example_edit', 'home_example_read']);
  async function call(operation, recordId = 'alex-work', expectedCode) {
    const result = await client.callTool({ name: `home_example_${operation}`, arguments: { recordId } });
    const data = JSON.parse(result.content[0].text);
    if (expectedCode) { assert.equal(result.isError, true); assert.equal(data.code, expectedCode); }
    else assert.notEqual(result.isError, true, JSON.stringify(data));
    return data;
  }
  await call('read', 'alex-work', 'DENIED');
  // The bridge key cannot reach GUI approvals; the GUI key cannot act as a bridge.
  for (const [path, header, key] of [['windows-preview', 'X-Home-Windows-Key', preview.assistantKey], ['windows-assistant', 'X-Home-Assistant-Key', preview.key]]) {
    assert.equal((await fetch(base + '/api/' + path, { method: 'POST', headers: {
      'Content-Type': 'application/json', 'X-Home-Preview': '1', [header]: key, Origin: base,
    }, body: JSON.stringify({ action: 'approve', mode: 'setup' }) })).status, 403);
  }
  const bridgeApproval = await fetch(base + '/api/windows-assistant', { method: 'POST', headers: {
    'Content-Type': 'application/json', 'X-Home-Preview': '1', 'X-Home-Assistant-Key': preview.assistantKey, Origin: base,
  }, body: JSON.stringify({ action: 'assistant-approve', mode: 'setup' }) });
  assert.equal((await bridgeApproval.json()).code, 'INVALID');
  await gui({ action: 'assistant-approve', mode: 'setup' });
  const receipt = await call('create');
  assert.deepEqual(Object.keys(receipt).sort(), ['accessEnded', 'recordId', 'status']);
  await call('create', 'sam-school'); await call('edit');
  await call('read', 'alex-work', 'DISCLOSURE_REQUIRED');
  const local = await gui({ action: 'approve', mode: 'read' });
  const saved = await gui({ action: 'record', operation: 'read', recordId: 'alex-work', grantId: local.grantId });
  assert.equal(saved.value, 'Willow Workshop');
  await gui({ action: 'assistant-share', recordId: 'alex-work', field: 'value' });
  assert.deepEqual(await call('read'), { value: 'Willow Workshop' });
  await call('read', 'sam-school', 'DISCLOSURE_REQUIRED');
  await gui({ action: 'assistant-share', recordId: 'alex-work', field: 'label' });
  assert.deepEqual(await call('read'), { label: 'Workplace' });
  await gui({ action: 'assistant-unshare' });
  await call('read', 'alex-work', 'DISCLOSURE_REQUIRED');
  await gui({ action: 'assistant-approve', mode: 'read' });
  await call('edit', 'alex-work', 'DENIED');
  await call('read', 'alex-work', 'DISCLOSURE_REQUIRED');
  await gui({ action: 'assistant-share', recordId: 'sam-school', field: 'value' });
  assert.deepEqual(await call('read', 'sam-school'), { value: 'Meadow School' });
  tick = 60000;
  await call('read', 'sam-school', 'DENIED');
  await call('edit', 'alex-work', 'DENIED');
  await gui({ action: 'assistant-approve', mode: 'setup' });
  await gui({ action: 'assistant-end' });
  await call('edit', 'alex-work', 'DENIED');
  await gui({ action: 'assistant-approve', mode: 'setup' });
  suppressEditReceipt = true;
  const beforeUnknown = edits;
  await call('edit', 'alex-work', 'WRITE_UNKNOWN');
  await call('edit', 'alex-work', 'DENIED');
  assert.equal(edits, beforeUnknown + 1);
  await assert.rejects(preview.request({ action: 'assistant-approve', mode: 'setup' }), error => error.code === 'DENIED');
  await gui({ action: 'assistant-disconnect' });
  await call('read', 'alex-work', 'DENIED');
});

test('revoking assistant sharing withholds an in-flight read; ending blocks queued writes', async () => {
  const entered = Promise.withResolvers(); const release = Promise.withResolvers();
  let writes = 0;
  const preview = createWindowsPreview({ store: {
    async read() { entered.resolve(); await release.promise; return { memberId: 'alex-example', label: 'Workplace', value: 'Willow Studio' }; },
    async create() {}, async edit() { writes++; },
  } });
  const { connectionId } = await preview.assistantRequest({ action: 'connect' });
  await preview.request({ action: 'assistant-approve', mode: 'setup' });
  await preview.request({ action: 'assistant-share', recordId: 'alex-work', field: 'value' });
  const input = { action: 'record', connectionId, recordId: 'alex-work' };
  const reading = assert.rejects(preview.assistantRequest({ ...input, operation: 'read' }), error => error.code === 'DISCLOSURE_REQUIRED');
  await entered.promise;
  await preview.request({ action: 'assistant-unshare' });
  release.resolve(); await reading;
  // A new pending read keeps the serialized store queue occupied.
  const block = Promise.withResolvers(); const readingAgain = Promise.withResolvers();
  preview.shutdown();
  const second = createWindowsPreview({ store: {
    async read() { readingAgain.resolve(); await block.promise; return { memberId: 'alex-example', label: 'Workplace', value: 'Willow Studio' }; },
    async create() {}, async edit() { writes++; },
  } });
  const connected = await second.assistantRequest({ action: 'connect' });
  await second.request({ action: 'assistant-approve', mode: 'setup' });
  await second.request({ action: 'assistant-share', recordId: 'alex-work', field: 'value' });
  const record = { ...input, connectionId: connected.connectionId };
  const late = assert.rejects(second.assistantRequest({ ...record, operation: 'read' }), error => error.code === 'DENIED');
  await readingAgain.promise;
  const queued = assert.rejects(second.assistantRequest({ ...record, operation: 'edit' }), error => error.code === 'DENIED');
  await second.request({ action: 'assistant-end' });
  block.resolve(); await Promise.all([late, queued]);
  assert.equal(writes, 0); second.shutdown();
});
