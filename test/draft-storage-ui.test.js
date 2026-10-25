import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = (await readFile(new URL('../src/draft-storage.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/m, '').replaceAll('export ', '');
function screen(fetch, connected = true) {
  const elements = new Map(); const timers = new Map(); const listeners = {}; let sequence = 0;
  const node = () => ({ textContent: '', hidden: false, disabled: false, children: [], listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    replaceChildren(...children) { this.children = children; }, append(child) { this.children.push(child); }, focus() {},
    querySelectorAll() { return ['#confirm-save', '#cancel-save', '#view-saved', '#hide-saved'].map(element); },
  });
  function element(id) { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); }
  const document = { querySelector: element, createElement: node, hidden: false, addEventListener(type, fn) { listeners[type] = fn; } };
  const context = { document, location: { hash: '#vault?save=' + 'a'.repeat(64) }, fetch, AbortSignal, URLSearchParams,
    canRequestAssistantReview: () => connected, setTimeout(fn) { const id = ++sequence; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); } };
  runInNewContext(source + '\nglobalThis.prepare = prepareSave;', context);
  return { element, timers, document, listeners, prepare: context.prepare, click: id => element(id).listeners.click() };
}
const ok = data => ({ ok: true, json: async () => data });
const prepared = { approval: crypto.randomUUID(), name: 'Alex Example', label: 'Workplace', value: 'Willow Workshop', previousValue: 'Willow Studio' };
test('save UI shows replacement and waits for separate approval; receipt does not become a draft mutation', async () => {
  const calls = [];
  const ui = screen(async (_url, options) => { const input = JSON.parse(options.body); calls.push(input); return ok(input.action === 'prepare' ? prepared : { status: 'saved' }); });
  await ui.prepare({ revision: 1 });
  assert.equal(calls.length, 1);
  assert.match(ui.element('#save-summary').textContent, /Replaces the saved value: Willow Studio/);
  assert.equal(ui.element('#save-approval').hidden, false);
  await ui.click('#confirm-save');
  assert.deepEqual(calls[1], { action: 'save', approval: prepared.approval });
  assert.match(ui.element('#save-status').textContent, /Saved on this computer/);
  await ui.click('#confirm-save');
  assert.equal(calls.length, 2);
});
test('unknown save cannot be retried until saved records are read; late reads are hidden after backgrounding', async () => {
  const calls = []; const pending = Promise.withResolvers();
  const ui = screen(async (_url, options) => {
    const input = JSON.parse(options.body); calls.push(input);
    if (input.action === 'prepare') return ok(prepared);
    if (input.action === 'save') throw new TypeError('lost receipt');
    return pending.promise;
  });
  await ui.prepare({ revision: 1 }); await ui.click('#confirm-save'); await ui.prepare({ revision: 1 });
  assert.deepEqual(calls.map(c => c.action), ['prepare', 'save']);
  assert.match(ui.element('#save-status').textContent, /View saved examples/);
  const reading = ui.click('#view-saved');
  ui.document.hidden = true; ui.listeners.visibilitychange();
  pending.resolve(ok({ records: [{ name: 'Alex Example', label: 'Workplace', value: 'Willow Workshop' }] }));
  await reading;
  assert.equal(ui.element('#saved-details').children.length, 0);
  await ui.prepare({ revision: 1 });
  assert.equal(calls.length, 3);
});
test('offline preview never enables save or makes storage requests even with a fragment key', async () => {
  let calls = 0; const ui = screen(async () => { calls++; }, false);
  assert.equal(ui.element('#draft-storage').hidden, true);
  await ui.prepare({ revision: 1 }); await ui.click('#view-saved');
  assert.equal(calls, 0);
});
