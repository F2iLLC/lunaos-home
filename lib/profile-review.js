import { createProfileDraft } from './profile-draft.js';

const profileInput = {
  people: [
    { id: 'alex-example', name: 'Alex Example' },
    { id: 'sam-example', name: 'Sam Example' },
    { id: 'casey-candidate', name: 'Casey Example' },
  ],
  sourceCoverage: [
    { id: 'memory-fixture', kind: 'assistant-memory', status: 'available' },
    { id: 'calendar-fixture', kind: 'calendar', status: 'available' },
    { id: 'email-fixture', kind: 'email', status: 'available' },
  ],
  observations: [
    {
      personName: 'Alex Example', fieldKey: 'workplace', fieldLabel: 'Workplace', value: 'Willow Studio',
      sourceId: 'memory-fixture', sourceReference: 'Fictional note 1', observedAt: '2026-10-20T12:00:00.000Z', provenance: 'direct',
    },
    {
      personName: 'Alex Example', fieldKey: 'library', fieldLabel: 'Library', value: 'Moonrise Library',
      sourceId: 'email-fixture', sourceReference: 'Fictional message 2', observedAt: '2026-10-18T09:15:00.000Z', provenance: 'direct',
    },
    {
      personName: 'Alex Example', fieldKey: 'membership.code', fieldLabel: 'Membership code', value: 'AbC',
      sourceId: 'memory-fixture', sourceReference: 'Fictional note 3', observedAt: '2026-10-15T14:00:00.000Z', provenance: 'inferred',
    },
    {
      personName: 'Alex Example', fieldKey: 'membership.code', fieldLabel: 'Membership code', value: 'abc',
      sourceId: 'calendar-fixture', sourceReference: 'Fictional event 4', observedAt: '2026-10-21T08:30:00.000Z', provenance: 'direct',
    },
    {
      personName: 'Sam Example', fieldKey: 'relationship', fieldLabel: 'Possible relationship', value: 'Sibling of Alex Example',
      sourceId: 'email-fixture', sourceReference: 'Fictional message 5', observedAt: '2026-10-19T11:45:00.000Z', provenance: 'inferred',
    },
  ],
};

const sourceLabels = {
  'assistant-memory': 'Assistant memory example',
  calendar: 'Calendar example',
  email: 'Email example',
  manual: 'Manual example',
};

/**
 * Convert the typed profile contract into the existing local review UI model.
 * All inputs are fictional constants; this function has no connector or save path.
 */
export function createProfileReviewProposal() {
  const profile = createProfileDraft(profileInput);
  const coverage = new Map(profile.sourceCoverage.map(source => [source.id, source]));
  const fieldsByPerson = new Map(profile.people.map(person => [person.id, []]));

  for (const field of profile.fields) {
    // Keep this adapter fail-closed: unresolved identity must never be assigned
    // to a candidate person by a GUI convenience conversion.
    if (field.identity.status !== 'matched' || !fieldsByPerson.has(field.identity.personId)) {
      throw new Error('The synthetic profile review fixture must use matched candidate identities.');
    }
    const evidence = field.evidence.map(item => ({
      sourceLabel: sourceLabels[coverage.get(item.sourceId).kind],
      sourceReference: item.sourceReference,
      observedAt: item.observedAt,
      provenance: item.provenance,
      value: item.value,
      trust: item.trust,
    }));
    fieldsByPerson.get(field.identity.personId).push({
      label: field.fieldLabel,
      value: field.value,
      source: 'Fictional evidence for this local preview; not connected to a source.',
      ...(field.value === null ? { status: 'needs-review' } : {}),
      uncertainty: field.uncertainty,
      evidence,
    });
  }

  return {
    people: profile.people.map(person => ({
      name: person.name,
      fields: fieldsByPerson.get(person.id),
      suggestions: person.id === 'alex-example'
        ? [{ title: 'Library card', reason: 'Would keeping this fictional library detail be useful later?' }]
        : [],
    })),
  };
}
