import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfileReviewProposal } from '../lib/profile-review.js';

test('fictional GUI proposal preserves sourced fields, uncertainty and candidates without observations', () => {
  const proposal = createProfileReviewProposal();
  const alex = proposal.people.find(person => person.name === 'Alex Example');
  const casey = proposal.people.find(person => person.name === 'Casey Example');
  const workplace = alex.fields.find(field => field.label === 'Workplace');
  const membershipCode = alex.fields.find(field => field.label === 'Membership code');
  const relationship = proposal.people.find(person => person.name === 'Sam Example').fields[0];

  assert.equal(workplace.value, 'Willow Studio');
  assert.equal(workplace.status, undefined);
  assert.deepEqual(workplace.evidence, [{
    sourceLabel: 'Assistant memory example',
    sourceReference: 'Fictional note 1',
    observedAt: '2026-10-20T12:00:00.000Z',
    provenance: 'direct',
    value: 'Willow Studio',
    trust: 'untrusted-source-data',
  }]);
  assert.equal(membershipCode.value, null);
  assert.equal(membershipCode.uncertainty, 'conflicting');
  assert.deepEqual(membershipCode.evidence.map(item => item.value), ['AbC', 'abc']);
  assert.equal(relationship.uncertainty, 'single-source');
  assert.equal(relationship.evidence[0].provenance, 'inferred');
  assert.deepEqual(casey.fields, []);
  assert.equal(alex.suggestions.length, 1);
});
