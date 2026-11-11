import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: ['src/native.js'], bundle: true, write: false, format: 'esm',
  define: { __ANDROID_VAULT_DEBUG__: 'true' },
  plugins: [{
    name: 'isolate-unrelated-home-services',
    setup(builder) {
      builder.onResolve({ filter: /(?:offline-drafts|draft-client|vault|draft-storage|notebook)\.js$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
        contents: 'export const createOfflineDraftClient = () => ({}); export const useOfflineDraftClient = () => {}; export const refreshDraft = () => {}; export const preserveSaveRoutes = () => {};',
      }));
    },
  }],
});

function createHarness() {
  const timers = new Map();
  const intervals = new Map();
  const windowListeners = new Map();
  const documentListeners = new Map();
  const calls = [];
  const pendingSnapshots = [];
  let timerId = 0;
  const state = { capturePhase: 'off' };

  const makeElement = () => ({
    hidden: false,
    disabled: false,
    children: [],
    textContent: '',
    dataset: {},
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    replaceWith(node) { this.replacement = node; },
    after() {},
    focus() {},
    append(...children) {
      this.children.push(...children);
      for (const child of children) if (child.id) rootNodes.set(`#${child.id}`, child);
    },
    replaceChildren(...children) { this.children = children; },
    addEventListener(type, listener) { this[`on${type}`] = listener; },
    querySelector(selector) {
      this.nodes ??= new Map();
      if (!this.nodes.has(selector)) this.nodes.set(selector, makeElement());
      return this.nodes.get(selector);
    },
  });
  const rootNodes = new Map();
  const document = {
    hidden: false,
    querySelector(selector) {
      if (!rootNodes.has(selector)) rootNodes.set(selector, makeElement());
      return rootNodes.get(selector);
    },
    createElement: makeElement,
    addEventListener(type, listener) { documentListeners.set(type, listener); },
  };
  const window = {
    addEventListener(type, listener) {
      const listeners = windowListeners.get(type) ?? [];
      listeners.push(listener);
      windowListeners.set(type, listeners);
    },
    scrollTo() {},
    __TAURI__: { core: { invoke(command) {
      calls.push(command);
      if (command !== 'get_luna_snapshot') return Promise.resolve();
      return new Promise(resolve => pendingSnapshots.push(() => resolve({
        status: 'ready', capturePhase: state.capturePhase, microphoneInUse: false,
        onlineAnswersEnabled: false, activeTimers: [],
      })));
    } } },
  };
  const fakeSetTimeout = (callback, delay) => {
    const id = ++timerId;
    timers.set(id, { callback, delay });
    return id;
  };
  const fakeClearTimeout = id => timers.delete(id);
  const fakeSetInterval = (callback, delay) => {
    const id = ++timerId;
    intervals.set(id, { callback, delay });
    return id;
  };
  const fakeClearInterval = id => intervals.delete(id);
  const location = { hash: '#welcome' };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

  return {
    state, calls, document, documentListeners, intervals, location, pendingSnapshots, timers, window, windowListeners,
    async start() {
      await new AsyncFunction('document', 'window', 'location', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', bundled.outputFiles[0].text)(
        document, window, location, fakeSetTimeout, fakeClearTimeout, fakeSetInterval, fakeClearInterval, queueMicrotask,
      );
      return document.querySelector('main').children.find(child => child.id === 'luna');
    },
    async flush() { await Promise.resolve(); await Promise.resolve(); },
    async untilSnapshotRequested() {
      for (let turn = 0; turn < 50 && pendingSnapshots.length === 0; turn += 1) await Promise.resolve();
      assert.equal(pendingSnapshots.length, 1, 'a snapshot request should be waiting');
    },
    async navigate(hash) {
      location.hash = hash;
      for (const listener of windowListeners.get('hashchange') ?? []) listener();
      await this.flush();
    },
    resolveSnapshot() { pendingSnapshots.shift()?.(); },
    runNextTimer() {
      const [id, timer] = timers.entries().next().value ?? [];
      assert.ok(timer, 'a status poll should be scheduled');
      timers.delete(id);
      void timer.callback();
    },
  };
}

