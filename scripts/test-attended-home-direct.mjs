// Attended, fictional-only Home GUI -> protected Windows store check.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { createDirectTlsIdentities } from './test-fixtures/direct-tls-identities.mjs';
import { selectedUsbAdb, selectedUsbAdbByCableCycle, selectedUsbAdbDetached } from './test-fixtures/usb-adb-preflight.mjs';
import { launchNativeDirectHost, requireLifecycleDuringGrant, waitForNativeEvent } from './test-fixtures/native-direct-host.mjs';
import { newExternalEvidencePath } from './test-fixtures/attended-output.mjs';
import { privateTestAddress, certificateFingerprint, connectDirectVaultExperiment } from '../lib/direct-vault-tls.js';
import { openWindowsProbeStore } from '../lib/windows-probe-store.js';
import { openWindowsPairingRegistry } from '../lib/windows-pairing-registry.js';
import { openHostApprovalConsole } from './test-fixtures/host-approval-console.mjs';
import { fileHash, windowsBootMarker, requireRestart, restartDirectory, lockRestartDirectory,
  saveRestartState, readRestartState, removeRestartState, newRestartProbeId, reviewedRunnerContinuation } from './test-fixtures/joined-restart-state.mjs';

let releaseRestartLock = () => {};
let activeReceipt;
try {
const [output, apk, serial, model, apiText, address, scenario = 'reconnect', repairFlag] = process.argv.slice(2);
assert.ok(process.argv.length <= 10 && (repairFlag === undefined || repairFlag === '--repair-runner'));
assert.ok(['reconnect', 'lock', 'sleep', 'rogue', 'restart-prepare', 'restart-verify', 'restart-cleanup'].includes(scenario), 'Select a supported attended Home scenario');
const restart = scenario.startsWith('restart-');
const resuming = scenario === 'restart-verify';
const cleaning = scenario === 'restart-cleanup';
assert.ok(repairFlag === undefined || resuming || cleaning);
assert.ok(process.platform === 'win32' && process.stdin.isTTY, 'Attended Windows terminal required');
assert.ok(output && apk && serial && model && /^\d+$/.test(apiText));
privateTestAddress(address);
assert.ok(Object.values(networkInterfaces()).flat().some(item => item?.address === address && !item.internal),
  'Host address must be assigned to a private local interface');
const repo = fileURLToPath(new URL('..', import.meta.url));
const evidencePath = restart ? restartDirectory(output, scenario === 'restart-prepare') : newExternalEvidencePath(output, repo);
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true }).trim();
const sourceHead = git('rev-parse', 'HEAD');
if (restart) assert.equal(git('status', '--porcelain'), '', 'Commit reviewed source before retained device tests');
assert.ok(existsSync(apk));
const adbPath = path.join(process.env.ANDROID_HOME, 'platform-tools/adb.exe');
const pkg = 'io.github.f2illc.lunaos.home.preview.issue14direct.debug';
const aapt2Path = path.join(process.env.ANDROID_HOME, 'build-tools/37.0.0/aapt2.exe');
const badging = execFileSync(aapt2Path, ['dump', 'badging', apk],
  { encoding: 'utf8', timeout: 20_000, windowsHide: true, maxBuffer: 128 * 1024 });
assert.equal(/^package: name='([^']+)'/m.exec(badging)?.[1], pkg,
  'Selected APK must have the separate attended Home test application ID');
assert.equal(/^targetSdkVersion:'(\d+)'/m.exec(badging)?.[1], '37',
  'Selected APK must target Android API 37 for the local-network permission check');
assert.match(badging, /^uses-permission: name='android\.permission\.ACCESS_LOCAL_NETWORK'/m,
  'Selected APK must declare the Android local-network permission');
