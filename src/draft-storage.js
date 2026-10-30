import { canRequestAssistantReview } from './draft-client.js';
const $ = selector => document.querySelector(selector);
const key = new URLSearchParams(location.hash.split('?')[1] ?? '').get('save');
let approval = null;
let busy = false;
let needsReadback = false;
let generation = 0;
let expiry;
export const canSaveDraft = () => canRequestAssistantReview() && /^[a-f0-9]{64}$/.test(key ?? '');
export function preserveSaveRoutes() {
  if (!canSaveDraft()) return;
  for (const link of document.querySelectorAll('a[href^="#"]')) {
    const route = link.getAttribute('href');
    if (['#welcome', '#vault', '#checklist'].includes(route)) link.setAttribute('href', `${route}?save=${key}`);
  }
}
export function resetSave() {
  generation++;
  approval = null;
  clearTimeout(expiry);
  $('#save-approval').hidden = true;
  $('#save-summary').textContent = '';
  $('#saved-details').replaceChildren();
}
async function call(input) {
  const response = await fetch('/api/draft-storage', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Home-Preview': '1', 'X-Home-Save-Key': key },
    body: JSON.stringify(input), signal: AbortSignal.timeout(120000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Storage is unavailable.');
  return data;
}
async function action(run) {
  if (busy || !canSaveDraft()) return;
  busy = true;
  for (const node of $('#draft-storage').querySelectorAll('button')) node.disabled = true;
  try { await run(); }
  catch (error) {
    resetSave();
    needsReadback = true;
    $('#save-status').textContent = `The result could not be confirmed. View saved examples before trying another save. ${error instanceof TypeError || error.name === 'TimeoutError' ? 'Reconnect using the current Home link if needed.' : error.message}`;
  } finally {
    busy = false;
    for (const node of $('#draft-storage').querySelectorAll('button')) node.disabled = false;
  }
}
export async function prepareSave(ref) {
  return action(async () => {
    resetSave();
    $('#saved-details').replaceChildren();
    if (needsReadback) throw Error('Check the last saved values first.');
    const current = generation;
    const result = await call({ action: 'prepare', ...ref });
    if (current !== generation) return;
    if (typeof result.approval !== 'string' || typeof result.value !== 'string' || typeof result.name !== 'string' || typeof result.label !== 'string' || !(result.previousValue === null || typeof result.previousValue === 'string')) throw Error('Invalid save preview.');
    approval = result.approval;
    $('#save-summary').textContent = `${result.name} · ${result.label}: ${result.value}. ${result.previousValue === null ? 'Adds a new saved detail.' : `Replaces the saved value: ${result.previousValue}.`}`;
    $('#save-status').textContent = 'Review this save before approving it.';
    $('#save-approval').hidden = false;
    $('#confirm-save').focus();
    expiry = setTimeout(() => { resetSave(); $('#save-status').textContent = 'Save approval expired. Review the detail again.'; }, 60000);
  });
}
$('#confirm-save').addEventListener('click', () => action(async () => {
  if (!approval || needsReadback) throw Error('Review the save again.');
  const token = approval;
  resetSave();
  const result = await call({ action: 'save', approval: token });
  if (result.status !== 'saved') throw Error('Invalid save receipt.');
  $('#save-status').textContent = 'Saved on this computer. View saved examples to check it. Closing Home keeps this saved detail.';
}));
$('#cancel-save').addEventListener('click', () => action(async () => {
  resetSave(); await call({ action: 'cancel' });
  $('#save-status').textContent = 'Save cancelled. Nothing was saved by this approval.';
}));
$('#view-saved').addEventListener('click', () => action(async () => {
  resetSave();
  $('#saved-details').replaceChildren();
  const current = generation;
  const result = await call({ action: 'view' });
  if (current !== generation) return;
  if (!Array.isArray(result.records) || result.records.length > 3 || result.records.some(r => ![r.name, r.label, r.value].every(v => typeof v === 'string'))) throw Error('Invalid saved detail response.');
  for (const record of result.records) {
    const line = document.createElement('p');
    line.textContent = `${record.name} · ${record.label}: ${record.value}`;
    $('#saved-details').append(line);
  }
  needsReadback = false;
  $('#save-status').textContent = result.records.length ? 'Saved examples read from this computer. These values were not sent to the assistant.' : 'No examples saved on this computer yet.';
  expiry = setTimeout(() => { $('#saved-details').replaceChildren(); resetSave(); }, 60000);
}));
$('#hide-saved').addEventListener('click', () => { resetSave(); $('#saved-details').replaceChildren(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { resetSave(); $('#saved-details').replaceChildren(); }
});
$('#draft-storage').hidden = !canSaveDraft();
