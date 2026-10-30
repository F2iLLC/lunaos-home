import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { exampleProposal } from '../lib/drafts.js';

test('real stdio protocol and HTTP GUI share one draft and correction state', { timeout: 20000 }, async t => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../assistant.js', import.meta.url))],
    env: { LUNA_HOME_PREVIEW_PORT: '0' }, stderr: 'pipe',
  });
  const client = new Client({ name: 'synthetic-protocol-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(transport);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ['home_correct_draft', 'home_open_home', 'home_review_requests', 'home_stage_draft']);
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true, result.content[0]?.text);
    return JSON.parse(result.content[0].text);
  };
  const staged = await call('home_stage_draft', exampleProposal);
  const url = new URL(staged.reviewUrl);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.search, '');
  assert.equal(url.hash, '#vault');
  const headers = { 'X-Home-Preview': '1', 'Content-Type': 'application/json', Origin: url.origin };
  const get = async () => (await (await fetch(`${url.origin}/api/draft`, { headers })).json()).draft;
  const review = async input => {
    const response = await fetch(`${url.origin}/api/review`, { method: 'POST', headers, body: JSON.stringify(input) });
    assert.equal(response.status, 200);
    return (await response.json()).draft;
  };
  const draft = await get();
  assert.equal(draft.id, staged.draftId);
  const ref = { draftId: draft.id, personId: draft.people[0].id, itemId: draft.people[0].fields[0].id };
  await review({ ...ref, revision: 0, action: 'flag' });
  let pending = await call('home_review_requests');
  assert.equal(pending.requests.length, 1);
  assert.equal(pending.requests[0].itemId, ref.itemId);
  assert.ok(!JSON.stringify(pending).includes('Moonrise Library'));
  await review({ ...ref, revision: 1, action: 'reply', value: 'Change it to Willow Workshop.' });
  pending = await call('home_review_requests');
  await call('home_correct_draft', { ...ref, revision: pending.revision, value: 'Willow Workshop' });
  const corrected = await get();
  assert.equal(corrected.people[0].fields[0].value, 'Willow Workshop');
  assert.equal(corrected.people[0].fields[0].status, 'proposed');
  const checked = await review({ ...ref, revision: corrected.revision, action: 'confirm' });
  assert.equal(checked.people[0].fields[0].status, 'confirmed');
  const refused = await client.callTool({ name: 'home_stage_draft', arguments: exampleProposal });
  assert.equal(refused.isError, true);
});
