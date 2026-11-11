import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: ['src/notebook-popup.js'], bundle: true, write: false, format: 'iife', globalName: 'Popup' });
test('voice popup shows the authoritative list, honors dismissal and discards stale reads', async () => {
  const node = () => ({ children: [], nodes: new Map(), open: false,
    setAttribute() {}, addEventListener(name, fn) { this[name] = fn; },
    append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; },
    querySelector(key) { if (!this.nodes.has(key)) this.nodes.set(key, node()); return this.nodes.get(key); },
    showModal() { this.open = true; }, close() { this.open = false; } });
  const document = { body: node(), createElement: node };
  const { createNotebookPopup } = new Function('document', bundle.outputFiles[0].text + ';return Popup;')(document);
  let resolve;
  let reads = 0;
  const popup = createNotebookPopup({ request: () => { reads++; return new Promise(r => { resolve = r; }); } });
  const state = { status: 'ready', capturePhase: 'waiting', notebookEvent: 1, notebookListId: 'list-movies' };
  const pending = popup.update(state);
  const page = document.body.children[0];
  resolve({ status: 'read', notebook: { lists: [
    { id: 'list-other', name: 'Other', items: [] },
    { id: 'list-movies', name: 'Movies', items: [{ text: '<b>Arrival</b>', completed: true }] },
  ] } });
  await pending;
  assert.equal(page.querySelector('h2').textContent, 'Movies');
  assert.equal(page.querySelector('ul').children[0].children[1].textContent, '<b>Arrival</b>');
  assert.equal(page.querySelector('ul').children[0].className, 'is-complete');
  page.querySelector('button').click();
  await popup.update(state);
  assert.equal(page.open, false); assert.equal(reads, 1);
  const next = popup.update({ ...state, notebookEvent: 2 });
  await popup.update({ ...state, notebookEvent: 2, activeTimers: [{ remainingSeconds: 0 }] });
  resolve({ status: 'read', notebook: { lists: [] } }); await next;
  assert.equal(page.open, false);
  assert.equal(page.querySelector('[role="status"]').textContent, 'Opening your list…');
});