const adb = (args, input) => execFileSync(adbPath, ['-s', serial, ...args],
  { input, encoding: 'utf8', timeout: 25_000, windowsHide: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const wifiRoute = () => /\bdev wlan0\b/.test(adb(['shell', 'ip', '-4', 'route', 'get', address]));
const fingerprint = certificate => certificateFingerprint(certificate);
const record = { memberId: 'alex-example', label: 'Library visit', value: 'Thursday from protected storage' };
const evidence = { result: 'INCOMPLETE', stage: 'preflight', scenario, model, api: Number(apiText), apkSha256: createHash('sha256').update(readFileSync(apk)).digest('hex'), checks: [] };
const resultPath = path.join(evidencePath, restart ? `${scenario}-${Date.now()}.json` : 'result.json');
let restartState;
let repairPending = false;
if (restart) {
  releaseRestartLock = lockRestartDirectory(evidencePath);
  writeFileSync(resultPath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
  activeReceipt = { evidence, resultPath };
  const current = { sourceHead, apkSha256: evidence.apkSha256,
    nativeSha256: fileHash(path.join(repo, 'src-tauri/target/debug/lunaos-home-preview.exe')),
    boot: windowsBootMarker(), serial, model, api: apiText };
  evidence.sourceHead = sourceHead; evidence.nativeSha256 = current.nativeSha256;
  if (resuming || cleaning) {
    restartState = readRestartState(evidencePath);
    for (const key of ['nativeSha256', 'apkSha256', 'serial', 'model', 'api']) {
      assert.equal(restartState[key], current[key], `Retained fixture mismatch: ${key}`);
    }
    if (repairFlag && restartState.runnerHead !== sourceHead) {
      git('merge-base', '--is-ancestor', restartState.sourceHead, sourceHead);
      restartState = reviewedRunnerContinuation(restartState, sourceHead,
        git('diff', '--name-only', restartState.sourceHead, sourceHead).split(/\r?\n/));
      repairPending = true;
      console.log(`Reviewed runner-only repair: prepared source ${restartState.sourceHead}; continuing runner ${sourceHead}. Native executable and APK hashes are unchanged. Type begin below only to continue with this repair.`);
    }
    assert.equal(restartState.runnerHead ?? restartState.sourceHead, sourceHead, 'Use the pinned runner source');
    evidence.preparedSourceHead = restartState.sourceHead;
    if (restartState.runnerHead) evidence.checks.push('Explicit reviewed runner-only continuation; original preparation source, boot marker and both build hashes retained');
    if (resuming) requireRestart(restartState, current); // Before USB, UI, listener or store access.
  } else {
    restartState = { schema: 1, fictional: true, phase: 'starting', ...current,
      probeId: newRestartProbeId(), installAttempted: false };
  }
  const start = createInterface({ input: process.stdin, output: process.stdout });
  try {
    assert.equal(await start.question(`Run ${scenario} for the retained fictional setup? Type begin: `), 'begin', 'Not started');
  } finally { start.close(); }
  if (repairPending) saveRestartState(evidencePath, restartState);
  writeFileSync(resultPath, JSON.stringify(evidence, null, 2) + '\n');
}
function usbSnapshot() {
  const adbList = execFileSync(adbPath, ['devices', '-l'], { encoding: 'utf8', timeout: 20_000, windowsHide: true });
  const present = execFileSync('powershell.exe', ['-NoProfile', '-Command',
    "Get-PnpDevice -PresentOnly | Where-Object { $_.Class -eq 'USB' -or $_.Class -like 'Android*' } | ForEach-Object { $parent = if ($_.Class -like 'Android*') { (Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName 'DEVPKEY_Device_Parent').Data } else { $null }; [pscustomobject]@{ Class = $_.Class; InstanceId = $_.InstanceId; Parent = $parent } } | ConvertTo-Json -Compress"],
    { encoding: 'utf8', timeout: 20_000, windowsHide: true, maxBuffer: 128 * 1024 });
  const parsed = JSON.parse(present);
  return { adbList, presentDevices: Array.isArray(parsed) ? parsed : [parsed] };
}
const listed = execFileSync(adbPath, ['devices', '-l'], { encoding: 'utf8', timeout: 20_000, windowsHide: true });
let cableCycleProved = false;
let usbProved = selectedUsbAdb(listed, serial);
if (!usbProved) {
  const before = usbSnapshot();
  usbProved = selectedUsbAdb(before.adbList, serial, before.presentDevices);
  if (!usbProved) {
    console.log('USB_CABLE_PROOF: unplug the selected phone USB cable now; the runner will wait for its adb serial and Android USB interface to disappear');
    let detached;
    const detachBy = Date.now() + 60_000;
    while (Date.now() < detachBy) {
      try {
        const sample = usbSnapshot();
        if (selectedUsbAdbDetached(sample, serial)) { detached = sample; break; }
      } catch { /* ADB and PnP may be unavailable during physical detach. */ }
      await pause(500);
    }
    assert.ok(detached, 'Selected USB adb serial and Android interface did not both disappear');
    console.log('USB_CABLE_RECONNECT: reconnect the same phone USB cable now; the runner will wait for the exact serial and Android USB interface to return');
    const reconnectBy = Date.now() + 60_000;
    while (Date.now() < reconnectBy) {
      try { if (selectedUsbAdbByCableCycle(before, detached, usbSnapshot(), serial)) { cableCycleProved = true; break; } }
      catch { /* ADB and PnP may still be recovering after reconnect. */ }
      await pause(500);
    }
    assert.ok(cableCycleProved, 'Selected USB adb serial and Android interface did not return together');
  }
}
assert.ok(cableCycleProved || usbProved, 'Selected phone must use USB adb');
if (cableCycleProved) evidence.checks.push('Operator unplugged and reconnected the selected USB phone; its exact adb serial and sole Android USB interface disappeared and returned together');
assert.equal(adb(['shell', 'getprop', 'ro.product.model']).trim(), model);
assert.equal(adb(['shell', 'getprop', 'ro.build.version.sdk']).trim(), apiText);
assert.notEqual(adb(['shell', 'getprop', 'ro.hardware']).trim(), 'ranchu');
const installedPackage = adb(['shell', 'pm', 'list', 'packages', pkg]).trim();
if (resuming || (cleaning && installedPackage)) {
  assert.equal(installedPackage, `package:${pkg}`, 'The retained Home package is required');
  const paths = adb(['shell', 'pm', 'path', pkg]).trim().split(/\r?\n/);
  assert.equal(paths.length, 1, 'Expected one retained base APK');
  assert.match(paths[0], /^package:\/data\/app\/[^\r\n]+\/base\.apk$/);
  evidence.stage = 'installed-apk-check';
  writeFileSync(resultPath, JSON.stringify(evidence, null, 2) + '\n');
  const expectedSize = statSync(apk).size;
  const bytes = execFileSync(adbPath, ['-s', serial, 'exec-out', 'cat', paths[0].slice(8)],
    { timeout: 30000, windowsHide: true, maxBuffer: expectedSize });
  assert.equal(bytes.length, expectedSize, 'Installed package size changed');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), restartState.apkSha256, 'Installed package changed');
} else if (!cleaning) assert.equal(installedPackage, '', 'Never overwrite an installed Home direct test package');
if (!restart) mkdirSync(evidencePath);
if (!restart) writeFileSync(resultPath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
if (!restart) activeReceipt = { evidence, resultPath };
const fixtures = restartState?.hostKey ? {
  ca: Buffer.from(restartState.ca), hostIdentity: { key: Buffer.from(restartState.hostKey),
    cert: Buffer.from(restartState.hostCert), fingerprint: fingerprint(restartState.hostCert) }, cleanup() {},
} : createDirectTlsIdentities({ hostOnly: restart });
let installed = false, store, visit, registry, reads = 0, writes = 0;
const hostConsole = openHostApprovalConsole({ readTimeoutMs: 30_000 });

function appNodes() {
  const focus = adb(['shell', 'dumpsys', 'window']);
  assert.ok(focus.split('\n').some(line => line.includes('mCurrentFocus=') && line.includes(pkg)), 'Bring the Home test app to the foreground');
  adb(['shell', 'uiautomator', 'dump', '/data/local/tmp/home-direct-ui.xml']);
  const xml = adb(['shell', 'cat', '/data/local/tmp/home-direct-ui.xml']);
  return [...xml.matchAll(/<node\b[^>]*>/g)].map(([tag]) =>
    Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) =>
      [key, value.replaceAll('&apos;', "'").replaceAll('&amp;', '&')]))).filter(node => node.package === pkg);
}
async function tap(label) {
  let last = 'absent';
  for (let attempt = 0; attempt < 8; attempt++) {
    const found = appNodes().find(node => node.text === label && node.enabled === 'true');
    if (found) {
      const [left, top, right, bottom] = found.bounds.match(/\d+/g).map(Number);
      if (right > left && bottom > top) {
        adb(['shell', 'input', 'tap', String(Math.floor((left + right) / 2)), String(Math.floor((top + bottom) / 2))]);
        return;
      }
      last = 'outside viewport';
    } else {
      last = 'absent or disabled';
    }
    adb(['shell', 'input', 'swipe', '540', '2050', '540', '870', '320']);
    await pause(250);
  }
  throw Error(`Enabled fictional control unavailable: ${label} (${last})`);
}
function tapVisible(label, nodes) {
  const found = nodes.find(node => node.text === label && node.enabled === 'true');
  if (!found) return false;
  const [left, top, right, bottom] = found.bounds.match(/\d+/g).map(Number);
  if (right <= left || bottom <= top) return false;
  adb(['shell', 'input', 'tap', String(Math.floor((left + right) / 2)), String(Math.floor((top + bottom) / 2))]);
  return true;
}
async function waitText(label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    try { const found = appNodes(); if (found.some(node => node.text === label)) return found; }
    catch (error) { if (!String(error.message).includes('Bring the Home test app to the foreground')) throw error; }
    await pause(250);
  }
  while (Date.now() < deadline);
  const knownStatuses = ['Review the test computer identity.', 'Computer approved for this screen. Connect when ready.',
    'Connecting to the approved test computer...', 'Computer connected. Waiting for host approval...',
    'Connected. Review and allow the selected read.', 'Connection or approval unavailable. No access remains.',
    'Connection ended. Reading needs fresh approval.', 'Reading selected fictional record...',
    'Fictional record read. No changes allowed.', 'Read unavailable. No access remains.',
    'Connection lost. Record hidden; fresh approval required.', 'Test access expired. Connect and approve again.'];
  let observed = 'screen unavailable';
  try { observed = appNodes().find(node => knownStatuses.includes(node.text))?.text || 'no expected status'; } catch { /* keep bounded result */ }
  throw Error(`Fictional screen did not show: ${label}; observed: ${observed}`);
}
async function waitEnabled(label, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const found = appNodes().find(node => node.text === label && node.enabled === 'true');
    if (found) return;
    await pause(250);
  } while (Date.now() < deadline);
  throw Error(`Operator did not enable fictional control: ${label}`);
}
function privateFile(name, bytes) {
  adb(['shell', '-T', 'run-as', pkg, 'sh', '-c', `'cat > no_backup/${name}'`], bytes);
}

