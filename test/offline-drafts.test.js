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
  assert.equal(workplace.status, 'proposed');
  assert.equal(conflict.status, 'needs-review');
  assert.equal(workplace.evidence[0].sourceReference, 'Fictional note 1');
  assert.deepEqual(casey.fields, []);
  await assert.rejects(client('/api/review', { ...ref, itemId: workplace.id, revision: 0, action: 'reply', value: 'Fictional correction' }), /not connected/);
  const confirmed = await client('/api/review', { ...ref, itemId: workplace.id, revision: 0, action: 'confirm' });
  assert.equal(confirmed.draft.people[0].fields[0].status, 'confirmed');
  const edited = await client('/api/review', { ...ref, itemId: workplace.id, revision: 1, action: 'edit', value: 'Willow Workshop' });
  assert.equal(edited.draft.people[0].fields[0].status, 'proposed');
  assert.equal(edited.draft.people[0].fields[0].source, 'Your edit');
  assert.equal(edited.draft.people[0].fields[0].evidence[0].value, 'Willow Studio');
  const declined = await client('/api/review', { ...ref, itemId: suggestion.id, revision: 2, action: 'decline' });
  assert.equal(declined.draft.people[0].suggestions[0].status, 'declined');
  const skipped = await client('/api/review', { ...ref, itemId: conflict.id, revision: 3, action: 'skip' });
  assert.equal(skipped.draft.people[0].fields.find(field => field.id === conflict.id).status, 'skipped');
  await assert.rejects(client('/api/review', { ...ref, itemId: conflict.id, revision: 4, action: 'confirm' }), /Correct/);
  assert.equal((await client('/api/draft')).draft.revision, 4);
  assert.equal((await createOfflineDraftClient()('/api/draft')).draft, null);
  await assert.rejects(client('/api/save', {}), /not available/);
  await client('/api/discard', { draftId: draft.id, revision: 4 });
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

test('manual start creates one reviewable typed detail with no account sources', async () => {
  const client = createOfflineDraftClient();
  const { draft } = await client('/api/manual', { name: 'Mira Example', label: 'Favorite activity', value: 'Gardening' });
  assert.equal(draft.people.length, 1);
  assert.equal(draft.people[0].name, 'Mira Example');
  const field = draft.people[0].fields[0];
  assert.equal(field.label, 'Favorite activity');
  assert.equal(field.value, 'Gardening');
  assert.equal(field.status, 'proposed');
  assert.equal(field.evidence[0].provenance, 'direct');
  assert.equal(field.evidence[0].sourceLabel, 'Entered manually');
  assert.equal(field.evidence[0].sourceReference, 'Entered in this local preview');
  assert.deepEqual(draft.sourceCoverage.map(source => [source.kind, source.status]), [
    ['manual', 'available'], ['assistant-memory', 'not-authorized'],
    ['email', 'not-authorized'], ['calendar', 'not-authorized'],
  ]);
  await assert.rejects(client('/api/manual', { name: 'Other Example', label: 'Role', value: 'Parent' }), /open draft/);
  const checked = await client('/api/review', { draftId: draft.id, personId: draft.people[0].id,
    itemId: field.id, revision: 0, action: 'confirm' });
  assert.equal(checked.draft.people[0].fields[0].status, 'confirmed');
  assert.equal((await createOfflineDraftClient()('/api/draft')).draft, null);
});

test('manual start rejects empty or unexpected input without opening a draft', async () => {
  const client = createOfflineDraftClient();
  await assert.rejects(client('/api/manual', { name: ' ', label: 'Role', value: 'Parent' }), /could not be read/);
  await assert.rejects(client('/api/manual', { name: 'Mira Example', label: 'Role', value: 'Parent', sourceId: 'email-fixture' }), /could not be read/);
  assert.equal((await client('/api/draft')).draft, null);
});
