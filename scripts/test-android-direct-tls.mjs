// Dedicated disposable emulator only; no phone, trust-store or Home app changes.
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, X509Certificate } from 'node:crypto';
import { createDirectTlsIdentities } from './test-fixtures/direct-tls-identities.mjs';
import { startDirectVaultExperiment, certificateFingerprint } from '../lib/direct-vault-tls.js';
import { checkDirectTlsGui } from './test-fixtures/direct-tls-gui.mjs';

const [outputDirectory, debugKeystore, mode = '--transport'] = process.argv.slice(2);
assert.ok(['--transport', '--gui', '--race', '--identity'].includes(mode), 'Unsupported test mode.');
const guiMode = mode === '--gui', raceMode = mode === '--race', identityMode = mode === '--identity';
if (!outputDirectory || !debugKeystore || !process.env.ANDROID_HOME || !process.env.JAVA_HOME) throw Error('Output directory, disposable debug keystore, SDK and JDK required.');
const repo = fileURLToPath(new URL('..', import.meta.url));
const adb = path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb.exe');
const serial = 'emulator-5556', packageName = 'io.github.f2illc.lunaos.directtlsprobe';
const adbSync = (args, input) => execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8', input, timeout: 15_000, windowsHide: true });
const adbAsync = async args => (await promisify(execFile)(adb, ['-s', serial, ...args], { encoding: 'utf8', timeout: 60_000, windowsHide: true })).stdout;
function verifyTarget() {
  assert.equal(adbSync(['emu', 'avd', 'name']).split(/\r?\n/)[0].trim(), 'HomeVaultAcceptance_API36');
  assert.equal(adbSync(['shell', 'getprop', 'ro.hardware']).trim(), 'ranchu');
  assert.equal(adbSync(['shell', 'getprop', 'ro.build.version.sdk']).trim(), '36');
}
verifyTarget();
assert.ok(/Started users state: \[0=RUNNING_UNLOCKED\]/.test(adbSync(['shell', 'dumpsys', 'user'])), 'Unlock the dedicated emulator first.');
assert.equal(adbSync(['shell', 'pm', 'list', 'packages', packageName]).trim(), '', 'Do not overwrite an existing test install.');
assert.equal(existsSync(outputDirectory), false, 'Choose a new build directory.');
const fixtures = createDirectTlsIdentities({ hostOnly: true });
let host, poll, revokeTimer, installed = false, approvalPaused = false, revoked = false;
let reads = 0, phaseReads = 0, writes = 0;
const approved = new Set(), enrollments = [];
const record = Object.freeze({ memberId: 'alex-example', label: 'Library visit', value: 'Monday' });
async function instrument(name, extra = [], logName = name) {
  const output = await adbAsync(['shell', 'am', 'instrument', '-w', ...extra, `${packageName}/.${name}`]);
  writeFileSync(path.join(outputDirectory, `${logName}.log`), output);
  assert.match(output, /INSTRUMENTATION_RESULT: result=PASS:/);
  assert.match(output, /INSTRUMENTATION_CODE: -1/);
  return output;
}
async function identity(action, logName = action) { return instrument('IdentityProbe', ['-e', 'action', action], `identity-${logName}`); }
function publicIdentity(output) {
  const details = JSON.parse(output.match(/INSTRUMENTATION_RESULT: identity=(.*)/)[1]);
  assert.equal(details.nonExportable, true); assert.equal(details.originGenerated, true);
  assert.equal(details.userAuthenticationRequired, false); assert.equal(details.algorithm, 'EC');
  assert.deepEqual([...details.authorizedDigests].sort(), ['NONE', 'SHA-256']);
  const certificate = adbSync(['exec-out', 'run-as', packageName, 'cat', 'no_backup/client-public.pem']);
  assert.ok(certificate.startsWith('-----BEGIN CERTIFICATE-----'), 'Public certificate retrieval failed; no enrollment performed.');
  const parsed = new X509Certificate(certificate);
  assert.equal(parsed.publicKey.asymmetricKeyType, 'ec'); assert.ok(parsed.verify(parsed.publicKey));
  return { certificate, fingerprint: certificateFingerprint(certificate), details };
}
async function enroll(peer) {
  clearInterval(poll); clearTimeout(revokeTimer); await host?.close();
  phaseReads = 0; approved.clear(); revoked = false;
  host = await startDirectVaultExperiment({ identity: fixtures.hostIdentity, ca: peer.certificate, idleMs: 30_000, store: {
    read: async id => {
      assert.equal(id, 'alex-library'); reads++; phaseReads++;
      if (!guiMode && !raceMode && phaseReads === 2) revokeTimer = setTimeout(() => { host.revokePeer(peer.fingerprint); revoked = true; }, 1500);
      return { ...record };
    },
    create: async () => { writes++; throw Error('Unexpected write'); },
    edit: async () => { writes++; throw Error('Unexpected write'); },
  } });
  // Explicit fixture decision on the public certificate obtained from this exact app/device.
  // A self-signed peer certificate is an exact trust anchor, not an arbitrary public CA.
  const pairing = host.approvePairing(peer.fingerprint, 120_000);
  const config = JSON.stringify({ ...pairing, port: host.port });
  // Fixed command, no interpolated shell data. Only stdin carries the short-lived fixture offer.
  adbSync(['shell', '-T', 'run-as', packageName, 'sh', '-c', "'cat > no_backup/config.json'"], config);
  enrollments.push({ fingerprint: peer.fingerprint, ...peer.details });
  poll = setInterval(() => {
    if (approvalPaused) return;
    for (const item of host.listConnections()) {
      if (item.peerFingerprint !== peer.fingerprint || approved.has(item.connectionId) || approved.size >= (guiMode ? 4 : 2)) continue;
      try {
        host.approveAccess(item.connectionId, 'read-only', { recordIds: ['alex-library'], lifetimeMs: 60_000 });
        approved.add(item.connectionId);
      } catch (error) { if (error.code !== 'DENIED') throw error; }
    }
  }, 50);
}
try {
  const buildArgs = ['-NoProfile', '-File', path.join(repo, 'scripts/build-android-direct-tls-probe.ps1'),
    '-OutputDirectory', path.resolve(outputDirectory), '-DebugKeystore', path.resolve(debugKeystore), '-FixtureDirectory', fixtures.scratch];
  const compiled = execFileSync('pwsh', [...buildArgs, '-Stage', 'Compile'], { encoding: 'utf8', timeout: 90_000, windowsHide: true });
  const packaged = execFileSync('pwsh', [...buildArgs, '-Stage', 'Package'], { encoding: 'utf8', timeout: 45_000, windowsHide: true });
  writeFileSync(path.join(outputDirectory, 'build.log'), compiled + packaged);
  const apk = path.join(outputDirectory, 'direct-tls-probe.apk');
  const apkSha256 = createHash('sha256').update(readFileSync(apk)).digest('hex');
  const archive = execFileSync(path.join(process.env.JAVA_HOME, 'bin/jar.exe'), ['tf', apk], { encoding: 'utf8', windowsHide: true });
  assert.deepEqual(archive.split(/\r?\n/).filter(name => name.startsWith('assets/') && !name.endsWith('/')), ['assets/ca.pem']);
  verifyTarget(); assert.match(adbSync(['install', '-t', apk]), /Success/); installed = true;
  const first = publicIdentity(await identity('create'));
  const preserved = publicIdentity(await identity('reject-replace'));
  assert.equal(preserved.fingerprint, first.fingerprint, 'An existing identity must not be overwritten.');
  await enroll(first);
  let guiChecks;
  if (guiMode) {
    guiChecks = await checkDirectTlsGui({ outputDirectory, adb: adbAsync,
      pauseApprovals: value => { approvalPaused = value; },
      revoke: () => { host.revokePeer(first.fingerprint); revoked = true; },
    });
  } else await instrument(raceMode ? 'DirectTlsRaceProbe' : 'DirectTlsProbe');
  assert.equal(phaseReads, guiMode ? 4 : raceMode ? 1 : 2);
  assert.equal(approved.size, phaseReads); assert.equal(writes, 0); assert.equal(revoked, !raceMode);
  const persisted = publicIdentity(await identity('inspect', 'after-client-process'));
  assert.equal(persisted.fingerprint, first.fingerprint);
  if (identityMode) {
    await identity('remove'); await identity('reject-missing');
    const replacement = publicIdentity(await identity('create', 'replacement'));
    assert.notEqual(replacement.fingerprint, first.fingerprint);
    const failuresBefore = host.rejectedHandshakeCount();
    await identity('reject-unenrolled');
    assert.ok(host.rejectedHandshakeCount() > failuresBefore, 'Host must observe TLS rejection of the untrusted replacement.');
    assert.equal(phaseReads, 2); assert.equal(host.listConnections().length, 0);
    await enroll(replacement); // New exact-certificate trust + pairing + record grants; same authoritative fixture.
    await instrument('DirectTlsProbe', [], 'DirectTlsProbe-reenrolled');
    assert.equal(phaseReads, 2); assert.equal(approved.size, 2); assert.equal(revoked, true); assert.equal(writes, 0);
  }
  const evidence = { result: 'PASS', mode, apkSha256, androidApi: '36',
    transport: 'AndroidKeyStore native TLS1.3 via emulator host-loopback alias', authoritativeReads: reads, writes,
    enrollments, finalPhaseApprovals: approved.size, revoked, guiChecks,
    hardwareClaim: 'Emulator API reports only; no physical hardware-backed custody claim' };
  writeFileSync(path.join(outputDirectory, 'result.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
} finally {
  clearInterval(poll); clearTimeout(revokeTimer); await host?.close();
  try { if (installed) { verifyTarget(); assert.match(adbSync(['uninstall', packageName]), /Success/); } }
  finally { fixtures.cleanup(); }
}