try {
  if (restart && !restartState.hostKey) {
    Object.assign(restartState, { hostKey: fixtures.hostIdentity.key.toString(),
      hostCert: fixtures.hostIdentity.cert.toString(), ca: fixtures.ca.toString() });
    saveRestartState(evidencePath, restartState); // Ownership receipt precedes store/install mutations.
    fixtures.cleanup(); // No plaintext TLS key survives this setup step on disk.
  }
  if (cleaning) {
    assert.ok(!installedPackage || restartState.installAttempted, 'No owned installation receipt');
    const ownedStore = path.join(process.env.LOCALAPPDATA, 'LunaOSHome', 'FictionalVaultAdapters', restartState.probeId);
    if (existsSync(ownedStore)) {
      registry = openWindowsPairingRegistry({ probeId: restartState.probeId, hostFingerprint: fixtures.hostIdentity.fingerprint });
      await registry.removeSyntheticRegistry(); registry = undefined;
      store = await openWindowsProbeStore({ probeId: restartState.probeId });
      await store.removeSyntheticStore(); store = undefined;
    }
    if (restartState.installAttempted) adb(['shell', 'rm', '-f', '/data/local/tmp/home-direct-ui.xml']);
    if (installedPackage) assert.match(adb(['uninstall', pkg]), /Success/);
    removeRestartState(evidencePath);
    evidence.result = 'PASS'; evidence.stage = 'complete';
    evidence.checks.push('Owned test package, protected restart custody, pairing registry and fictional store removed');
  } else {
  evidence.stage = 'phone-identity';
  if (!resuming) {
    if (restart) { restartState.installAttempted = true; saveRestartState(evidencePath, restartState); }
    assert.match(adb(['install', '-t', apk]), /Success/); installed = true;
  } else {
    // Foreground authority is not restored by relaunch. Never renew the retained identity.
    adb(['shell', 'am', 'force-stop', pkg]);
  }
  adb(['shell', 'am', 'start', '-W', '-n', `${pkg}/io.github.f2illc.lunaos.home.preview.MainActivity`]);
  await waitText('What would you like to do today?');
  await tap('What would you like to do today?');
  if (!resuming) {
    await tap('Prepare or renew fictional computer identity (debug)');
    await waitText('Test identity prepared or renewed. Re-pair with the computer before connecting.');
  }
  const cert = adb(['exec-out', 'run-as', pkg, 'cat', 'no_backup/client-public.pem']);
  const certificate = new X509Certificate(cert);
  assert.ok(certificate.verify(certificate.publicKey));
  const peer = fingerprint(cert);
    evidence.checks.push(resuming ? 'Home retained its Android Keystore transport identity; only the public certificate was read'
      : 'Home explicitly prepared an Android Keystore transport identity and exported only its public certificate');

  if (resuming) {
    assert.equal(peer, restartState.peer, 'Retained Android identity changed');
    assert.equal(cert, restartState.phoneCert);
  }
  store = await openWindowsProbeStore({ ...(restart && { probeId: restartState.probeId }), create: !resuming });
  if (!resuming) await store.create('alex-library', record);
  const ciphertext = readFileSync(path.join(store.directory, 'records.bin'));
  assert.equal(ciphertext.includes(Buffer.from(record.value)), false);
  store = await openWindowsProbeStore({ probeId: store.probeId });
  registry = openWindowsPairingRegistry({ probeId: store.probeId, hostFingerprint: fixtures.hostIdentity.fingerprint });
  if (resuming) {
    assert.equal(fileHash(path.join(store.directory, 'records.bin')), restartState.ciphertextSha256);
    assert.equal(fileHash(path.join(store.directory, 'pairing.bin')), restartState.registrySha256);
    assert.deepEqual(await registry.load(), [peer]);
    evidence.checks.push('Changed Windows boot; same source/builds, Android identity, ciphertext and protected enrollment reopened');
  }
  evidence.stage = 'host-listener';
  // In the rogue scenario the second fictional certificate is trusted by TLS
  // but has no enrollment. This tests pairing policy, not issuer rejection.
  visit = await launchNativeDirectHost({ identity: fixtures.hostIdentity,
    ca: scenario === 'rogue' ? [cert, fixtures.ca] : cert, bindAddress: address, idleMs: 60_000,
    protectedPairing: true,
    store: { lifecycleStore: store, read: async id => { assert.equal(id, 'alex-library'); reads++; return store.read(id); },
      create: async () => { writes++; throw Error('Unexpected write'); }, edit: async () => { writes++; throw Error('Unexpected write'); } } });
  // The empty preflight connection proves this exact listener port is reachable
  // from the phone. It sends no application data and cannot authenticate.
  assert.ok(wifiRoute(), 'Selected phone must route to the private Windows host over Wi-Fi');
  const beforeTcp = visit.host.incomingTcpCount();
  for (let attempt = 0; attempt < 3 && visit.host.incomingTcpCount() <= beforeTcp; attempt++) {
    try { adb(['shell', 'toybox', 'nc', '-w', '2', address, String(visit.host.port)]); }
    catch { /* An unauthenticated TLS server may close netcat with a nonzero exit. */ }
    await pause(250);
  }
  if (visit.host.incomingTcpCount() <= beforeTcp) throw Error('Selected phone cannot reach the exact Windows test listener port');
  evidence.checks.push('Selected phone reached the exact private Windows listener port before verification');
  console.log('WINDOWS_VERIFICATION_READY: complete the trusted Windows prompt on this computer');
  evidence.stage = 'windows-verification';
  const verifiedBy = Date.now() + 120_000;
  for (;;) { try { visit.gate.requireVerified(); break; } catch { if (Date.now() >= verifiedBy) throw Error('Windows verification not completed'); await pause(250); } }
  console.log('WINDOWS_VERIFICATION_COMPLETE: continue with the phone and local approval prompts');

  evidence.stage = 'phone-opening';
  privateFile('ca.pem', fixtures.ca);
  const config = { physicalOptIn: 'attended-fictional-lan-only', expectedModel: model, expectedApi: Number(apiText),
    transportAddress: address, port: visit.host.port, hostFingerprint: visit.host.hostFingerprint, offer: 'not-approved' };
  privateFile('config.json', JSON.stringify(config));
  await tap('Open fictional computer connection (debug)');
  console.log('ANDROID_LOCAL_NETWORK_PERMISSION_READY: approve the Android local network prompt for this test package if shown');
  await waitText('Review the test computer identity.', 180_000);
  evidence.stage = 'identity-review';
  if (!await hostConsole.readyForEnrollment()) throw Error('Operator did not start identity review');
  const review = visit.enrollment.review(peer);
  const screen = appNodes();
  assert.ok(screen.some(node => node.text === `Test computer identity: ${review.hostFingerprint}`));
  assert.ok(screen.some(node => node.text === `Android identity: ${peer}`));
  console.log('IDENTITY_REVIEW: matched full host and Android fingerprints on the Home screen');
  evidence.stage = 'pairing';
  // Resumption never issues/replays a pairing offer. Human identity/scope review stays separate.
  const decision = await hostConsole.enrollment(review);
  let offer;
  if (resuming) {
    assert.equal(decision.allow, true);
    visit.enrollment.cancel(review.requestId);
    offer = { offer: 'resume' };
  } else offer = visit.enrollment.decide(decision);
  if (scenario === 'rogue') {
    evidence.stage = 'rogue-live-offer';
    const tcpBefore = visit.host.incomingTcpCount();
    const tlsRejectedBefore = visit.host.rejectedHandshakeCount();
    // Probe before the phone consumes the offer, then let the phone prove
    // that it remains valid and was not burned by the wrong certificate.
    await assert.rejects(connectDirectVaultExperiment({ address, port: visit.host.port,
      identity: fixtures.outsiderIdentity, ca: fixtures.ca,
      approvedHostFingerprint: visit.host.hostFingerprint, offer: offer.offer }), { code: 'DENIED' });
    assert.ok(visit.host.incomingTcpCount() >= tcpBefore + 1);
    assert.equal(visit.host.rejectedHandshakeCount(), tlsRejectedBefore);
    assert.deepEqual(visit.host.listPairedPeers(), []);
    assert.deepEqual(visit.host.listConnections(), []);
    assert.equal(reads, 0); assert.equal(writes, 0);
    evidence.checks.push('TLS-trusted outsider was denied the unconsumed phone-bound offer before phone pairing');
  }
  privateFile('config.json', JSON.stringify({ ...config, ...offer }));
  console.log('PHONE_PAIRING_APPROVAL_READY: inspect both identities and scope, then tap Approve fictional computer on the phone within 45 seconds');
  await waitText('Computer approved for this screen. Connect when ready.', 45_000);
  await tap('Connect to test computer');
  await waitText('Computer connected. Waiting for host approval...');
  const connections = visit.host.listConnections();
  assert.equal(connections.length, 1);
  assert.equal(connections[0].peerFingerprint, peer);
  const awaitingGrant = appNodes();
  assert.ok(awaitingGrant.some(node => node.text === 'No record shown.'));
  assert.ok(awaitingGrant.some(node => node.text === "Read Alex's record" && node.enabled === 'false'));
  assert.equal(reads, 0);
  if (scenario === 'rogue') evidence.checks.push('The intended phone subsequently consumed the same offer successfully');
  // A separate decision grants only this connection's Alex read for 60 seconds.
  evidence.stage = 'selected-read';
  if (!await hostConsole.read(connections[0])) throw Error('Host denied selected read');
  const grantTick = performance.now();
  visit.enrollment.approveRead(connections[0]);
  await waitText('Connected. Review and allow the selected read.');
  assert.ok(appNodes().some(node => node.text === "Read Alex's record" && node.enabled === 'false'));
  assert.equal(reads, 0);
  const approvalStarted = Date.now();
  console.log('PHONE_READ_APPROVAL_READY: tap Allow selected read on the phone within 45 seconds');
  await waitEnabled("Read Alex's record");
  await tap("Read Alex's record");
  const shown = await waitText(`${record.label}: ${record.value}`);
  assert.ok(wifiRoute(), 'Protected Home read must use the phone Wi-Fi route');
  evidence.readDisplayedWithinMs = Date.now() - approvalStarted;
  assert.equal(reads, 1); assert.equal(writes, 0);
  evidence.checks.push('Home native screen read the committed Windows DPAPI record over directly authenticated TLS with separate host and phone approvals');
  evidence.stage = scenario;
  if (restart) {
    if (!tapVisible('End connection', shown)) await tap('End connection');
    const ended = await waitText('Connection ended. Reading needs fresh approval.');
    assert.ok(ended.some(node => node.text === 'No record shown.'));
    assert.ok(ended.some(node => node.text === "Read Alex's record" && node.enabled === 'false'));
    assert.equal(reads, 1); assert.equal(writes, 0);
    assert.deepEqual(readFileSync(path.join(store.directory, 'records.bin')), ciphertext);
    assert.deepEqual(await registry.load(), [peer]);
    await visit.close(); visit = undefined;
    Object.assign(restartState, { phase: resuming ? 'verified' : 'prepared', phoneCert: cert, peer,
      ciphertextSha256: fileHash(path.join(store.directory, 'records.bin')),
      registrySha256: fileHash(path.join(store.directory, 'pairing.bin')) });
    saveRestartState(evidencePath, restartState);
    evidence.checks.push('Fresh independent host/phone read approvals required; one read, zero writes; End cleared authority; host stopped');
  } else if (scenario === 'lock' || scenario === 'sleep') {
    console.log(scenario === 'lock'
      ? 'READY_FOR_WINDOWS_LOCK: keep Home visible on the phone; press Win+L now, then unlock Windows normally'
      : 'READY_FOR_WINDOWS_SLEEP: keep Home visible on the phone; put Windows to sleep now, then wake and unlock it normally');
    let timer;
    try {
      await Promise.race([visit.ended, new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('No native Windows lifecycle receipt within 90 seconds')), 90_000);
      })]);
    } finally { clearTimeout(timer); }
    const reason = scenario === 'lock' ? 'lock' : 'suspend';
    await waitForNativeEvent(visit.nativeEvents, reason);
    const event = requireLifecycleDuringGrant(visit.nativeEvents, reason, grantTick, 60_000);
    evidence.elapsedFromGrantToEventMs = Math.round(event.tick - grantTick);
    assert.throws(() => visit.gate.requireVerified());
    assert.ok(await hostConsole.afterWindowsUnlock(scenario === 'sleep' ? 1_200_000 : 180_000),
      'Operator did not confirm Windows unlock and wake');
    if (scenario === 'sleep') {
      const readyBy = Date.now() + 60_000;
      for (;;) {
        try { assert.equal(adb(['shell', 'getprop', 'ro.product.model']).trim(), model); break; }
        catch (error) { if (Date.now() >= readyBy) throw error; await pause(1_000); }
      }
    }
    const lost = await waitText('No record shown.', 30_000);
    assert.ok(lost.some(node => node.text === 'No record shown.'));
    assert.ok(lost.some(node => node.text === "Read Alex's record" && node.enabled === 'false'));
    await tap('Connect to test computer');
    await waitText('Connection or approval unavailable. No access remains.');
    assert.equal(reads, 1); assert.equal(writes, 0);
    assert.deepEqual(readFileSync(path.join(store.directory, 'records.bin')), ciphertext);
    evidence.nativeEvents = visit.nativeEvents.map(({ reason, at }) => ({ reason, at }));
    evidence.checks.push(`Native Windows ${reason} ended the verified visit during an active Home read grant; the phone cleared the displayed record and reconnect failed without a new store read`);
  } else if (scenario === 'rogue') {
    const tcpBeforeRogue = visit.host.incomingTcpCount();
    const tlsRejectedBeforeRogue = visit.host.rejectedHandshakeCount();
    await assert.rejects(connectDirectVaultExperiment({ address, port: visit.host.port,
      identity: fixtures.outsiderIdentity, ca: fixtures.ca,
      approvedHostFingerprint: visit.host.hostFingerprint }), { code: 'DENIED' });
    assert.ok(visit.host.incomingTcpCount() >= tcpBeforeRogue + 1);
    assert.equal(visit.host.rejectedHandshakeCount(), tlsRejectedBeforeRogue,
      'Outsider resume handshake must pass TLS so the test reaches pairing policy');
    assert.deepEqual(visit.host.listPairedPeers(), [peer]);
    assert.deepEqual(visit.host.listConnections().map(item => item.peerFingerprint), [peer]);
    assert.equal(reads, 1); assert.equal(writes, 0);
    const retained = await waitText(`${record.label}: ${record.value}`);
    if (!tapVisible('End connection', retained)) await tap('End connection');
    const ended = await waitText('Connection ended. Reading needs fresh approval.');
    assert.ok(ended.some(node => node.text === 'No record shown.'));
    assert.deepEqual(readFileSync(path.join(store.directory, 'records.bin')), ciphertext);
    evidence.checks.push('The TLS-trusted outsider could not resume while the selected phone stayed paired and connected; no extra record read occurred');
  } else {
    if (!tapVisible('End connection', shown)) await tap('End connection');
    const ended = await waitText('Connection ended. Reading needs fresh approval.');
    assert.ok(ended.some(node => node.text === 'No record shown.'));
    assert.ok(ended.some(node => node.text === "Read Alex's record" && node.enabled === 'false'));
    assert.equal(reads, 1); assert.equal(writes, 0);
    evidence.checks.push('End cleared displayed content and old read authority without a second store read');
    const closedBy = Date.now() + 5_000;
    while (visit.host.listConnections().some(connection => connection.connectionId === connections[0].connectionId) &&
        Date.now() < closedBy) await pause(20);
    assert.ok(!visit.host.listConnections().some(connection => connection.connectionId === connections[0].connectionId),
      'Ended connection must leave the host before reconnecting');
    await tap('Connect to test computer');
    const reconnected = await waitText('Computer connected. Waiting for host approval...');
    assert.ok(reconnected.some(node => node.text === 'No record shown.'));
    assert.ok(reconnected.some(node => node.text === "Read Alex's record" && node.enabled === 'false'));
    assert.equal(reads, 1);
    const resumedConnections = visit.host.listConnections();
    assert.equal(resumedConnections.length, 1);
    assert.notEqual(resumedConnections[0].connectionId, connections[0].connectionId);
    assert.equal(resumedConnections[0].peerFingerprint, peer);
    if (!await hostConsole.read(resumedConnections[0])) throw Error('Host denied selected read');
    visit.enrollment.approveRead(resumedConnections[0]);
    const ready = await waitText('Connected. Review and allow the selected read.');
    assert.ok(ready.some(node => node.text === "Read Alex's record" && node.enabled === 'false'));
    assert.equal(reads, 1);
    console.log('PHONE_RECONNECTED_READ_APPROVAL_READY: tap Allow selected read again on the phone within 45 seconds');
    await waitEnabled("Read Alex's record");
    await tap("Read Alex's record");
    const shownAgain = await waitText(`${record.label}: ${record.value}`);
    assert.ok(wifiRoute(), 'Reconnected Home read must use the phone Wi-Fi route');
    assert.equal(reads, 2); assert.equal(writes, 0);
    evidence.checks.push('Reconnect withheld the record until a fresh host approval and phone read approval on the new connection');
    if (!tapVisible('End connection', shownAgain)) await tap('End connection');
    const endedAgain = await waitText('Connection ended. Reading needs fresh approval.');
    assert.ok(endedAgain.some(node => node.text === 'No record shown.'));
    assert.equal(reads, 2); assert.equal(writes, 0);
    assert.deepEqual(readFileSync(path.join(store.directory, 'records.bin')), ciphertext);
    hostConsole.devices(visit.enrollment.enrolledDevices());
    if (await hostConsole.removal(peer)) {
      const removed = await visit.enrollment.removeDevice(peer);
      hostConsole.devices(visit.enrollment.enrolledDevices());
      if (removed.removal === 'uncertain') {
        const checked = await visit.enrollment.reconcileRemoval(peer);
        hostConsole.devices(visit.enrollment.enrolledDevices());
        if (checked.removal !== 'confirmed') {
          if (!await hostConsole.retryRemoval(peer)) throw Error('Device removal remains uncertain');
          const retried = await visit.enrollment.retryRemoval(peer);
          hostConsole.devices(visit.enrollment.enrolledDevices());
          if (retried.removal !== 'confirmed') throw Error('Device removal remains uncertain; readback required before another attempt');
        }
      }
      evidence.checks.push('Local device removal was confirmed by registry commit or explicit readback');
    }
  }
  evidence.result = scenario === 'restart-prepare' ? 'PREPARED_NOT_RESTART_VERIFIED' : 'PASS'; evidence.stage = 'complete';
  }
} catch (error) {
  evidence.error = error.name;
  evidence.connectionsAtFailure = visit?.host?.listConnections().length ?? 0;
  evidence.rejectedHandshakesAtFailure = visit?.host?.rejectedHandshakeCount() ?? 0;
  try {
    const pid = adb(['shell', 'pidof', pkg]).trim().split(/\s+/)[0];
    assert.match(pid, /^\d+$/);
    const diagnostic = adb(['logcat', '-d', `--pid=${pid}`, '-s', 'HomeDirectProbe:W', '*:S']);
    const matched = [...diagnostic.matchAll(/(?:connect=(config|tls|resume|pair|approval)|\b(read))\/([A-Za-z]+(?:Exception|Error))/g)].at(-1);
    if (matched) evidence.androidConnectionDiagnostic = `${matched[1] || matched[2]}/${matched[3]}`;
  } catch { /* ADB may be unavailable during cleanup; preserve the primary failure. */ }
  console.error('PRIMARY_RUN_FAILURE', error.name);
  process.exitCode = 1;
}
finally {
  const failures = [];
  try { await visit?.close(); } catch (error) { failures.push(error); }
  if (!restart) {
    try { await registry?.removeSyntheticRegistry(); } catch (error) { failures.push(error); }
    try { await store?.removeSyntheticStore(); } catch (error) { failures.push(error); }
  }
  hostConsole.close();
  try { if (installed && !restart) {
    adb(['shell', 'rm', '-f', '/data/local/tmp/home-direct-ui.xml']);
    assert.match(adb(['uninstall', pkg]), /Success/);
  } } catch (error) { failures.push(error); }
  fixtures.cleanup();
  evidence.reads = reads; evidence.writes = writes;
  evidence.cleanup = failures.length || (cleaning && evidence.result !== 'PASS') ? 'FAILED' : restart && !cleaning ? 'RETAINED_FOR_EXPLICIT_CLEANUP' : 'PASS';
  evidence.finished = new Date().toISOString();
  writeFileSync(resultPath, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
  if (restart && !cleaning) console.log('Retained fictional setup. Never reboot automatically. Use restart-verify after an operator Restart, then separate restart-cleanup.');
  if (failures.length) throw new AggregateError(failures, 'Owned fictional cleanup failed');
}
} catch (error) {
  if (activeReceipt) {
    const { evidence, resultPath } = activeReceipt;
    evidence.result = 'INCOMPLETE'; evidence.error = error.name;
    if (typeof error.code === 'string' && /^[A-Z_]{1,40}$/.test(error.code)) evidence.errorCode = error.code;
    evidence.finished = new Date().toISOString();
    writeFileSync(resultPath, JSON.stringify(evidence, null, 2) + '\n');
  }
  console.error('RUNNER_REFUSED', error.name, typeof error.code === 'string' && /^[A-Z_]{1,40}$/.test(error.code) ? error.code : '');
  if (['Attended Windows terminal required', 'cold-restart-not-observed', 'Not started'].includes(error.message)) console.error(error.message);
  process.exitCode = 1;
} finally { releaseRestartLock(); }
