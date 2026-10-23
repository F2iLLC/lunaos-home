import { z } from 'zod';

const id = z.string().trim().min(1).max(80);
const text = z.string().trim().min(1).max(240);
const fieldKey = z.string().regex(/^[a-z][a-z0-9._-]{0,79}$/);

export const sourceCoverageSchema = z.discriminatedUnion('status', [
  z.object({ id, kind: z.enum(['assistant-memory', 'calendar', 'email', 'manual']), status: z.literal('available') }).strict(),
  z.object({ id, kind: z.enum(['assistant-memory', 'calendar', 'email', 'manual']), status: z.literal('unavailable'), reason: text }).strict(),
  z.object({ id, kind: z.enum(['assistant-memory', 'calendar', 'email', 'manual']), status: z.literal('not-authorized') }).strict(),
]);

const personSchema = z.object({ id, name: text }).strict();
const observationSchema = z.object({
  personName: text,
  fieldKey,
  fieldLabel: text,
  value: text,
  sourceId: id,
}).strict();

export const profileDraftInputSchema = z.object({
  people: z.array(personSchema).max(12),
  sourceCoverage: z.array(sourceCoverageSchema).max(24),
  observations: z.array(observationSchema).max(100),
}).strict().superRefine((input, context) => {
  const sourceIds = new Set();
  for (const [index, source] of input.sourceCoverage.entries()) {
    if (sourceIds.has(source.id)) {
      context.addIssue({ code: 'custom', path: ['sourceCoverage', index, 'id'], message: 'Source ids must be unique.' });
    }
    sourceIds.add(source.id);
  }

  const personIds = new Set();
  for (const [index, person] of input.people.entries()) {
    if (personIds.has(person.id)) {
      context.addIssue({ code: 'custom', path: ['people', index, 'id'], message: 'Person ids must be unique.' });
    }
    personIds.add(person.id);
  }

  const sourceById = new Map(input.sourceCoverage.map(source => [source.id, source]));
  for (const [index, observation] of input.observations.entries()) {
    const source = sourceById.get(observation.sourceId);
    if (!source || source.status !== 'available') {
      context.addIssue({ code: 'custom', path: ['observations', index, 'sourceId'], message: 'Observations require a declared available source.' });
    }
  }
});

const evidenceSchema = z.object({
  sourceId: id,
  value: text,
  trust: z.literal('untrusted-source-data'),
}).strict();
const candidatePersonIds = z.array(id).max(12).refine(ids => new Set(ids).size === ids.length, 'Candidate person ids must be unique.');
const identitySchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('matched'), personId: id, candidatePersonIds: candidatePersonIds.length(1) }).strict(),
  z.object({ status: z.literal('ambiguous'), personId: z.null(), candidatePersonIds: candidatePersonIds.min(2) }).strict(),
  z.object({ status: z.literal('unmatched'), personId: z.null(), candidatePersonIds: candidatePersonIds.length(0) }).strict(),
]);
const profileFieldSchema = z.object({
  personName: text,
  identity: identitySchema,
  fieldKey,
  fieldLabel: text,
  value: text.nullable(),
  uncertainty: z.enum(['single-source', 'corroborated', 'conflicting', 'ambiguous-identity', 'unmatched-identity']),
  reviewStatus: z.literal('needs-review'),
  evidence: z.array(evidenceSchema).min(1).max(100),
}).strict().superRefine((field, context) => {
  const sources = new Set(field.evidence.map(item => item.sourceId));
  const values = new Set(field.evidence.map(item => normalize(item.value)));
  const expectedIdentityUncertainty = {
    ambiguous: 'ambiguous-identity',
    unmatched: 'unmatched-identity',
  }[field.identity.status];
  if (expectedIdentityUncertainty && field.uncertainty !== expectedIdentityUncertainty) {
    context.addIssue({ code: 'custom', path: ['uncertainty'], message: 'Unresolved identities must remain explicitly uncertain.' });
  }
  if (expectedIdentityUncertainty && field.value !== null) {
    context.addIssue({ code: 'custom', path: ['value'], message: 'Unresolved identities cannot select a value.' });
  }
  if (field.identity.status === 'matched' && ['ambiguous-identity', 'unmatched-identity'].includes(field.uncertainty)) {
    context.addIssue({ code: 'custom', path: ['uncertainty'], message: 'Identity uncertainty must match the identity state.' });
  }
  if (field.uncertainty === 'conflicting' && (field.value !== null || values.size < 2)) {
    context.addIssue({ code: 'custom', path: ['value'], message: 'Conflicting evidence cannot select a value.' });
  }
  if (['single-source', 'corroborated'].includes(field.uncertainty) && (field.value === null || values.size !== 1)) {
    context.addIssue({ code: 'custom', path: ['value'], message: 'A consistent claim must carry one proposed value.' });
  }
  if (field.uncertainty === 'single-source' && sources.size !== 1) {
    context.addIssue({ code: 'custom', path: ['uncertainty'], message: 'Single-source claims must have one source.' });
  }
  if (field.uncertainty === 'corroborated' && sources.size < 2) {
    context.addIssue({ code: 'custom', path: ['uncertainty'], message: 'Corroboration requires multiple sources.' });
  }
});

