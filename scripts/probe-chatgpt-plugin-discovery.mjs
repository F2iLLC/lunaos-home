import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Exercise the real host's plugin parser and MCP startup. Unlike the SDK
// round-trip probe, this never launches assistant.js or calls draft tools.
export async function probePluginDiscovery(codexExecutable, marketplacePath) {
  if (!codexExecutable || !marketplacePath || !isAbsolute(codexExecutable) || !isAbsolute(marketplacePath)) {
    throw new Error('Supply absolute paths to the Codex executable and installed marketplace.json.');
  }
  const child = spawn(codexExecutable, ['app-server', '--stdio'], {
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  const pending = new Map();
  let nextId = 0;
  const rejectPending = error => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear();
  };
  const closed = new Promise(done => child.once('close', done));
  child.once('error', () => rejectPending(new Error('Could not start the supplied Codex executable.')));
  child.once('close', () => rejectPending(new Error('Client closed before discovery completed.')));
  child.stdin.on('error', () => rejectPending(new Error('Client input closed before discovery completed.')));
  child.stderr.resume(); // Do not publish machine configuration or unrelated diagnostics.
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    clearTimeout(item.timer);
    if (message.error) item.reject(new Error(`Client rejected ${item.method} (code ${message.error.code}).`));
    else item.resolve(message.result);
  });
  const request = (method, params) => new Promise((resolveRequest, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out waiting for ${method}.`)); }, 30000);
    pending.set(id, { method, resolve: resolveRequest, reject, timer });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
  try {
    await request('initialize', {
      clientInfo: { name: 'home_plugin_discovery_probe', version: '1.0.0' }, capabilities: { experimentalApi: true },
    });
    child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
    const { plugin } = await request('plugin/read', { marketplacePath, pluginName: 'lunaos-home-preview' });
    assert.equal(plugin.summary.installed, true, 'Install the package before checking client discovery.');
    assert.equal(plugin.summary.enabled, true, 'The installed plugin must be enabled.');
    assert.deepEqual(plugin.mcpServers, ['lunaos_home_preview'], 'The host did not discover the bundled MCP server.');
    const status = await request('mcpServerStatus/list', { serverName: 'lunaos_home_preview', detail: 'toolsAndAuthOnly' });
    assert.equal(status.data.length, 1, 'The host did not start the Home MCP server.');
    const server = status.data[0];
    assert.equal(server.pluginId, 'lunaos-home-preview@lunaos-home-local');
    assert.equal(server.httpOrigin, null, 'This probe requires the local stdio transport.');
    assert.equal(server.toolsError, null, 'The host could not list the Home tools.');
    assert.equal(server.serverInfo?.name, 'lunaos-home-draft-preview');
    const tools = Object.keys(server.tools).sort();
    assert.deepEqual(tools, ['home_correct_draft', 'home_review_requests', 'home_stage_draft']);
    return { clientDiscovery: 'PASS', installedVersion: plugin.summary.localVersion, tools, draftToolCalls: 0, liveChatgpt: 'NOT TESTED' };
  } finally {
    child.stdin.end();
    const killTimer = setTimeout(() => child.kill(), 3000);
    await closed;
    clearTimeout(killTimer);
    lines.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await probePluginDiscovery(process.argv[2], process.argv[3]))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
