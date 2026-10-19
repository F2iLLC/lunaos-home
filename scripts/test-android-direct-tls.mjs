// Dedicated disposable emulator only; no phone, trust-store or Home app changes.
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createDirectTlsIdentities } from './test-fixtures/direct-tls-identities.mjs';
import { startDirectVaultExperiment } from '../lib/direct-vault-tls.js';
import { checkDirectTlsGui } from './test-fixtures/direct-tls-gui.mjs';

const [outputDirectory, debugKeystore] = process.argv.slice(2);
const guiMode = process.argv[4] === '--gui';
const raceMode = process.argv[4] === '--race';
if (!outputDirectory || !debugKeystore || !process.env.ANDROID_HOME || !process.env.JAVA_HOME) throw Error('Output directory, disposable debug keystore, SDK and JDK are required.');
const repo = fileURLToPath(new URL('..', import.meta.url));
const adb = path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb.exe');
const serial = 'emulator-5556';
const packageName = 'io.github.f2illc.lunaos.directtlsprobe';
const adbSync = args => execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8', timeout: 15_000, windowsHide: true });
function verifyTarget() {
  assert.equal(adbSync(['emu', 'avd', 'name']).split(/\r?\n/)[0].trim(), 'HomeVaultAcceptance_API36');
  assert.equal(adbSync(['shell', 'getprop', 'ro.hardware']).trim(), 'ranchu');
  assert.equal(adbSync(['shell', 'getprop', 'ro.build.version.sdk']).trim(), '36', 'This evidence requires the actual API36 image.');
}
verifyTarget();
assert.ok(/Started users state: \[0=RUNNING_UNLOCKED\]/.test(adbSync(['shell', 'dumpsys', 'user'])), 'Unlock the dedicated disposable emulator before running.');
assert.equal(adbSync(['shell', 'pm', 'list', 'packages', packageName]).trim(), '', 'Do not overwrite an existing test install.');
assert.equal(existsSync(outputDirectory), false, 'Build requires a new output directory.');
const fixtures = createDirectTlsIdentities();
let host, poll, revokeTimer, installed = false;
let reads = 0, writes = 0, revoked = false;
let approvalPaused = false;
const approved = new Set();
const record = Object.freeze({ memberId: 'alex-example', label: 'Library visit', value: 'Monday' });
try {
  host = await startDirectVaultExperiment({ identity: fixtures.hostIdentity, ca: fixtures.ca, idleMs: 30_000, store: {
    read: async id => {
      assert.equal(id, 'alex-library'); reads++;
      if (!guiMode && !raceMode && reads === 2) revokeTimer = setTimeout(() => { host.revokePeer(fixtures.phoneIdentity.fingerprint); revoked = true; }, 1500);
      return { ...record };
    },
    create: async () => { writes++; throw Error('Unexpected write'); },
    edit: async () => { writes++; throw Error('Unexpected write'); },
  } });
  // This local controller approves only the disposable certificate and fixed read-only record.
  poll = setInterval(() => {
    if (approvalPaused) return;
    for (const item of host.listConnections()) {
      if (item.peerFingerprint !== fixtures.phoneIdentity.fingerprint || approved.has(item.connectionId) || approved.size >= (guiMode ? 4 : 2)) continue;
      approved.add(item.connectionId);
      host.approveAccess(item.connectionId, 'read-only', { recordIds: ['alex-library'], lifetimeMs: 60_000 });
    }
  }, 50);
  const buildArgs = ['-NoProfile', '-File', path.join(repo, 'scripts/build-android-direct-tls-probe.ps1'),
    '-OutputDirectory', path.resolve(outputDirectory), '-DebugKeystore', path.resolve(debugKeystore), '-FixtureDirectory', fixtures.scratch],
    buildOptions = { encoding: 'utf8', timeout: 90_000, windowsHide: true };
  const compiled = execFileSync('pwsh', [...buildArgs, '-Stage', 'Compile'], buildOptions);
  verifyTarget();
  // Compilation and full target preflight consume none of the real 120s lifetime.
  const pairing = host.approvePairing(fixtures.phoneIdentity.fingerprint, 120_000);
  writeFileSync(path.join(fixtures.scratch, 'config.json'), JSON.stringify({ ...pairing, port: host.port }));
  const packaged = execFileSync('pwsh', [...buildArgs, '-Stage', 'Package'], { ...buildOptions, timeout: 45_000 });
  writeFileSync(path.join(outputDirectory, 'build.log'), compiled + packaged);
  const apk = path.join(outputDirectory, 'direct-tls-probe.apk');
  const apkSha256 = createHash('sha256').update(readFileSync(apk)).digest('hex');
  assert.match(adbSync(['install', '-t', apk]), /Success/); installed = true;
  let guiChecks;
  if (guiMode) {
    guiChecks = await checkDirectTlsGui({ outputDirectory,
      adb: async args => (await promisify(execFile)(adb, ['-s', serial, ...args], { encoding: 'utf8', timeout: 20_000, windowsHide: true })).stdout,
      pauseApprovals: value => { approvalPaused = value; },
      revoke: () => { host.revokePeer(fixtures.phoneIdentity.fingerprint); revoked = true; },
    });
  } else {
    const { stdout } = await promisify(execFile)(adb, ['-s', serial, 'shell', 'am', 'instrument', '-w', `${packageName}/.${raceMode ? 'DirectTlsRaceProbe' : 'DirectTlsProbe'}`],
    { encoding: 'utf8', timeout: 60_000, windowsHide: true });
  writeFileSync(path.join(outputDirectory, 'instrumentation.log'), stdout);
  assert.match(stdout, /INSTRUMENTATION_RESULT: result=PASS:/);
  assert.match(stdout, /INSTRUMENTATION_CODE: -1/);
  }
  assert.equal(reads, guiMode ? 4 : raceMode ? 1 : 2); assert.equal(writes, 0); assert.equal(approved.size, guiMode ? 4 : raceMode ? 1 : 2); assert.equal(revoked, !raceMode);
  const evidence = { result: 'PASS', apkSha256, androidApi: adbSync(['shell', 'getprop', 'ro.build.version.sdk']).trim(),
    transport: 'Android native TLS1.3 via emulator host-loopback alias', authoritativeReads: reads, writes, freshApprovals: approved.size, revoked, guiChecks };
  writeFileSync(path.join(outputDirectory, 'result.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
} finally {
  clearInterval(poll); clearTimeout(revokeTimer);
  await host?.close();
  try { if (installed) { verifyTarget(); assert.match(adbSync(['uninstall', packageName]), /Success/); } }
  finally { fixtures.cleanup(); }
}