export const profileDraftSchema = z.object({
  version: z.literal(1),
  sourceCoverage: z.array(sourceCoverageSchema).max(24),
  fields: z.array(profileFieldSchema).max(100),
}).strict().superRefine((draft, context) => {
  const sourceById = new Map();
  for (const [index, source] of draft.sourceCoverage.entries()) {
    if (sourceById.has(source.id)) {
      context.addIssue({ code: 'custom', path: ['sourceCoverage', index, 'id'], message: 'Source ids must be unique.' });
    }
    sourceById.set(source.id, source);
  }
  for (const [fieldIndex, field] of draft.fields.entries()) {
    for (const [evidenceIndex, item] of field.evidence.entries()) {
      if (sourceById.get(item.sourceId)?.status !== 'available') {
        context.addIssue({ code: 'custom', path: ['fields', fieldIndex, 'evidence', evidenceIndex, 'sourceId'], message: 'Evidence requires a declared available source.' });
      }
    }
  }
});

/** @typedef {import('zod').infer<typeof profileDraftInputSchema>} ProfileDraftInput */
/** @typedef {import('zod').infer<typeof profileDraftSchema>} ProfileDraft */

function normalize(value) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

/**
 * Creates a read/draft-only profile proposal from already-authorized, typed observations.
 * This function does not read sources, call an assistant, or save records.
 * @param {ProfileDraftInput} input
 * @returns {ProfileDraft}
 */
export function createProfileDraft(input) {
  const parsed = profileDraftInputSchema.parse(input);
  const groups = new Map();

  for (const observation of parsed.observations) {
    const matchingPeople = parsed.people.filter(person => normalize(person.name) === normalize(observation.personName));
    const identity = matchingPeople.length === 1
      ? { status: 'matched', personId: matchingPeople[0].id, candidatePersonIds: [matchingPeople[0].id] }
      : matchingPeople.length > 1
        ? { status: 'ambiguous', personId: null, candidatePersonIds: matchingPeople.map(person => person.id) }
        : { status: 'unmatched', personId: null, candidatePersonIds: [] };
    const identityKey = identity.status === 'matched'
      ? `person:${identity.personId}`
      : `${identity.status}:${normalize(observation.personName)}`;
    const key = `${identityKey}\u0000${observation.fieldKey}`;
    let group = groups.get(key);
    if (!group) {
      group = { personName: observation.personName, identity, fieldKey: observation.fieldKey, fieldLabel: observation.fieldLabel, evidence: [] };
      groups.set(key, group);
    }
    group.evidence.push({
      sourceId: observation.sourceId,
      value: observation.value,
      trust: 'untrusted-source-data',
    });
  }

  const fields = [...groups.values()].map(group => {
    const distinctValues = new Map(group.evidence.map(item => [normalize(item.value), item.value]));
    let uncertainty;
    let value = null;
    if (group.identity.status === 'ambiguous') uncertainty = 'ambiguous-identity';
    else if (group.identity.status === 'unmatched') uncertainty = 'unmatched-identity';
    else if (distinctValues.size > 1) uncertainty = 'conflicting';
    else {
      const distinctSources = new Set(group.evidence.map(item => item.sourceId));
      uncertainty = distinctSources.size > 1 ? 'corroborated' : 'single-source';
      value = group.evidence[0].value;
    }
    return {
      ...group,
      value,
      uncertainty,
      reviewStatus: 'needs-review',
      evidence: group.evidence,
    };
  });

  return profileDraftSchema.parse({ version: 1, sourceCoverage: parsed.sourceCoverage, fields });
}
