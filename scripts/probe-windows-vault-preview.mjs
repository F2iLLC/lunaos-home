import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openWindowsProbeStore } from '../lib/windows-probe-store.js';
import { createWindowsPreview } from '../lib/windows-preview.js';
import { createAppServer } from '../server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const powershell = process.env.LUNA_HOME_PROBE_POWERSHELL || 'pwsh';
if (process.argv[2] === '--child') {
  let input = '';
  for await (const chunk of process.stdin) { input += chunk; if (input.length > 2048) throw Error('Invalid fixture request.'); }
  const store = await openWindowsProbeStore({ powershell, probeId: JSON.parse(input).probeId });
  const preview = createWindowsPreview({ store });
  const server = createAppServer({ windowsPreview: preview });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  process.stdout.write(JSON.stringify({ port: server.address().port, key: preview.key, assistantKey: preview.assistantKey, pid: process.pid }) + '\n');
} else {
  async function launch(probeId) {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    const closed = once(child, 'close');
    let text = '';
    let started;
    try {
      started = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill(); reject(Error('Preview did not start.')); }, 30000);
        child.once('error', () => { clearTimeout(timer); reject(Error('Preview could not start.')); });
        child.once('close', () => { clearTimeout(timer); reject(Error('Preview stopped early.')); });
        child.stdout.on('data', chunk => {
          text += chunk;
          if (text.length > 4096) { child.kill(); clearTimeout(timer); reject(Error('Unexpected preview output.')); }
          else if (text.includes('\n')) {
            clearTimeout(timer);
            try { resolve(JSON.parse(text.trim())); } catch { child.kill(); reject(Error('Invalid preview output.')); }
          }
        });
        child.stdin.end(JSON.stringify({ probeId }));
      });
    } catch (error) { child.kill(); await closed; throw error; }
    const base = `http://127.0.0.1:${started.port}`;
    return {
      ...started,
      async call(input, key = started.key) {
        const response = await fetch(base + '/api/windows-preview', {
          method: 'POST', signal: AbortSignal.timeout(35000), headers: {
            'Content-Type': 'application/json', 'X-Home-Preview': '1', 'X-Home-Windows-Key': key, Origin: base,
          }, body: JSON.stringify(input),
        });
        return { status: response.status, data: await response.json() };
      },
      async stop() { child.kill(); await closed; },
    };
  }
  const store = await openWindowsProbeStore({ powershell, create: true });
  let running;
  let assistant;
  const record = (grantId, operation, recordId = 'alex-work') => ({ action: 'record', grantId, operation, recordId });
  try {
    running = await launch(store.probeId);
    const approve = await running.call({ action: 'approve', mode: 'setup' });
    assert.equal(approve.status, 200);
    const grant = approve.data.grantId;
    for (const id of ['alex-work', 'sam-school']) assert.equal((await running.call(record(grant, 'create', id))).status, 200);
    assert.equal((await running.call(record(grant, 'edit'))).status, 200);
    assert.equal((await running.call(record(grant, 'read'))).data.value, 'Willow Workshop');
    assistant = new Client({ name: 'fictional-encrypted-stdio-test', version: '1.0.0' });
    const transport = new StdioClientTransport({ command: process.execPath,
      args: [fileURLToPath(new URL('./windows-vault-assistant.mjs', import.meta.url))],
      env: { LUNA_HOME_WINDOWS_URL: `http://127.0.0.1:${running.port}`, LUNA_HOME_WINDOWS_ASSISTANT_KEY: running.assistantKey }, stderr: 'pipe',
    });
    transport.stderr?.on('data', () => {});
    await assistant.connect(transport);
    const tool = async (operation, recordId = 'alex-work') => {
      const response = await assistant.callTool({ name: `home_example_${operation}`, arguments: { recordId } });
      return { failed: response.isError === true, value: JSON.parse(response.content[0].text) };
    };
    assert.equal((await tool('read')).value.code, 'DENIED');
    await running.call({ action: 'assistant-approve', mode: 'setup' });
    const receipt = await tool('edit');
    assert.equal(receipt.failed, false);
    assert.deepEqual(Object.keys(receipt.value).sort(), ['accessEnded', 'recordId', 'status']);
    assert.equal((await tool('read')).value.code, 'DISCLOSURE_REQUIRED');
    await running.call({ action: 'assistant-share', recordId: 'alex-work', field: 'value' });
    assert.deepEqual((await tool('read')).value, { value: 'Willow Workshop' });
    assert.equal((await tool('read', 'sam-school')).value.code, 'DISCLOSURE_REQUIRED');
    await running.call({ action: 'assistant-unshare' });
    assert.equal((await tool('read')).value.code, 'DISCLOSURE_REQUIRED');
    await running.call({ action: 'assistant-end' });
    assert.equal((await tool('edit')).value.code, 'DENIED');
    await assistant.close(); assistant = undefined;
    const read = (await running.call({ action: 'approve', mode: 'read' })).data.grantId;
    const before = await readFile(join(store.directory, 'records.bin'));
    assert.equal((await running.call(record(read, 'edit'))).data.code, 'DENIED');
    await running.call({ action: 'end', grantId: read });
    assert.equal((await running.call(record(read, 'read'))).data.code, 'DENIED');
    assert.deepEqual(await readFile(join(store.directory, 'records.bin')), before);
    const old = { pid: running.pid, key: running.key, grant };
    await running.stop(); running = undefined;
    running = await launch(store.probeId);
    assert.notEqual(running.pid, old.pid);
    assert.equal((await running.call({ action: 'approve', mode: 'read' }, old.key)).status, 403);
    assert.equal((await running.call(record(old.grant, 'read'))).data.code, 'DENIED');
    const fresh = (await running.call({ action: 'approve', mode: 'read' })).data.grantId;
    assert.equal((await running.call(record(fresh, 'read'))).data.value, 'Willow Workshop');
    assert.equal((await running.call(record(fresh, 'read', 'sam-school'))).data.value, 'Meadow School');
    for (const encoding of ['utf8', 'utf16le']) for (const marker of ['Willow Workshop', 'Meadow School', 'alex-example', 'sam-example']) {
      assert.equal(before.toString(encoding).includes(marker), false);
    }
  } finally {
    if (assistant) await assistant.close();
    if (running) await running.stop();
    await store.removeSyntheticStore();
  }
  await assert.rejects(stat(store.directory), e => e.code === 'ENOENT');
  console.log('PASS: real Windows encrypted storage through GUI HTTP and stdio MCP; receipt-only writes, explicit field disclosure, withheld fields/other records, stopped sharing/end denial, two members, create/edit/read, read-only/end denials, distinct-process restart, old capability/grant rejection, fresh approved reads, ciphertext markers absent and cleanup. No native GUI, OS unlock or live model proof.');
}
