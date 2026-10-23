import { z } from 'zod';

const randomUUID = () => globalThis.crypto.randomUUID();

const text = z.string().trim().min(1).max(240);
const id = z.string().min(1).max(80);
const profileEvidenceSchema = z.object({
  sourceLabel: text,
  sourceReference: text,
  observedAt: z.iso.datetime(),
  provenance: z.enum(['direct', 'inferred']),
  value: text,
  trust: z.literal('untrusted-source-data'),
}).strict();
const profileUncertainty = z.enum(['single-source', 'corroborated', 'conflicting', 'ambiguous-identity', 'unmatched-identity']);
export const proposalSchema = z.object({
  people: z.array(z.object({
    name: text,
    fields: z.array(z.object({
      label: text,
      value: text.nullable(),
      source: text,
      status: z.literal('needs-review').optional(),
      uncertainty: profileUncertainty.optional(),
      evidence: z.array(profileEvidenceSchema).min(1).max(100).optional(),
    }).strict()).max(12),
    suggestions: z.array(z.object({ title: text, reason: text }).strict()).max(6),
  }).strict()).min(1).max(6),
}).strict().superRefine((proposal, context) => {
  let evidenceCount = 0;
  for (const [personIndex, person] of proposal.people.entries()) {
    for (const [fieldIndex, field] of person.fields.entries()) {
      evidenceCount += field.evidence?.length ?? 0;
      const unresolved = ['conflicting', 'ambiguous-identity', 'unmatched-identity'].includes(field.uncertainty);
      if (unresolved && (field.value !== null || field.status !== 'needs-review')) {
        context.addIssue({ code: 'custom', path: ['people', personIndex, 'fields', fieldIndex], message: 'Unresolved fields must have no selected value and require review.' });
      }
      if (field.value === null && (field.status !== 'needs-review' || !['conflicting', 'ambiguous-identity', 'unmatched-identity'].includes(field.uncertainty))) {
        context.addIssue({ code: 'custom', path: ['people', personIndex, 'fields', fieldIndex, 'value'], message: 'Only unresolved fields may omit a proposed value.' });
      }
    }
  }
  if (evidenceCount > 100) {
    context.addIssue({ code: 'custom', path: ['people'], message: 'A proposal may contain at most 100 evidence items.' });
  }
});
export const reviewSchema = z.object({
  draftId: id, personId: id, itemId: id, revision: z.number().int().nonnegative(),
  action: z.enum(['flag', 'reply', 'edit', 'confirm', 'skip', 'accept', 'decline']),
  value: text.optional(),
}).strict();
export const correctionSchema = z.object({
  draftId: id, personId: id, itemId: id, revision: z.number().int().nonnegative(), value: text,
}).strict();

export class DraftError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// Deliberately in-memory and draft-only. This service has no vault or filesystem adapter.
export function createDraftStore() {
  let draft = null;
  const copy = () => structuredClone(draft);
  function target(input) {
    if (!draft || input.draftId !== draft.id) throw new DraftError('This draft is no longer open. Refresh and try again.', 409);
    if (input.revision !== draft.revision) throw new DraftError('This draft changed. Refresh before making your change.', 409);
    const person = draft.people.find(item => item.id === input.personId);
    if (!person) throw new DraftError('That person is not in this draft.', 404);
    return person;
  }
  return {
    read: copy,
    stage(input) {
      const proposal = proposalSchema.parse(input);
      if (draft) throw new DraftError('Finish or discard the open draft before starting another.', 409);
      draft = {
        id: randomUUID(), revision: 0,
        people: proposal.people.map(person => ({
          id: randomUUID(), name: person.name,
          fields: person.fields.map(field => ({
            ...field,
            id: randomUUID(),
            status: field.status ?? 'proposed',
            question: field.status === 'needs-review' ? `What needs to change about ${field.label.toLowerCase()}?` : '',
            reply: '',
          })),
          suggestions: person.suggestions.map(item => ({ ...item, id: randomUUID(), status: 'proposed' })),
        })),
      };
      return copy();
    },
    review(input) {
      input = reviewSchema.parse(input);
      const person = target(input);
      if (['accept', 'decline'].includes(input.action)) {
        const suggestion = person.suggestions.find(item => item.id === input.itemId);
        if (!suggestion) throw new DraftError('That suggestion is not in this draft.', 404);
        suggestion.status = input.action === 'accept' ? 'accepted' : 'declined';
      } else {
        const field = person.fields.find(item => item.id === input.itemId);
        if (!field) throw new DraftError('That detail is not in this draft.', 404);
        if (['reply', 'edit'].includes(input.action) && !input.value) throw new DraftError('Add your change first.');
        if (input.action === 'reply' && field.status !== 'needs-review') throw new DraftError('Mark this detail as Needs review first.');
        if (input.action === 'confirm' && (field.status === 'needs-review' || field.value === null)) throw new DraftError('Correct this detail or skip it before confirming.');
        if (input.action === 'flag') {
          field.status = 'needs-review';
          field.question = `What needs to change about ${field.label.toLowerCase()}?`;
          field.reply = '';
        }
        if (input.action === 'reply') field.reply = input.value;
        if (input.action === 'edit') {
          field.value = input.value; field.status = 'proposed'; field.source = 'Your edit'; field.question = ''; field.reply = '';
        }
        if (input.action === 'confirm') field.status = 'confirmed';
        if (input.action === 'skip') { field.status = 'skipped'; field.question = ''; field.reply = ''; }
      }
      draft.revision++;
      return copy();
    },
    correct(input) {
      input = correctionSchema.parse(input);
      const person = target(input);
      const field = person.fields.find(item => item.id === input.itemId);
      if (!field || field.status !== 'needs-review' || !field.reply) throw new DraftError('A correction needs an open review and your reply.', 409);
      field.value = input.value;
      field.source = 'Assistant correction — please check';
      field.status = 'proposed'; field.question = ''; field.reply = '';
      draft.revision++;
      return copy();
    },
    pending() {
      if (!draft) return { draftId: null, revision: null, requests: [] };
      return {
        draftId: draft.id, revision: draft.revision,
        requests: draft.people.flatMap(person => person.fields.filter(field => field.status === 'needs-review').map(field => ({
          personId: person.id, itemId: field.id, question: field.question, reply: field.reply,
        }))),
      };
    },
    discard(input) {
      if (!draft || input.draftId !== draft.id || input.revision !== draft.revision) throw new DraftError('This draft changed. Refresh before discarding it.', 409);
      draft = null;
      return null;
    },
  };
}

export const exampleProposal = {
  people: [
    {
      name: 'Alex Example',
      fields: [
        { label: 'Workplace', value: 'Willow Studio', source: 'Fictional calendar example · unverified' },
        { label: 'Library', value: 'Moonrise Library', source: 'Fictional email example · unverified' },
      ],
      suggestions: [{ title: 'Library card', reason: 'You might want your library details in one place.' }],
    },
    {
      name: 'Sam Example',
      fields: [{ label: 'School', value: 'Meadow School', source: 'Supplied fictional family example · unverified' }],
      suggestions: [{ title: 'School contact', reason: 'Keep the school contact handy when you need it.' }],
    },
  ],
};
