import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createPortableBackup, openPortableBackup } from '../lib/portable-vault-backup.js';

const snapshot = {
  schema: 1,
  records: { 'alex-library': { memberId: 'alex-example', label: 'Library visit', value: 'Monday fictional visit' } },
};

test('a new random key and authenticated archive round-trip only the selected synthetic records', () => {
  const first = createPortableBackup(snapshot);
  const second = createPortableBackup(snapshot);
  try {
    assert.notDeepEqual(first.recoveryKey, second.recoveryKey);
    assert.notDeepEqual(first.archive, second.archive);
    assert.equal(first.archive.includes(Buffer.from(snapshot.records['alex-library'].value)), false);
    assert.deepEqual(openPortableBackup(first.archive, first.recoveryKey), snapshot);
  } finally {
    first.recoveryKey.fill(0);
    second.recoveryKey.fill(0);
  }
});

test('wrong key, tampering, truncation and unsupported version never return records', () => {
  const { archive, recoveryKey } = createPortableBackup(snapshot);
  try {
    assert.throws(() => openPortableBackup(archive, randomBytes(32)), /could not be opened/);
    const changed = JSON.parse(archive);
    changed.ciphertext = changed.ciphertext[0] === 'A' ? 'B' + changed.ciphertext.slice(1) : 'A' + changed.ciphertext.slice(1);
    assert.throws(() => openPortableBackup(Buffer.from(JSON.stringify(changed)), recoveryKey), /could not be opened/);
    assert.throws(() => openPortableBackup(archive.subarray(0, archive.length - 1), recoveryKey), /could not be opened/);
    const future = JSON.parse(archive);
    future.version = 2;
    assert.throws(() => openPortableBackup(Buffer.from(JSON.stringify(future)), recoveryKey), /Unsupported synthetic backup version/);
  } finally { recoveryKey.fill(0); }
});

test('backup input cannot include device grants, credentials or unknown fields', () => {
  assert.throws(() => createPortableBackup({ ...snapshot, grants: ['old-approval'] }));
  assert.throws(() => createPortableBackup({ schema: 1, records: {
    'alex-library': { ...snapshot.records['alex-library'], password: 'fictional-only' },
  } }));
});

test('largest schema-valid snapshot fits the authenticated archive', () => {
  const entries = Array.from({ length: 64 }, (_, index) => [
    `record-${index.toString().padStart(2, '0')}${'a'.repeat(71)}`,
    { memberId: 'm'.repeat(80), label: '😀'.repeat(40), value: '🔒'.repeat(120) },
  ]);
  const maximal = { schema: 1, records: Object.fromEntries(entries) };
  const { archive, recoveryKey } = createPortableBackup(maximal);
  try {
    assert.ok(archive.length > 65536);
    assert.deepEqual(openPortableBackup(archive, recoveryKey), maximal);
  } finally { recoveryKey.fill(0); }
  const escaped = { schema: 1, records: Object.fromEntries(entries.map(([key, record]) => [
    key, { ...record, label: '\ud800'.repeat(80), value: '\ud800'.repeat(240) },
  ])) };
  const worstCase = createPortableBackup(escaped);
  try {
    assert.ok(worstCase.archive.length > 131072);
    assert.deepEqual(openPortableBackup(worstCase.archive, worstCase.recoveryKey), escaped);
  } finally { worstCase.recoveryKey.fill(0); }
});

test('a valid __proto__ record survives both archive directions', () => {
  const special = { schema: 1, records: Object.fromEntries([
    ['__proto__', { memberId: 'alex-example', label: 'Fictional', value: 'Preserved' }],
  ]) };
  const { archive, recoveryKey } = createPortableBackup(special);
  try {
    const opened = openPortableBackup(archive, recoveryKey);
    assert.equal(Object.hasOwn(opened.records, '__proto__'), true);
    assert.deepEqual(opened, special);
  } finally { recoveryKey.fill(0); }
});
