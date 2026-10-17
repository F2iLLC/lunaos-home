const key = location.hash.slice(1);
history.replaceState(null, '', location.pathname); // Do not retain the process capability in navigation history.
let grant;
let revision = 0;
let timer;
const status = document.querySelector('#access-status');
const result = document.querySelector('#record-result');
const error = document.querySelector('#preview-error');
const accessButtons = [...document.querySelectorAll('#approve-read, #approve-setup, #end-access')];
const recordButtons = [...document.querySelectorAll('#read-record, #create-record, #edit-record')];
function clearAccess(message) {
  grant = undefined;
  revision++;
  clearTimeout(timer);
  result.textContent = '';
  status.textContent = message;
}
async function request(input) {
  const response = await fetch('/api/windows-preview', {
    method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(10000), headers: {
      'Content-Type': 'application/json', 'X-Home-Preview': '1', 'X-Home-Windows-Key': key,
    }, body: JSON.stringify(input),
  });
  const value = await response.json();
  if (!response.ok) throw Object.assign(Error(value.error), { code: value.code });
  return value;
}
for (const mode of ['read', 'setup']) document.querySelector(`#approve-${mode}`).addEventListener('click', async () => {
  accessButtons.forEach(button => { button.disabled = true; });
  clearAccess('Waiting for approval…');
  error.textContent = '';
  const pending = revision;
  const started = performance.now();
  try {
    const approved = await request({ action: 'approve', mode });
    if (pending !== revision) return;
    const remaining = approved.lifetimeMs - (performance.now() - started);
    if (remaining <= 0) { clearAccess('Access has ended. Choose access again to continue.'); return; }
    grant = approved.grantId;
    status.textContent = `${mode === 'read' ? 'Viewing' : 'Adding and changing'} approved for both examples · up to one minute. Nothing shared with an assistant.`;
    timer = setTimeout(() => clearAccess('Access has ended. Choose access again to continue.'), remaining);
  } catch (failure) { if (pending === revision) { clearAccess('Approval could not be confirmed. Any access granted ends within one minute.'); error.textContent = failure.message; } }
  finally { accessButtons.forEach(button => { button.disabled = false; }); }
});
document.querySelector('#end-access').addEventListener('click', async () => {
  const ending = grant;
  clearAccess('Ending access…');
  error.textContent = '';
  const pending = revision;
  if (!ending) { status.textContent = 'No active access on this screen.'; return; }
  try {
    await request({ action: 'end', grantId: ending });
    if (pending === revision) status.textContent = 'Access ended. Saved examples remain on this computer.';
  } catch (failure) {
    if (pending === revision) { status.textContent = 'Ending access could not be confirmed. The one-minute limit still applies.'; error.textContent = failure.message; }
  }
});
document.querySelector('#member').addEventListener('change', () => { result.textContent = ''; error.textContent = ''; });
for (const operation of ['read', 'create', 'edit']) document.querySelector(`#${operation}-record`).addEventListener('click', async event => {
  error.textContent = '';
  result.textContent = '';
  if (!grant) { error.textContent = 'Choose access first.'; return; }
  const pending = revision;
  const recordId = document.querySelector('#member').value;
  recordButtons.forEach(button => { button.disabled = true; });
  try {
    const value = await request({ action: 'record', grantId: grant, recordId, operation });
    if (pending !== revision) return;
    if (value.accessEnded) { clearAccess('The change was saved, but access has ended. Approve viewing to check it.'); return; }
    if (recordId === document.querySelector('#member').value) result.textContent = operation === 'read' ? `${value.label}: ${value.value}` : 'Example saved on this computer.';
  } catch (failure) {
    if (pending !== revision) return;
    if (['DENIED', 'WRITE_UNKNOWN'].includes(failure.code) || (!failure.code && operation !== 'read')) clearAccess('Choose access again to continue.');
    error.textContent = failure.code ? failure.message : operation === 'read'
      ? 'The example could not be read. Check that the preview is still running.'
      : 'The save could not be confirmed. Approve viewing and check the saved example before retrying.';
  } finally { recordButtons.forEach(button => { button.disabled = false; }); }
});
