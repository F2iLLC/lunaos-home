import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { openWindowsProbeStore } from '../lib/windows-probe-store.js';
import { VaultConflictError } from '../lib/vault-record-contract.js';
import { createMemoryVersionedStore, MEMORY_STORE_CEILING_BYTES } from './support/memory-versioned-store.js';
import { CONFORMANCE_CLAUSES, defineVersionedStoreConformance, syntheticGroceryRecord } from './support/versioned-store-conformance.js';

defineVersionedStoreConformance(test, {
  name: 'memory reference',
  async open() {
    const backing = new Map();
    return { store: createMemoryVersionedStore(backing), reopen: async () => createMemoryVersionedStore(backing), dispose() {} };
  },
});

defineVersionedStoreConformance(test, {
  name: 'Windows DPAPI probe v2',
  testOptions: { skip: process.platform !== 'win32', timeout: 120000 },
  async open() {
    const store = await openWindowsProbeStore({ create: true, contractVersion: 2 });
    return { store, directory: store.directory,
      reopen: () => openWindowsProbeStore({ probeId: store.probeId, contractVersion: 2 }),
      dispose: () => store.removeSyntheticStore() };
  },
  atRest: handle => readFile(path.join(handle.directory, 'records.bin')),
});

test('memory reference counts the encoded backing bytes and preserves them after an oversized edit', async () => {
  const backing = new Map();
  const store = createMemoryVersionedStore(backing);
  const { revision } = await store.create('weekly', syntheticGroceryRecord());
  const encoded = backing.get('weekly');
  assert.equal(typeof encoded, 'string');
  assert.equal(encoded, JSON.stringify(await store.read('weekly')));
  assert.ok(Buffer.byteLength(encoded) <= MEMORY_STORE_CEILING_BYTES);

  const oversized = syntheticGroceryRecord(Array.from({ length: 500 }, (_, index) => ({
    id: `item-${index}`, label: `Item ${index}`, notes: 'n'.repeat(1000), completed: false,
  })));
  await assert.rejects(store.edit('weekly', oversized, revision), error => !(error instanceof VaultConflictError));
  assert.equal(backing.get('weekly'), encoded);
  assert.deepEqual(await store.read('weekly'), JSON.parse(encoded));
});

test('memory reference rejects commits above its encoded byte ceiling without changing the current record', async () => {
  const backing = new Map();
  const store = createMemoryVersionedStore(backing);
  const { revision } = await store.create('weekly', syntheticGroceryRecord());
  const before = await store.read('weekly');
  const encodedBefore = backing.get('weekly');
  assert.equal(encodedBefore, JSON.stringify(before));
  const oversized = syntheticGroceryRecord(Array.from({ length: 500 }, (_, index) => ({
    id: `item-${index}`, label: `Item ${index}`, notes: 'n'.repeat(1000), completed: false,
  })));

  assert.ok(Buffer.byteLength(JSON.stringify({ revision: crypto.randomUUID(), data: oversized })) > MEMORY_STORE_CEILING_BYTES);
  await assert.rejects(store.edit('weekly', oversized, revision), {
    message: 'Synthetic store payload exceeds its commit ceiling.',
  });
  assert.deepEqual(await store.read('weekly'), before);
  assert.equal(backing.get('weekly'), encodedBefore);
  await assert.rejects(store.create('too-large', oversized), {
    message: 'Synthetic store payload exceeds its commit ceiling.',
  });
  assert.equal(await store.read('too-large'), null);
});

test('the conformance document and suite list the same clauses', async () => {
  const spec = await readFile(new URL('../docs/architecture/versioned-record-store-conformance.md', import.meta.url), 'utf8');
  const documented = [...spec.matchAll(/^\| (C-\d{2}) \|/gm)].map(match => match[1]);
  assert.deepEqual(documented, [...CONFORMANCE_CLAUSES]);
});
