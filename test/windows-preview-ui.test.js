import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../src/windows-vault.js', import.meta.url), 'utf8');
function screen(fetch) {
  const elements = new Map();
  const timers = new Map();
  let timerId = 0;
  function element(selector) {
    if (!elements.has(selector)) elements.set(selector, {
      textContent: '', value: selector === '#member' ? 'alex-work' : '', disabled: false, listeners: {},
      addEventListener(event, listener) { this.listeners[event] = listener; },
    });
    return elements.get(selector);
  }
  runInNewContext(source, {
    document: { querySelector: element, querySelectorAll: selector => selector.split(', ').map(element) },
    location: { hash: '#fictional-process-capability', pathname: '/windows-vault' }, history: { replaceState() {} },
    fetch, AbortSignal, performance: { now: () => 0 },
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; }, clearTimeout(id) { timers.delete(id); },
  });
  return { element, timers, click: id => element(id).listeners.click({ currentTarget: element(id) }) };
}
const ok = data => ({ ok: true, json: async () => data });
const approved = { grantId: 'fictional-grant', lifetimeMs: 60000 };

test('GUI forgets an uncertain save and cannot retry with the old approval', async () => {
  const calls = [];
  const ui = screen(async (_url, options) => {
    const input = JSON.parse(options.body); calls.push(input);
    if (input.action === 'approve') return ok(approved);
    throw Error('Connection interrupted after possible commit');
  });
  await ui.click('#approve-setup');
  await ui.click('#edit-record');
  assert.match(ui.element('#preview-error').textContent, /save could not be confirmed/);
  assert.equal(calls.length, 2);
  await ui.click('#edit-record');
  assert.equal(calls.length, 2); // No silent replay or retained write grant.
  assert.equal(ui.element('#preview-error').textContent, 'Choose access first.');
});

test('GUI clears records on end and ignores a late read response', async () => {
  const reading = Promise.withResolvers();
  const ui = screen(async (_url, options) => {
    const input = JSON.parse(options.body);
    return input.action === 'approve' ? ok(approved) : input.action === 'end' ? ok({ status: 'ended' }) : reading.promise;
  });
  await ui.click('#approve-read');
  const pending = ui.click('#read-record');
  await ui.click('#end-access');
  reading.resolve(ok({ label: 'Workplace', value: 'Willow Workshop' }));
  await pending;
  assert.equal(ui.element('#record-result').textContent, '');
  assert.match(ui.element('#access-status').textContent, /Access ended/);
});

test('GUI expiry clears displayed information and prevents further record requests', async () => {
  let calls = 0;
  const ui = screen(async (_url, options) => {
    calls++;
    return ok(JSON.parse(options.body).action === 'approve' ? approved : { label: 'School', value: 'Meadow School' });
  });
  await ui.click('#approve-read');
  await ui.click('#read-record');
  assert.equal(ui.element('#record-result').textContent, 'School: Meadow School');
  [...ui.timers.values()][0]();
  assert.equal(ui.element('#record-result').textContent, '');
  await ui.click('#read-record');
  assert.equal(calls, 2);
  assert.equal(ui.element('#preview-error').textContent, 'Choose access first.');
});

test('assistant sharing is a separate selected-field request and a late response cannot outlive expiry', async () => {
  const sharing = Promise.withResolvers(); const calls = [];
  const ui = screen(async (_url, options) => {
    const input = JSON.parse(options.body); calls.push(input);
    return input.action === 'assistant-share' ? sharing.promise : ok({ lifetimeMs: 60000 });
  });
  await ui.click('#assistant-read');
  assert.deepEqual(calls, [{ action: 'assistant-approve', mode: 'read' }]);
  assert.match(ui.element('#sharing-status').textContent, /Nothing approved for sharing/);
  ui.element('#share-record').value = 'sam-school';
  ui.element('#share-field').value = 'label';
  const pending = ui.click('#assistant-share');
  assert.deepEqual(calls[1], { action: 'assistant-share', recordId: 'sam-school', field: 'label' });
  [...ui.timers.values()][0]();
  sharing.resolve(ok({ status: 'sharing-approved' })); await pending;
  assert.equal(ui.element('#sharing-status').textContent, 'Sharing has ended.');
  assert.equal(ui.element('#assistant-status').textContent, 'Assistant access has ended.');
});
