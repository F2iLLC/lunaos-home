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
  const state = { status: 'ready', capturePhase: 'off', listeningStatus: 'disabled', listeningEnabled: false, replyPlaying: false };

  const makeElement = () => ({
    hidden: false,
    disabled: false,
    children: [],
    textContent: '',
    dataset: {},
    style: {},
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    getAttribute(name) { return this.attributes[name] ?? null; },
    replaceWith(node) {
      if (node === this.parentNode) throw new Error('Cannot replace an element with its ancestor');
      this.replacement = node;
    },
    after(node) { if (node.id) rootNodes.set(`#${node.id}`, node); },
    focus() {},
    close() { this.open = false; },
    showModal() { this.open = true; },
    append(...children) {
      this.children.push(...children);
      for (const child of children) {
        child.parentNode = this;
        if (child.id) rootNodes.set(`#${child.id}`, child);
      }
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
  let document;
  document = {
    body: makeElement(),
    hidden: false,
    querySelector(selector) {
      if (!rootNodes.has(selector)) { const node = makeElement(); node.ownerDocument = document; rootNodes.set(selector, node); }
      return rootNodes.get(selector);
    },
    createElement() { const node = makeElement(); node.ownerDocument = document; return node; },
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
        ...state, microphoneInUse: false,
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
  const avatarHost = harness.document.querySelector('#welcome-luna');
  const face = avatarHost.replacement;
  assert.equal(face.id, 'home-luna-toggle');
  assert.equal(face.children[0], avatarHost, 'the shared avatar host stays inside the listening button');
  assert.equal(harness.document.querySelector('#welcome').dataset.nativeHome, 'true', 'native Home can use its compact landscape layout');
  harness.resolveSnapshot();
  await harness.flush();
  assert.equal(face.attributes['aria-pressed'], 'false');
  assert.deepEqual([...harness.timers.values()].map(timer => timer.delay), [5000]);

  Object.assign(harness.state, { capturePhase: 'waiting', listeningStatus: 'enabled', listeningEnabled: true });
  const waking = face.onclick();
  assert.equal(face.disabled, true);
  await harness.untilSnapshotRequested();
  harness.resolveSnapshot();
  await waking;
  assert.equal(face.attributes['aria-pressed'], 'true');
  assert.equal(face.children[0].querySelector('svg').dataset.state, 'listening');
  assert.deepEqual([...harness.timers.values()].map(timer => timer.delay), [1000]);

  Object.assign(harness.state, { capturePhase: 'off', listeningStatus: 'disabled', listeningEnabled: false });
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
  const face = harness.document.querySelector('#welcome-luna').replacement;
  for (const [phase, listeningStatus, shown] of [['review', 'enabled', 'thinking'], ['retry', 'enabled', 'thinking'], ['off', 'disabled', 'sleeping']]) {
    Object.assign(harness.state, { capturePhase: phase, listeningStatus, listeningEnabled: listeningStatus === 'enabled', replyPlaying: false });
    harness.resolveSnapshot();
    await harness.flush();
    assert.equal(face.children[0].querySelector('svg').dataset.state, shown);
    assert.equal(face.attributes['aria-pressed'], phase === 'off' ? 'false' : 'true');
    if (phase !== 'off') { const [timer] = harness.timers.values(); harness.timers.clear(); timer.callback(); await harness.flush(); }
  }
});

test('command-ready indicator appears only for the native awake command window', async () => {
  const harness = createHarness();
  const luna = await harness.start();
  const face = harness.document.querySelector('#welcome-luna').replacement;
  const home = harness.document.querySelector('#home-luna');
  const refresh = luna.querySelector('#refresh-luna-state');
  harness.resolveSnapshot();
  await harness.flush();

  Object.assign(harness.state, { capturePhase: 'awake', listeningStatus: 'enabled', listeningEnabled: true });
  let update = refresh.onclick();
  await harness.untilSnapshotRequested(); harness.resolveSnapshot(); await update;
  assert.equal(home.dataset.commandReady, 'true');
  assert.equal(home.querySelector('#home-luna-state').textContent, 'Speak now. Luna is listening for your command.');
  assert.match(face.attributes['aria-label'], /waiting for your command/);

  Object.assign(harness.state, { capturePhase: 'waiting' });
  update = refresh.onclick();
  await harness.untilSnapshotRequested(); harness.resolveSnapshot(); await update;
  assert.equal(home.dataset.commandReady, 'false');
  assert.equal(home.querySelector('#home-luna-state').textContent, 'Say “Hey Luna” when you need me.');
});

test('Home listening control announces disabled, permission, mute, lock and disconnection separately', async () => {
  const harness = createHarness();
  const luna = await harness.start();
  const face = harness.document.querySelector('#welcome-luna').replacement;
  harness.resolveSnapshot();
  await harness.flush();
  assert.match(face.attributes['aria-label'], /listening is disabled/);
  const refresh = luna.querySelector('#refresh-luna-state');
  for (const [listeningStatus, phrase] of [['permission','permission is unavailable'],['muted','microphone is muted'],['locked','device is locked'],['disconnected','service disconnected']]) {
    harness.state.listeningStatus = listeningStatus;
    harness.state.listeningEnabled = true;
    const pending = refresh.onclick();
    await harness.untilSnapshotRequested();
    harness.resolveSnapshot();
    await pending;
    assert.ok(face.attributes['aria-label'].toLowerCase().includes(phrase), listeningStatus);
  }
  harness.state.status = 'unavailable';
  harness.state.listeningStatus = 'permission';
  const pending = refresh.onclick();
  await harness.untilSnapshotRequested();
  harness.resolveSnapshot();
  await pending;
  assert.match(luna.querySelector('#luna-state').textContent, /Microphone permission is unavailable/);
  assert.match(face.attributes['aria-label'], /permission is unavailable/);
});
