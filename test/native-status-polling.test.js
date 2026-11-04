import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: ['src/native.js'], bundle: true, write: false, format: 'esm',
  define: { __ANDROID_VAULT_DEBUG__: 'true' },
  plugins: [{
    name: 'isolate-unrelated-home-services',
    setup(builder) {
      builder.onResolve({ filter: /(?:offline-drafts|draft-client|app)\.js$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
        contents: 'export const createOfflineDraftClient = () => ({}); export const useOfflineDraftClient = () => {};',
      }));
    },
  }],
});

function createHarness() {
  const timers = new Map();
  const windowListeners = new Map();
  const documentListeners = new Map();
  const calls = [];
  const pendingSnapshots = [];
  let timerId = 0;

  const makeElement = () => ({
    hidden: false,
    disabled: false,
    children: [],
    textContent: '',
    setAttribute() {},
    append(...children) { this.children.push(...children); },
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
    addEventListener(type, listener) { windowListeners.set(type, listener); },
    __TAURI__: { core: { invoke(command) {
      calls.push(command);
      if (command !== 'get_luna_snapshot') return Promise.resolve();
      return new Promise(resolve => pendingSnapshots.push(() => resolve({
        status: 'ready', capturePhase: 'off', microphoneInUse: false,
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
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

  return {
    calls, document, documentListeners, pendingSnapshots, timers, window, windowListeners,
    async start() {
      await new AsyncFunction('document', 'window', 'setTimeout', 'clearTimeout', 'queueMicrotask', bundled.outputFiles[0].text)(
        document, window, fakeSetTimeout, fakeClearTimeout, queueMicrotask,
      );
      return document.querySelector('main').children.find(child => child.id === 'luna');
    },
    async flush() { await Promise.resolve(); await Promise.resolve(); },
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

  luna.hidden = false;
  harness.windowListeners.get('hashchange')();
  await harness.flush();
  harness.resolveSnapshot();
  await harness.flush();
  assert.deepEqual([...harness.timers.values()].map(timer => timer.delay), [5000]);

  luna.hidden = true;
  harness.windowListeners.get('hashchange')();
  await harness.flush();
  assert.equal(harness.timers.size, 0, 'leaving Luna clears the pending poll');

  luna.hidden = false;
  harness.windowListeners.get('hashchange')();
  await harness.flush();
  assert.deepEqual([...harness.timers.values()].map(timer => timer.delay), [5000]);

  harness.document.hidden = true;
  harness.documentListeners.get('visibilitychange')();
  assert.equal(harness.timers.size, 0, 'hiding the document clears the pending poll');

  harness.document.hidden = false;
  harness.documentListeners.get('visibilitychange')();
  assert.deepEqual([...harness.timers.values()].map(timer => timer.delay), [5000]);
  harness.runNextTimer();
  await harness.flush();
  assert.equal(harness.calls.filter(command => command === 'get_luna_snapshot').length, 2);
  assert.equal(harness.timers.size, 0, 'the next poll waits until the native request finishes');

  luna.querySelector('#refresh-luna-state').onclick();
  assert.equal(harness.calls.filter(command => command === 'get_luna_snapshot').length, 2,
    'manual refresh does not overlap an in-flight poll');

  harness.resolveSnapshot();
  await harness.flush();
  assert.deepEqual([...harness.timers.values()].map(timer => timer.delay), [5000]);
});
