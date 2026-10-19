// A trusted Windows prompt must be cancelled by the attending user.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createConnection } from 'node:net';
import { createDirectTlsIdentities } from './test-fixtures/direct-tls-identities.mjs';
import { launchNativeDirectHost } from './test-fixtures/native-direct-host.mjs';

const output = process.argv[2];
assert.ok(process.platform === 'win32' && process.stdin.isTTY, 'Attended Windows terminal required');
assert.ok(output && !existsSync(output), 'Choose a new output directory outside the checkout');
mkdirSync(output, { recursive: false });
const fixture = createDirectTlsIdentities({ hostOnly: true });
let visit, reads = 0, writes = 0;
const evidence = { result: 'INCOMPLETE', mode: 'trusted-Windows-cancel', started: new Date().toISOString() };
function refuseTcp(port) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(2000);
    socket.once('connect', () => { socket.destroy(); reject(Error('Closed visit still accepts TCP')); });
    socket.once('error', error => error.code === 'ECONNREFUSED' ? resolve() : reject(error));
    socket.once('timeout', () => { socket.destroy(); reject(Error('Closed visit timed out')); });
  });
}
try {
  visit = await launchNativeDirectHost({ identity: fixture.hostIdentity, ca: fixture.ca,
    store: { read: async () => { reads++; throw Error('Unexpected read'); },
      create: async () => { writes++; throw Error('Unexpected write'); },
      edit: async () => { writes++; throw Error('Unexpected write'); } } });
  assert.throws(() => visit.gate.requireVerified());
  const port = visit.host.port;
  console.log('CANCEL_TRUSTED_WINDOWS_PROMPT_NOW; do not enter a PIN or close the Luna window');
  let timer;
  try {
    await Promise.race([visit.ended, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('No cancellation result within 120 seconds')), 120000);
    })]);
  } finally { clearTimeout(timer); }
  assert.ok(visit.nativeEvents.some(item => item.reason === 'canceled'), 'Require actual Windows canceled status');
  assert.throws(() => visit.gate.requireVerified());
  await visit.close();
  await refuseTcp(port);
  assert.equal(visit.host.listConnections().length, 0);
  assert.equal(reads, 0); assert.equal(writes, 0);
  evidence.result = 'PASS'; evidence.cancelStatus = 'native Windows canceled status';
  evidence.listener = 'closed'; evidence.recordsRead = reads; evidence.writes = writes;
  evidence.finished = new Date().toISOString();
} catch (error) { evidence.error = error.message; throw error; }
finally {
  const failures = [];
  evidence.nativeEvents = visit?.nativeEvents || [];
  try { await visit?.close(); } catch (error) { failures.push(error); }
  fixture.cleanup();
  evidence.cleanup = failures.length ? 'FAILED' : 'PASS';
  writeFileSync(path.join(output, 'result.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
  if (failures.length) throw new AggregateError(failures, 'Synthetic cleanup failed');
}
