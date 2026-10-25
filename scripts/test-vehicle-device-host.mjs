// Explicit attended developer harness. Only the separate vehicle test package.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createDirectTlsIdentities } from './test-fixtures/direct-tls-identities.mjs';
import { certificateFingerprint, privateTestAddress, startDirectVaultExperiment } from '../lib/direct-vault-tls.js';
import { createVehicleSessions } from '../lib/vehicle-sessions.js';

const [sdk, serial, address, mode] = process.argv.slice(2);
if (!sdk || !serial || !address) throw Error('Usage: node scripts/test-vehicle-device-host.mjs <SDK> <explicit device serial> <private host IPv4>');
const usb = mode === '--usb';
if (mode && !usb) throw Error('Unsupported test mode');
if (!usb) privateTestAddress(address);
const adb = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const pkg = 'io.github.f2illc.lunaos.home.vehicleprobe';
const call = (args, input) => execFileSync(adb, ['-s', serial, ...args], { input, encoding: 'utf8', timeout: 15000, windowsHide: true });
const publicCert = call(['exec-out', 'run-as', pkg, 'cat', 'no_backup/client-public.pem']);
const peer = certificateFingerprint(publicCert);
const fixture = createDirectTlsIdentities({ hostOnly: true });
const sessions = createVehicleSessions(); sessions.approve(peer);
let events = 0;
const host = await startDirectVaultExperiment({ identity: fixture.hostIdentity, ca: publicCert, bindAddress: usb ? '127.0.0.1' : address,
  vehicleSessions: { ...sessions, receive(who, event) {
    const result = sessions.receive(who, event); events++;
    console.log(`Vehicle event ${events}: ${event.event}; ${result.state}.`); return result;
  } },
  pairingRegistry: { hostFingerprint: fixture.hostIdentity.fingerprint, load: async () => [peer], add: async () => { throw Error(); }, remove: async () => {} },
  store: { read() { throw Error(); }, create() { throw Error(); }, edit() { throw Error(); } },
});
if (usb) call(['reverse', `tcp:${host.port}`, `tcp:${host.port}`]);
call(['shell', '-T', 'run-as', pkg, 'sh', '-c', "'cat > no_backup/ca.pem'"], fixture.ca);
call(['shell', '-T', 'run-as', pkg, 'sh', '-c', "'cat > no_backup/config.json'"], JSON.stringify({
  transportAddress: address, port: host.port, hostFingerprint: host.hostFingerprint, vehicleGreetings: true, vehicleHarnessAdbReverse: usb,
}));
console.log('Attended vehicle host ready. Only this explicitly selected test installation is enrolled; no record access.');
const interval = setInterval(() => console.log(`Current vehicle sessions: ${sessions.inspect().activeSessions}.`), 60000);
let closing;
const close = () => closing ??= (async () => {
  clearInterval(interval); await host.close();
  if (usb) try { call(['reverse', '--remove', `tcp:${host.port}`]); } catch { }
  fixture.cleanup();
})();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, close);
