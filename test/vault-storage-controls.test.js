import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = (await readFile(new URL('../src/vault.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replaceAll('export ', '');

test('draft refresh leaves a pending storage request button under storage ownership', async () => {
  const pending = Promise.withResolvers();
  const elements = new Map();
  const storageButton = { disabled: true, isConnected: true, closest: selector => selector === '#draft-storage' ? {} : null };
  const refreshButton = { disabled: false, isConnected: true, closest: () => null };
  const node = () => ({ hidden: false, textContent: '', disabled: false, isConnected: true,
    addEventListener() {}, setAttribute() {}, removeAttribute() {}, contains: () => false,
    querySelectorAll: () => [storageButton, refreshButton],
  });
  const document = { activeElement: null, hidden: false, addEventListener() {}, querySelector(selector) {
    if (!elements.has(selector)) elements.set(selector, node());
    return elements.get(selector);
  } };
  const context = { document, requestDraft: () => pending.promise, resetSave() {}, canSaveDraft: () => false };
  runInNewContext(source + '\nglobalThis.refresh = refreshDraft;', context);
  const refreshing = context.refresh();
  assert.equal(refreshButton.disabled, true);
  assert.equal(storageButton.disabled, true);
  pending.resolve({ draft: null });
  await refreshing;
  assert.equal(refreshButton.disabled, false);
  assert.equal(storageButton.disabled, true);
});
