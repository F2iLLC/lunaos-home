// Explicitly selected physical phone only; separate disposable package, synthetic store.
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash, X509Certificate } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { createServer, connect as connectTcp } from 'node:net';
import { once } from 'node:events';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDirectTlsIdentities } from './test-fixtures/direct-tls-identities.mjs';
import { selectedUsbAdb } from './test-fixtures/usb-adb-preflight.mjs';
import { launchNativeDirectHost, requireLifecycleDuringGrant, requireVisitDeadline } from './test-fixtures/native-direct-host.mjs';
import { privateTestAddress, certificateFingerprint } from '../lib/direct-vault-tls.js';
import { openWindowsProbeStore } from '../lib/windows-probe-store.js';
import { exportWindowsSyntheticBackup, restoreWindowsSyntheticBackup } from '../lib/windows-portable-backup.js';

const [output, keystore, serial, model, apiText, address, event] = process.argv.slice(2);
assert.ok(process.stdin.isTTY && process.platform === 'win32', 'Attended Windows terminal required');
assert.ok(['lock', 'sleep', 'expiry', 'background', 'revoke', 'client-end', 'restore', 'host-loss', 'link-reset', 'wifi-cycle'].includes(event),
  'Unsupported attended event; no physical evidence was recorded');
assert.ok(serial && !serial.startsWith('emulator-') && model && /^\d+$/.test(apiText));
privateTestAddress(address);
assert.ok(Object.values(networkInterfaces()).flat().some(i => i?.address === address && !i.internal), 'Bind only an assigned private address');
assert.equal(existsSync(output), false, 'Choose a new output directory');
const repo = fileURLToPath(new URL('..', import.meta.url));
const adbPath = path.join(process.env.ANDROID_HOME, 'platform-tools/adb.exe');
const pkg = 'io.github.f2illc.lunaos.directtlsprobe';
if (event === 'wifi-cycle') {
  const listed = execFileSync(adbPath, ['devices', '-l'], { encoding: 'utf8', timeout: 20_000, windowsHide: true });
  let presentDevices = [];
  if (!selectedUsbAdb(listed, serial)) {
    const present = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      "Get-PnpDevice -PresentOnly | Where-Object { $_.Class -eq 'USB' -or $_.Class -like 'Android*' } | ForEach-Object { $parent = if ($_.Class -like 'Android*') { (Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName 'DEVPKEY_Device_Parent').Data } else { $null }; [pscustomobject]@{ Class = $_.Class; InstanceId = $_.InstanceId; Parent = $parent } } | ConvertTo-Json -Compress"],
      { encoding: 'utf8', timeout: 20_000, windowsHide: true, maxBuffer: 128 * 1024 });
    const parsed = JSON.parse(present);
    presentDevices = Array.isArray(parsed) ? parsed : [parsed];
  }
  assert.ok(selectedUsbAdb(listed, serial, presentDevices), 'Wi-Fi cycle requires the selected physical phone over USB adb');
}
const adb = async args => (await promisify(execFile)(adbPath, ['-s', serial, ...args], { encoding: 'utf8', timeout: 20000, windowsHide: true })).stdout;
const sync = (args, input) => execFileSync(adbPath, ['-s', serial, ...args], { input, encoding: 'utf8', timeout: 20000, windowsHide: true });
function verifyTarget() {
  assert.equal(sync(['shell', 'getprop', 'ro.product.model']).trim(), model);
  assert.equal(sync(['shell', 'getprop', 'ro.build.version.sdk']).trim(), apiText);
  assert.notEqual(sync(['shell', 'getprop', 'ro.hardware']).trim(), 'ranchu');
}
verifyTarget();
assert.equal(sync(['shell', 'pm', 'list', 'packages', pkg]).trim(), '', 'Never overwrite an installed probe');
// No adb forward/reverse is used: the client connects directly to the LAN address.
const configBase = { physicalOptIn: 'attended-fictional-lan-only', expectedModel: model, expectedApi: Number(apiText), transportAddress: address };
function config(value) { sync(['shell', '-T', 'run-as', pkg, 'sh', '-c', "'cat > no_backup/config.json'"], JSON.stringify({ ...configBase, ...value })); }
const fixtures = createDirectTlsIdentities({ hostOnly: true });
let installed = false, wifiChanged = false, sourceStore, store, visit, relay, recoveryKey, reads = 0, writes = 0;
const evidence = { result: 'INCOMPLETE', event, model, api: Number(apiText), started: new Date().toISOString(), checks: [] };
const record = { memberId: 'alex-example', label: 'Library visit', value: 'Thursday from protected storage' };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function wifiRouteAvailable() {
  try { return /\bdev wlan0\b/.test(await adb(['shell', 'ip', '-4', 'route', 'get', address])); }
  catch { return false; }
}
async function beforeDeadline(promise, deadline, message) {
  const remaining = deadline - performance.now();
  assert.ok(remaining > 0, message);
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(message)), remaining); })]);
  } finally { clearTimeout(timer); }
}
async function startDisposableRelay(address, hostPort) {
  const pairs = new Set();
  let failure;
  const server = createServer(phone => {
    const host = connectTcp({ host: address, port: hostPort });
    const pair = { phone, host }; pairs.add(pair);
    const end = () => { phone.destroy(); host.destroy(); pairs.delete(pair); };
    for (const socket of [phone, host]) { socket.on('error', end); socket.on('close', end); }
    phone.pipe(host); host.pipe(phone); // TLS remains end-to-end; this fixture only forwards bytes.
  });
  server.maxConnections = 8;
  server.listen(0, address);
  await once(server, 'listening');
  server.on('error', error => { failure = error; for (const pair of pairs) { pair.phone.destroy(); pair.host.destroy(); } });
  return {
    port: server.address().port,
    activeCount: () => pairs.size,
    check: () => assert.equal(failure, undefined),
    drop() { for (const pair of pairs) { pair.phone.destroy(); pair.host.destroy(); } },
    async close() {
      this.drop();
      if (server.listening) await new Promise(resolve => server.close(resolve));
      this.check();
    },
  };
}
async function nodes() {
  const focus = await adb(['shell', 'dumpsys', 'window']);
  assert.ok(focus.split('\n').some(line => /mCurrentFocus=/.test(line) && line.includes(pkg)), 'Bring the fictional test app to the foreground');
  await adb(['shell', 'uiautomator', 'dump', '/data/local/tmp/fictional-physical-ui.xml']);
  const xml = await adb(['shell', 'cat', '/data/local/tmp/fictional-physical-ui.xml']);
  assert.ok(xml.includes(`package="${pkg}"`));
  // Keep only synthetic app nodes; never retain keyboard, notification or other-app nodes.
  return [...xml.matchAll(/<node\b[^>]*>/g)].map(([tag]) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v.replaceAll('&apos;', "'").replaceAll('&amp;', '&')]))).filter(n => n.package === pkg);
}
async function waitText(text) {
  const end = Date.now() + 20000;
  do { const found = await nodes(); if (found.some(n => n.text === text)) return found; await pause(200); } while (Date.now() < end);
  throw Error(`Expected synthetic text: ${text}`);
}
async function tap(text) {
  const n = (await nodes()).find(n => n.text === text && n.class === 'android.widget.Button');
  assert.ok(n && n.enabled === 'true', `Visible enabled control required: ${text}`);
  const [l,t,r,b] = n.bounds.match(/\d+/g).map(Number); assert.ok(r > l && b > t);
  await adb(['shell', 'input', 'tap', String(Math.floor((l+r)/2)), String(Math.floor((t+b)/2))]);
}
try {
  const built = execFileSync('pwsh', ['-NoProfile', '-File', path.join(repo, 'scripts/build-android-direct-tls-probe.ps1'), '-OutputDirectory', path.resolve(output), '-DebugKeystore', path.resolve(keystore), '-FixtureDirectory', fixtures.scratch], { encoding: 'utf8', timeout: 120000, windowsHide: true });
  writeFileSync(path.join(output, 'build.log'), built);
  const apk = path.join(output, 'direct-tls-probe.apk');
  evidence.apkSha256 = createHash('sha256').update(readFileSync(apk)).digest('hex');
  verifyTarget(); assert.match(sync(['install', '-t', apk]), /Success/); installed = true;
  sync(['shell', 'run-as', pkg, 'mkdir', '-p', 'no_backup']);
  config({});
  const identityOutput = await adb(['shell', 'am', 'instrument', '-w', '-e', 'action', 'create', `${pkg}/.IdentityProbe`]);
  assert.match(identityOutput, /INSTRUMENTATION_CODE: -1/);
  const identity = JSON.parse(identityOutput.match(/INSTRUMENTATION_RESULT: identity=(.*)/)[1]);
  assert.equal(identity.nonExportable, true); assert.equal(identity.originGenerated, true);
  const cert = sync(['exec-out', 'run-as', pkg, 'cat', 'no_backup/client-public.pem']);
  const certificate = new X509Certificate(cert); assert.ok(certificate.verify(certificate.publicKey));
  evidence.identity = identity;
  if (event === 'restore') {
    sourceStore = await openWindowsProbeStore({ create: true, recovery: true });
    await sourceStore.create('alex-library', record);
    const backup = await exportWindowsSyntheticBackup(sourceStore);
    recoveryKey = backup.recoveryKey;
    await sourceStore.removeSyntheticStore();
    sourceStore = undefined;
    store = await openWindowsProbeStore({ create: true, recovery: true });
    await restoreWindowsSyntheticBackup(store, backup.archive, recoveryKey);
    recoveryKey.fill(0);
    recoveryKey = undefined;
    evidence.checks.push('Fictional archive imported into an empty independent Windows encrypted store after source removal; key stayed in process memory');
  } else {
    store = await openWindowsProbeStore({ create: true });
    await store.create('alex-library', record);
  }
  const ciphertext = readFileSync(path.join(store.directory, 'records.bin'));
  assert.equal(ciphertext.includes(Buffer.from(record.value)), false);
  store = await openWindowsProbeStore({ probeId: store.probeId });
  visit = await launchNativeDirectHost({ identity: fixtures.hostIdentity, ca: cert, bindAddress: address, idleMs: 60000,
    store: { lifecycleStore: store, read: async id => { assert.equal(id, 'alex-library'); reads++; return store.read(id); },
      create: async () => { writes++; throw Error('Unexpected write'); }, edit: async () => { writes++; throw Error('Unexpected write'); } } });
  console.log(`LAN_LISTENER_READY port=${visit.host.port}; waiting for real Windows verification`);
  const deadline = Date.now() + 120000;
  for (;;) { try { visit.gate.requireVerified(); break; } catch { if (Date.now() >= deadline) throw Error('Windows verification not completed'); await pause(250); } }
  const verifiedTick = performance.now();
  const peer = certificateFingerprint(cert), review = visit.enrollment.review(peer);
  if (event === 'link-reset') relay = await startDisposableRelay(address, visit.host.port);
  const port = relay?.port ?? visit.host.port;
  config({ port, hostFingerprint: review.hostFingerprint, offer: 'not-approved' });
  const rejectionOutput = await adb(['shell', 'am', 'instrument', '-w', '-e', 'action', 'host-rejection', `${pkg}/.DirectTlsProbe`]);
  assert.match(rejectionOutput, /INSTRUMENTATION_RESULT: result=PASS: selected physical Android rejected wrong TLS host name and host fingerprint\./);
  assert.match(rejectionOutput, /INSTRUMENTATION_CODE: -1/);
  evidence.checks.push('Selected physical Android rejected wrong TLS host name and host fingerprint before pairing');
  await adb(['shell', 'am', 'start', '-W', '-n', `${pkg}/.PairingActivity`]);
  const screen = await waitText('Review the test computer identity.');
  assert.ok(screen.some(n => n.text === `Test computer identity: ${review.hostFingerprint}`));
  assert.ok(screen.some(n => n.text === `Android identity: ${peer}`));
  // Owner delegated the fixed fictional test scope. This is agent approval, not human UI acceptance.
  const offer = visit.enrollment.decide({ ...review, allow: true });
  config({ ...offer, port });
  await tap('Approve fictional computer'); await tap('Connect to test computer');
  await waitText('Computer connected. Waiting for host approval...');
  const connections = visit.host.listConnections();
  evidence.connectionCountAtApproval = connections.length;
  try { visit.gate.requireVerified(); evidence.gateAtApproval = 'verified'; }
  catch { evidence.gateAtApproval = 'closed'; }
  assert.equal(connections.length, 1); assert.equal(connections[0].peerFingerprint, peer);
  const grantTick = performance.now();
  visit.enrollment.approveRead(connections[0]);
  await waitText('Connected. Review and allow the selected read.'); await tap('Allow selected read');
  await tap("Read Alex's record"); await waitText(`${record.label}: ${record.value}`);
  evidence.checks.push(`Physical Android read of ${event === 'restore' ? 'restored' : 'reopened'} Windows encrypted store over native mutually authenticated TLS1.3 on LAN`);
  assert.equal(reads, 1); assert.equal(writes, 0);
  if (event === 'client-end') {
    await tap('End connection');
    const ended = await waitText('Connection ended. Reading needs fresh approval.');
    assert.ok(ended.some(n => n.text === 'No record shown.'));
    assert.ok(ended.some(n => n.text === "Read Alex's record" && n.enabled === 'false'));
    visit.gate.requireVerified();
    await tap('Connect to test computer');
    await waitText('Computer connected. Waiting for host approval...');
    const awaiting = await nodes();
    assert.ok(awaiting.some(n => n.text === 'No record shown.'));
    assert.ok(awaiting.some(n => n.text === "Read Alex's record" && n.enabled === 'false'));
    assert.equal(reads, 1); assert.equal(writes, 0);
    evidence.checks.push('Physical Android End connection cleared content and access; reconnect awaited fresh host approval without a second store read');
  } else if (event === 'revoke' || event === 'restore') {
    visit.host.revokePeer(peer);
    const denied = await waitText('Connection lost. Record hidden; fresh approval required.');
    assert.ok(denied.some(n => n.text === 'No record shown.'));
    assert.ok(denied.some(n => n.text === "Read Alex's record" && n.enabled === 'false'));
    await tap('Connect to test computer');
    await waitText('Connection or approval unavailable. No access remains.');
    assert.equal(reads, 1); assert.equal(writes, 0);
    evidence.checks.push(`${event === 'restore' ? 'After restore, removing' : 'Removing'} the physical client automatically cleared its displayed record and old access; reconnect was denied without another store read`);
  } else if (event === 'host-loss') {
    assert.ok(performance.now() - grantTick < 60_000, 'Host-loss check missed the active read grant');
    const disconnectedBy = performance.now() + 5_000;
    await beforeDeadline(visit.host.close(), disconnectedBy, 'Owned host closure exceeded five seconds');
    visit.gate.requireVerified(); // Only the owned transport stopped; Windows verification did not stand in for a network event.
    while (visit.host.listConnections().length && performance.now() < disconnectedBy) await pause(20);
    assert.deepEqual(visit.host.listConnections(), []);
    const denied = await waitText('Connection lost. Record hidden; fresh approval required.');
    assert.ok(denied.some(n => n.text === 'No record shown.'));
    assert.ok(denied.some(n => n.text === "Read Alex's record" && n.enabled === 'false'));
    await tap('Connect to test computer');
    await waitText('Connection or approval unavailable. No access remains.');
    assert.equal(reads, 1); assert.equal(writes, 0);
    evidence.checks.push('Owned host transport stopped after one read; physical client automatically cleared displayed content and old access, then denied reconnect without another store read');
  } else if (event === 'link-reset') {
    assert.ok(performance.now() - grantTick < 60_000, 'Link-reset check missed the active read grant');
    assert.equal(relay.activeCount(), 1);
    relay.drop();
    const disconnectedBy = performance.now() + 5_000;
    while ((relay.activeCount() || visit.host.listConnections().length) && performance.now() < disconnectedBy) await pause(20);
    relay.check();
    assert.equal(relay.activeCount(), 0);
    assert.deepEqual(visit.host.listConnections(), []);
    visit.gate.requireVerified(); // A transport reset is not a Windows lifecycle event.
    assert.deepEqual(visit.nativeEvents, []);
    const denied = await waitText('Connection lost. Record hidden; fresh approval required.');
    assert.ok(denied.some(n => n.text === 'No record shown.'));
    assert.ok(denied.some(n => n.text === "Read Alex's record" && n.enabled === 'false'));
    await tap('Connect to test computer');
    await waitText('Computer connected. Waiting for host approval...');
    const awaiting = await nodes();
    assert.ok(awaiting.some(n => n.text === 'No record shown.'));
    assert.ok(awaiting.some(n => n.text === "Read Alex's record" && n.enabled === 'false'));
    assert.ok(visit.host.listConnections().some(c => c.peerFingerprint === peer));
    assert.equal(reads, 1); assert.equal(writes, 0);
    evidence.checks.push('Disposable TCP relay reset the physical client link while Windows and the host remained verified; displayed content cleared automatically and reconnect awaited fresh host approval without a second store read');
  } else if (event === 'wifi-cycle') {
    assert.equal(sync(['shell', 'settings', 'get', 'global', 'wifi_on']).trim(), '1', 'Physical Wi-Fi must begin enabled');
    assert.ok(await wifiRouteAvailable(), 'Physical phone must route to the selected private host over Wi-Fi');
    assert.ok(performance.now() - grantTick < 60_000, 'Wi-Fi cycle missed the active read grant');
    wifiChanged = true;
    sync(['shell', 'svc', 'wifi', 'disable']);
    const disabledBy = performance.now() + 10_000;
    while ((sync(['shell', 'settings', 'get', 'global', 'wifi_on']).trim() !== '0' || await wifiRouteAvailable()) && performance.now() < disabledBy) await pause(100);
    assert.equal(sync(['shell', 'settings', 'get', 'global', 'wifi_on']).trim(), '0', 'Physical Wi-Fi did not switch off');
    assert.equal(await wifiRouteAvailable(), false, 'Physical Wi-Fi route to the host did not disappear');
    assert.ok(performance.now() - grantTick < 60_000, 'Wi-Fi did not switch off during the active read grant');
    visit.gate.requireVerified();
    assert.deepEqual(visit.nativeEvents, []);
    const denied = await waitText('Connection lost. Record hidden; fresh approval required.');
    assert.ok(performance.now() - grantTick < 60_000, 'Automatic clearing missed the active read grant');
    assert.ok(denied.some(n => n.text === 'No record shown.'));
    assert.ok(denied.some(n => n.text === "Read Alex's record" && n.enabled === 'false'));
    await tap('Connect to test computer');
    await waitText('Connection or approval unavailable. No access remains.');
    sync(['shell', 'svc', 'wifi', 'enable']);
    const enabledBy = performance.now() + 30_000;
    while ((sync(['shell', 'settings', 'get', 'global', 'wifi_on']).trim() !== '1' || !(await wifiRouteAvailable())) && performance.now() < enabledBy) await pause(250);
    assert.equal(sync(['shell', 'settings', 'get', 'global', 'wifi_on']).trim(), '1', 'Physical Wi-Fi did not switch back on');
    assert.ok(await wifiRouteAvailable(), 'Physical Wi-Fi route to the host did not return');
    await tap('Connect to test computer');
    await waitText('Computer connected. Waiting for host approval...');
    const awaiting = await nodes();
    assert.ok(awaiting.some(n => n.text === 'No record shown.'));
    assert.ok(awaiting.some(n => n.text === "Read Alex's record" && n.enabled === 'false'));
    assert.ok(visit.host.listConnections().some(c => c.peerFingerprint === peer));
    visit.gate.requireVerified();
    assert.deepEqual(visit.nativeEvents, []);
    assert.equal(reads, 1); assert.equal(writes, 0);
    evidence.checks.push('Physical Wi-Fi was disabled and restored over USB adb while Windows and its TLS host stayed verified; displayed content cleared automatically, offline reconnect failed, and reconnect after Wi-Fi returned awaited fresh host approval without another store read');
  } else if (event === 'background') {
    await adb(['shell', 'input', 'keyevent', 'KEYCODE_HOME']);
    await pause(300);
    const focus = await adb(['shell', 'dumpsys', 'window']);
    assert.ok(!focus.split('\n').some(line => /mCurrentFocus=/.test(line) && line.includes(pkg)), 'Fictional client must leave the foreground');
    await adb(['shell', 'am', 'start', '-W', '-n', `${pkg}/.PairingActivity`]);
    const returned = await waitText('No record shown.');
    assert.ok(returned.some(n => n.text === "Read Alex's record" && n.enabled === 'false'));
    assert.ok(returned.some(n => n.text === 'Connect to test computer' && n.enabled === 'false'));
    visit.gate.requireVerified();
    assert.deepEqual(visit.nativeEvents, []);
    assert.ok(performance.now() - grantTick < 60_000, 'Background check missed the active read grant');
    await tap('Approve fictional computer');
    await tap('Connect to test computer');
    await waitText('Computer connected. Waiting for host approval...');
    const awaiting = await nodes();
    assert.ok(awaiting.some(n => n.text === 'No record shown.'));
    assert.ok(awaiting.some(n => n.text === "Read Alex's record" && n.enabled === 'false'));
    assert.ok(visit.host.listConnections().some(c => c.peerFingerprint === peer));
    assert.equal(reads, 1); assert.equal(writes, 0);
    evidence.checks.push('Android background cleared content and scope during an active grant; reconnect awaited fresh host approval with no second store read');
  } else {
    evidence.actionRequested = new Date().toISOString();
    if (event === 'expiry') {
      console.log('WAIT_FOR_VISIT_EXPIRY; leave Windows and the phone test app awake');
      await pause(120_000);
      visit.gate.requireVerified(); // The phone grant has expired; the Windows visit remains active.
      evidence.checks.push('Windows visit still verified after the phone read grant expired');
      const remaining = 315_000 - (performance.now() - verifiedTick);
      assert.ok(remaining > 0, 'Visit-expiry observation started too late');
      let expiryTimer;
      let end;
      try {
        end = await Promise.race([visit.ended, new Promise((_, reject) => {
          expiryTimer = setTimeout(() => reject(Error('Native visit did not expire within 315 seconds')), remaining);
        })]);
      } finally { clearTimeout(expiryTimer); }
      await pause(250); // Let the owned native diagnostic pipe deliver any competing lifecycle event.
      const elapsed = performance.now() - verifiedTick;
      requireVisitDeadline(end, visit.nativeEvents, elapsed);
      evidence.elapsedFromVerificationToVisitEndMs = Math.round(elapsed);
      evidence.visitEndReason = end.reason;
      evidence.checks.push('Native Windows visit expired after five minutes without a lifecycle event');
    } else {
      console.log(`READY_FOR_EVENT:${event}; keep phone test app visible; perform Windows action now`);
      let eventTimer;
      try {
        await Promise.race([visit.ended, new Promise((_, reject) => { eventTimer = setTimeout(() => reject(Error('No native lifecycle event within 90 seconds')), 90000); })]);
      } finally { clearTimeout(eventTimer); }
      await pause(250);
      const reason = event === 'lock' ? 'lock' : 'suspend';
      const receipt = requireLifecycleDuringGrant(visit.nativeEvents, reason, grantTick, 60_000);
      evidence.elapsedFromGrantToNativeEventMs = Math.round(receipt.tick - grantTick);
    }
    evidence.nativeEvents = [...visit.nativeEvents];
    assert.throws(() => visit.gate.requireVerified());
    if (event === 'sleep') {
      const terminal = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
      // The clock behind AbortSignal.timeout can advance during Windows sleep.
      // Allow an attended longer sleep and a normal unlock before resuming checks.
      try { assert.equal(await terminal.question('WAIT_FOR_RESUME: after waking and unlocking Windows, type back: ', { signal: AbortSignal.timeout(1_200_000) }), 'back'); }
      finally { terminal.close(); }
      // Read-only readiness polling: Windows Wi-Fi/ADB can recover after the native
      // session already ended. Never retry a record operation or open a fresh grant.
      const readyDeadline = Date.now() + 60000;
      for (;;) {
        try {
          const state = await promisify(execFile)(adbPath, ['-s', serial, 'shell', 'getprop', 'ro.product.model'], { encoding: 'utf8', timeout: 3000, windowsHide: true });
          assert.equal(state.stdout.trim(), model); break;
        } catch (error) { if (Date.now() >= readyDeadline) throw error; await pause(1000); }
      }
    }
    const current = await nodes();
    evidence.readControlAfterEvent = current.some(n => n.text === "Read Alex's record" && n.enabled === 'true') ? 'enabled; attempting old read' : 'already closed';
    if (evidence.readControlAfterEvent.startsWith('enabled')) {
      await tap("Read Alex's record");
      await waitText('Read unavailable. No access remains.');
    }
    await waitText('No record shown.');
    const closed = await nodes(); assert.ok(closed.some(n => n.text === "Read Alex's record" && n.enabled === 'false'));
    await tap('Connect to test computer'); await waitText('Connection or approval unavailable. No access remains.');
    assert.equal(reads, 1); assert.equal(writes, 0);
    evidence.checks.push(`${event === 'expiry' ? 'Windows visit deadline' : `Native Windows ${event === 'lock' ? 'lock' : 'suspend'} receipt`} ended visit; phone old read refused or expired, content cleared, reconnect denied without another store read`);
  }
  assert.deepEqual(readFileSync(path.join(store.directory, 'records.bin')), ciphertext);
  evidence.nativeEvents = [...visit.nativeEvents]; evidence.reads = reads; evidence.writes = writes;
  evidence.result = 'PASS'; evidence.finished = new Date().toISOString();
} catch (error) { evidence.error = error.message; throw error; }
finally {
  const failures = [];
  recoveryKey?.fill(0);
  evidence.nativeEvents ??= [...(visit?.nativeEvents || [])];
  try { if (wifiChanged) {
    sync(['shell', 'svc', 'wifi', 'enable']);
    const restoredBy = performance.now() + 30_000;
    while ((sync(['shell', 'settings', 'get', 'global', 'wifi_on']).trim() !== '1' || !(await wifiRouteAvailable())) && performance.now() < restoredBy) await pause(250);
    assert.equal(sync(['shell', 'settings', 'get', 'global', 'wifi_on']).trim(), '1', 'Physical Wi-Fi cleanup did not restore enabled state');
    assert.ok(await wifiRouteAvailable(), 'Physical Wi-Fi cleanup did not restore the private host route');
  } } catch (e) { failures.push(e); }
  try { await relay?.close(); } catch (e) { failures.push(e); }
  try { if (visit) await beforeDeadline(visit.close(), performance.now() + 5_000, 'Owned visit cleanup exceeded five seconds'); } catch (e) { failures.push(e); }
  try { await store?.removeSyntheticStore(); } catch (e) { failures.push(e); }
  try { await sourceStore?.removeSyntheticStore(); } catch (e) { failures.push(e); }
  try { if (installed) {
    verifyTarget();
    sync(['shell', 'rm', '-f', '/data/local/tmp/fictional-physical-ui.xml']);
    assert.match(sync(['uninstall', pkg]), /Success/);
  } } catch (e) { failures.push(e); }
  fixtures.cleanup(); evidence.cleanup = failures.length ? 'FAILED' : 'PASS';
  if (existsSync(output)) writeFileSync(path.join(output, 'result.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
  if (failures.length) throw new AggregateError(failures, 'Owned test cleanup failed');
}
