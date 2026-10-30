// Generate an owner-local 90-day TLS identity. Never changes a phone's trust/pin.
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';

const directory = process.argv[2];
const root = fileURLToPath(new URL('../', import.meta.url));
const rel = directory && relative(root, resolve(directory));
if (!directory || !isAbsolute(directory) || (!rel.startsWith('..') && !isAbsolute(rel)) || existsSync(directory)) {
  throw Error('Choose a new absolute private directory outside the checkout.');
}
mkdirSync(directory, { mode: 0o700 });
try {
  if (process.platform === 'win32') {
    const sid = execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true }).match(/S-1-5-[0-9-]+/)[0];
    execFileSync('icacls', [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { stdio: 'pipe', windowsHide: true });
  }
  const gitOpenSSL = 'C:/Program Files/Git/usr/bin/openssl.exe';
  const openssl = existsSync(gitOpenSSL) ? gitOpenSSL : 'openssl';
  execFileSync(openssl, ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-noenc',
    '-keyout', join(directory, 'host.key'), '-out', join(directory, 'host.pem'), '-days', '90', '-subj', '/CN=Home Vehicle Host',
    '-addext', 'basicConstraints=critical,CA:FALSE', '-addext', 'keyUsage=critical,digitalSignature',
    '-addext', 'extendedKeyUsage=serverAuth', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'],
  { stdio: 'pipe', windowsHide: true, timeout: 30_000 });
  const cert = new X509Certificate(readFileSync(join(directory, 'host.pem')));
  console.log(`Created private host identity; expires ${cert.validTo}. Provision its public certificate and SHA-256 pin through the existing trusted enrollment channel. No phone or running configuration changed.`);
} catch {
  throw Error('Identity provisioning failed. Inspect the private output directory; existing configuration was not changed.');
}
