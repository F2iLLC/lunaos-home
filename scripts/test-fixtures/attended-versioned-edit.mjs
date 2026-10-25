import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createVaultSessionService } from '../../lib/vault-sessions.js';

// Called only after an attended version-2 read with independent approvals.
// The controller never taps Save or any permission/identity approval.
export async function runAttendedVersionedEdit({ scenario, evidence, store, visit, hostConsole, peer,
  appNodes, tap, waitText, waitEnabled, privateFile, config, counts, checkpoint }) {
  const bytes = () => readFileSync(path.join(store.directory, 'records.bin'));
  const initial = await store.read('alex-library');
  const before = bytes();
  const stale = scenario === 'stale-edit';
  assert.ok(stale || scenario === 'write-unknown');
  evidence.stage = 'prepare-edit'; checkpoint();
  assert.ok(appNodes().some(n => n.text === 'Save Friday from phone' && n.enabled === 'false'));
  let expected = initial;
  evidence.competingWrites = 0;
  if (stale) {
    // Simulated competing Windows author, using the same service contract and
    // current OS gate; this is not claimed as a second human or physical phone.
    const other = createVaultSessionService({ store, contractVersion: 2, requireAccess: () => visit.gate.requireVerified() });
    try {
      other.admitDevice('fictional-competing-windows');
      const local = other.openConnection({ deviceId: 'fictional-competing-windows' });
      const grant = other.approveEdit(local, { recordIds: ['alex-library'], lifetimeMs: 60_000 });
      await local.execute(grant, { version: 2, action: 'edit', recordId: 'alex-library',
        expectedRevision: initial.revision, data: { ...initial.data, value: 'Thursday from competing computer' } });
      evidence.competingWrites = 1;
    } finally { await other.shutdown(); }
    expected = await store.read('alex-library');
    assert.notEqual(expected.revision, initial.revision);
  }
  const committed = bytes();
  const connection = visit.host.listConnections().find(item => item.peerFingerprint === peer);
  assert.ok(connection);
  evidence.stage = 'host-edit-approval'; checkpoint();
  if (!await hostConsole.edit(connection)) throw Error('Host denied selected edit');
  const editGrant = visit.enrollment.approveFictionalEdit(connection);
  // Collect the terminal decision before starting the phone's bounded socket
  // wait. The host can queue the event, but only the human can press Save.
  await tap('Review Friday change');
  evidence.stage = 'phone-save-approval'; checkpoint();
  console.log('PHONE_SAVE_READY: review the fixed Friday proposal, then tap Save Friday from phone only if you approve it.');
  const outcome = stale ? 'Record changed. Your edit was not saved. Read latest before another edit.'
    : 'Change not confirmed. Reconnect and read latest. Do not repeat the save.';
  await waitText(outcome, 45_000);
  visit.host.revokeGrant(editGrant);
  assert.equal(counts().editAttempts, 1);
  assert.equal(counts().editBaseRevision, initial.revision, 'Phone must use the revision read before the competing edit');
  assert.equal(counts().writes, stale ? 0 : 1);
  const after = await store.read('alex-library');
  if (stale) {
    assert.deepEqual(after, expected); assert.deepEqual(bytes(), committed);
    evidence.checks.push('Phone sent its originally read revision; stale edit conflicted without overwriting the competing committed revision');
  } else {
    assert.notEqual(after.revision, initial.revision);
    assert.equal(after.data.value, 'Friday from phone'); assert.notDeepEqual(bytes(), before);
    evidence.checks.push('One phone edit committed before its receipt was deliberately lost; phone reported unconfirmed and closed authority');
  }
  const saved = bytes();
  const ended = appNodes();
  assert.ok(ended.some(n => n.text === 'No record shown.'));
  assert.ok(ended.some(n => n.text === 'Save Friday from phone' && n.enabled === 'false'));
  // A separate connection, no new offer, fresh read-only approval; never replay.
  evidence.stage = 'fresh-readback'; checkpoint();
  if (stale) await tap('End connection');
  privateFile('config.json', JSON.stringify({ ...config, offer: 'resume' }));
  await tap('Connect to test computer');
  await waitText('Computer connected. Waiting for host approval...');
  const resumed = visit.host.listConnections().find(item => item.peerFingerprint === peer && item.connectionId !== connection.connectionId);
  assert.ok(resumed);
  assert.equal(counts().reads, 1); assert.equal(counts().editAttempts, 1);
  if (!await hostConsole.read(resumed)) throw Error('Host denied reconciliation read');
  visit.enrollment.approveRead(resumed);
  await waitText('Connected. Review and allow the selected read.');
  console.log('PHONE_READ_APPROVAL_READY: approve only the selected read to reconcile. No edit will be repeated.');
  await waitEnabled("Read Alex's record");
  await tap("Read Alex's record");
  await waitText(`Library visit: ${after.data.value}`);
  assert.equal(counts().reads, 2); assert.equal(counts().editAttempts, 1);
  assert.equal(counts().writes, stale ? 0 : 1); assert.deepEqual(bytes(), saved);
  assert.ok(appNodes().some(n => n.text === 'Save Friday from phone' && n.enabled === 'false'));
  await tap('End connection');
  await waitText('Connection ended. Reading needs fresh approval.');
  assert.ok(appNodes().some(n => n.text === 'No record shown.'));
  evidence.checks.push('Fresh connection and independent read approvals reconciled the committed record; no retry, duplicate mutation or inherited edit permission; End hid contents');
}
