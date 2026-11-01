import { createProfileDraft } from './profile-draft.js';
import { z } from 'zod';

const profileInput = {
  people: [
    { id: 'alex-example', name: 'Alex Example' },
    { id: 'sam-example', name: 'Sam Example' },
    { id: 'casey-candidate', name: 'Casey Example' },
  ],
  sourceCoverage: [
    { id: 'memory-fixture', kind: 'assistant-memory', status: 'available' },
    { id: 'calendar-fixture', kind: 'calendar', status: 'unavailable', reason: 'Offline in this fictional example.' },
    { id: 'email-fixture', kind: 'email', status: 'available' },
    { id: 'manual-fixture', kind: 'manual', status: 'not-authorized' },
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
      sourceId: 'email-fixture', sourceReference: 'Fictional message 4', observedAt: '2026-10-21T08:30:00.000Z', provenance: 'direct',
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
  manual: 'Entered manually',
};

const manualInputSchema = z.object({
  name: z.string().trim().min(1).max(240),
  label: z.string().trim().min(1).max(240),
  value: z.string().trim().min(1).max(240),
}).strict();

// A first manual detail uses the same typed evidence contract as source-backed
// proposals. No account connector or storage adapter is involved.
export function createManualProfileReviewProposal(input) {
  const { name, label, value } = manualInputSchema.parse(input);
  const typedInput = {
    people: [{ id: 'manual-person', name }],
    sourceCoverage: [
      { id: 'manual-entry', kind: 'manual', status: 'available' },
      { id: 'memory-not-authorized', kind: 'assistant-memory', status: 'not-authorized' },
      { id: 'email-not-authorized', kind: 'email', status: 'not-authorized' },
      { id: 'calendar-not-authorized', kind: 'calendar', status: 'not-authorized' },
    ],
    observations: [{ personName: name, fieldKey: 'manual.detail', fieldLabel: label,
      value, sourceId: 'manual-entry', sourceReference: 'Entered in this local preview',
      observedAt: new Date().toISOString(), provenance: 'direct' }],
  };
  return toReviewProposal(typedInput, 'Entered manually in this local preview.');
}

/**
 * Convert the typed profile contract into the existing local review UI model.
 * All inputs are fictional constants; this function has no connector or save path.
 */
export function createProfileReviewProposal() {
  return toReviewProposal(profileInput, 'Fictional evidence for this local preview; not connected to a source.');
}

function toReviewProposal(input, sourceDescription) {
  const profile = createProfileDraft(input);
  const coverage = new Map(profile.sourceCoverage.map(source => [source.id, source]));
  const fieldsByPerson = new Map(profile.people.map(person => [person.id, []]));

  for (const field of profile.fields) {
    // Keep this adapter fail-closed: unresolved identity must never be assigned
    // to a candidate person by a GUI convenience conversion.
    if (field.identity.status !== 'matched' || !fieldsByPerson.has(field.identity.personId)) {
      throw new Error('This profile review proposal must use matched candidate identities.');
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
      source: sourceDescription,
      ...(field.value === null ? { status: 'needs-review' } : {}),
      uncertainty: field.uncertainty,
      evidence,
    });
  }

  return {
    sourceCoverage: profile.sourceCoverage,
    people: profile.people.map(person => ({
      name: person.name,
      fields: fieldsByPerson.get(person.id),
      suggestions: person.id === 'alex-example'
        ? [{ title: 'Library card', reason: 'Would keeping this fictional library detail be useful later?' }]
        : [],
    })),
  };
}
