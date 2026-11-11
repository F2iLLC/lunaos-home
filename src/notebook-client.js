const session = crypto.randomUUID();
export async function notebookRequest(body) {
  if (typeof __ANDROID_VAULT_DEBUG__ !== 'undefined' && __ANDROID_VAULT_DEBUG__ && window.__TAURI__?.core) {
    return JSON.parse(await window.__TAURI__.core.invoke('notebook_request', { body: JSON.stringify(body), session }));
  }
  const response = await fetch('/api/notebook', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Home-Preview': '1', 'X-Home-Session': session },
    body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Notebook unavailable.');
  return result;
}
