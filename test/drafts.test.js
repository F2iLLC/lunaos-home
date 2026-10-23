import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftStore, exampleProposal } from '../lib/drafts.js';
import { createProfileReviewProposal } from '../lib/profile-review.js';

function setup() {
  const store = createDraftStore();
  const draft = store.stage(exampleProposal);
  const ref = { draftId: draft.id, personId: draft.people[0].id, itemId: draft.people[0].fields[0].id, revision: 0 };
  return { store, draft, ref };
}
test('fictional proposal is isolated, bounded and cannot replace a reviewed draft', () => {
  const { store, draft } = setup();
  draft.people[0].fields[0].value = 'outside mutation';
  assert.equal(store.read().people[0].fields[0].value, 'Willow Studio');
  assert.throws(() => store.stage(exampleProposal), /open draft/);
  assert.equal(createDraftStore().read(), null);
  assert.throws(() => createDraftStore().stage({ ...exampleProposal, saved: true }));
  assert.throws(() => createDraftStore().stage({ people: [] }));
});
test('review requires a reply, correction stays unconfirmed and stale requests fail', () => {
  const { store, ref } = setup();
  store.review({ ...ref, action: 'flag' });
  assert.match(store.pending().requests[0].question, /workplace/);
  assert.throws(() => store.correct({ ...ref, revision: 1, value: 'Willow Workshop' }), /reply/);
  assert.throws(() => store.review({ ...ref, revision: 1, action: 'confirm' }), /Correct/);
  store.review({ ...ref, revision: 1, action: 'reply', value: 'It should be Willow Workshop.' });
  assert.equal(store.pending().requests[0].reply, 'It should be Willow Workshop.');
  assert.throws(() => store.correct({ ...ref, revision: 1, value: 'stale' }), /changed/);
  const correction = store.correct({ ...ref, revision: 2, value: 'Willow Workshop' });
  assert.equal(correction.people[0].fields[0].status, 'proposed');
  assert.equal(store.pending().requests.length, 0);
  store.review({ ...ref, revision: 3, action: 'confirm' });
  assert.equal(store.read().people[0].fields[0].status, 'confirmed');
  assert.throws(() => store.correct({ ...ref, revision: 4, value: 'unrequested' }), /open review/);
});
test('wrong member and discarded draft cannot be changed; accepted suggestions stay drafts', () => {
  const { store, draft, ref } = setup();
  assert.throws(() => store.review({ ...ref, personId: draft.people[1].id, action: 'skip' }), /not in this draft/);
  const suggestion = draft.people[0].suggestions[0];
  store.review({ ...ref, itemId: suggestion.id, action: 'accept' });
  assert.equal(store.read().people[0].suggestions[0].status, 'accepted');
  assert.equal(store.read().people[1].fields[0].status, 'proposed');
  store.discard({ draftId: draft.id, revision: 1 });
  const next = store.stage(exampleProposal);
  assert.notEqual(next.id, ref.draftId);
  assert.throws(() => store.review({ ...ref, action: 'skip' }), /no longer open/);
});
test('manual changes require review again and skipped details leave the assistant queue', () => {
  const { store, ref } = setup();
  store.review({ ...ref, action: 'confirm' });
  store.review({ ...ref, revision: 1, action: 'edit', value: 'Fictional studio' });
  assert.equal(store.read().people[0].fields[0].status, 'proposed');
  store.review({ ...ref, revision: 2, action: 'flag' });
  store.review({ ...ref, revision: 3, action: 'skip' });
  assert.equal(store.pending().requests.length, 0);
  assert.equal(store.read().people[0].fields[0].status, 'skipped');
});

test('sourced staging rejects selected unresolved values, oversized fields and aggregate evidence', () => {
  const proposal = createProfileReviewProposal();
  const conflict = proposal.people[0].fields.find(field => field.uncertainty === 'conflicting');
  conflict.value = 'AbC';
  assert.throws(() => createDraftStore().stage(proposal), /Unresolved fields must have no selected value/);

  conflict.value = null;
  delete conflict.status;
  assert.throws(() => createDraftStore().stage(proposal), /require review/);

  const resolved = createProfileReviewProposal().people[0].fields[0];
  const manyFields = { people: [{ name: 'Alex Example', fields: Array.from({ length: 13 }, (_, index) => ({ ...resolved, label: `Detail ${index}` })), suggestions: [] }] };
  assert.throws(() => createDraftStore().stage(manyFields));

  const evidence = resolved.evidence[0];
  const manyEvidence = { people: [{ name: 'Alex Example', fields: [
    { ...resolved, label: 'First', evidence: Array.from({ length: 51 }, () => evidence) },
    { ...resolved, label: 'Second', evidence: Array.from({ length: 50 }, () => evidence) },
  ], suggestions: [] }] };
  assert.throws(() => createDraftStore().stage(manyEvidence), /at most 100 evidence items/);
});

test('a skipped unresolved field cannot be confirmed into an unreadable null state', () => {
  const store = createDraftStore();
  const draft = store.stage(createProfileReviewProposal());
  const person = draft.people[0];
  const conflict = person.fields.find(field => field.value === null);
  const ref = { draftId: draft.id, personId: person.id, itemId: conflict.id };
  store.review({ ...ref, revision: 0, action: 'skip' });
  assert.throws(() => store.review({ ...ref, revision: 1, action: 'confirm' }), /Correct/);
  assert.equal(store.read().people[0].fields.find(field => field.id === conflict.id).status, 'skipped');
  assert.equal(store.read().revision, 1);
});
