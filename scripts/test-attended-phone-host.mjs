// Attended Windows -> selected physical Android, one fictional read over direct TLS.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { connect as connectTls } from 'node:tls';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDirectTlsIdentities } from './test-fixtures/direct-tls-identities.mjs';
import { selectedUsbAdb } from './test-fixtures/usb-adb-preflight.mjs';
import { newExternalEvidencePath } from './test-fixtures/attended-output.mjs';
import { privateTestAddress, certificateFingerprint } from '../lib/direct-vault-tls.js';

const [output, apk, serial, model, apiText, pcAddress] = process.argv.slice(2);
assert.ok(process.platform === 'win32' && process.stdin.isTTY, 'Attended Windows terminal required');
assert.ok(output && apk && serial && model && /^\d+$/.test(apiText));
privateTestAddress(pcAddress);
assert.ok(Object.values(networkInterfaces()).flat().some(item => item?.address === pcAddress && !item.internal),
  'Windows address must be assigned to a local interface');
const repo = fileURLToPath(new URL('..', import.meta.url));
const evidencePath = newExternalEvidencePath(output, repo);
assert.ok(existsSync(apk));
const pkg = 'io.github.f2illc.lunaos.home.preview.issue14phonehost.debug';
const adbPath = path.join(process.env.ANDROID_HOME, 'platform-tools/adb.exe');
const aapt2Path = path.join(process.env.ANDROID_HOME, 'build-tools/37.0.0/aapt2.exe');
const badging = execFileSync(aapt2Path, ['dump', 'badging', apk],
  { encoding: 'utf8', timeout: 20_000, windowsHide: true, maxBuffer: 128 * 1024 });
assert.equal(/^package: name='([^']+)'/m.exec(badging)?.[1], pkg);
assert.equal(/^targetSdkVersion:'(\d+)'/m.exec(badging)?.[1], '37');
for (const permission of ['ACCESS_LOCAL_NETWORK', 'INTERNET', 'USE_BIOMETRIC'])
  assert.match(badging, new RegExp(`^uses-permission: name='android\\.permission\\.${permission}'`, 'm'));
const adb = (args, input, binary = false) => execFileSync(adbPath, ['-s', serial, ...args],
  { input, encoding: binary ? null : 'utf8', timeout: 25_000, windowsHide: true });
