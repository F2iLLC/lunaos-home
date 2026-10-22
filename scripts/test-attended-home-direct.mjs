// Attended, fictional-only Home GUI -> protected Windows store check.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDirectTlsIdentities } from './test-fixtures/direct-tls-identities.mjs';
import { selectedUsbAdb } from './test-fixtures/usb-adb-preflight.mjs';
import { launchNativeDirectHost } from './test-fixtures/native-direct-host.mjs';
import { privateTestAddress, certificateFingerprint } from '../lib/direct-vault-tls.js';
import { openWindowsProbeStore } from '../lib/windows-probe-store.js';

const [output, apk, serial, model, apiText, address] = process.argv.slice(2);
assert.ok(process.platform === 'win32' && process.stdin.isTTY, 'Attended Windows terminal required');
assert.ok(output && apk && serial && model && /^\d+$/.test(apiText));
privateTestAddress(address);
assert.ok(Object.values(networkInterfaces()).flat().some(item => item?.address === address && !item.internal),
  'Host address must be assigned to a private local interface');
const repo = fileURLToPath(new URL('..', import.meta.url));
const evidencePath = path.resolve(output), repositoryPath = path.resolve(repo);
assert.ok(evidencePath !== repositoryPath && !evidencePath.startsWith(repositoryPath + path.sep) && !existsSync(output),
  'Use a fresh evidence directory outside Git');
