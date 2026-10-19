import test from 'node:test';
import assert from 'node:assert/strict';
import { openWindowsProbeStore } from '../lib/windows-probe-store.js';
import { exportWindowsSyntheticBackup, restoreWindowsSyntheticBackup } from '../lib/windows-portable-backup.js';
import { createLocalEnrollment } from '../lib/local-enrollment.js';
import { connectDirectVaultExperiment, DirectVaultError, startDirectVaultExperiment } from '../lib/direct-vault-tls.js';
import { createDirectTlsIdentities } from '../scripts/test-fixtures/direct-tls-identities.mjs';

const record = { memberId: 'alex-example', label: 'Library visit', value: 'Monday fictional visit' };
const read = { action: 'read', recordId: 'alex-library' };
const scope = { recordIds: ['alex-library'], lifetimeMs: 60_000 };
const denied = error => error instanceof DirectVaultError && error.code === 'DENIED';

test('a restored Windows store needs new phone pairing and read approval',
  { skip: process.platform !== 'win32' }, async () => {
    const identities = createDirectTlsIdentities();
    let source, destination, sourceHost, restoredHost;
    let sourceClient, restoredClient, sourceEnrollment, restoredEnrollment, recoveryKey;
    try {
      source = await openWindowsProbeStore({ create: true, recovery: true });
      destination = await openWindowsProbeStore({ create: true, recovery: true });
      await source.create('alex-library', record);
      sourceHost = await startDirectVaultExperiment({
        identity: identities.hostIdentity, ca: identities.ca, store: source,
      });
      sourceEnrollment = createLocalEnrollment(sourceHost);
      const originalReview = sourceEnrollment.review(identities.phoneIdentity.fingerprint);
      const originalOffer = sourceEnrollment.decide({ ...originalReview, allow: true }).offer;
      const connect = (host, offer) => connectDirectVaultExperiment({
        port: host.port, identity: identities.phoneIdentity, ca: identities.ca,
        approvedHostFingerprint: host.hostFingerprint, offer,
      });
      sourceClient = await connect(sourceHost, originalOffer);
      const oldGrant = sourceHost.approveAccess(sourceClient.connectionId, 'read-only', scope);
      assert.deepEqual(await sourceClient.execute(oldGrant, read), record);

      const backup = await exportWindowsSyntheticBackup(source);
      recoveryKey = backup.recoveryKey;
      sourceClient.close();
      await sourceHost.close();
      sourceHost = null;
      await source.removeSyntheticStore();
      source = null;
      await restoreWindowsSyntheticBackup(destination, backup.archive, recoveryKey);

      let restoredReads = 0;
      restoredHost = await startDirectVaultExperiment({
        identity: identities.hostIdentity, ca: identities.ca,
        store: {
          lifecycleStore: destination,
          read: async id => { restoredReads++; return destination.read(id); },
          create: (id, data) => destination.create(id, data),
          edit: (id, data) => destination.edit(id, data),
        },
      });
      // Reusing the same disposable TLS certificates is deliberately stricter
      // than a new device identity: restored records still convey no admission.
      await assert.rejects(connect(restoredHost), denied);
      assert.equal(restoredReads, 0);
      restoredEnrollment = createLocalEnrollment(restoredHost);
      const freshReview = restoredEnrollment.review(identities.phoneIdentity.fingerprint);
      const freshOffer = restoredEnrollment.decide({ ...freshReview, allow: true }).offer;
      restoredClient = await connect(restoredHost, freshOffer);
      await assert.rejects(restoredClient.execute(oldGrant, read), denied);
      assert.equal(restoredReads, 0);
      const freshGrant = restoredHost.approveAccess(restoredClient.connectionId, 'read-only', scope);
      assert.deepEqual(await restoredClient.execute(freshGrant, read), record);
      assert.equal(restoredReads, 1);
      restoredHost.revokePeer(identities.phoneIdentity.fingerprint);
      await assert.rejects(restoredClient.execute(freshGrant, read));
      await assert.rejects(connect(restoredHost), denied);
      assert.equal(restoredReads, 1);
    } finally {
      sourceEnrollment?.close();
      restoredEnrollment?.close();
      sourceClient?.close();
      restoredClient?.close();
      recoveryKey?.fill(0);
      const failures = [];
      const attempt = async action => { try { await action(); } catch (error) { failures.push(error); } };
      await attempt(() => sourceHost?.close());
      await attempt(() => restoredHost?.close());
      await attempt(() => source?.removeSyntheticStore());
      await attempt(() => destination?.removeSyntheticStore());
      await attempt(() => identities.cleanup());
      if (failures.length) throw new AggregateError(failures, 'Synthetic recovery cleanup failed.');
    }
  });
