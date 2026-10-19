import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createPortableBackup, openPortableBackup } from '../lib/portable-vault-backup.js';
import { createLocalEnrollment } from '../lib/local-enrollment.js';
import { connectDirectVaultExperiment, DirectVaultError, startDirectVaultExperiment } from '../lib/direct-vault-tls.js';
import { createDirectTlsIdentities } from '../scripts/test-fixtures/direct-tls-identities.mjs';

const identities = createDirectTlsIdentities();
after(identities.cleanup);
const record = { memberId: 'alex-example', label: 'Library visit', value: 'Monday fictional visit' };
const read = { action: 'read', recordId: 'alex-library' };
const scope = { recordIds: ['alex-library'], lifetimeMs: 60_000 };
const denied = error => error instanceof DirectVaultError && error.code === 'DENIED';

function storeFor(rows) {
  return {
    read: async id => rows.get(id),
    create: async (id, data) => { if (rows.has(id)) throw Error('Exists'); rows.set(id, data); },
    edit: async (id, data) => { if (!rows.has(id)) throw Error('Missing'); rows.set(id, data); },
  };
}

function connect(host, offer) {
  return connectDirectVaultExperiment({
    port: host.port, identity: identities.phoneIdentity, ca: identities.ca,
    approvedHostFingerprint: host.hostFingerprint, offer,
  });
}

function locallyApprove(enrollment) {
  const review = enrollment.review(identities.phoneIdentity.fingerprint);
  return enrollment.decide({ ...review, allow: true }).offer;
}

test('a fictional backup opened on a fresh host carries no phone pairing or grants', async () => {
  const rows = new Map([['alex-library', record]]);
  let sourceHost, restoredHost, sourceClient, restoredClient, sourceEnrollment, restoredEnrollment, recoveryKey;
  try {
    sourceHost = await startDirectVaultExperiment({
      identity: identities.hostIdentity, ca: identities.ca, store: storeFor(rows),
    });
    sourceEnrollment = createLocalEnrollment(sourceHost);
    sourceClient = await connect(sourceHost, locallyApprove(sourceEnrollment));
    const oldGrant = sourceHost.approveAccess(sourceClient.connectionId, 'read-only', scope);
    assert.deepEqual(await sourceClient.execute(oldGrant, read), record);

    const backup = createPortableBackup({ schema: 1, records: Object.fromEntries(rows) });
    recoveryKey = backup.recoveryKey;
    sourceClient.close();
    await sourceHost.close();
    sourceHost = null;

    const restored = openPortableBackup(backup.archive, recoveryKey);
    assert.deepEqual(Object.keys(restored), ['schema', 'records']);
    restoredHost = await startDirectVaultExperiment({
      identity: identities.hostIdentity, ca: identities.ca,
      store: storeFor(new Map(Object.entries(restored.records))),
    });
    // Even with the same disposable TLS identities, a restored record archive
    // does not admit the old phone or revive its prior connection grant.
    await assert.rejects(connect(restoredHost), denied);
    restoredEnrollment = createLocalEnrollment(restoredHost);
    restoredClient = await connect(restoredHost, locallyApprove(restoredEnrollment));
    await assert.rejects(restoredClient.execute(oldGrant, read), denied);
    const freshGrant = restoredHost.approveAccess(restoredClient.connectionId, 'read-only', scope);
    assert.deepEqual(await restoredClient.execute(freshGrant, read), record);
    restoredHost.revokePeer(identities.phoneIdentity.fingerprint);
    await assert.rejects(restoredClient.execute(freshGrant, read));
    await assert.rejects(connect(restoredHost), denied);
  } finally {
    sourceEnrollment?.close();
    restoredEnrollment?.close();
    sourceClient?.close();
    restoredClient?.close();
    await sourceHost?.close();
    await restoredHost?.close();
    recoveryKey?.fill(0);
  }
});
