// The browser preview uses the local process. The native entry supplies an
// offline client before loading the GUI; there is no automatic network fallback.
function isReadableDraft(draft) {
  if (draft === null) return true;
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const text = (value, max = 240, min = 1) => typeof value === 'string' && value.length >= min && value.length <= max;
  const list = (value, min, max, valid) => Array.isArray(value) && value.length >= min && value.length <= max && value.every(valid);
  const ids = new Set();
  const uniqueId = value => {
    if (!text(value, 80) || ids.has(value)) return false;
    ids.add(value);
    return true;
  };
  const profileUncertainty = ['single-source', 'corroborated', 'conflicting', 'ambiguous-identity', 'unmatched-identity'];
  const validEvidence = value => list(value, 1, 100, item => object(item)
    && text(item.sourceLabel) && text(item.sourceReference)
    && typeof item.observedAt === 'string' && !Number.isNaN(Date.parse(item.observedAt))
    && ['direct', 'inferred'].includes(item.provenance) && text(item.value)
    && item.trust === 'untrusted-source-data');
  // Validate the read contract before replacing UI state or clearing recovery.
  // This is response integrity checking, not authentication of the local service.
  return object(draft) && uniqueId(draft.id) && Number.isSafeInteger(draft.revision) && draft.revision >= 0
    && list(draft.people, 1, 6, person => object(person) && uniqueId(person.id) && text(person.name)
      && list(person.fields, 0, 12, field => object(field) && uniqueId(field.id)
        && text(field.label) && (text(field.value) || (field.value === null && ['needs-review', 'skipped'].includes(field.status) && profileUncertainty.includes(field.uncertainty))) && text(field.source)
        && ['proposed', 'needs-review', 'confirmed', 'skipped'].includes(field.status)
        && (field.uncertainty === undefined || profileUncertainty.includes(field.uncertainty))
        && (field.evidence === undefined || validEvidence(field.evidence))
        && text(field.question, 1024, 0) && text(field.reply, 240, 0))
      && list(person.suggestions, 0, 6, item => object(item) && uniqueId(item.id)
        && text(item.title) && text(item.reason) && ['proposed', 'accepted', 'declined'].includes(item.status)));
}

export function createHttpDraftClient(fetcher = (...args) => fetch(...args)) {
  let needsRefresh = false;
  return async (path, input) => {
    if (needsRefresh && input !== undefined) {
      throw new Error('Check for updates before making another change. Your last change may already have arrived.');
    }
    let response;
    let data;
    try {
      response = await fetcher(path, {
        method: input === undefined ? 'GET' : 'POST',
        headers: { 'X-Home-Preview': '1', ...(input === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: input === undefined ? undefined : JSON.stringify(input),
        signal: AbortSignal.timeout(8000),
      });
      data = await response.json();
      if (!data || typeof data !== 'object') throw new TypeError('Invalid preview response.');
      if (response.ok && (!Object.hasOwn(data, 'draft') || !isReadableDraft(data.draft))) {
        throw new TypeError('Invalid preview draft.');
      }
    } catch {
      // A failed response cannot tell us whether a write reached the service.
      // Never replay it; only a successful current-draft read clears this gate.
      needsRefresh = true;
      throw new TypeError('The local preview response could not be confirmed.');
    }
    if (!response.ok) {
      if (response.status === 409 || response.status >= 500) needsRefresh = true;
      throw new Error(data.error || 'This change could not be completed.');
    }
    if (path === '/api/draft' && input === undefined) needsRefresh = false;
    return data;
  };
}
let client = createHttpDraftClient();
let assistantReview = true;
export function useOfflineDraftClient(offlineClient) { client = offlineClient; assistantReview = false; }
export const requestDraft = (path, input) => client(path, input);
export const canRequestAssistantReview = () => assistantReview;
