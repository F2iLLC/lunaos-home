// The browser preview uses the local process. The native entry supplies an
// offline client before loading the GUI; there is no automatic network fallback.
let client = async (path, input) => {
  const response = await fetch(path, {
    method: input === undefined ? 'GET' : 'POST',
    headers: { 'X-Home-Preview': '1', ...(input === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: input === undefined ? undefined : JSON.stringify(input),
    signal: AbortSignal.timeout(8000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'This change could not be completed.');
  return data;
};
let assistantReview = true;
export function useOfflineDraftClient(offlineClient) { client = offlineClient; assistantReview = false; }
export const requestDraft = (path, input) => client(path, input);
export const canRequestAssistantReview = () => assistantReview;
