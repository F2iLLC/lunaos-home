import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { exampleProposal } from '../lib/drafts.js';

export async function probeChatgptPlugin(pluginRoot) {
  pluginRoot = resolve(pluginRoot);
  const manifest = JSON.parse(await readFile(resolve(pluginRoot, 'mcp.json'), 'utf8'));
  const config = manifest.mcpServers.lunaos_home_preview;
  assert.equal(config.type, 'stdio');
  assert.equal(config.command, 'node');
  assert.deepEqual(config.args, ['${PLUGIN_ROOT}/runtime/assistant.js']);
  assert.equal(config.cwd, '${PLUGIN_ROOT}/runtime');
  assert.deepEqual(config.env, { LUNA_HOME_PREVIEW_PORT: '0' });
  const launch = async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: config.args.map(arg => arg.replaceAll('${PLUGIN_ROOT}', pluginRoot)),
      cwd: config.cwd.replaceAll('${PLUGIN_ROOT}', pluginRoot), env: config.env, stderr: 'pipe',
    });
    const client = new Client({ name: 'home-installed-package-probe', version: '1.0.0' });
    try { await client.connect(transport); }
    catch (error) { await client.close(); throw error; }
    return client;
  };
  const call = async (client, name, args = {}) => {
    const reply = await client.callTool({ name, arguments: args });
    assert.notEqual(reply.isError, true, reply.content[0]?.text);
    return JSON.parse(reply.content[0].text);
  };
  const client = await launch();
  let origin;
  let staleCorrection;
  try {
    const inventory = (await client.listTools()).tools.map(tool => tool.name).sort();
    assert.deepEqual(inventory, ['home_correct_draft', 'home_review_requests', 'home_stage_draft']);
    assert.deepEqual(await call(client, 'home_review_requests'), { draftId: null, revision: null, requests: [] });
    const staged = await call(client, 'home_stage_draft', exampleProposal);
    const reviewUrl = new URL(staged.reviewUrl);
    assert.equal(reviewUrl.hostname, '127.0.0.1');
    assert.equal(reviewUrl.hash, '#vault');
    assert.equal(reviewUrl.search, '');
    origin = reviewUrl.origin;
    const headers = { 'X-Home-Preview': '1', 'Content-Type': 'application/json', Origin: origin };
    for (const path of ['/', '/styles.css', '/app.js', '/tasks.js', '/vault.js', '/draft-client.js']) {
      const response = await fetch(`${origin}${path}`);
      assert.equal(response.status, 200, path);
      assert.ok((await response.text()).length > 0);
    }
    for (const path of ['/api/windows-preview', '/api/windows-assistant']) {
      assert.equal((await fetch(`${origin}${path}`, { headers, method: 'POST', body: '{}' })).status, 404);
    }
    assert.equal((await fetch(`${origin}/api/draft`, { headers: { ...headers, Origin: 'https://example.invalid' } })).status, 403);
    const get = async () => (await (await fetch(`${origin}/api/draft`, { headers })).json()).draft;
    const review = async input => {
      const response = await fetch(`${origin}/api/review`, { method: 'POST', headers, body: JSON.stringify(input) });
      assert.equal(response.status, 200);
      return (await response.json()).draft;
    };
    const draft = await get();
    assert.equal(draft.id, staged.draftId);
    const sam = structuredClone(draft.people[1]);
    const ref = { draftId: draft.id, personId: draft.people[0].id, itemId: draft.people[0].fields[0].id };
    await review({ ...ref, revision: 0, action: 'flag' });
    const pending = await call(client, 'home_review_requests');
    assert.equal(pending.requests.length, 1);
    assert.equal(pending.requests[0].reply, '');
    assert.ok(!JSON.stringify(pending).includes('Moonrise Library'));
    assert.equal((await client.callTool({ name: 'home_correct_draft', arguments: { ...ref, revision: 1, value: 'Willow Workshop' } })).isError, true);
    await review({ ...ref, revision: 1, action: 'reply', value: 'Change it to Willow Workshop.' });
    const replied = await call(client, 'home_review_requests');
    staleCorrection = { ...ref, revision: replied.revision, value: 'Willow Workshop' };
    await call(client, 'home_correct_draft', staleCorrection);
    const corrected = await get();
    assert.equal(corrected.people[0].fields[0].value, 'Willow Workshop');
    assert.equal(corrected.people[0].fields[0].status, 'proposed');
    assert.deepEqual(corrected.people[1], sam);
    assert.equal((await client.callTool({ name: 'home_correct_draft', arguments: staleCorrection })).isError, true);
    const confirmed = await review({ ...ref, revision: corrected.revision, action: 'confirm' });
    assert.equal(confirmed.people[0].fields[0].status, 'confirmed');
    assert.equal((await client.callTool({ name: 'home_stage_draft', arguments: exampleProposal })).isError, true);
  } finally { await client.close(); }
  // Client close must stop the listener, not leave a detached preview behind.
  let stopped = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    try { await fetch(origin, { signal: AbortSignal.timeout(500) }); }
    catch { stopped = true; break; }
    await new Promise(done => setTimeout(done, 50));
  }
  assert.ok(stopped, 'Preview listener must close with its MCP process');
  const restarted = await launch();
  try {
    assert.deepEqual(await call(restarted, 'home_review_requests'), { draftId: null, revision: null, requests: [] });
    assert.equal((await restarted.callTool({ name: 'home_correct_draft', arguments: staleCorrection })).isError, true);
  } finally { await restarted.close(); }
  return { packageProtocol: 'PASS', staticAssets: 'PASS', correctionIsolation: 'PASS', localConfirmation: 'HTTP harness only', restart: 'empty draft; old IDs denied', liveChatgpt: 'NOT TESTED' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Supply the generated or installed plugin directory.');
  try { console.log(JSON.stringify(await probeChatgptPlugin(process.argv[2]))); }
  catch { console.error('Installed-package synthetic probe failed; no ChatGPT acceptance is claimed.'); process.exitCode = 1; }
}
