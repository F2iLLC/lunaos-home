import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfflineDraftClient } from '../lib/offline-drafts.js';

test('offline review supports correction and confirmation without an assistant or persistence', async () => {
  const client = createOfflineDraftClient();
  assert.equal((await client('/api/draft')).draft, null);
  const { draft } = await client('/api/example', {});
  const ref = { draftId: draft.id, personId: draft.people[0].id, itemId: draft.people[0].fields[0].id };
  await client('/api/review', { ...ref, revision: 0, action: 'flag' });
  await assert.rejects(client('/api/review', { ...ref, revision: 1, action: 'reply', value: 'Fictional correction' }), /not connected/);
  await assert.rejects(client('/api/review', { ...ref, revision: 1, action: 'confirm' }), /Correct/);
  const edited = await client('/api/review', { ...ref, revision: 1, action: 'edit', value: 'Willow Workshop' });
  assert.equal(edited.draft.people[0].fields[0].status, 'proposed');
  await assert.rejects(client('/api/review', { ...ref, revision: 1, action: 'confirm' }), /changed/);
  const confirmed = await client('/api/review', { ...ref, revision: 2, action: 'confirm' });
  assert.equal(confirmed.draft.people[0].fields[0].status, 'confirmed');
  assert.equal((await createOfflineDraftClient()('/api/draft')).draft, null);
  await client('/api/discard', { draftId: draft.id, revision: 3 });
  assert.equal((await client('/api/draft')).draft, null);
});

test('offline adapter rejects unsupported operations and does not replace an open draft', async () => {
  const client = createOfflineDraftClient();
  const { draft } = await client('/api/example', {});
  await assert.rejects(client('/api/example', {}), /open draft/);
  await assert.rejects(client('/api/save', {}), /not available/);
  await assert.rejects(client('/api/review', null), /could not be read/);
  assert.deepEqual((await client('/api/draft')).draft, draft);
});