function adbRead(args) {
  try { return adb(args); }
  catch (error) {
    if (!String(error.stderr).includes('daemon still not running')) throw error;
    execFileSync(adbPath, ['start-server'], { timeout: 20_000, windowsHide: true });
    return adb(args);
  }
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const listed = execFileSync(adbPath, ['devices', '-l'], { encoding: 'utf8', timeout: 20_000, windowsHide: true });
let presentDevices = [];
if (!selectedUsbAdb(listed, serial)) {
  const present = execFileSync('powershell.exe', ['-NoProfile', '-Command',
    "Get-PnpDevice -PresentOnly | Where-Object { $_.Class -eq 'USB' -or $_.Class -like 'Android*' } | ForEach-Object { $parent = if ($_.Class -like 'Android*') { (Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName 'DEVPKEY_Device_Parent').Data } else { $null }; [pscustomobject]@{ Class = $_.Class; InstanceId = $_.InstanceId; Parent = $parent } } | ConvertTo-Json -Compress"],
    { encoding: 'utf8', timeout: 20_000, windowsHide: true, maxBuffer: 128 * 1024 });
  const parsed = JSON.parse(present);
  presentDevices = Array.isArray(parsed) ? parsed : [parsed];
}
assert.ok(selectedUsbAdb(listed, serial, presentDevices), 'Selected physical phone must use authorized USB ADB');
assert.equal(adb(['shell', 'getprop', 'ro.product.model']).trim(), model);
assert.equal(adb(['shell', 'getprop', 'ro.build.version.sdk']).trim(), apiText);
assert.notEqual(adb(['shell', 'getprop', 'ro.hardware']).trim(), 'ranchu');
assert.equal(adb(['shell', 'pm', 'list', 'packages', pkg]).trim(), '', 'Never overwrite an installed test package');
const wifi = adb(['shell', 'ip', '-4', 'addr', 'show', 'wlan0']);
const phoneAddress = /\binet (\d+\.\d+\.\d+\.\d+)\//.exec(wifi)?.[1];
assert.ok(phoneAddress, 'Selected physical phone needs private Wi-Fi IPv4');
privateTestAddress(phoneAddress);
assert.match(adb(['shell', 'ip', '-4', 'route', 'get', pcAddress]), /\bdev wlan0\b/);
mkdirSync(evidencePath);
const evidence = { result: 'INCOMPLETE', model, api: Number(apiText),
  apkSha256: createHash('sha256').update(readFileSync(apk)).digest('hex'), checks: [] };
const fixtures = createDirectTlsIdentities({ hostOnly: true, windowsClient: true });
let installed = false;
function nodes() {
  const focus = adbRead(['shell', 'dumpsys', 'window']);
  assert.ok(focus.split('\n').some(line => line.includes('mCurrentFocus=') && line.includes(pkg)),
    'Bring the separate Home test app to the foreground');
  adbRead(['shell', 'uiautomator', 'dump', '/data/local/tmp/home-phone-host-ui.xml']);
  const xml = adbRead(['shell', 'cat', '/data/local/tmp/home-phone-host-ui.xml']);
  return [...xml.matchAll(/<node\b[^>]*>/g)].map(([tag]) =>
    Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) =>
      [key, value.replaceAll('&apos;', "'").replaceAll('&amp;', '&')]))).filter(node => node.package === pkg);
}
async function waitText(value, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    try { const found = nodes(); if (found.some(node => node.text.toLowerCase().includes(value.toLowerCase()))) return found; }
    catch (error) { if (!String(error.message).includes('foreground')) throw error; }
    await pause(250);
  } while (Date.now() < deadline);
  throw Error(`Expected fictional app status unavailable: ${value}`);
}
async function tap(value) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const found = nodes().find(node => node.text.toLowerCase() === value.toLowerCase());
    if (found?.enabled === 'false') throw Error(`Fictional control disabled: ${value}`);
    if (found) {
      const [left, top, right, bottom] = found.bounds.match(/\d+/g).map(Number);
      if (right > left && bottom > top) {
        if (top < 140) adb(['shell', 'input', 'swipe', '540', '850', '540', '1940', '250']);
        else if (bottom > 2080) adb(['shell', 'input', 'swipe', '540', '1940', '540', '850', '250']);
        else {
          adb(['shell', 'input', 'tap', String(Math.floor((left + right) / 2)), String(Math.floor((top + bottom) / 2))]);
          return;
        }
        await pause(200);
        continue;
      }
    }
    adb(['shell', 'input', 'swipe', '540', '2040', '540', '850', '250']);
    await pause(200);
  }
  throw Error(`Enabled fictional control unavailable: ${value}`);
}
async function credentialAndApprove() {
  await tap('1. Verify with Android');
  console.log('ANDROID_CREDENTIAL_READY: complete the trusted Android prompt on the Samsung');
  await waitText('Verified only. Review member and mode', 120_000);
  await tap('2. Approve selected scope for 60 seconds');
  await waitText('Approved selected scope for 60 seconds');
}
function oneRead(port, phoneFingerprint) {
  return new Promise((resolve, reject) => {
    const socket = connectTls({ host: phoneAddress, port, localAddress: pcAddress,
      cert: fixtures.windowsClientIdentity.cert, key: fixtures.windowsClientIdentity.key,
      rejectUnauthorized: false, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3', timeout: 8_000 });
    const chunks = [];
    let size = 0, settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true; socket.destroy();
      if (error) reject(error); else resolve(result);
    };
    socket.on('secureConnect', () => {
      try {
        assert.equal(socket.getProtocol(), 'TLSv1.3');
        const peer = socket.getPeerCertificate(true);
        assert.ok(peer?.raw, 'Phone must present its reviewed certificate');
        assert.equal(createHash('sha256').update(peer.raw).digest('hex'), phoneFingerprint,
          'Phone TLS identity changed before the fixed read');
        socket.write('READ ALEX\n');
      } catch (error) { finish(error); }
    });
    socket.on('data', chunk => {
      size += chunk.length;
      if (size > 200) finish(Error('Oversized fictional response'));
      else chunks.push(chunk);
    });
    socket.on('error', error => finish(error));
    socket.on('timeout', () => finish(Error('Phone-hosted TLS read timed out')));
    socket.on('end', () => finish(undefined, Buffer.concat(chunks).toString('utf8')));
    socket.on('close', () => { if (!settled) finish(Error('Phone closed before the fixed read completed')); });
  });
}
try {
  assert.match(adb(['install', '-t', apk]), /Success/); installed = true;
  adb(['shell', 'am', 'start', '-W', '-n', `${pkg}/io.github.f2illc.lunaos.home.preview.MainActivity`]);
  await waitText('What would you like to do today?', 40_000);
  await tap('What would you like to do today?');
  await waitText('Open fictional Android vault experiment (debug, API30+)', 40_000);
  await tap('Open fictional Android vault experiment (debug, API30+)');
  await waitText('Closed. Device credentials');
  await tap('Prepare fictional phone TLS identity (debug)');
  await waitText('Fictional phone TLS identity prepared');
  const phoneCert = adb(['exec-out', 'run-as', pkg, 'cat', 'no_backup/client-public.pem']);
  const parsedPhone = new X509Certificate(phoneCert);
  assert.ok(parsedPhone.verify(parsedPhone.publicKey));
  const phoneFingerprint = certificateFingerprint(phoneCert);
  adb(['shell', '-T', 'run-as', pkg, 'sh', '-c', "'cat > no_backup/phone-host-windows.pem'"],
    fixtures.windowsClientIdentity.cert);
  await tap('Allow local network for fictional phone host (debug)');
  console.log('ANDROID_LOCAL_NETWORK_PERMISSION_READY: tap Allow on Samsung if prompted');
  await waitText('Local network allowed', 120_000);
  await tap('Setup: create/edit selected record, never delete');
  await credentialAndApprove();
  await tap('Save fictional visit: Monday');
  await waitText('Save applied');
  await tap('End access');
  const before = adb(['exec-out', 'run-as', pkg, 'cat', 'no_backup/fictional-v1-ALEX'], undefined, true);
  assert.equal(before.length, 30);
  assert.equal(before.includes(Buffer.from('Alex Example')), false);
  await tap('Read-only: selected record');
  assert.ok(nodes().some(node => node.text === 'Read-only: selected record' && node.checked === 'true'),
    'Selected mode must change to read-only before a new Android verification');
  await credentialAndApprove();
  assert.ok(nodes().some(node => node.text === 'Read-only: selected record' && node.checked === 'true'),
    'Approved scope must remain read-only');
  await tap('Review fictional Windows client identity (debug)');
  const review = nodes();
  assert.ok(review.some(node => node.text.includes(fixtures.windowsClientIdentity.fingerprint)),
    'Phone must show the full exact Windows client fingerprint before approval');
  await tap('Allow one Windows read of Alex (debug)');
  const ready = await waitText('Phone host ready on private Wi-Fi');
  const port = Number(ready.map(node => node.text).join(' ').match(/Port: (\d+)/)?.[1]);
  assert.ok(Number.isInteger(port) && port > 0 && port < 65536);
  const response = await oneRead(port, phoneFingerprint);
  assert.equal(response, 'Alex Example — fictional library visit: Monday\n');
  const closed = await waitText('Fictional Windows read completed. Access ended.');
  assert.ok(closed.some(node => node.text.toLowerCase() === 'allow one windows read of alex (debug)' && node.enabled === 'false'));
  const after = adb(['exec-out', 'run-as', pkg, 'cat', 'no_backup/fictional-v1-ALEX'], undefined, true);
  assert.deepEqual(after, before);
  assert.match(adb(['shell', 'ip', '-4', 'route', 'get', pcAddress]), /\bdev wlan0\b/);
  evidence.checks.push('Separate Home debug app served one fixed fictional Alex read to Windows over direct Wi-Fi TLS 1.3 with both exact certificate fingerprints checked');
  evidence.checks.push('Android credential and selected read-only approval preceded listener creation; Android Keystore retained phone private key');
  evidence.checks.push('Phone encrypted record bytes were unchanged by the Windows read; listener and read controls closed afterward');
  evidence.result = 'PASS';
} catch (error) {
  evidence.error = error.name;
  console.error('PRIMARY_RUN_FAILURE', error);
  throw error;
} finally {
  const failures = [];
  if (installed) {
    try { adb(['shell', 'am', 'force-stop', pkg]); adb(['uninstall', pkg]); }
    catch (error) { failures.push(error.name); }
  }
  try { fixtures.cleanup(); } catch (error) { failures.push(error.name); }
  evidence.cleanup = failures.length ? 'FAILED' : 'PASS';
  writeFileSync(path.join(evidencePath, 'result.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(`EVIDENCE ${evidence.result} ${evidence.cleanup} ${evidencePath}`);
  if (failures.length) process.exitCode = 1;
}
