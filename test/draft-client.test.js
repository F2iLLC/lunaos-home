import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHttpDraftClient } from '../src/draft-client.js';
import { createDraftStore, exampleProposal } from '../lib/drafts.js';

test('a committed change with a lost response is not replayed before a successful refresh', async t => {
  const store = createDraftStore();
  const initial = store.stage(exampleProposal);
  let writes = 0;
  let dropWriteResponse = true;
  let unavailable = false;
  const server = createServer(async (request, response) => {
    if (unavailable) { response.destroy(); return; }
    let draft = store.read();
    if (request.method === 'POST') {
      writes++;
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      draft = store.review(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (dropWriteResponse) { response.destroy(); return; }
    }
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ draft }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const client = createHttpDraftClient((path, options) => fetch(`http://127.0.0.1:${server.address().port}${path}`, options));
  const change = {
    draftId: initial.id, personId: initial.people[0].id, itemId: initial.people[0].fields[0].id,
    revision: 0, action: 'edit', value: 'Willow Workshop',
  };
  await assert.rejects(client('/api/review', change), TypeError);
  assert.equal(store.read().revision, 1);
  assert.equal(store.read().people[0].fields[0].value, 'Willow Workshop');
  await assert.rejects(client('/api/review', change), /Check for updates/);
  await assert.rejects(client('/api/discard', { draftId: initial.id, revision: 1 }), /Check for updates/);
  assert.equal(writes, 1, 'uncertain writes must not be automatically or manually replayed');
  unavailable = true;
  await assert.rejects(client('/api/draft'), TypeError);
  unavailable = false;
  await client('/another-read');
  await assert.rejects(client('/api/review', change), /Check for updates/);
  const refreshed = await client('/api/draft');
  assert.equal(refreshed.draft.revision, 1);
  assert.equal(refreshed.draft.people[0].fields[0].status, 'proposed');
  dropWriteResponse = false;
  const confirmed = await client('/api/review', { ...change, revision: 1, action: 'confirm' });
  assert.equal(confirmed.draft.people[0].fields[0].status, 'confirmed');
  assert.equal(writes, 2);
});

test('timeout, malformed replies, stale edits and server errors require a real draft refresh', async () => {
  for (const failure of [
    () => { throw new DOMException('Timed out', 'TimeoutError'); },
    () => new Response('<html>unavailable</html>'),
    () => Response.json(null),
    () => Response.json({}),
    () => Response.json({ error: 'Refresh the draft.' }, { status: 409 }),
    () => Response.json({ error: 'Unavailable.' }, { status: 503 }),
  ]) {
    let calls = 0;
    let next = failure;
    const client = createHttpDraftClient(() => { calls++; return next(); });
    await assert.rejects(client('/api/review', {}));
    await assert.rejects(client('/api/example', {}), /Check for updates/);
    assert.equal(calls, 1);
    next = () => Response.json({});
    await assert.rejects(client('/api/draft'), TypeError);
    await assert.rejects(client('/api/example', {}), /Check for updates/);
    next = () => Response.json({ draft: null });
    assert.deepEqual(await client('/api/draft'), { draft: null });
    await client('/api/example', {});
    assert.equal(calls, 4);
  }
});
