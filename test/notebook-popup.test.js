import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: ['src/notebook-popup.js'], bundle: true, write: false, format: 'iife', globalName: 'Popup' });
test('voice popup shows the authoritative list, honors dismissal and discards stale reads', async () => {
  const node = () => ({ children: [], nodes: new Map(), attrs: {}, handlers: {}, dataset: {}, open: false, scrollTop: 0,
    setAttribute(name, value) { this.attrs[name] = value; }, addEventListener(name, fn) { this.handlers[name] = fn; }, setPointerCapture() {},
    click(event = {}) { this.handlers.click?.(event); }, dispatch(name, event = {}) { this.handlers[name]?.(event); },
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
  assert.match(page.innerHTML,/notebook-popup-handle/);
  assert.match(page.innerHTML,/Open full notebook to edit/);
  resolve({ status: 'read', notebook: { lists: [
    { id: 'list-other', name: 'Other', items: [] },
    { id: 'list-movies', name: 'Movies', items: [{ text: '<b>Arrival</b>', completed: true }] },
  ] } });
  await pending;
  assert.equal(page.querySelector('h2').textContent, 'Movies');
  assert.equal(page.querySelector('ul').children[0].children[1].textContent, '<b>Arrival</b>');
  assert.equal(page.querySelector('ul').children[0].className, 'is-complete');
  page.querySelector('.notebook-popup-close').click();
  await popup.update(state);
  assert.equal(page.open, false); assert.equal(reads, 1);
  const next = popup.update({ ...state, notebookEvent: 2 });
  await popup.update({ ...state, notebookEvent: 2, activeTimers: [{ remainingSeconds: 0 }] });
  resolve({ status: 'read', notebook: { lists: [] } }); await next;
  assert.equal(page.open, false);
  assert.equal(page.querySelector('[role="status"]').textContent, 'Opening your list…');
});

test('drawer expands by click or upward pull, collapses by downward pull, and offers notebook editing', async () => {
  const node = () => ({ children: [], nodes: new Map(), attrs: {}, handlers: {}, dataset: {}, open: false, scrollTop: 0,
    setAttribute(name, value) { this.attrs[name] = value; }, addEventListener(name, fn) { this.handlers[name] = fn; }, setPointerCapture() {},
    click(event = {}) { this.handlers.click?.(event); }, dispatch(name, event = {}) { this.handlers[name]?.(event); },
    append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; },
    querySelector(key) { if (!this.nodes.has(key)) this.nodes.set(key, node()); return this.nodes.get(key); },
    showModal() { this.open = true; }, close() { this.open = false; } });
  const document = { body: node(), createElement: node }, location = { hash: '' };
  const { createNotebookPopup } = new Function('document','location',bundle.outputFiles[0].text + ';return Popup;')(document, location);
  const popup=createNotebookPopup({ request:async()=>({status:'read',notebook:{lists:[{id:'groceries',name:'Groceries',items:[]}]}}) });
  await popup.update({status:'ready',capturePhase:'waiting',notebookEvent:1,notebookListId:'groceries'});
  const page=document.body.children[0],handle=page.querySelector('.notebook-popup-handle');
  handle.click(); assert.equal(page.dataset.expanded,'true'); assert.equal(handle.attrs['aria-expanded'],'true');
  handle.click(); assert.equal(page.dataset.expanded,'false');
  handle.dispatch('pointerdown',{clientY:100,pointerId:1,isPrimary:true}); handle.dispatch('pointermove',{clientY:40});
  assert.equal(page.dataset.expanded,'true');
  page.scrollTop=0; handle.dispatch('pointerdown',{clientY:40,pointerId:2,isPrimary:true}); handle.dispatch('pointermove',{clientY:95});
  assert.equal(page.dataset.expanded,'false');
  page.dataset.expanded='true'; page.querySelector('.notebook-popup-edit').click();
  assert.equal(location.hash,'#notebook'); assert.equal(page.open,false);
});

test('voice popup is a scrollable 28-percent bottom drawer that expands to full screen with reduced motion', async () => {
  const css=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
  assert.match(css,/\.notebook-popup \{[^}]*inset: auto 0 0;[^}]*height: 28vh; max-height: 30vh/);
  assert.match(css,/\.notebook-popup:not\(\[open\]\) \{ display:none; \}/);
  assert.match(css,/\.notebook-popup-scroll \{[^}]*overflow:auto/);
  assert.match(css,/\.notebook-popup\[data-expanded="true"\] \{[^}]*height:100vh; height:100dvh/);
  assert.match(css,/\.notebook-popup\[data-expanded="true"\] \.notebook-popup-actions \{ display:block; \}/);
  assert.match(css,/@keyframes notebook-drawer-in \{ from \{ transform:translateY\(100%\)/);
  assert.match(css,/@media \(prefers-reduced-motion:reduce\) \{ \.notebook-popup \{ animation:none; transition:none; \} \}/);
});