assert.ok(existsSync(apk));
const adbPath = path.join(process.env.ANDROID_HOME, 'platform-tools/adb.exe');
const pkg = 'io.github.f2illc.lunaos.home.preview.issue14direct.debug';
const adb = (args, input) => execFileSync(adbPath, ['-s', serial, ...args],
  { input, encoding: 'utf8', timeout: 25_000, windowsHide: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const fingerprint = certificate => certificateFingerprint(certificate);
const record = { memberId: 'alex-example', label: 'Library visit', value: 'Thursday from protected storage' };
const evidence = { result: 'INCOMPLETE', model, api: Number(apiText), apkSha256: createHash('sha256').update(readFileSync(apk)).digest('hex'), checks: [] };
const listed = execFileSync(adbPath, ['devices', '-l'], { encoding: 'utf8', timeout: 20_000, windowsHide: true });
let presentDevices = [];
if (!selectedUsbAdb(listed, serial)) {
  const present = execFileSync('powershell.exe', ['-NoProfile', '-Command',
    "Get-PnpDevice -PresentOnly | Where-Object { $_.Class -eq 'USB' -or $_.Class -like 'Android*' } | ForEach-Object { $parent = if ($_.Class -like 'Android*') { (Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName 'DEVPKEY_Device_Parent').Data } else { $null }; [pscustomobject]@{ Class = $_.Class; InstanceId = $_.InstanceId; Parent = $parent } } | ConvertTo-Json -Compress"],
    { encoding: 'utf8', timeout: 20_000, windowsHide: true, maxBuffer: 128 * 1024 });
  const parsed = JSON.parse(present);
  presentDevices = Array.isArray(parsed) ? parsed : [parsed];
}
assert.ok(selectedUsbAdb(listed, serial, presentDevices), 'Selected phone must use USB adb');
assert.equal(adb(['shell', 'getprop', 'ro.product.model']).trim(), model);
assert.equal(adb(['shell', 'getprop', 'ro.build.version.sdk']).trim(), apiText);
assert.notEqual(adb(['shell', 'getprop', 'ro.hardware']).trim(), 'ranchu');
assert.equal(adb(['shell', 'pm', 'list', 'packages', pkg]).trim(), '', 'Never overwrite an installed Home direct test package');
mkdirSync(output);
const fixtures = createDirectTlsIdentities({ hostOnly: true });
let installed = false, store, visit, reads = 0, writes = 0;

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
function privateFile(name, bytes) {
  adb(['shell', '-T', 'run-as', pkg, 'sh', '-c', `'cat > no_backup/${name}'`], bytes);
}

try {
  assert.match(adb(['install', '-t', apk]), /Success/); installed = true;
  adb(['shell', 'am', 'start', '-W', '-n', `${pkg}/io.github.f2illc.lunaos.home.preview.MainActivity`]);
  await waitText('What would you like to do today?');
  await tap('What would you like to do today?');
  await tap('Prepare or renew fictional computer identity (debug)');
  await waitText('Test identity prepared or renewed. Re-pair with the computer before connecting.');
  const cert = adb(['exec-out', 'run-as', pkg, 'cat', 'no_backup/client-public.pem']);
  const certificate = new X509Certificate(cert);
  assert.ok(certificate.verify(certificate.publicKey));
  const peer = fingerprint(cert);
  evidence.checks.push('Home explicitly prepared an Android Keystore transport identity and exported only its public certificate');

  store = await openWindowsProbeStore({ create: true });
  await store.create('alex-library', record);
  const ciphertext = readFileSync(path.join(store.directory, 'records.bin'));
  assert.equal(ciphertext.includes(Buffer.from(record.value)), false);
  store = await openWindowsProbeStore({ probeId: store.probeId });
  visit = await launchNativeDirectHost({ identity: fixtures.hostIdentity, ca: cert, bindAddress: address, idleMs: 60_000,
    store: { lifecycleStore: store, read: async id => { assert.equal(id, 'alex-library'); reads++; return store.read(id); },
      create: async () => { writes++; throw Error('Unexpected write'); }, edit: async () => { writes++; throw Error('Unexpected write'); } } });
  // The empty preflight connection proves this exact listener port is reachable
  // from the phone. It sends no application data and cannot authenticate.
  const beforeTcp = visit.host.incomingTcpCount();
  try { adb(['shell', 'toybox', 'nc', '-w', '2', address, String(visit.host.port)]); }
  catch { /* An unauthenticated TLS server may close netcat with a nonzero exit. */ }
  await pause(250);
  if (visit.host.incomingTcpCount() <= beforeTcp) throw Error('Selected phone cannot reach the exact Windows test listener port');
  evidence.checks.push('Selected phone reached the exact private Windows listener port before verification');
  console.log('WINDOWS_VERIFICATION_READY: complete the trusted Windows prompt on this computer');
  const verifiedBy = Date.now() + 120_000;
  for (;;) { try { visit.gate.requireVerified(); break; } catch { if (Date.now() >= verifiedBy) throw Error('Windows verification not completed'); await pause(250); } }

  privateFile('ca.pem', fixtures.ca);
  const config = { physicalOptIn: 'attended-fictional-lan-only', expectedModel: model, expectedApi: Number(apiText),
    transportAddress: address, port: visit.host.port, hostFingerprint: visit.host.hostFingerprint, offer: 'not-approved' };
  privateFile('config.json', JSON.stringify(config));
  await tap('Open fictional computer connection (debug)');
  console.log('ANDROID_LOCAL_NETWORK_PERMISSION_READY: approve the Android local network prompt for this test package if shown');
  await waitText('Review the test computer identity.', 180_000);
  const review = visit.enrollment.review(peer);
  const screen = appNodes();
  assert.ok(screen.some(node => node.text === `Test computer identity: ${review.hostFingerprint}`));
  assert.ok(screen.some(node => node.text === `Android identity: ${peer}`));
  // The owner delegated this fixed fictional test scope. This is an attended
  // agent decision after both full identities are shown, not human acceptance.
  console.log('IDENTITY_REVIEW: matched full host and Android fingerprints on the Home screen');
  const offer = visit.enrollment.decide({ ...review, allow: true });
  privateFile('config.json', JSON.stringify({ ...config, ...offer }));
  await tap('Approve fictional computer');
  await tap('Connect to test computer');
  await waitText('Computer connected. Waiting for host approval...');
  const connections = visit.host.listConnections();
  assert.equal(connections.length, 1);
  assert.equal(connections[0].peerFingerprint, peer);
  // A separate decision grants only this connection's Alex read for 60 seconds.
  visit.enrollment.approveRead(connections[0]);
  await waitText('Connected. Review and allow the selected read.');
  const approvalStarted = Date.now();
  await tap('Allow selected read');
  await tap("Read Alex's record");
  const shown = await waitText(`${record.label}: ${record.value}`);
  evidence.readDisplayedWithinMs = Date.now() - approvalStarted;
  assert.equal(reads, 1); assert.equal(writes, 0);
  evidence.checks.push('Home native screen read the committed Windows DPAPI record over directly authenticated TLS with separate host and phone approvals');
  if (!tapVisible('End connection', shown)) await tap('End connection');
  const ended = await waitText('Connection ended. Reading needs fresh approval.');
  assert.ok(ended.some(node => node.text === 'No record shown.'));
  assert.ok(ended.some(node => node.text === "Read Alex's record" && node.enabled === 'false'));
  assert.equal(reads, 1); assert.equal(writes, 0);
  evidence.checks.push('End cleared displayed content and old read authority without a second store read');
  assert.deepEqual(readFileSync(path.join(store.directory, 'records.bin')), ciphertext);
  evidence.result = 'PASS';
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
  console.error('PRIMARY_RUN_FAILURE', error);
  throw error;
}
finally {
  const failures = [];
  try { await visit?.close(); } catch (error) { failures.push(error); }
  try { await store?.removeSyntheticStore(); } catch (error) { failures.push(error); }
  try { if (installed) {
    adb(['shell', 'rm', '-f', '/data/local/tmp/home-direct-ui.xml']);
    assert.match(adb(['uninstall', pkg]), /Success/);
  } } catch (error) { failures.push(error); }
  fixtures.cleanup();
  evidence.reads = reads; evidence.writes = writes; evidence.cleanup = failures.length ? 'FAILED' : 'PASS';
  writeFileSync(path.join(output, 'result.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
  if (failures.length) throw new AggregateError(failures, 'Owned fictional cleanup failed');
}