test('Luna status polling follows visible route and document state at five-second cadence', async () => {
  const harness = createHarness();
  const luna = await harness.start();
  assert.equal(harness.calls.filter(command => command === 'get_luna_snapshot').length, 1);
  harness.resolveSnapshot();
  await harness.flush();
  assert.deepEqual([...harness.timers.values()].map(timer => timer.delay), [5000], 'the home page shows Luna, so it polls too');

  await harness.navigate('#luna?source=home');
  assert.equal(luna.hidden, false, 'the real app router shows Luna for a query-bearing route');
  harness.resolveSnapshot();
  await harness.flush();
  assert.deepEqual([...harness.timers.values()].map(timer => timer.delay), [5000]);

  await harness.navigate('#checklist');
  assert.equal(luna.hidden, true, 'the real app router hides Luna after leaving its route');
  assert.equal(harness.timers.size, 0, 'leaving Luna clears the pending poll');

  await harness.navigate('#luna');
  assert.equal(luna.hidden, false);
  harness.resolveSnapshot();
  await harness.flush();
  assert.deepEqual([...harness.timers.values()].map(timer => timer.delay), [5000]);

  harness.document.hidden = true;
  harness.documentListeners.get('visibilitychange')();
  assert.equal(harness.timers.size, 0, 'hiding the document clears the pending poll');

  harness.document.hidden = false;
  harness.documentListeners.get('visibilitychange')();
  harness.resolveSnapshot();
  await harness.flush();
  assert.deepEqual([...harness.timers.values()].map(timer => timer.delay), [5000]);
  const snapshotCountBeforePoll = harness.calls.filter(command => command === 'get_luna_snapshot').length;
  harness.runNextTimer();
  await harness.flush();
  assert.equal(harness.calls.filter(command => command === 'get_luna_snapshot').length, snapshotCountBeforePoll + 1);
  assert.equal(harness.timers.size, 0, 'the next poll waits until the native request finishes');

  luna.querySelector('#refresh-luna-state').onclick();
  assert.equal(harness.calls.filter(command => command === 'get_luna_snapshot').length, snapshotCountBeforePoll + 1,
    'manual refresh does not overlap an in-flight poll');

  harness.resolveSnapshot();
  await harness.flush();
  const refreshButton = luna.querySelector('#refresh-luna-state');
  assert.equal(refreshButton.disabled, false, 'the completed poll re-enables manual refresh');
  assert.deepEqual([...harness.timers.values()].map(timer => timer.delay), [5000]);

  const manualRefresh = refreshButton.onclick();
  assert.equal(refreshButton.disabled, true);
  assert.equal(harness.calls.filter(command => command === 'get_luna_snapshot').length, snapshotCountBeforePoll + 2,
    'manual refresh starts a fresh snapshot request when no request is in flight');
  harness.resolveSnapshot();
  await manualRefresh;
  assert.equal(refreshButton.disabled, false, 'manual refresh re-enables its button after completion');
});

test('pressing Luna on the home page turns listening on and off, and her face follows closely while she listens', async () => {
  const harness = createHarness();
  await harness.start();
  const face = harness.document.querySelector('.luna-companion').replacement;
  assert.equal(face.id, 'home-luna-toggle');
  harness.resolveSnapshot();
  await harness.flush();
  assert.equal(face.attributes['aria-pressed'], 'false');
  assert.deepEqual([...harness.timers.values()].map(timer => timer.delay), [5000]);

  harness.state.capturePhase = 'waiting';
  const waking = face.onclick();
  assert.equal(face.disabled, true);
  await harness.untilSnapshotRequested();
  harness.resolveSnapshot();
  await waking;
  assert.equal(face.attributes['aria-pressed'], 'true');
  assert.equal(face.querySelector('.luna-avatar').dataset.capturePhase, 'waiting');
  assert.deepEqual([...harness.timers.values()].map(timer => timer.delay), [1000]);

  harness.state.capturePhase = 'off';
  const sleeping = face.onclick();
  await harness.untilSnapshotRequested();
  harness.resolveSnapshot();
  await sleeping;
  assert.equal(face.attributes['aria-pressed'], 'false');
  assert.equal(face.disabled, false);
  assert.deepEqual([...harness.timers.values()].map(timer => timer.delay), [5000]);
  assert.deepEqual(harness.calls.filter(command => /enable|disable/.test(command)), ['enable_luna_wake', 'disable_luna_wake']);
});

test('Luna stays awake, without her sleep mask, while she thinks or resets between requests', async () => {
  const harness = createHarness();
  await harness.start();
  const face = harness.document.querySelector('.luna-companion').replacement;
  for (const [phase, shown] of [['review', 'response'], ['retry', 'waiting'], ['off', 'off']]) {
    harness.state.capturePhase = phase;
    harness.resolveSnapshot();
    await harness.flush();
    assert.equal(face.querySelector('.luna-avatar').dataset.capturePhase, shown);
    assert.equal(face.attributes['aria-pressed'], phase === 'off' ? 'false' : 'true');
    if (phase !== 'off') { const [timer] = harness.timers.values(); harness.timers.clear(); timer.callback(); await harness.flush(); }
  }
});
