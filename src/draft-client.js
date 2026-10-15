// The browser preview uses the local process. The native entry supplies an
// offline client before loading the GUI; there is no automatic network fallback.
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
      if (response.ok && !Object.hasOwn(data, 'draft')) throw new TypeError('Missing preview draft.');
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
