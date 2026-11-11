import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Run the real application entry point; isolate only unrelated draft services.
const bundled = await build({
  entryPoints: ['src/app.js'], bundle: true, write: false, format: 'iife',
  plugins: [{
    name: 'isolate-draft-services',
    setup(builder) {
      builder.onResolve({ filter: /(?:vault|draft-storage)\.js$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
        contents: 'export const refreshDraft = () => {}; export const preserveSaveRoutes = () => {};',
      }));
    },
  }],
});

for (const hasLuna of [true, false]) {
  test(`#luna routing ${hasLuna ? 'shows the debug page' : 'falls back without the debug page'}`, () => {
    let focused;
    let scrolls = 0;
    const listeners = {};
    const node = id => ({ hidden: false, append() {}, replaceChildren() {}, addEventListener() {}, focus() { focused = id; } });
    const ids = ['welcome', 'checklist', 'vault', 'welcome-heading', 'checklist-heading', 'vault-heading',
      'task-form', 'task-title', 'task-category', 'form-error', 'task-list', 'home-actions-toggle', 'empty-state', 'task-count'];
    if (hasLuna) ids.push('luna', 'luna-heading');
    const elements = new Map(ids.map(id => [`#${id}`, node(id)]));
    const document = { querySelector: selector => elements.get(selector) ?? null, createElement: () => node() };
    const location = { hash: '#luna' };
    const window = { addEventListener: (type, callback) => { listeners[type] = callback; }, scrollTo: () => { scrolls++; } };
    new Function('document', 'window', 'location', bundled.outputFiles[0].text)(document, window, location);
    const assertPage = page => {
      for (const id of ['welcome', 'checklist', 'vault', ...(hasLuna ? ['luna'] : [])]) {
        assert.equal(elements.get(`#${id}`).hidden, id !== page, id);
      }
    };
    assertPage(hasLuna ? 'luna' : 'welcome');
    assert.equal(document.title, hasLuna ? 'Luna settings · Luna OS Home' : 'Luna OS Home');
    assert.equal(focused, undefined, 'initial load does not steal focus');
    assert.equal(scrolls, 0);
    location.hash = '#checklist';
    listeners.hashchange();
    assertPage('checklist');
    assert.equal(focused, 'checklist-heading');
    location.hash = '#luna?source=home';
    listeners.hashchange();
    assertPage(hasLuna ? 'luna' : 'welcome');
    assert.equal(document.title, hasLuna ? 'Luna settings · Luna OS Home' : 'Luna OS Home');
    assert.equal(focused, hasLuna ? 'luna-heading' : 'welcome-heading');
    assert.equal(scrolls, 2);
    location.hash = '#unknown';
    listeners.hashchange();
    assertPage('welcome');
    assert.equal(focused, 'welcome-heading');
  });
}
