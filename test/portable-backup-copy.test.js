import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { checkPortableBackupCopy, createPortableBackup } from '../lib/portable-vault-backup.js';

const snapshot = {
  schema: 1,
  records: { 'alex-library': { memberId: 'alex-example', label: 'Library visit', value: 'Monday fictional visit' } },
};

test('a separate fictional archive and key copy can be checked without returning records or key', () => {
  const generated = createPortableBackup(snapshot);
  const savedArchive = Buffer.from(generated.archive);
  const separatelySuppliedKey = Buffer.from(generated.recoveryKey);
  const expectedKey = Buffer.from(separatelySuppliedKey);
  generated.recoveryKey.fill(0);
  try {
    const checked = checkPortableBackupCopy(savedArchive, separatelySuppliedKey);
    assert.deepEqual(checked, {
      recordCount: 1,
      archiveSha256: createHash('sha256').update(savedArchive).digest('hex'),
    });
    assert.equal(Object.isFrozen(checked), true);
    assert.equal(JSON.stringify(checked).includes(snapshot.records['alex-library'].value), false);
    assert.deepEqual(separatelySuppliedKey, expectedKey);
  } finally { separatelySuppliedKey.fill(0); expectedKey.fill(0); }
});

test('wrong key, incomplete copy and altered archive cannot produce a confirmation', () => {
  const { archive, recoveryKey } = createPortableBackup(snapshot);
  const wrongKey = randomBytes(32);
  try {
    const altered = JSON.parse(archive);
    altered.ciphertext = altered.ciphertext[0] === 'A'
      ? `B${altered.ciphertext.slice(1)}` : `A${altered.ciphertext.slice(1)}`;
    for (const [candidate, key] of [
      [Buffer.from(archive), wrongKey],
      [archive.subarray(0, archive.length - 1), recoveryKey],
      [Buffer.from(JSON.stringify(altered)), recoveryKey],
    ]) assert.throws(() => checkPortableBackupCopy(candidate, key), /could not be opened/);
    assert.throws(() => checkPortableBackupCopy(archive, undefined), /could not be opened/);
  } finally { recoveryKey.fill(0); wrongKey.fill(0); }
});
