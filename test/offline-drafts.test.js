import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfflineDraftClient } from '../lib/offline-drafts.js';

test('offline review supports correction and confirmation without an assistant or persistence', async () => {
  const client = createOfflineDraftClient();
  assert.equal((await client('/api/draft')).draft, null);
  const { draft } = await client('/api/example', {});
  const alex = draft.people.find(person => person.name === 'Alex Example');
  const casey = draft.people.find(person => person.name === 'Casey Example');
  const workplace = alex.fields.find(field => field.label === 'Workplace');
  const conflict = alex.fields.find(field => field.label === 'Membership code');
  const suggestion = alex.suggestions[0];
  const ref = { draftId: draft.id, personId: alex.id };
  assert.equal(workplace.status, 'needs-review');
  assert.equal(workplace.evidence[0].sourceReference, 'Fictional note 1');
  assert.deepEqual(casey.fields, []);
  await assert.rejects(client('/api/review', { ...ref, itemId: workplace.id, revision: 0, action: 'reply', value: 'Fictional correction' }), /not connected/);
  await assert.rejects(client('/api/review', { ...ref, itemId: workplace.id, revision: 0, action: 'confirm' }), /Correct/);
  const edited = await client('/api/review', { ...ref, itemId: workplace.id, revision: 0, action: 'edit', value: 'Willow Workshop' });
  assert.equal(edited.draft.people[0].fields[0].status, 'proposed');
  assert.equal(edited.draft.people[0].fields[0].source, 'Your edit');
  assert.equal(edited.draft.people[0].fields[0].evidence[0].value, 'Willow Studio');
  const declined = await client('/api/review', { ...ref, itemId: suggestion.id, revision: 1, action: 'decline' });
  assert.equal(declined.draft.people[0].suggestions[0].status, 'declined');
  const skipped = await client('/api/review', { ...ref, itemId: conflict.id, revision: 2, action: 'skip' });
  assert.equal(skipped.draft.people[0].fields.find(field => field.id === conflict.id).status, 'skipped');
  assert.equal((await createOfflineDraftClient()('/api/draft')).draft, null);
  await assert.rejects(client('/api/save', {}), /not available/);
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
